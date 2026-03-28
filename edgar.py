import os
import requests
import pandas as pd

# --- SEC REQUIRED HEADER ---
# The SEC requires a User-Agent with your name and email to access EDGAR.
# Set SEC_USER_AGENT in your .env file, e.g.:
#   SEC_USER_AGENT=Jane Doe myemail@example.com
_sec_agent = os.getenv("SEC_USER_AGENT", "FinanceTerminal user@example.com")
SEC_HEADERS = {
    'User-Agent': _sec_agent
}


def get_cik_from_ticker(ticker):
    """Maps a standard stock ticker to the SEC's required 10-digit CIK."""
    ticker = ticker.upper()
    url = "https://www.sec.gov/files/company_tickers.json"

    try:
        response = requests.get(url, headers=SEC_HEADERS)
        data = response.json()

        # The SEC returns a dictionary of dictionaries. We loop through to find the match.
        for key, company in data.items():
            if company['ticker'] == ticker:
                # The SEC API requires the CIK to be exactly 10 digits, padded with leading zeros
                cik_str = str(company['cik_str']).zfill(10)
                return cik_str
        return None
    except Exception as e:
        print(f"Error fetching CIK mapping: {e}")
        return None


def get_recent_filings(ticker):
    """Fetches the latest SEC filings (10-K, 10-Q, 8-K) for a given ticker."""
    cik = get_cik_from_ticker(ticker)

    if not cik:
        return None, "Ticker not found in SEC database."

    # The Submissions API endpoint gives us the filing history
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"

    try:
        response = requests.get(url, headers=SEC_HEADERS)
        data = response.json()

        # Extract the recent filings data
        recent = data.get('filings', {}).get('recent', {})
        if not recent:
            return None, "No filings found."

        # Convert the raw dictionary lists into a clean Pandas DataFrame
        df = pd.DataFrame({
            'Filing Date': recent.get('filingDate', []),
            'Form Type': recent.get('form', []),
            'Accession Number': recent.get('accessionNumber', []),
            'Primary Document': recent.get('primaryDocument', [])
        })

        # Filter for the important fundamental forms: 10-K (Annual), 10-Q (Quarterly), 8-K (Current Events)
        fundamental_forms = ['10-K', '10-Q', '8-K']
        df_filtered = df[df['Form Type'].isin(fundamental_forms)].head(10)

        return df_filtered, data.get('name')

    except Exception as e:
        return None, f"Error pulling SEC data: {e}"



# ── Institutional Holders via EDGAR 13F ──────────────────────────────────────

_HOLDERS_CACHE: dict = {}   # ticker -> {"data": list, "ts": float}
_HOLDERS_TTL = 86400        # 24h — 13F filings are quarterly

# SEC EDGAR full-text search (search-index, not EFTS/v1 which is IP-restricted)
_EFTS_URL = "https://efts.sec.gov/LATEST/search-index"
_ARCH_URL = "https://www.sec.gov/Archives/edgar/data"

# Max concurrent XML fetches — stay well within SEC rate-limit guidelines
_MAX_WORKERS = 12
# Max EFTS pages to collect (100 hits/page × 100 pages = 10,000 = EFTS hard cap)
_MAX_PAGES = 100
# Seconds to sleep per _fetch_one call
_SEC_DELAY = 0.08

# ── Full-quarter index scan (background) ────────────────────────────────────
_FULL_IDX_DIR   = os.path.join(os.path.dirname(__file__), ".edgar_cache")
_FULL_WORKERS   = 4       # 4 workers × 0.4 s = 10 req/s (SEC rate limit)
_FULL_DELAY     = 0.4
_FULL_SCAN_RUNNING: set = set()   # tickers currently being background-scanned
_CUSIP_CACHE: dict = {}           # ticker → CUSIP, session-level
_QUARTER_IDX_TTL = 7 * 86400     # re-download form.idx weekly (late filers trickle in)


def _bootstrap_cusip(ticker: str, file_start: str, file_end: str) -> str | None:
    """
    Discover the CUSIP for `ticker` by fetching the first EFTS hit (name search),
    downloading its infotable XML, and extracting the <cusip> field.
    Result cached in _CUSIP_CACHE for the process lifetime.
    """
    import xml.etree.ElementTree as ET
    import time

    tk = ticker.upper()
    if tk in _CUSIP_CACHE:
        return _CUSIP_CACHE[tk]

    try:
        resp = requests.get(
            _EFTS_URL,
            params={"q": f'"{tk}"', "forms": "13F-HR",
                    "dateRange": "custom", "startdt": file_start, "enddt": file_end,
                    "from": 0, "size": 5},
            headers=SEC_HEADERS, timeout=20,
        )
        hits = resp.json().get("hits", {}).get("hits", [])
    except Exception:
        return None

    for hit in hits:
        src    = hit.get("_source", {})
        hit_id = hit.get("_id", "")
        adsh   = src.get("adsh", "")
        ciks   = src.get("ciks", ["0"])
        if not adsh or ":" not in hit_id:
            continue
        xml_file   = hit_id.split(":", 1)[1]
        acc_nodash = adsh.replace("-", "")
        filer_cik  = (ciks[0] if ciks else "0").lstrip("0") or "0"
        xml_url    = f"{_ARCH_URL}/{filer_cik}/{acc_nodash}/{xml_file}"
        try:
            time.sleep(_SEC_DELAY)
            r = requests.get(xml_url, headers=SEC_HEADERS, timeout=12)
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.text)
        except Exception:
            continue
        ns_uri = root.tag.split("}")[0].lstrip("{") if "}" in root.tag else ""
        p      = f"{{{ns_uri}}}" if ns_uri else ""
        for entry in root.iter(f"{p}infoTable"):
            name = (entry.findtext(f"{p}nameOfIssuer") or "").strip().upper()
            if tk in name:
                cusip = (entry.findtext(f"{p}cusip") or "").strip()
                if cusip:
                    _CUSIP_CACHE[tk] = cusip
                    return cusip
    return None


def _current_quarter_window() -> tuple[str, str]:
    """
    Returns (startdt, enddt) for the filing window of the most recently completed
    13F quarter. 13F-HR must be filed within 45 days of quarter end:
      Q1 (Mar 31) → due May 15   Q2 (Jun 30) → due Aug 14
      Q3 (Sep 30) → due Nov 14   Q4 (Dec 31) → due Feb 14
    We add a 90-day buffer after the deadline to catch late filers.
    """
    from datetime import date, timedelta
    today = date.today()
    yr    = today.year
    candidates = [
        date(yr - 1, 12, 31), date(yr, 3, 31),
        date(yr, 6, 30),      date(yr, 9, 30),
        date(yr, 12, 31),
    ]
    completed = [q for q in candidates if (today - q).days >= 45]
    qend  = max(completed)
    start = (qend + timedelta(days=1)).strftime("%Y-%m-%d")
    end   = (qend + timedelta(days=135)).strftime("%Y-%m-%d")
    return start, end


def _efts_hits(query: str, startdt: str, enddt: str) -> list[dict]:
    """
    Collect up to _MAX_PAGES × 100 EFTS hits for 13F-HR filings mentioning `query`
    filed within [startdt, enddt]. Each hit's `_id` is `{accession}:{xml_filename}`.
    """
    hits: list[dict] = []
    for page in range(_MAX_PAGES):
        try:
            resp = requests.get(
                _EFTS_URL,
                params={
                    "q":         query,
                    "forms":     "13F-HR",
                    "dateRange": "custom",
                    "startdt":   startdt,
                    "enddt":     enddt,
                    "from":      page * 100,
                    "size":      100,
                },
                headers=SEC_HEADERS,
                timeout=20,
            )
            page_hits = resp.json().get("hits", {}).get("hits", [])
            hits.extend(page_hits)
            if len(page_hits) < 100:
                break   # last page
        except Exception:
            break
    return hits


def _current_quarter() -> tuple[int, int]:
    """Returns (year, qtr) for the most recently completed 13F quarter."""
    from datetime import date
    today = date.today()
    yr    = today.year
    candidates = [
        (yr-1, 4, date(yr-1, 12, 31)),
        (yr,   1, date(yr,   3,  31)),
        (yr,   2, date(yr,   6,  30)),
        (yr,   3, date(yr,   9,  30)),
        (yr,   4, date(yr,  12,  31)),
    ]
    completed = [(y, q, d) for y, q, d in candidates if (today - d).days >= 45]
    y, q, _ = max(completed, key=lambda x: x[2])
    return y, q


def _quarterly_index(year: int, qtr: int) -> list[tuple[str, str, str, str]]:
    """
    Download + parse SEC EDGAR quarterly form.idx. Returns list of
    (cik, accession_dashed, entity_name, date_filed) for all 13F-HR filings.
    Cached to disk weekly; safe to call from a background thread.
    """
    import pickle, time as _t
    os.makedirs(_FULL_IDX_DIR, exist_ok=True)
    cache_path = os.path.join(_FULL_IDX_DIR, f"{year}_Q{qtr}_idx.pkl")
    if os.path.exists(cache_path):
        if _t.time() - os.path.getmtime(cache_path) < _QUARTER_IDX_TTL:
            with open(cache_path, "rb") as f:
                return pickle.load(f)

    url  = f"https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{qtr}/form.idx"
    resp = requests.get(url, headers=SEC_HEADERS, timeout=90)
    resp.raise_for_status()

    results: list[tuple[str, str, str, str]] = []
    for line in resp.text.splitlines():
        if not line.startswith("13F-HR"):
            continue
        # Fixed-width columns: form[0:12] company[12:74] cik[74:86] date[86:98] file[98:]
        entity     = line[12:74].strip()
        date_filed = line[86:98].strip()
        filename   = line[98:].strip()          # edgar/data/{cik}/{acc}.txt  or  .../acc-index.htm
        parts      = filename.split("/")
        if len(parts) < 4:
            continue
        cik  = parts[2]
        last = parts[-1]
        if last.endswith(".txt"):
            accession = last[:-4]               # "0001234567-26-000001"
        elif "-index" in last:
            accession = last.split("-index")[0]
        else:
            continue
        results.append((cik, accession, entity, date_filed))

    with open(cache_path, "wb") as f:
        pickle.dump(results, f)
    return results


def _infotable_url(cik: str, accession: str) -> str | None:
    """
    Fetch the filing index JSON and return the URL of the INFORMATION TABLE XML.
    Sleeps _FULL_DELAY before the request (caller provides rate-limit context).
    """
    import time
    acc_nodash = accession.replace("-", "")
    idx_url    = (f"https://www.sec.gov/Archives/edgar/data/{cik}/"
                  f"{acc_nodash}/{accession}-index.json")
    try:
        time.sleep(_FULL_DELAY)
        r = requests.get(idx_url, headers=SEC_HEADERS, timeout=10)
        if r.status_code != 200:
            return None
        items    = r.json().get("directory", {}).get("item", [])
        xml_file = next(
            (it["name"] for it in items
             if it.get("type") == "INFORMATION TABLE"
             or it.get("name", "").lower().endswith("_infotable.xml")),
            None,
        )
        if not xml_file:
            return None
        return f"{_ARCH_URL}/{cik}/{acc_nodash}/{xml_file}"
    except Exception:
        return None


def _fetch_one_full(cik: str, accession: str, entity: str, date_filed: str,
                    cusip: str | None, ticker: str) -> dict | None:
    """
    Full-scan variant of _fetch_one. Used by the background daemon thread.
    Discovers the infotable XML via the filing index JSON, then parses it.
    """
    import time
    xml_url = _infotable_url(cik, accession)   # includes one _FULL_DELAY sleep
    if not xml_url:
        return None
    try:
        time.sleep(_FULL_DELAY)
        resp = requests.get(xml_url, headers=SEC_HEADERS, timeout=15)
        if resp.status_code != 200:
            return None
        # Quick text check before full XML parse — skip if CUSIP not present
        if cusip and cusip.upper() not in resp.text.upper():
            return None
        shares, value, has_opts, port_total = _parse_infotable(resp.text, cusip, ticker)
        if shares is None and value is None:
            return None
        pct_port = (value / port_total) if (port_total and value) else None
        return {
            "name":          entity,
            "shares":        shares,
            "value":         value,
            "pctOut":        None,
            "change":        None,
            "changePct":     None,
            "dateReported":  date_filed,
            "holderType":    "Institution",
            "source":        "13F",
            "portName":      "",
            "hasOptions":    has_opts,
            "estHoldPeriod": None,
            "pctPortfolio":  pct_port,
        }
    except Exception:
        return None


def _start_full_scan(ticker: str, cusip: str | None, known_accessions: set) -> None:
    """
    Spawns a daemon thread that scans every 13F-HR filing for the current quarter
    (excluding those already found by EFTS), writes holders to disk, then invalidates
    the in-memory cache so the next call picks up the complete picture.
    """
    import threading, json, time
    tk = ticker.upper()

    def _run():
        try:
            year, qtr      = _current_quarter()
            all_filings    = _quarterly_index(year, qtr)
            remaining      = [(cik, acc, name, dt) for cik, acc, name, dt in all_filings
                              if acc not in known_accessions]
            holders: list[dict] = []
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=_FULL_WORKERS) as pool:
                futures = {
                    pool.submit(_fetch_one_full, cik, acc, name, dt, cusip, tk): acc
                    for cik, acc, name, dt in remaining
                }
                for future in concurrent.futures.as_completed(futures):
                    result = future.result()
                    if result:
                        holders.append(result)
            holders.sort(key=lambda x: x.get("value") or 0, reverse=True)
            os.makedirs(_FULL_IDX_DIR, exist_ok=True)
            cache_path = os.path.join(_FULL_IDX_DIR, f"{year}_Q{qtr}_{tk}.json")
            with open(cache_path, "w") as f:
                json.dump({"holders": holders, "ts": time.time()}, f)
            _HOLDERS_CACHE.pop(tk, None)   # invalidate so next call merges full results
        finally:
            _FULL_SCAN_RUNNING.discard(tk)

    t = threading.Thread(target=_run, daemon=True, name=f"edgar-full-{tk}")
    t.start()


def _parse_infotable(xml_text: str, cusip: str | None, ticker: str) -> tuple[int | None, float | None, bool, float]:
    """
    Parse a 13F infotable XML.

    Returns (shares, value_usd, has_options, portfolio_total) where:
    - shares / value_usd  — position in the target security
    - has_options         — True if a putCall element is present
    - portfolio_total     — sum of ALL <value> entries in this filer's XML,
                            used to compute pctPortfolio = value / portfolio_total
    """
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None, None, False, 0.0

    ns_uri = root.tag.split("}")[0].lstrip("{") if "}" in root.tag else ""
    p      = f"{{{ns_uri}}}" if ns_uri else ""

    target_shares: int | None   = None
    target_value:  float | None = None
    has_opts       = False
    portfolio_total = 0.0

    for entry in root.iter(f"{p}infoTable"):
        entry_cusip = (entry.findtext(f"{p}cusip") or "").strip().upper()
        entry_name  = (entry.findtext(f"{p}nameOfIssuer") or "").strip().upper()
        raw_val     = (entry.findtext(f"{p}value") or "0").replace(",", "")

        try:
            entry_val = float(raw_val)
        except ValueError:
            entry_val = 0.0

        portfolio_total += entry_val  # accumulate every row for portfolio total

        is_target = (cusip and entry_cusip == cusip.upper()) or (ticker.upper() in entry_name)
        if is_target and target_shares is None:   # first match wins
            soa = entry.find(f"{p}shrsOrPrnAmt")
            shares_raw = (
                (soa.findtext(f"{p}sshPrnamt") if soa is not None else None)
                or entry.findtext(f"{p}sshPrnamt")
                or "0"
            )
            has_opts = entry.findtext(f"{p}putCall") is not None
            try:
                target_shares = int(float(shares_raw.replace(",", "")))
                target_value  = entry_val
            except Exception:
                pass

    return target_shares, target_value, has_opts, portfolio_total


def _fetch_one(hit: dict, cusip: str | None, ticker: str) -> dict | None:
    """
    Given a single EFTS hit, fetch its infotable XML and return a holder dict,
    or None if the target security is not found in that filing.
    """
    src      = hit.get("_source", {})
    hit_id   = hit.get("_id", "")                        # "XXXX-YY-ZZZZ:filename.xml"
    adsh     = src.get("adsh", "")                       # "XXXX-YY-ZZZZ"
    ciks     = src.get("ciks", ["0"])
    names    = src.get("display_names", ["Unknown"])
    period   = src.get("period_ending", src.get("file_date", ""))

    if not adsh or not hit_id:
        return None

    # Extract XML filename from hit _id (format: "{accession}:{filename}")
    xml_file = hit_id.split(":", 1)[1] if ":" in hit_id else None
    if not xml_file:
        return None

    acc_nodash = adsh.replace("-", "")
    filer_cik  = (ciks[0] if ciks else "0").lstrip("0") or "0"
    entity     = names[0].split("  (CIK")[0].strip() if names else "Unknown"

    xml_url = f"{_ARCH_URL}/{filer_cik}/{acc_nodash}/{xml_file}"
    try:
        import time as _time
        _time.sleep(_SEC_DELAY)   # SEC rate-limit: ≈ _MAX_WORKERS / _SEC_DELAY ≤ 10 req/s

        resp = requests.get(xml_url, headers=SEC_HEADERS, timeout=12)
        if resp.status_code != 200:
            return None

        shares, value, has_opts, port_total = _parse_infotable(resp.text, cusip, ticker)
        if shares is None and value is None:
            return None

        pct_port = (value / port_total) if (port_total and value) else None

        return {
            "name":          entity,
            "shares":        shares,
            "value":         value,
            "pctOut":        None,       # back-filled in app.py using sharesOutstanding
            "change":        None,
            "changePct":     None,
            "dateReported":  period[:10] if period else None,
            "holderType":    "Institution",
            "source":        "13F",
            "portName":      "",
            "hasOptions":    has_opts,
            "estHoldPeriod": None,
            "pctPortfolio":  pct_port,   # COMPUTED: position_value / filer_total_portfolio
        }
    except Exception:
        return None


def get_institutional_holders_edgar(ticker: str) -> list[dict]:
    """
    Comprehensive 13F reverse lookup for `ticker`.

    Phase 1 (fast, ~30-120 s): Bootstrap exact CUSIP from first EFTS XML hit,
    then query EFTS with the precise CUSIP string for up to 10,000 filers.
    Concurrent XML fetch + parse via ThreadPoolExecutor.

    Phase 2 (background daemon thread, ~20-30 min first time):
    Download the SEC quarterly form.idx, scan every 13F-HR filer NOT already found
    in Phase 1, write results to .edgar_cache/{year}_Q{qtr}_{ticker}.json.
    On the *next* call the disk cache is merged in automatically.

    Results are in-memory cached for 24 h.
    """
    import time
    import json
    import concurrent.futures

    tk  = ticker.upper()
    now = time.time()

    cached = _HOLDERS_CACHE.get(tk)
    if cached and now - cached["ts"] < _HOLDERS_TTL:
        return cached["data"]

    # ── Phase 1: EFTS search with bootstrapped CUSIP ─────────────────────────
    file_start, file_end = _current_quarter_window()
    cusip = _bootstrap_cusip(tk, file_start, file_end)
    query = f'"{cusip}"' if cusip else f'"{tk}"'
    hits  = _efts_hits(query, file_start, file_end)
    if not hits and cusip:                      # fallback: name search
        hits = _efts_hits(f'"{tk}"', file_start, file_end)

    # Track accessions Phase 1 already covers (skip in background scan)
    efts_accessions = {h.get("_source", {}).get("adsh", "") for h in hits}

    # ── Merge any completed background full-scan results from disk ────────────
    year, qtr = _current_quarter()
    scan_path = os.path.join(_FULL_IDX_DIR, f"{year}_Q{qtr}_{tk}.json")
    full_scan_holders: list[dict] = []
    if os.path.exists(scan_path):
        try:
            with open(scan_path) as f:
                full_scan_holders = json.load(f).get("holders", [])
        except Exception:
            pass

    # ── Start background full-scan if not already running / completed ─────────
    if tk not in _FULL_SCAN_RUNNING and not os.path.exists(scan_path):
        _FULL_SCAN_RUNNING.add(tk)
        _start_full_scan(tk, cusip, efts_accessions)

    # ── Deduplicate EFTS hits by entity name, concurrent XML fetch ────────────
    best: dict[str, dict] = {}
    for hit in hits:
        src   = hit.get("_source", {})
        names = src.get("display_names", [""])
        key   = names[0].split("  (CIK")[0].strip() if names else ""
        if not key:
            continue
        existing = best.get(key)
        if existing is None or src.get("file_date", "") > existing["_source"].get("file_date", ""):
            best[key] = hit

    holders: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_one, hit, cusip, tk): hit for hit in best.values()}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            if result:
                holders.append(result)

    # ── Merge full-scan stragglers (not already in EFTS results) ─────────────
    efts_names = {h["name"].lower() for h in holders}
    for fh in full_scan_holders:
        if fh["name"].lower() not in efts_names:
            holders.append(fh)

    holders.sort(key=lambda x: x.get("value") or 0, reverse=True)
    _HOLDERS_CACHE[tk] = {"data": holders, "ts": now}
    return holders


# ── ETF Holdings via N-PORT ──────────────────────────────────────────────────

def _parse_nport_xml(cik_stripped: str, acc: str, acc_date: str) -> tuple[dict, dict, float | None, float | None, str]:
    """
    Fetch and parse a single N-PORT XML filing.

    Returns (holdings_by_cusip, metadata, total_assets, net_assets, period) where:
      holdings_by_cusip : {cusip: {name, ticker, shares, balance, units, valUSD, pctVal, assetCat, country}}
      metadata          : raw fund-level fields
      total_assets      : float or None
      net_assets        : float or None
      period            : report date string
    """
    import time
    import xml.etree.ElementTree as ET

    acc_nodash = acc.replace('-', '')

    # Discover primary XML filename from filing index
    xml_filename = 'primary_doc.xml'
    try:
        time.sleep(_SEC_DELAY)
        idx_url = f"{_ARCH_URL}/{cik_stripped}/{acc_nodash}/{acc}-index.json"
        idx_r = requests.get(idx_url, headers=SEC_HEADERS, timeout=10)
        if idx_r.status_code == 200:
            items = idx_r.json().get('directory', {}).get('item', [])
            xml_files = [it['name'] for it in items
                         if it.get('name', '').lower().endswith('.xml')
                         and 'index' not in it.get('name', '').lower()]
            if xml_files:
                xml_filename = xml_files[0]
    except Exception:
        pass

    xml_url = f"{_ARCH_URL}/{cik_stripped}/{acc_nodash}/{xml_filename}"
    try:
        time.sleep(_SEC_DELAY)
        xml_r = requests.get(xml_url, headers=SEC_HEADERS, timeout=60)
        if xml_r.status_code != 200:
            return {}, {}, None, None, acc_date
        root = ET.fromstring(xml_r.content)
    except Exception:
        return {}, {}, None, None, acc_date

    ns_uri = root.tag.split('}')[0].lstrip('{') if '}' in root.tag else ''
    p      = f'{{{ns_uri}}}' if ns_uri else ''

    # Fund-level metadata
    total_assets = None
    net_assets   = None
    period       = acc_date
    for fi in root.iter(f'{p}fundInfo'):
        def _flt(tag):
            try: return float((fi.findtext(f'{p}{tag}') or '0').replace(',', ''))
            except: return None
        total_assets = _flt('totAssets') or _flt('totalAssets')
        net_assets   = _flt('netAssets')
        rpt = fi.findtext(f'{p}repPdDate') or fi.findtext(f'{p}reportDate')
        if rpt:
            period = rpt[:10]
        break

    # Parse holdings keyed by CUSIP (most stable identifier across filings)
    holdings_by_cusip: dict = {}
    for inv in root.iter(f'{p}invstOrSec'):
        name  = (inv.findtext(f'{p}name') or '').strip()
        if not name:
            continue
        cusip = (inv.findtext(f'{p}cusip') or '').strip()

        ticker_val = ''
        for idents in inv.iter(f'{p}identifiers'):
            t_el = idents.find(f'{p}ticker')
            if t_el is not None:
                ticker_val = (t_el.get('tickerValue') or t_el.text or '').strip()
            break

        def _num(tag):
            try: return float((inv.findtext(f'{p}{tag}') or '').replace(',', ''))
            except: return None

        balance  = _num('balance')
        val_usd  = _num('valUSD')
        pct_val  = _num('pctVal')
        units    = (inv.findtext(f'{p}units') or '').strip()
        asset_cat= (inv.findtext(f'{p}assetCat') or '').strip()
        country  = (inv.findtext(f'{p}invCountry') or '').strip()

        key = cusip if cusip else name  # fall back to name if no CUSIP
        holdings_by_cusip[key] = {
            'name':      name,
            'ticker':    ticker_val,
            'cusip':     cusip,
            'shares':    int(balance) if (balance is not None and units == 'NS') else None,
            'balance':   balance,
            'units':     units,
            'valUSD':    val_usd,
            'pctVal':    pct_val,
            'assetCat':  asset_cat,
            'country':   country,
        }

    return holdings_by_cusip, {}, total_assets, net_assets, period


def get_etf_holdings_nport(ticker: str) -> dict:
    """
    Fetch complete ETF holdings for ANY ETF from SEC N-PORT filings.

    Fetches the two most recent N-PORT filings and diffs share counts by CUSIP
    to compute position changes (sharesChg) — works for all US-listed ETFs,
    not just ARK funds.

    Returns a dict with:
        holdings    : list of holding dicts (with sharesChg populated)
        trades      : list of notable change dicts (new/increased/decreased/exited)
        filingDate  : latest period end date (YYYY-MM-DD)
        prevDate    : previous period date (YYYY-MM-DD) or None
        totalAssets : float or None
        netAssets   : float or None
        numHoldings : int
        source      : 'EDGAR N-PORT'
    Returns {} on any failure.
    """
    import time

    tk = ticker.upper()

    # 1. Resolve CIK
    cik = get_cik_from_ticker(tk)
    if not cik:
        return {}

    cik_stripped = cik.lstrip('0') or '0'

    # 2. Collect up to 2 most recent N-PORT accession numbers
    sub_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        time.sleep(_SEC_DELAY)
        resp = requests.get(sub_url, headers=SEC_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return {}

    recent     = data.get('filings', {}).get('recent', {})
    forms      = recent.get('form', [])
    accessions = recent.get('accessionNumber', [])
    dates      = recent.get('filingDate', [])

    nport_filings: list[tuple[str, str]] = []   # [(acc, date), ...]
    for form, acc, date in zip(forms, accessions, dates):
        if form in ('N-PORT', 'N-PORT-P', 'N-PORT/A', 'N-PORT-P/A'):
            nport_filings.append((acc, date))
            if len(nport_filings) == 2:
                break

    if not nport_filings:
        return {}

    # 3. Parse latest filing (always), and previous filing for diff
    curr_acc, curr_date = nport_filings[0]
    curr_map, _, total_assets, net_assets, period = _parse_nport_xml(
        cik_stripped, curr_acc, curr_date
    )
    if not curr_map:
        return {}

    prev_map: dict = {}
    prev_date = None
    if len(nport_filings) >= 2:
        prev_acc, prev_date = nport_filings[1]
        prev_map, _, _, _, _ = _parse_nport_xml(cik_stripped, prev_acc, prev_date)

    # 4. Build holdings list with sharesChg from diff
    holdings = []
    for key, h in curr_map.items():
        prev = prev_map.get(key)
        shares_now  = h['shares']
        shares_prev = prev['shares'] if prev else None

        if shares_now is not None and shares_prev is not None:
            shares_chg = shares_now - shares_prev
        elif shares_now is not None and prev is None:
            shares_chg = shares_now  # new position
        else:
            shares_chg = None

        holdings.append({
            'name':        h['name'],
            'ticker':      h['ticker'],
            'cusip':       h['cusip'],
            'shares':      shares_now,
            'sharesChg':   shares_chg,
            'weight':      round(h['pctVal'], 4) if h['pctVal'] is not None else None,
            'marketValue': h['valUSD'],
            'sharePrice':  None,
            'assetCat':    h['assetCat'],
            'country':     h['country'],
            'isNew':       prev is None and prev_map,   # new position this period
            'rank':        0,
        })

    # Sort by market value, assign ranks
    holdings.sort(key=lambda h: h['marketValue'] or 0, reverse=True)
    for i, h in enumerate(holdings):
        h['rank'] = i + 1

    # 5. Build trades/insights list from meaningful changes
    trades = []
    if prev_map:
        # New positions
        for key, h in curr_map.items():
            if key not in prev_map and h['shares']:
                trades.append({
                    'ticker':    h['ticker'],
                    'company':   h['name'],
                    'direction': 'Buy',
                    'shares':    h['shares'],
                    'etfPct':    h['pctVal'] or 0,
                    'note':      'New position',
                    'date':      period,
                })
        # Fully exited positions
        for key, h in prev_map.items():
            if key not in curr_map and h['shares']:
                trades.append({
                    'ticker':    h['ticker'],
                    'company':   h['name'],
                    'direction': 'Sell',
                    'shares':    h['shares'],
                    'etfPct':    h.get('pctVal') or 0,
                    'note':      'Position closed',
                    'date':      period,
                })
        # Large changes (>5% move in share count)
        for key, h in curr_map.items():
            prev = prev_map.get(key)
            if not prev:
                continue
            s_now  = h['shares']
            s_prev = prev['shares']
            if s_now and s_prev and s_prev != 0:
                pct_chg = (s_now - s_prev) / s_prev * 100
                if abs(pct_chg) >= 5:
                    trades.append({
                        'ticker':    h['ticker'],
                        'company':   h['name'],
                        'direction': 'Buy' if pct_chg > 0 else 'Sell',
                        'shares':    abs(s_now - s_prev),
                        'etfPct':    h['pctVal'] or 0,
                        'note':      f'{pct_chg:+.1f}% change',
                        'date':      period,
                    })

        # Sort: new positions first, then by absolute share change size
        trades.sort(key=lambda t: (t['note'] != 'New position', -(t['shares'] or 0)))

    return {
        'holdings':    holdings,
        'trades':      trades,
        'filingDate':  period,
        'prevDate':    prev_date,
        'totalAssets': total_assets,
        'netAssets':   net_assets,
        'numHoldings': len(holdings),
        'source':      'EDGAR N-PORT',
    }


# --- Quick Local Test ---
if __name__ == "__main__":
    print("Pinging the SEC EDGAR Database...")
    filings_df, company_name = get_recent_filings("AAPL")

    if filings_df is not None:
        print(f"\nRecent Filings for {company_name}:")
        print(filings_df.to_string(index=False))
    else:
        print(company_name)  # This prints the error message if it failed