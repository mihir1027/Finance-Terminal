"""
research.py — Financial research aggregator (PDF-focused).
Scrapes RSS feeds and structured HTML pages from ~20 institutions.
Each result includes pdf_url when a direct PDF can be found.
Returns a flat list of {id, institution, category, title, url, pdf_url, date, summary}.
"""

import re
import feedparser
import requests
from bs4 import BeautifulSoup
import concurrent.futures
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

SOURCES = [
    # (id, name, category, type, url, hint)
    ("nber",        "NBER",                "academic",      "rss",  "https://www.nber.org/rss/new.xml",                             None),
    ("ny_fed",      "NY Fed",              "central_bank",  "rss",  "https://www.newyorkfed.org/feeds/research_papers",             None),
    ("fed_feds",    "Federal Reserve",     "central_bank",  "rss",  "https://www.federalreserve.gov/feeds/feds.xml",                None),
    ("bis_wp",      "BIS Working Papers",  "multilateral",  "rss",  "https://www.bis.org/rss/wpapers.rss",                         None),
    ("bis_qr",      "BIS Qtly Review",     "multilateral",  "rss",  "https://www.bis.org/rss/qtrrev.rss",                          None),
    ("imf_wp",      "IMF",                 "multilateral",  "rss",  "https://www.imf.org/en/Publications/WP/rss",                  None),
    ("ecb_wp",      "ECB",                 "central_bank",  "rss",  "https://www.ecb.europa.eu/rss/wpapers.xml",                   None),
    ("stlouis",     "St. Louis Fed",       "central_bank",  "rss",  "https://research.stlouisfed.org/rss/wp.rss",                  None),
    ("chi_fed",     "Chicago Fed",         "central_bank",  "rss",  "https://www.chicagofed.org/publications/feed",                None),
    ("sf_fed",      "SF Fed",              "central_bank",  "rss",  "https://www.frbsf.org/feeds/research/",                       None),
    ("pimco",       "PIMCO",               "asset_manager", "rss",  "https://www.pimco.com/rss/insights",                         None),
    ("aqr",         "AQR",                 "quant_hf",      "rss",  "https://www.aqr.com/rss",                                    None),
    # HTML sources
    ("blackrock",   "BlackRock Institute", "asset_manager", "html", "https://www.blackrock.com/us/individual/insights",            "blackrock"),
    ("gs",          "Goldman Sachs",       "bank",          "html", "https://www.goldmansachs.com/intelligence",                   "gs"),
    ("jpmorgan",    "JPMorgan",            "bank",          "html", "https://www.jpmorgan.com/insights",                           "jpmorgan"),
    ("man",         "Man Institute",       "quant_hf",      "html", "https://www.man.com/maninstitute/research",                   "man"),
    ("bridgewater", "Bridgewater",         "quant_hf",      "html", "https://www.bridgewater.com/research-and-insights",           "bridgewater"),
    ("worldbank",   "World Bank",          "multilateral",  "html", "https://blogs.worldbank.org/en/research",                    "worldbank"),
    ("oaktree",     "Oaktree Capital",     "pe_credit",     "html", "https://www.oaktreecapital.com/insights",                    "oaktree"),
    ("blackstone",  "Blackstone",          "pe_credit",     "html", "https://www.blackstone.com/insights/",                      "blackstone"),
    ("apollo",      "Apollo Global",       "pe_credit",     "html", "https://www.apollo.com/insights",                           "apollo"),
    ("troweprice",  "T. Rowe Price",       "asset_manager", "html", "https://www.troweprice.com/investment-institute",            "troweprice"),
    ("wellington",  "Wellington Mgmt",     "asset_manager", "html", "https://www.wellington.com/en-us/institutional/insights",    "wellington"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────

def _strip(html_text):
    text = re.sub(r'<[^>]+>', ' ', html_text or '')
    return re.sub(r'\s+', ' ', text).strip()[:280]


def _parse_date(entry):
    for field in ('published', 'updated', 'created'):
        val = entry.get(field, '')
        if val:
            try:
                dt = parsedate_to_datetime(val)
                return dt.astimezone(timezone.utc).strftime('%Y-%m-%d')
            except Exception:
                pass
        struct = entry.get(f'{field}_parsed')
        if struct:
            try:
                return datetime(*struct[:3]).strftime('%Y-%m-%d')
            except Exception:
                pass
    return ''


def _is_pdf_url(url):
    return bool(url and re.search(r'\.pdf(\?|#|$)', url, re.I))


def _find_pdf_in_html(page_url, base, timeout=8):
    """Fetch an article page and look for the first PDF link."""
    try:
        r = requests.get(page_url, headers=HEADERS, timeout=timeout)
        if r.status_code != 200:
            return ''
        soup = BeautifulSoup(r.text, 'html.parser')
        for a in soup.find_all('a', href=True):
            href = a['href']
            if _is_pdf_url(href):
                if not href.startswith('http'):
                    href = base.rstrip('/') + '/' + href.lstrip('/')
                return href
    except Exception:
        pass
    return ''


def _derive_pdf_url(article_url):
    """Apply known URL → PDF transformations without a network request."""
    # Federal Reserve FEDS — links are already PDFs
    if _is_pdf_url(article_url):
        return article_url

    u = article_url

    # BIS: /publ/work123.htm → /publ/work123.pdf
    bis_m = re.match(r'(https://www\.bis\.org/publ/\w+)\.htm', u)
    if bis_m:
        return bis_m.group(1) + '.pdf'

    # BIS quarterly: /publ/qtrpdf_r_qt2401.htm → same .pdf
    bis_q = re.match(r'(https://www\.bis\.org/.+?)\.htm', u)
    if bis_q:
        return bis_q.group(1) + '.pdf'

    # ECB: /pub/pdf/scpwps/ecb.wp2400.en.pdf is often in the link already
    # ECB article pages: /pub/research-bulletin/articles/2024/... → need to follow
    # Just try appending .pdf as fallback for ecb
    if 'ecb.europa.eu' in u and not _is_pdf_url(u):
        return ''  # must follow page

    # IMF: /content/dam/.../english.pdf  pattern sometimes in RSS description
    # Fall through to follow-page approach

    # NBER: /papers/w12345 → /papers/w12345.pdf  (free for most working papers)
    nber_m = re.match(r'(https://www\.nber\.org/papers/w\d+)$', u)
    if nber_m:
        return nber_m.group(1) + '.pdf'

    # SF Fed: /economic-research/publications/working-papers/... → look on page
    # Chicago Fed: /publications/working-papers/... → look on page

    return ''


def _make(src_id, name, category, title, url, pdf_url='', date='', summary=''):
    return {
        "id":          src_id,
        "institution": name,
        "category":    category,
        "title":       title.strip(),
        "url":         url,
        "pdf_url":     pdf_url,
        "date":        date,
        "summary":     summary,
    }


def _get(url, timeout=12):
    return requests.get(url, headers=HEADERS, timeout=timeout)


# ─────────────────────────────────────────────
#  RSS PARSER
# ─────────────────────────────────────────────

def _parse_rss(src_id, name, category, feed_url):
    try:
        feed = feedparser.parse(feed_url)
        out = []
        for e in feed.entries[:15]:
            title = e.get('title', '').strip()
            link  = e.get('link', '')
            if not title or not link:
                continue

            # 1. Check RSS enclosures for a PDF
            pdf_url = ''
            for enc in e.get('enclosures', []):
                if 'pdf' in enc.get('type', '') or _is_pdf_url(enc.get('href', '')):
                    pdf_url = enc.get('href', '')
                    break

            # 2. Check if the link itself is a PDF
            if not pdf_url and _is_pdf_url(link):
                pdf_url = link

            # 3. Try known URL-pattern derivations (no network)
            if not pdf_url:
                pdf_url = _derive_pdf_url(link)

            # 4. Try finding a PDF link in the description/summary HTML
            if not pdf_url:
                desc = e.get('summary', '') + e.get('description', '')
                m = re.search(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', desc, re.I)
                if m:
                    pdf_url = m.group(1)

            out.append(_make(src_id, name, category, title, link, pdf_url,
                             _parse_date(e), _strip(e.get('summary', ''))))
        return out
    except Exception:
        return []


# ─────────────────────────────────────────────
#  HTML PARSERS — find PDFs alongside article links
# ─────────────────────────────────────────────

def _html_scrape(src_id, name, category, page_url, base):
    """Generic scraper: finds article cards and PDF links within each card."""
    try:
        r = _get(page_url)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, 'html.parser')
        out = []

        # Cast a wide net for cards
        cards = soup.select(
            'article, [class*="card"], [class*="insight"], [class*="article"], '
            '[class*="research"], [class*="post"], [class*="paper"], [class*="item"]'
        )

        seen_titles = set()
        for card in cards:
            t_el = card.find(['h2', 'h3', 'h4', 'h5'])
            if not t_el:
                continue
            title = t_el.get_text(strip=True)
            if not title or len(title) < 12 or title in seen_titles:
                continue
            seen_titles.add(title)

            # Find article link
            a_link = card.find('a', href=True)
            if not a_link:
                continue
            href = a_link['href']
            if not href.startswith('http'):
                href = base.rstrip('/') + '/' + href.lstrip('/')

            # Find PDF link within the same card
            pdf_url = ''
            for a in card.find_all('a', href=True):
                h = a['href']
                if _is_pdf_url(h):
                    if not h.startswith('http'):
                        h = base.rstrip('/') + '/' + h.lstrip('/')
                    pdf_url = h
                    break

            # If the article link itself is a PDF, use it
            if not pdf_url and _is_pdf_url(href):
                pdf_url = href

            # Date
            d_el = card.find('time') or card.select_one('[class*="date"]')
            date = ''
            if d_el:
                date = d_el.get('datetime', '') or d_el.get_text(strip=True)
                date = date[:10] if len(date) >= 10 else date

            out.append(_make(src_id, name, category, title, href, pdf_url, date))
            if len(out) >= 15:
                break

        return out
    except Exception:
        return []


# Per-institution wrappers (pass correct base URL)

def _parse_blackrock(name, cat, url):
    return _html_scrape('blackrock', name, cat, url, 'https://www.blackrock.com')

def _parse_gs(name, cat, url):
    return _html_scrape('gs', name, cat, url, 'https://www.goldmansachs.com')

def _parse_jpmorgan(name, cat, url):
    return _html_scrape('jpmorgan', name, cat, url, 'https://www.jpmorgan.com')

def _parse_man(name, cat, url):
    return _html_scrape('man', name, cat, url, 'https://www.man.com')

def _parse_bridgewater(name, cat, url):
    return _html_scrape('bridgewater', name, cat, url, 'https://www.bridgewater.com')

def _parse_worldbank(name, cat, url):
    return _html_scrape('worldbank', name, cat, url, 'https://blogs.worldbank.org')

def _parse_oaktree(name, cat, url):
    return _html_scrape('oaktree', name, cat, url, 'https://www.oaktreecapital.com')

def _parse_blackstone(name, cat, url):
    return _html_scrape('blackstone', name, cat, url, 'https://www.blackstone.com')

def _parse_apollo(name, cat, url):
    return _html_scrape('apollo', name, cat, url, 'https://www.apollo.com')

def _parse_troweprice(name, cat, url):
    return _html_scrape('troweprice', name, cat, url, 'https://www.troweprice.com')

def _parse_wellington(name, cat, url):
    return _html_scrape('wellington', name, cat, url, 'https://www.wellington.com')


# ─────────────────────────────────────────────
#  FOLLOW-PAGE PDF ENRICHMENT
# ─────────────────────────────────────────────

_FOLLOW_SOURCES = {
    # src_id → base URL (to resolve relative links)
    'ny_fed':   'https://www.newyorkfed.org',
    'ecb_wp':   'https://www.ecb.europa.eu',
    'stlouis':  'https://research.stlouisfed.org',
    'chi_fed':  'https://www.chicagofed.org',
    'sf_fed':   'https://www.frbsf.org',
    'imf_wp':   'https://www.imf.org',
    'aqr':      'https://www.aqr.com',
}

def _enrich_with_page_pdfs(papers):
    """
    For sources where we couldn't derive a PDF URL from the RSS link,
    follow the article page and look for a PDF link.
    Done in parallel; max 6 concurrent requests; only for papers missing pdf_url.
    """
    to_enrich = [p for p in papers if not p['pdf_url'] and p['id'] in _FOLLOW_SOURCES]

    def fetch_one(paper):
        base = _FOLLOW_SOURCES[paper['id']]
        pdf = _find_pdf_in_html(paper['url'], base, timeout=8)
        if pdf:
            paper['pdf_url'] = pdf

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_one, to_enrich))

    return papers


# ─────────────────────────────────────────────
#  DISPATCH
# ─────────────────────────────────────────────

_HTML_PARSERS = {
    'blackrock':   _parse_blackrock,
    'gs':          _parse_gs,
    'jpmorgan':    _parse_jpmorgan,
    'man':         _parse_man,
    'bridgewater': _parse_bridgewater,
    'worldbank':   _parse_worldbank,
    'oaktree':     _parse_oaktree,
    'blackstone':  _parse_blackstone,
    'apollo':      _parse_apollo,
    'troweprice':  _parse_troweprice,
    'wellington':  _parse_wellington,
}


def scrape_source(src):
    sid, name, cat, stype, url, hint = src
    try:
        if stype == 'rss':
            return _parse_rss(sid, name, cat, url)
        fn = _HTML_PARSERS.get(hint)
        if fn:
            return fn(name, cat, url)
    except Exception:
        pass
    return []


def scrape_all():
    """Scrape all sources in parallel, enrich with page-follow PDFs, sort by date."""
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for batch in ex.map(scrape_source, SOURCES):
            results.extend(batch)

    # Second pass: follow article pages to find PDFs for sources that need it
    results = _enrich_with_page_pdfs(results)

    dated   = [p for p in results if p.get('date')]
    undated = [p for p in results if not p.get('date')]
    dated.sort(key=lambda x: x['date'], reverse=True)
    return dated + undated
