"""
KINETIC TERMINAL — Backend Server
Run: python app.py
Then open: http://localhost:5000
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
from curves import get_ust_yield_curve
from providers import get_quote as provider_get_quote, finnhub_client
import requests
import config
import finnhub
import json
import traceback
from datetime import datetime, timedelta
import concurrent.futures
import pandas as pd
import os
import re as _re

app = Flask(__name__, static_folder=".")
CORS(app)

# ─────────────────────────────────────────────
#  CRYPTO HELPERS (Binance — no API key)
# ─────────────────────────────────────────────
_BINANCE_BASE_URL = "https://data-api.binance.vision/api/v3"

def _is_crypto_ticker(t):
    return bool(_re.match(r'^[A-Z0-9]+-USD$', t))

def _binance_sym(t):
    """BTC-USD -> BTCUSDT"""
    return t.replace('-USD', 'USDT').replace('-', '')

def _hp_binance(ticker, period='1y', interval='1d'):
    sym = _binance_sym(ticker)
    limit_map = {'1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825}
    iv_map    = {'1d': '1d', '1wk': '1w', '1mo': '1M'}
    try:
        r = requests.get(f"{_BINANCE_BASE_URL}/klines", params={
            "symbol":   sym,
            "interval": iv_map.get(interval, '1d'),
            "limit":    limit_map.get(period, 365),
        }, timeout=8)
        if r.status_code != 200:
            return None
        return [{
            "date":   datetime.fromtimestamp(k[0] / 1000).strftime('%Y-%m-%d'),
            "open":   round(float(k[1]), 8),
            "high":   round(float(k[2]), 8),
            "low":    round(float(k[3]), 8),
            "close":  round(float(k[4]), 8),
            "volume": float(k[5]),
        } for k in r.json()]
    except Exception:
        return None

# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────

def safe_get(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict):
            d = d.get(k, default)
        else:
            return default
    return d if d is not None else default

def fmt_large(n):
    if n is None: return "—"
    try:
        n = float(n)
        if n >= 1e12: return f"${n/1e12:.2f}T"
        if n >= 1e9:  return f"${n/1e9:.2f}B"
        if n >= 1e6:  return f"${n/1e6:.2f}M"
        return f"${n:,.0f}"
    except: return "—"

def fmt_pct(n):
    if n is None: return "—"
    try: return f"{float(n)*100:.2f}%"
    except: return "—"

def fmt_num(n, decimals=2):
    if n is None: return "—"
    try: return f"{float(n):,.{decimals}f}"
    except: return "—"

# ─────────────────────────────────────────────
#  ROUTES
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

# ── QUOTE (Q) ─────────────────────────────────
@app.route("/api/quote/<ticker>")
def quote(ticker):
    try:
        data = provider_get_quote(ticker)
        if not data:
            return jsonify({"ok": False, "error": "All providers failed to return data."})

        return jsonify({
            "ok": True,
            "ticker":    data.get("ticker", ticker.upper()),
            "name":      data.get("name", "—"),
            "price":     data.get("price"),
            "prev":      data.get("prev"),
            "change":    data.get("change"),
            "changePct": data.get("changePct"),
            "bid":       data.get("bid"),
            "ask":       data.get("ask"),
            "volume":    data.get("volume"),
            "avgVolume": data.get("avgVolume"),
            "high":      data.get("high"),
            "low":       data.get("low"),
            "open":      data.get("open"),
            "marketCap":    data.get("marketCap"),
            "marketCapFmt": fmt_large(data.get("marketCap")),
            "currency":  data.get("currency", "USD"),
            "exchange":  data.get("exchange", "—"),
            "source":    data.get("source"),
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── DES (Description) ─────────────────────────
_DES_CACHE     = {}   # ticker -> {"data": {...}, "ts": float}
_DES_INFO_TTL  = 300  # company info: 5 min
_DES_PRICE_TTL = 30   # price fields: 30 sec

@app.route("/api/des/<ticker>")
def des(ticker):
    import time as _t
    now    = _t.time()
    ticker = ticker.upper()
    cached = _DES_CACHE.get(ticker, {})

    # Serve fully cached response if fresh enough
    if cached.get("data") and now - cached.get("ts", 0) < _DES_INFO_TTL:
        payload = dict(cached["data"])
        # Refresh price from provider chain even when info is cached
        if now - cached.get("price_ts", 0) > _DES_PRICE_TTL:
            q = provider_get_quote(ticker)
            if q and q.get("price"):
                payload.update({"price": q["price"], "change": q.get("change"),
                                "changePct": q.get("changePct")})
                cached["price_ts"] = now
        return jsonify({"ok": True, **payload})

    try:
        t    = yf.Ticker(ticker)
        info = t.info

        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev  = info.get("previousClose")
        chg   = (price - prev) if (price and prev) else None
        pct   = ((chg / prev) * 100) if (chg and prev) else None

        # If yfinance didn't return a price, try provider chain
        if not price:
            q = provider_get_quote(ticker)
            if q and q.get("price"):
                price = q["price"]; chg = q.get("change"); pct = q.get("changePct")

        # 52W history for mini chart
        hist = t.history(period="1y", interval="1wk")
        chart_prices = hist["Close"].dropna().tolist()[-52:]
        chart_dates  = [str(d)[:10] for d in hist.index.tolist()[-52:]]

        data = {
            "ticker":  ticker,
            "name":    info.get("longName") or info.get("shortName", "—"),
            "shortName": info.get("shortName", "—"),
            "price":   price,
            "change":  chg,
            "changePct": pct,
            "currency": info.get("currency","USD"),
            "exchange": info.get("exchange","—"),
            "sector":  info.get("sector","—"),
            "industry":info.get("industry","—"),
            "country": info.get("country","—"),
            "employees": info.get("fullTimeEmployees"),
            "website":   info.get("website","—"),
            "description": info.get("longBusinessSummary","No description available."),
            "marketCap":   info.get("marketCap"),
            "marketCapFmt": fmt_large(info.get("marketCap")),
            "sharesOutstanding": info.get("sharesOutstanding"),
            "sharesOutFmt": fmt_large(info.get("sharesOutstanding","").replace("$","") if isinstance(info.get("sharesOutstanding",""), str) else info.get("sharesOutstanding")),
            "pe":    info.get("trailingPE"),
            "eps":   info.get("trailingEps"),
            "pbRatio": info.get("priceToBook"),
            "dividendYield": info.get("dividendYield"),
            "beta":  info.get("beta"),
            "hi52":  info.get("fiftyTwoWeekHigh"),
            "lo52":  info.get("fiftyTwoWeekLow"),
            "avg50": info.get("fiftyDayAverage"),
            "avg200":info.get("twoHundredDayAverage"),
            "chartPrices": chart_prices,
            "chartDates":  chart_dates,
            "address": f"{info.get('address1','')}, {info.get('city','')}, {info.get('state','')} {info.get('zip','')}",
        }
        _DES_CACHE[ticker] = {"data": data, "ts": now, "price_ts": now}
        return jsonify({"ok": True, **data})
    except Exception as e:
        # If yfinance is rate-limited, try serving stale cache rather than failing
        if cached.get("data"):
            return jsonify({"ok": True, **cached["data"], "_stale": True})
        return jsonify({"ok": False, "error": str(e), "trace": traceback.format_exc()})


# ── FA (Financials) ───────────────────────────
@app.route("/api/fa/<ticker>")
def financials(ticker):
    try:
        t = yf.Ticker(ticker)

        def df_to_list(df):
            if df is None or df.empty: return []
            df = df.iloc[:, :4]  # last 4 periods
            result = []
            for idx, row in df.iterrows():
                row_data = {"label": str(idx)}
                for col in df.columns:
                    val = row[col]
                    row_data[str(col)[:10]] = None if (val != val) else float(val)
                result.append(row_data)
            return result

        income  = df_to_list(t.financials)
        balance = df_to_list(t.balance_sheet)
        cashflow= df_to_list(t.cashflow)

        income_cols  = [str(c)[:10] for c in (t.financials.columns[:4] if not t.financials.empty else [])]
        balance_cols = [str(c)[:10] for c in (t.balance_sheet.columns[:4] if not t.balance_sheet.empty else [])]
        cf_cols      = [str(c)[:10] for c in (t.cashflow.columns[:4] if not t.cashflow.empty else [])]

        return jsonify({
            "ok": True,
            "ticker": ticker.upper(),
            "income":   income,
            "incomeCols":  income_cols,
            "balance":  balance,
            "balanceCols": balance_cols,
            "cashflow": cashflow,
            "cfCols":   cf_cols,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── G (Chart — history) ───────────────────────
@app.route("/api/chart/<ticker>")
def chart(ticker):
    period   = request.args.get("period", "3mo")
    interval = request.args.get("interval", "1d")
    try:
        t    = yf.Ticker(ticker)
        hist = t.history(period=period, interval=interval)
        if hist.empty:
            return jsonify({"ok": False, "error": "No data returned"})

        dates  = [str(d)[:10] for d in hist.index.tolist()]
        opens  = hist["Open"].round(2).tolist()
        highs  = hist["High"].round(2).tolist()
        lows   = hist["Low"].round(2).tolist()
        closes = hist["Close"].round(2).tolist()
        vols   = hist["Volume"].tolist()

        return jsonify({
            "ok": True, "ticker": ticker.upper(),
            "period": period, "interval": interval,
            "dates": dates, "opens": opens, "highs": highs,
            "lows": lows, "closes": closes, "volumes": vols,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── N (News) — Google News RSS (real-time) ────
@app.route("/api/news/<ticker>")
def news(ticker):
    """
    Primary:  Google News RSS feed — truly real-time, no API key.
    Fallback: yfinance .news (often hours/days stale).

    Google News RSS URL format:
      https://news.google.com/rss/search?q=AAPL+stock&hl=en-US&gl=US&ceid=US:en
    The `when:Xh` operator filters to the last X hours.
    """
    import feedparser
    import html
    import re

    try:
        sym = ticker.upper()

        # Build a smart query: ticker symbol + company name for better relevance
        # Try to get company name from yfinance for a richer query
        company_name = ""
        try:
            info = yf.Ticker(sym).info
            company_name = info.get("shortName") or info.get("longName") or ""
            # Strip "Inc.", "Corp." etc for cleaner search
            company_name = re.sub(r'\b(Inc\.?|Corp\.?|Ltd\.?|LLC|PLC|Co\.?|Group)\b', '', company_name).strip()
        except:
            pass

        # Build query: use both ticker and company name for best coverage
        # when:7d = last 7 days, gives plenty of fresh results
        if company_name and company_name.upper() != sym:
            q = f'"{sym}" OR "{company_name}" stock'
        else:
            q = f'"{sym}" stock'

        import urllib.parse
        rss_url = (
            f"https://news.google.com/rss/search?"
            f"q={urllib.parse.quote(q)}"
            f"&when=7d"
            f"&hl=en-US&gl=US&ceid=US:en"
        )

        feed = feedparser.parse(rss_url)
        out  = []

        for entry in feed.entries[:25]:
            # Title — Google News sometimes wraps in HTML, strip it
            title = html.unescape(entry.get("title", ""))
            # Strip " - Source Name" suffix that Google appends
            # Format is usually: "Headline - Source Name"
            source_suffix = ""
            if " - " in title:
                parts = title.rsplit(" - ", 1)
                title = parts[0].strip()
                source_suffix = parts[1].strip()

            # Published date
            pub = entry.get("published", "")

            # Source — prefer feed source tag, fall back to suffix parsed above
            source = ""
            if hasattr(entry, "source") and isinstance(entry.source, dict):
                source = entry.source.get("title", "")
            if not source and source_suffix:
                source = source_suffix

            # URL — Google News wraps in redirect; provide as-is (browser will follow)
            url = entry.get("link", "")

            # Summary — often not present in Google News RSS, that's fine
            summary = entry.get("summary", "")
            if summary:
                summary = re.sub(r'<[^>]+>', '', html.unescape(summary)).strip()
                if len(summary) > 300:
                    summary = summary[:300] + "…"

            if title:
                out.append({
                    "title":    title,
                    "summary":  summary,
                    "provider": source,
                    "url":      url,
                    "pubDate":  pub,
                    "source":   "google_news",
                })

        # If Google News returned nothing (network issue in sandbox etc), fall back to yfinance
        if not out:
            try:
                t = yf.Ticker(sym)
                items = t.news or []
                for n in items[:20]:
                    ct = n.get("content", {})
                    pub_dt = ct.get("pubDate") or ct.get("displayTime", "")
                    yf_title = ct.get("title", n.get("title", ""))
                    yf_summary = ct.get("summary", "")
                    provider = (ct.get("provider", {}) or {}).get("displayName", "") if isinstance(ct.get("provider"), dict) else ""
                    yf_url = ""
                    ctu = ct.get("canonicalUrl", {})
                    if isinstance(ctu, dict):
                        yf_url = ctu.get("url", "")
                    if yf_title:
                        out.append({
                            "title":    yf_title,
                            "summary":  yf_summary,
                            "provider": provider,
                            "url":      yf_url,
                            "pubDate":  pub_dt,
                            "source":   "yfinance_fallback",
                        })
            except:
                pass

        return jsonify({
            "ok": True,
            "ticker": sym,
            "news":   out,
            "source": "google_news_rss" if out and out[0].get("source") == "google_news" else "yfinance_fallback",
            "count":  len(out),
        })

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── TOP NEWS (general market headlines, no ticker) ──
@app.route("/api/top_news")
def top_news():
    """
    Fetches top financial/business headlines from Google News RSS.
    No ticker needed — good for the news ticker strip.
    """
    import feedparser, html, re, urllib.parse
    topics = [
        ("Business",  "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en"),
        ("Markets",   f"https://news.google.com/rss/search?q=stock+market+today&when=1d&hl=en-US&gl=US&ceid=US:en"),
    ]
    out = []
    seen = set()
    for _label, url in topics:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:12]:
                title = html.unescape(entry.get("title", ""))
                if " - " in title:
                    title = title.rsplit(" - ", 1)[0].strip()
                if title and title not in seen:
                    seen.add(title)
                    out.append({
                        "title":   title,
                        "url":     entry.get("link", ""),
                        "pubDate": entry.get("published", ""),
                    })
        except:
            pass
    return jsonify({"ok": True, "headlines": out[:20]})




# ── HDS (Holders) ─────────────────────────────
@app.route("/api/hds/<ticker>")
def holders(ticker):
    try:
        t = yf.Ticker(ticker)
        ih = t.institutional_holders
        mh = t.mutualfund_holders

        def df_fmt(df):
            if df is None or df.empty: return []
            rows = []
            for _, r in df.iterrows():
                rows.append({k: (None if str(v) in ("nan","NaT","None") else (str(v)[:10] if hasattr(v,"year") else v)) for k,v in r.items()})
            return rows[:25]

        return jsonify({
            "ok": True, "ticker": ticker.upper(),
            "institutional": df_fmt(ih),
            "mutualFund": df_fmt(mh),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── CF (SEC Filings) ──────────────────────────
@app.route("/api/cf/<ticker>")
def filings(ticker):
    try:
        import requests as req
        # Resolve CIK from SEC EDGAR
        search = req.get(
            f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&startdt=2020-01-01&forms=10-K,10-Q,8-K",
            headers={"User-Agent": "KineticTerminal research@local.dev"}, timeout=10
        )
        # Simpler: use EDGAR company search
        cik_r = req.get(
            f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={ticker}&type=10-K&dateb=&owner=include&count=10&search_text=&output=atom",
            headers={"User-Agent": "KineticTerminal research@local.dev"}, timeout=10
        )
        # EDGAR full-text search API
        edgar = req.get(
            f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&forms=10-K,10-Q,8-K,DEF+14A&dateRange=custom&startdt=2018-01-01",
            headers={"User-Agent": "KineticTerminal research@local.dev"}, timeout=10
        )
        # Use company facts approach
        # First get CIK
        cik_search = req.get(
            f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker.upper()}%22&forms=10-K",
            headers={"User-Agent": "KineticTerminal/1.0 local@terminal.dev"}, timeout=8
        )

        # Direct EDGAR full text search - reliable
        r2 = req.get(
            f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&startdt=2010-01-01&forms=10-K,10-Q,8-K",
            headers={"User-Agent": "KineticTerminal/1.0 admin@localhost"},
            timeout=10
        )

        filings_list = []
        try:
            data = r2.json()
            hits = data.get("hits", {}).get("hits", [])
            for h in hits[:30]:
                src = h.get("_source", {})
                filings_list.append({
                    "form":    src.get("form_type","—"),
                    "filed":   src.get("file_date","—"),
                    "period":  src.get("period_of_report","—"),
                    "company": src.get("entity_name","—"),
                    "url":     "https://www.sec.gov/Archives/edgar/data/" + src.get("file_num","").replace("-","") + "/" if src.get("file_num") else src.get("_id",""),
                })
        except: pass

        return jsonify({
            "ok": True,
            "ticker": ticker.upper(),
            "filings": filings_list,
            "edgarUrl": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={ticker}&type=&dateb=&owner=include&count=40&search_text="
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── ANR (Analyst Ratings) ─────────────────────
@app.route("/api/anr/<ticker>")
def analyst(ticker):
    try:
        t = yf.Ticker(ticker)
        info = t.info

        recs = t.recommendations
        rec_list = []
        if recs is not None and not recs.empty:
            for _, r in recs.tail(20).iterrows():
                rec_list.append({
                    "period": str(r.name)[:10] if hasattr(r.name,"year") else str(r.name),
                    "strongBuy":   int(r.get("strongBuy",0)),
                    "buy":         int(r.get("buy",0)),
                    "hold":        int(r.get("hold",0)),
                    "sell":        int(r.get("sell",0)),
                    "strongSell":  int(r.get("strongSell",0)),
                })

        upgrades = t.upgrades_downgrades
        updown_list = []
        if upgrades is not None and not upgrades.empty:
            for dt, r in upgrades.tail(15).iterrows():
                updown_list.append({
                    "date": str(dt)[:10],
                    "firm": r.get("Firm","—"),
                    "toGrade": r.get("ToGrade","—"),
                    "fromGrade": r.get("FromGrade","—"),
                    "action": r.get("Action","—"),
                })

        return jsonify({
            "ok": True,
            "ticker": ticker.upper(),
            "targetHigh": info.get("targetHighPrice"),
            "targetLow":  info.get("targetLowPrice"),
            "targetMean": info.get("targetMeanPrice"),
            "targetMedian": info.get("targetMedianPrice"),
            "currentPrice": info.get("currentPrice"),
            "recommendation": info.get("recommendationKey","—").upper(),
            "numAnalysts": info.get("numberOfAnalystOpinions"),
            "recommendations": rec_list,
            "upgrades": updown_list,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── WEI (World Equity Indices) ────────────────
@app.route("/api/wei")
def world_indices():
    tickers = {
        "^GSPC":  "S&P 500",
        "^DJI":   "Dow Jones",
        "^IXIC":  "NASDAQ",
        "^RUT":   "Russell 2000",
        "^FTSE":  "FTSE 100",
        "^GDAXI": "DAX",
        "^FCHI":  "CAC 40",
        "^N225":  "Nikkei 225",
        "^HSI":   "Hang Seng",
        "000001.SS": "Shanghai Comp",
        "^BSESN": "BSE Sensex",
        "^AXJO":  "ASX 200",
        "^STOXX50E": "Euro Stoxx 50",
    }
    results = []
    for sym, name in tickers.items():
        try:
            t    = yf.Ticker(sym)
            info = t.info
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev  = info.get("previousClose") or info.get("regularMarketPreviousClose")
            chg   = (price - prev) if (price and prev) else None
            pct   = ((chg / prev) * 100) if (chg and prev) else None
            results.append({"sym": sym, "name": name, "price": price, "change": chg, "changePct": pct})
        except: pass
    return jsonify({"ok": True, "indices": results})


# ── GLCO (Global Commodities) ─────────────────

_TD_COMMODITY = {
    "GC=F": "XAU/USD", "SI=F": "XAG/USD", "CL=F": "USOIL",
    "BZ=F": "UKOIL",   "NG=F": "NGAS",    "HG=F": "HG",
    "PL=F": "XPT/USD", "ZW=F": "WHEAT",   "ZC=F": "CORN",
    "ZS=F": "SOYBEAN", "KC=F": "COFFEE",  "SB=F": "SUGAR",
}

_YTD_CACHE = {}  # sym → {"price": x, "date": "YYYY-MM-DD"}

def _ytd_price(sym):
    """Return first-of-year close price for YTD calculation. Cached per calendar day."""
    today = datetime.now().strftime("%Y-%m-%d")
    cached = _YTD_CACHE.get(sym)
    if cached and cached.get("date") == today:
        return cached["price"]
    try:
        year = datetime.now().year
        hist = yf.Ticker(sym).history(start=f"{year}-01-01", end=f"{year}-01-15", interval="1d")
        if hist.empty:
            return None
        price = float(hist["Close"].iloc[0])
        _YTD_CACHE[sym] = {"price": price, "date": today}
        return price
    except Exception:
        return None

def _commodity_massive(yf_sym, name):
    try:
        key = config.MASSIVE_API_KEY
        if not key:
            return None
        sym = yf_sym.replace("=F", "")
        url = f"https://api.massive.com/v2/snapshot/locale/us/markets/futures/tickers/{sym}"
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=5)
        if r.status_code != 200:
            return None
        d = r.json().get("results", {})
        last = (d.get("lastTrade") or {}).get("p") or (d.get("day") or {}).get("c")
        prev = (d.get("prevDay") or {}).get("c")
        if not last:
            return None
        chg = round(last - prev, 4) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {"sym": yf_sym, "name": name, "price": last, "change": chg, "changePct": pct, "unit": "USD"}
    except Exception:
        return None

def _commodity_twelve_data(yf_sym, name):
    try:
        td_sym = _TD_COMMODITY.get(yf_sym)
        if not td_sym:
            return None
        r = requests.get("https://api.twelvedata.com/quote",
            params={"symbol": td_sym, "apikey": config.TWELVE_DATA_API_KEY}, timeout=5)
        d = r.json()
        if d.get("code") or d.get("status") == "error":
            return None
        last = float(d.get("close") or 0)
        prev = float(d.get("previous_close") or 0)
        if not last:
            return None
        chg = round(last - prev, 4) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {"sym": yf_sym, "name": name, "price": last, "change": chg, "changePct": pct, "unit": "USD"}
    except Exception:
        return None

@app.route("/api/glco")
def commodities():
    tickers = [
        ("GC=F",  "Gold",         "METALS"),
        ("SI=F",  "Silver",       "METALS"),
        ("PL=F",  "Platinum",     "METALS"),
        ("HG=F",  "Copper",       "METALS"),
        ("CL=F",  "WTI Crude",    "ENERGY"),
        ("BZ=F",  "Brent Crude",  "ENERGY"),
        ("NG=F",  "Natural Gas",  "ENERGY"),
        ("ZW=F",  "Wheat",        "AGRI"),
        ("ZC=F",  "Corn",         "AGRI"),
        ("ZS=F",  "Soybeans",     "AGRI"),
        ("KC=F",  "Coffee",       "AGRI"),
        ("SB=F",  "Sugar",        "AGRI"),
    ]
    results = []
    for sym, name, cat in tickers:
        row = _commodity_massive(sym, name) or _commodity_twelve_data(sym, name)
        if not row:
            try:
                t     = yf.Ticker(sym)
                info  = t.info
                price = info.get("regularMarketPrice") or info.get("currentPrice")
                prev  = info.get("previousClose")
                chg   = (price - prev) if (price and prev) else None
                pct   = ((chg / prev) * 100) if (chg and prev) else None
                row   = {"sym": sym, "name": name, "price": price, "change": chg,
                         "changePct": pct, "unit": info.get("currency", "USD")}
            except:
                continue
        if row:
            row["category"] = cat
            results.append(row)

    # Fetch YTD prices in parallel (cached after first call)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(_ytd_price, r["sym"]): i for i, r in enumerate(results)}
        for fut, i in futs.items():
            try:
                ytd = fut.result(timeout=10)
                p   = results[i].get("price")
                results[i]["ytdPct"] = round((p - ytd) / ytd * 100, 2) if (ytd and p) else None
            except:
                results[i]["ytdPct"] = None

    return jsonify({"ok": True, "commodities": results})


# ── FX (Forex) ────────────────────────────────

def _fx_massive(yf_sym, name):
    try:
        key = config.MASSIVE_API_KEY
        if not key:
            return None
        pair = yf_sym.replace("=X", "")
        url = f"https://api.massive.com/v2/snapshot/locale/global/markets/forex/tickers/C:{pair}"
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=5)
        if r.status_code != 200:
            return None
        d = r.json().get("results", {})
        last = (d.get("lastTrade") or d.get("lastQuote") or {}).get("p") or (d.get("day") or {}).get("c")
        prev = (d.get("prevDay") or {}).get("c")
        if not last:
            return None
        chg = round(last - prev, 5) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {"sym": yf_sym, "name": name, "price": last, "change": chg, "changePct": pct}
    except Exception:
        return None

def _fx_twelve_data(yf_sym, name):
    try:
        pair = yf_sym.replace("=X", "")
        td_sym = pair[:3] + "/" + pair[3:]  # EURUSD -> EUR/USD
        r = requests.get("https://api.twelvedata.com/quote",
            params={"symbol": td_sym, "apikey": config.TWELVE_DATA_API_KEY}, timeout=5)
        d = r.json()
        if d.get("code") or d.get("status") == "error":
            return None
        last = float(d.get("close") or 0)
        prev = float(d.get("previous_close") or 0)
        if not last:
            return None
        chg = round(last - prev, 5) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {"sym": yf_sym, "name": name, "price": last, "change": chg, "changePct": pct}
    except Exception:
        return None

def _fx_finnhub(yf_sym, name):
    try:
        pair = yf_sym.replace("=X", "")
        fh_sym = "OANDA:" + pair[:3] + "_" + pair[3:]  # EURUSD -> OANDA:EUR_USD
        quote = finnhub_client.quote(fh_sym)
        if not quote or quote.get("c", 0) == 0:
            return None
        last, prev = quote["c"], quote["pc"]
        chg = round(last - prev, 5) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {"sym": yf_sym, "name": name, "price": last, "change": chg, "changePct": pct}
    except Exception:
        return None

@app.route("/api/fx")
def forex():
    pairs = [
        ("EURUSD=X", "EUR/USD"), ("GBPUSD=X", "GBP/USD"), ("USDJPY=X", "USD/JPY"),
        ("USDCHF=X", "USD/CHF"), ("AUDUSD=X", "AUD/USD"), ("USDCAD=X", "USD/CAD"),
        ("NZDUSD=X", "NZD/USD"), ("USDCNY=X", "USD/CNY"), ("USDINR=X", "USD/INR"),
        ("USDBRL=X", "USD/BRL"), ("USDMXN=X", "USD/MXN"), ("USDKRW=X", "USD/KRW"),
    ]
    results = []
    for sym, name in pairs:
        row = _fx_massive(sym, name) or _fx_twelve_data(sym, name) or _fx_finnhub(sym, name)
        if not row:
            try:
                t     = yf.Ticker(sym)
                info  = t.info
                price = info.get("regularMarketPrice") or info.get("currentPrice")
                prev  = info.get("previousClose")
                chg   = (price - prev) if (price and prev) else None
                pct   = ((chg / prev) * 100) if (chg and prev) else None
                row   = {"sym": sym, "name": name, "price": price, "change": chg, "changePct": pct}
            except:
                continue
        if row:
            results.append(row)

    # Fetch YTD prices in parallel (cached after first call)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(_ytd_price, r["sym"]): i for i, r in enumerate(results)}
        for fut, i in futs.items():
            try:
                ytd = fut.result(timeout=10)
                p   = results[i].get("price")
                results[i]["ytdPct"] = round((p - ytd) / ytd * 100, 2) if (ytd and p) else None
            except:
                results[i]["ytdPct"] = None

    return jsonify({"ok": True, "pairs": results})


# ── FX Matrix (Cross-Rate Heatmap) ────────────

_FXM_CACHE = {"data": None, "ts": 0}
_FXM_TTL   = 60  # 1-minute cache

@app.route("/api/fxmatrix")
def fxmatrix():
    import time as _t
    now = _t.time()
    if _FXM_CACHE["data"] and now - _FXM_CACHE["ts"] < _FXM_TTL:
        return jsonify({"ok": True, **_FXM_CACHE["data"]})

    # (sym, invert) — invert=True means price = X per USD, so usdRate = 1/price
    ccy_map = {
        "USD": ("USD",      False),
        "EUR": ("EURUSD=X", False),
        "GBP": ("GBPUSD=X", False),
        "AUD": ("AUDUSD=X", False),
        "NZD": ("NZDUSD=X", False),
        "JPY": ("USDJPY=X", True),
        "CHF": ("USDCHF=X", True),
        "CAD": ("USDCAD=X", True),
        "HKD": ("USDHKD=X", True),
        "NOK": ("USDNOK=X", True),
        "SEK": ("USDSEK=X", True),
        "CNY": ("USDCNY=X", True),
        "RUB": ("USDRUB=X", True),
        "INR": ("USDINR=X", True),
    }

    def fetch_rate(ccy, sym, invert):
        if ccy == "USD":
            return ccy, 1.0
        try:
            info = yf.Ticker(sym).info
            p = info.get("regularMarketPrice") or info.get("currentPrice")
            if not p:
                return ccy, None
            return ccy, round(1.0 / float(p), 8) if invert else round(float(p), 8)
        except Exception:
            return ccy, None

    usd_rates = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch_rate, ccy, sym, inv): ccy
                for ccy, (sym, inv) in ccy_map.items()}
        for fut in concurrent.futures.as_completed(futs):
            ccy, rate = fut.result()
            if rate is not None:
                usd_rates[ccy] = rate

    currencies = [c for c in ["USD","EUR","GBP","JPY","CHF","CAD","AUD","NZD",
                               "HKD","NOK","SEK","CNY","RUB","INR"] if c in usd_rates]
    result = {"currencies": currencies, "usdRates": usd_rates}
    _FXM_CACHE.update({"data": result, "ts": now})
    return jsonify({"ok": True, **result})


# ── FX Historical Period Performance ──────────

_FX_PAIRS = [
    "EURUSD=X","GBPUSD=X","USDJPY=X","USDCHF=X","AUDUSD=X",
    "USDCAD=X","NZDUSD=X","USDCNY=X","USDINR=X","USDBRL=X","USDMXN=X","USDKRW=X"
]

_FXP_CACHE = {"data": None, "date": None}  # refreshed once per calendar day

@app.route("/api/fx/periods")
def fx_periods():
    today_str = datetime.today().strftime("%Y-%m-%d")
    if _FXP_CACHE["data"] and _FXP_CACHE["date"] == today_str:
        return jsonify({"ok": True, **_FXP_CACHE["data"]})

    years  = [1, 2, 3, 5, 10]
    today  = datetime.today().date()
    start  = (today - timedelta(days=365 * 11)).strftime("%Y-%m-%d")

    def get_pair_periods(sym):
        try:
            df = yf.download(sym, start=start, progress=False, auto_adjust=True)
            if df.empty:
                return sym, {}
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            close = df["Close"].dropna()
            if close.empty:
                return sym, {}
            current = float(close.iloc[-1])
            result  = {}
            for yr in years:
                target = today - timedelta(days=365 * yr)
                past   = close[close.index.date <= target]
                if past.empty:
                    continue
                past_price = float(past.iloc[-1])
                if past_price:
                    result[f"{yr}y"] = round((current - past_price) / past_price * 100, 2)
            return sym, result
        except Exception:
            return sym, {}

    periods = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(get_pair_periods, sym): sym for sym in _FX_PAIRS}
        for fut in concurrent.futures.as_completed(futs):
            sym, data = fut.result()
            periods[sym] = data

    result = {"periods": periods}
    _FXP_CACHE.update({"data": result, "date": today_str})
    return jsonify({"ok": True, **result})


_FXR_CACHE = {}  # key = "from_to" → cached response

@app.route("/api/fx/perf")
def fx_perf():
    from_date = request.args.get("from")
    to_date   = request.args.get("to", datetime.today().strftime("%Y-%m-%d"))
    if not from_date:
        return jsonify({"ok": False, "error": "from date required"})

    cache_key = f"{from_date}_{to_date}"
    if cache_key in _FXR_CACHE:
        return jsonify({"ok": True, **_FXR_CACHE[cache_key]})

    try:
        from_dt = datetime.strptime(from_date, "%Y-%m-%d").date()
        to_dt   = datetime.strptime(to_date,   "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid date format (use YYYY-MM-DD)"})

    fetch_start = (from_dt - timedelta(days=10)).strftime("%Y-%m-%d")
    fetch_end   = (to_dt   + timedelta(days=7)).strftime("%Y-%m-%d")

    def get_pair_perf(sym):
        try:
            df = yf.download(sym, start=fetch_start, end=fetch_end,
                             progress=False, auto_adjust=True)
            if df.empty:
                return sym, None
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            close = df["Close"].dropna()
            start_sl = close[close.index.date >= from_dt]
            end_sl   = close[close.index.date <= to_dt]
            if start_sl.empty or end_sl.empty:
                return sym, None
            sp = float(start_sl.iloc[0])
            ep = float(end_sl.iloc[-1])
            if not sp:
                return sym, None
            return sym, round((ep - sp) / sp * 100, 2)
        except Exception:
            return sym, None

    perfs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(get_pair_perf, sym): sym for sym in _FX_PAIRS}
        for fut in concurrent.futures.as_completed(futs):
            sym, pct = fut.result()
            if pct is not None:
                perfs[sym] = pct

    result = {"from": from_date, "to": to_date, "perfs": perfs}
    _FXR_CACHE[cache_key] = result
    return jsonify({"ok": True, **result})


# ── GLCO Historical Period Performance ────────

_GLCO_SYMS = ["GC=F","SI=F","PL=F","HG=F","CL=F","BZ=F","NG=F","ZW=F","ZC=F","ZS=F","KC=F","SB=F"]

_GLCP_CACHE = {"data": None, "date": None}
_GLCR_CACHE = {}

@app.route("/api/glco/periods")
def glco_periods():
    today_str = datetime.today().strftime("%Y-%m-%d")
    if _GLCP_CACHE["data"] and _GLCP_CACHE["date"] == today_str:
        return jsonify({"ok": True, **_GLCP_CACHE["data"]})

    years = [1, 2, 3, 5, 10]
    today = datetime.today().date()
    start = (today - timedelta(days=365 * 11)).strftime("%Y-%m-%d")

    def get_sym_periods(sym):
        try:
            df = yf.download(sym, start=start, progress=False, auto_adjust=True)
            if df.empty: return sym, {}
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            close = df["Close"].dropna()
            if close.empty: return sym, {}
            current = float(close.iloc[-1])
            result = {}
            for yr in years:
                target = today - timedelta(days=365 * yr)
                past = close[close.index.date <= target]
                if past.empty: continue
                past_price = float(past.iloc[-1])
                if past_price:
                    result[f"{yr}y"] = round((current - past_price) / past_price * 100, 2)
            return sym, result
        except Exception:
            return sym, {}

    periods = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(get_sym_periods, sym): sym for sym in _GLCO_SYMS}
        for fut in concurrent.futures.as_completed(futs):
            sym, data = fut.result()
            periods[sym] = data

    result = {"periods": periods}
    _GLCP_CACHE.update({"data": result, "date": today_str})
    return jsonify({"ok": True, **result})


@app.route("/api/glco/perf")
def glco_perf():
    from_date = request.args.get("from")
    to_date   = request.args.get("to", datetime.today().strftime("%Y-%m-%d"))
    if not from_date:
        return jsonify({"ok": False, "error": "from date required"})

    cache_key = f"{from_date}_{to_date}"
    if cache_key in _GLCR_CACHE:
        return jsonify({"ok": True, **_GLCR_CACHE[cache_key]})

    try:
        from_dt = datetime.strptime(from_date, "%Y-%m-%d").date()
        to_dt   = datetime.strptime(to_date,   "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid date format"})

    fetch_start = (from_dt - timedelta(days=10)).strftime("%Y-%m-%d")
    fetch_end   = (to_dt   + timedelta(days=7)).strftime("%Y-%m-%d")

    def get_sym_perf(sym):
        try:
            df = yf.download(sym, start=fetch_start, end=fetch_end,
                             progress=False, auto_adjust=True)
            if df.empty: return sym, None
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            close = df["Close"].dropna()
            start_sl = close[close.index.date >= from_dt]
            end_sl   = close[close.index.date <= to_dt]
            if start_sl.empty or end_sl.empty: return sym, None
            sp = float(start_sl.iloc[0])
            ep = float(end_sl.iloc[-1])
            if not sp: return sym, None
            return sym, round((ep - sp) / sp * 100, 2)
        except Exception:
            return sym, None

    perfs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(get_sym_perf, sym): sym for sym in _GLCO_SYMS}
        for fut in concurrent.futures.as_completed(futs):
            sym, pct = fut.result()
            if pct is not None:
                perfs[sym] = pct

    result = {"from": from_date, "to": to_date, "perfs": perfs}
    _GLCR_CACHE[cache_key] = result
    return jsonify({"ok": True, **result})


# ── EQS (Equity Screener) — FinanceDatabase powered ──────────────
try:
    import financedatabase as _fd
    _FD_AVAILABLE = True
except ImportError:
    _FD_AVAILABLE = False

_EQS_FD_CACHE = {"df": None, "ts": 0}
_EQS_FD_TTL   = 3600  # 1 hour

def _get_fd_df():
    import time as _t
    now = _t.time()
    if _EQS_FD_CACHE["df"] is not None and now - _EQS_FD_CACHE["ts"] < _EQS_FD_TTL:
        return _EQS_FD_CACHE["df"]
    df = _fd.Equities().select()
    _EQS_FD_CACHE.update({"df": df, "ts": now})
    return df

def _bulk_quotes_yf(syms):
    """Batch-fetch quotes via yfinance; fall back to provider chain for any misses."""
    if not syms:
        return {}
    result = {}

    # Pass 1 — single yfinance batch call
    try:
        raw = yf.download(syms, period="5d", auto_adjust=True, progress=False, threads=True)
        if isinstance(raw.columns, pd.MultiIndex):
            close_df = raw["Close"]
            for sym in close_df.columns:
                s = close_df[sym].dropna()
                if len(s) < 2:
                    continue
                price = float(s.iloc[-1])
                prev  = float(s.iloc[-2])
                chg   = price - prev
                pct   = (chg / prev * 100) if prev else None
                result[sym] = {"price": round(price, 4), "change": round(chg, 4),
                               "changePct": round(pct, 4) if pct is not None else None}
        else:
            s = raw["Close"].dropna()
            if len(s) >= 2 and syms:
                price = float(s.iloc[-1])
                prev  = float(s.iloc[-2])
                chg   = price - prev
                pct   = (chg / prev * 100) if prev else None
                result[syms[0]] = {"price": round(price, 4), "change": round(chg, 4),
                                   "changePct": round(pct, 4) if pct is not None else None}
    except Exception:
        pass

    # Pass 2 — provider chain fallback for any syms that got no data
    misses = [s for s in syms if s not in result]
    if misses:
        def _fallback(sym):
            q = provider_get_quote(sym)
            if q and q.get("price"):
                return sym, {"price": q["price"], "change": q.get("change"),
                             "changePct": q.get("changePct")}
            return sym, None
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for sym, data in ex.map(_fallback, misses):
                if data:
                    result[sym] = data

    return result

@app.route("/api/eqs/meta")
def eqs_meta():
    if not _FD_AVAILABLE:
        return jsonify({"ok": False, "error": "FinanceDatabase not installed"})
    try:
        df = _get_fd_df()
        sectors    = sorted([s for s in df["sector"].dropna().unique().tolist() if s])
        countries  = sorted([c for c in df["country"].dropna().unique().tolist() if c])
        market_caps = ["Nano Cap", "Micro Cap", "Small Cap", "Mid Cap", "Large Cap", "Mega Cap"]
        return jsonify({"ok": True, "sectors": sectors, "countries": countries, "market_caps": market_caps})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

_US_EXCHANGES = {"NMS", "NYQ", "ASE", "NGM", "NCM"}

@app.route("/api/eqs")
def screener():
    if not _FD_AVAILABLE:
        return jsonify({"ok": False, "error": "FinanceDatabase not available"})
    try:
        q          = (request.args.get("q")          or "").strip()
        country    = (request.args.get("country")    or "").strip()
        sector     = (request.args.get("sector")     or "").strip()
        market_cap = (request.args.get("market_cap") or "").strip()
        exchange   = (request.args.get("exchange")   or "").strip()
        page       = max(1, int(request.args.get("page", 1)))
        per_page   = 25

        df = _get_fd_df()

        # Fix 1: when filtering "United States", also require a genuine US exchange
        # to avoid SHZ/foreign tickers mislabeled as US
        if country == "United States":
            df = df[(df["country"] == country) & df["exchange"].isin(_US_EXCHANGES)]
        elif country:
            df = df[df["country"] == country]

        if sector:
            df = df[df["sector"] == sector]
        if market_cap:
            df = df[df["market_cap"] == market_cap]
        if exchange:
            df = df[df["exchange"] == exchange]
        if q:
            mask = (df["name"].str.contains(q, case=False, na=False) |
                    df.index.str.contains(q, case=False))
            df = df[mask]

        total       = len(df)
        total_pages = max(1, (total + per_page - 1) // per_page)
        page        = min(page, total_pages)

        start   = (page - 1) * per_page
        page_df = df.iloc[start:start + per_page]

        syms   = page_df.index.tolist()
        quotes = _bulk_quotes_yf(syms)

        # Fetch numerical market cap from yfinance fast_info (parallel)
        def _fetch_mktcap(sym):
            try:
                cap = yf.Ticker(sym).fast_info.market_cap
                return sym, int(cap) if cap else None
            except Exception:
                return sym, None

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            for sym, cap in ex.map(_fetch_mktcap, syms):
                if cap:
                    quotes.setdefault(sym, {})["marketCap"] = cap

        results = []
        for sym, row in page_df.iterrows():
            q_data = quotes.get(sym, {})
            results.append({
                "sym":       sym,
                "name":      str(row.get("name")       or "—"),
                "sector":    str(row.get("sector")     or "—"),
                "industry":  str(row.get("industry")   or "—"),
                "country":   str(row.get("country")    or "—"),
                "exchange":  str(row.get("exchange")   or "—"),
                "market_cap":str(row.get("market_cap") or "—"),
                "price":     q_data.get("price"),
                "change":    q_data.get("change"),
                "changePct": q_data.get("changePct"),
                "marketCap": q_data.get("marketCap"),
            })

        return jsonify({"ok": True, "results": results,
                        "total": total, "page": page, "totalPages": total_pages})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


_EQS_PERF_CACHE = {}  # key: "SYM_period_YYYY-MM-DD" -> pct float

@app.route("/api/eqs/perf")
def eqs_perf():
    syms   = [s.strip() for s in (request.args.get("syms", "")).split(",") if s.strip()]
    period = (request.args.get("period") or "ytd").lower()
    if not syms:
        return jsonify({"ok": False, "error": "no syms"})

    today = datetime.today().date()
    if period == "ytd":
        start = today.replace(month=1, day=1)
    elif period == "1m":
        start = today - timedelta(days=31)
    elif period == "6m":
        start = today - timedelta(days=183)
    elif period == "1y":
        start = today - timedelta(days=365)
    elif period == "5y":
        start = today - timedelta(days=365 * 5)
    else:
        return jsonify({"ok": False, "error": "invalid period"})

    cache_date = today.strftime("%Y-%m-%d")
    to_fetch   = [s for s in syms if f"{s}_{period}_{cache_date}" not in _EQS_PERF_CACHE]

    # Prevent unbounded cache growth
    if len(_EQS_PERF_CACHE) > 5000:
        _EQS_PERF_CACHE.clear()

    if to_fetch:
        try:
            fetch_start = (start - timedelta(days=10)).strftime("%Y-%m-%d")
            raw = yf.download(to_fetch, start=fetch_start, auto_adjust=True,
                              progress=False, threads=True)
            if isinstance(raw.columns, pd.MultiIndex):
                close_df = raw["Close"]
                syms_to_iter = list(close_df.columns)
                def _get_series(s): return close_df[s].dropna()
            else:
                close_df = None
                syms_to_iter = to_fetch[:1]
                def _get_series(s): return raw["Close"].dropna()

            for sym in syms_to_iter:
                s = _get_series(sym)
                if len(s) < 2:
                    continue
                end_price = float(s.iloc[-1])
                s_start   = s[s.index.date >= start]
                if s_start.empty:
                    s_start = s
                start_price = float(s_start.iloc[0])
                if start_price:
                    pct = (end_price - start_price) / start_price * 100
                    _EQS_PERF_CACHE[f"{sym}_{period}_{cache_date}"] = round(pct, 4)
        except Exception:
            pass

    perfs = {s: _EQS_PERF_CACHE.get(f"{s}_{period}_{cache_date}") for s in syms}
    return jsonify({"ok": True, "period": period, "perfs": perfs})


# ── HP (Historical Prices) ────────────────────
@app.route("/api/hp/<ticker>")
def historical_prices(ticker):
    period   = request.args.get("period","1y")
    interval = request.args.get("interval","1d")
    if _is_crypto_ticker(ticker):
        rows = _hp_binance(ticker, period, interval)
        if rows:
            return jsonify({"ok": True, "ticker": ticker.upper(), "rows": rows[-100:]})
    try:
        t    = yf.Ticker(ticker)
        hist = t.history(period=period, interval=interval)
        rows = []
        for dt, r in hist.iterrows():
            rows.append({
                "date":   str(dt)[:10],
                "open":   round(float(r["Open"]),2),
                "high":   round(float(r["High"]),2),
                "low":    round(float(r["Low"]),2),
                "close":  round(float(r["Close"]),2),
                "volume": int(r["Volume"]),
            })
        return jsonify({"ok": True, "ticker": ticker.upper(), "rows": rows[-100:]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── FISC (Institutional Fiscal Dashboard) ────────────
_FISC_CACHE = {"data": None, "ts": 0}
_FISC_TTL   = 1800  # 30 min

@app.route("/api/fisc")
def fisc_data():
    import time, requests as _req, concurrent.futures
    now = time.time()
    if _FISC_CACHE["data"] and now - _FISC_CACHE["ts"] < _FISC_TTL:
        return jsonify({"ok": True, **_FISC_CACHE["data"]})

    FRED_KEY  = os.environ.get("FRED_API_KEY", "")
    FRED_BASE = "https://api.stlouisfed.org/fred"
    TREAS_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
    HDR = {"User-Agent": "KineticTerminal/1.0"}

    def fred_obs(series_id, limit=60, freq=None):
        params = {"series_id": series_id, "api_key": FRED_KEY,
                  "file_type": "json", "sort_order": "desc", "limit": limit}
        if freq:
            params["frequency"] = freq
        r = _req.get(f"{FRED_BASE}/series/observations", params=params, timeout=15)
        r.raise_for_status()
        out = []
        for obs in reversed(r.json().get("observations", [])):
            v = obs.get("value", ".")
            if v != ".":
                try:
                    out.append({"date": obs["date"], "value": float(v)})
                except Exception:
                    pass
        return out

    def treas_get(path, params):
        r = _req.get(f"{TREAS_BASE}{path}", params=params, headers=HDR, timeout=15)
        r.raise_for_status()
        return r.json().get("data", [])

    # ── FRED fetches ──────────────────────────────────
    def fetch_yields():
        tenors = [
            ("1M","DGS1MO"),("3M","DGS3MO"),("6M","DGS6MO"),("1Y","DGS1"),
            ("2Y","DGS2"),("5Y","DGS5"),("7Y","DGS7"),("10Y","DGS10"),
            ("20Y","DGS20"),("30Y","DGS30"),
        ]
        curve, history = {}, {}
        for label, sid in tenors:
            obs = fred_obs(sid, 252)
            if obs:
                curve[label] = obs[-1]["value"]
                history[sid] = obs
        # TIPS 10Y breakeven (inflation expectations)
        tips = fred_obs("T10YIE", 252)
        return {"curve": curve, "yieldHistory": history, "breakeven10y": tips}

    def fetch_budget():
        def safe_obs(sid, lim, freq=None):
            try: return fred_obs(sid, lim, freq)
            except: return []
        rcpt    = safe_obs("MTSR133FMS",  60)
        outly   = safe_obs("MTSO133FMS",  60)
        defi    = safe_obs("MTSDS133FMS", 60)
        debtB   = safe_obs("GFDEBTN",     60, "q")
        debtGdp = safe_obs("FYGFGDQ188S", 60)   # Federal Debt % of GDP (quarterly)
        tga     = safe_obs("WTREGEN",     104)
        return {"receipts": rcpt, "outlays": outly, "deficit": defi,
                "debtB": debtB, "debtGdp": debtGdp, "tga": tga}

    # ── Treasury Fiscal Data fetches ─────────────────
    def fetch_auctions():
        # Last 30 auction results across all security types
        rows = treas_get("/v1/accounting/od/auctions_query", {
            "sort": "-auction_date",
            "limit": 30,
            "fields": "security_type,security_term,auction_date,issue_date,maturity_date,"
                      "offering_amt,total_tendered,total_accepted,"
                      "bid_to_cover_ratio,high_yield,int_rate",
            "filter": "bid_to_cover_ratio:gt:0",
        })
        auctions = []
        for r in rows:
            def safe_f(v):
                try: return float(v) if v not in (None, "", "null") else None
                except: return None
            auctions.append({
                "type":        r.get("security_type", ""),
                "term":        r.get("security_term", ""),
                "auctionDate": r.get("auction_date", ""),
                "issueDate":   r.get("issue_date", ""),
                "maturityDate":r.get("maturity_date", ""),
                "offeringAmt": safe_f(r.get("offering_amt")),
                "tendered":    safe_f(r.get("total_tendered")),
                "accepted":    safe_f(r.get("total_accepted")),
                "bidToCover":  safe_f(r.get("bid_to_cover_ratio")),
                "highYield":   safe_f(r.get("high_yield")),
                "intRate":     safe_f(r.get("int_rate")),
            })
        return {"auctions": auctions}

    def fetch_avg_rates():
        # Average interest rate on outstanding debt by security type — last 24 months
        rows = treas_get("/v2/accounting/od/avg_interest_rates", {
            "sort": "-record_date",
            "limit": 200,
            "fields": "record_date,security_type_desc,security_desc,avg_interest_rate_amt",
        })
        out = []
        for r in rows:
            try:
                out.append({
                    "date":     r.get("record_date", ""),
                    "typeDesc": r.get("security_type_desc", ""),
                    "secDesc":  r.get("security_desc", ""),
                    "rate":     float(r.get("avg_interest_rate_amt", 0) or 0),
                })
            except: pass
        return {"avgRates": out}

    def fetch_debt_penny():
        # Daily total public debt outstanding — last 365 days
        rows = treas_get("/v2/accounting/od/debt_to_penny", {
            "sort": "-record_date",
            "limit": 365,
            "fields": "record_date,debt_held_public_amt,intragov_hold_amt,tot_pub_debt_out_amt",
        })
        out = []
        for r in rows:
            try:
                out.append({
                    "date":     r.get("record_date", ""),
                    "public":   float(r.get("debt_held_public_amt", 0) or 0),
                    "intragov": float(r.get("intragov_hold_amt", 0) or 0),
                    "total":    float(r.get("tot_pub_debt_out_amt", 0) or 0),
                })
            except: pass
        return {"debtPenny": list(reversed(out))}

    try:
        result = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            jobs = {
                "yields":      ex.submit(fetch_yields),
                "budget":      ex.submit(fetch_budget),
                "auctions":    ex.submit(fetch_auctions),
                "avgRates":    ex.submit(fetch_avg_rates),
                "debtPenny":   ex.submit(fetch_debt_penny),
            }
            for k, fut in jobs.items():
                try:
                    result.update(fut.result(timeout=25))
                except Exception as e:
                    pass
        _FISC_CACHE["data"] = result
        _FISC_CACHE["ts"]   = now
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── MACRO (US Macroeconomic Dashboard via FRED) ──────
_MACRO_CACHE = {"data": None, "ts": 0}
_MACRO_TTL   = 1800  # 30 min — FRED data is monthly/quarterly

@app.route("/api/macro")
def macro_data():
    import time, requests as _req, concurrent.futures
    now = time.time()
    if _MACRO_CACHE["data"] and now - _MACRO_CACHE["ts"] < _MACRO_TTL:
        return jsonify({"ok": True, **_MACRO_CACHE["data"]})

    FRED_KEY  = os.environ.get("FRED_API_KEY", "")
    FRED_BASE = "https://api.stlouisfed.org/fred"

    def fred_obs(series_id, limit=60, freq=None):
        params = {"series_id": series_id, "api_key": FRED_KEY,
                  "file_type": "json", "sort_order": "desc", "limit": limit}
        if freq:
            params["frequency"] = freq
        r = _req.get(f"{FRED_BASE}/series/observations", params=params, timeout=15)
        r.raise_for_status()
        out = []
        for obs in reversed(r.json().get("observations", [])):
            v = obs.get("value", ".")
            if v != ".":
                try:
                    out.append({"date": obs["date"], "value": float(v)})
                except Exception:
                    pass
        return out

    def fetch_growth():
        return {
            "gdpNom":   fred_obs("GDP",             24, "q"),
            "gdpReal":  fred_obs("A191RL1Q225SBEA", 24, "q"),
            "gdpLevel": fred_obs("GDPC1",           24, "q"),
            "pce":      fred_obs("PCEC96",          60, "q"),
        }

    def fetch_labor():
        return {
            "unrate":  fred_obs("UNRATE",  60),
            "payems":  fred_obs("PAYEMS",  60),
            "civpart": fred_obs("CIVPART", 60),
            "icsa":    fred_obs("ICSA",    104),
            "jolts":   fred_obs("JTSJOL",  36),
        }

    def fetch_inflation():
        return {
            "cpi":     fred_obs("CPIAUCSL",  72),
            "coreCpi": fred_obs("CPILFESL",  72),
            "pce":     fred_obs("PCEPI",     72),
            "corePce": fred_obs("PCEPILFE",  72),
            "ppi":     fred_obs("PPIACO",    72),
        }

    def fetch_rates():
        return {
            "fedFunds": fred_obs("FEDFUNDS", 60),
            "dff":      fred_obs("DFF",      252),
            "tips10":   fred_obs("DFII10",   252),
            "prime":    fred_obs("PRIME",    60),
        }

    def fetch_credit():
        # ICE BofA Option-Adjusted Spreads (OAS) — all daily, in basis points (%)
        return {
            "igOas":   fred_obs("BAMLC0A0CM",    500),  # IG Corporate OAS
            "hyOas":   fred_obs("BAMLH0A0HYM2",  500),  # HY Corporate OAS
            "bbbOas":  fred_obs("BAMLC0A4CBBB",  500),  # BBB OAS
            "aaOas":   fred_obs("BAMLC0A1CAAA",  500),  # AAA OAS
            "t10y2y":  fred_obs("T10Y2Y",        500),  # 10Y-2Y Treasury spread
            "t10y3m":  fred_obs("T10Y3M",        500),  # 10Y-3M Treasury spread
        }

    try:
        result = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            jobs = {
                "growth":    ex.submit(fetch_growth),
                "labor":     ex.submit(fetch_labor),
                "inflation": ex.submit(fetch_inflation),
                "rates":     ex.submit(fetch_rates),
                "credit":    ex.submit(fetch_credit),
            }
            for k, fut in jobs.items():
                try:
                    result.update(fut.result(timeout=25))
                except Exception:
                    pass
        _MACRO_CACHE["data"] = result
        _MACRO_CACHE["ts"]   = now
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── RATE (Key Rates Monitor via FRED) ─────────────
_RATE_CACHE = {"data": None, "ts": 0}
_RATE_TTL   = 3600  # 1 hour — daily FRED series

@app.route("/api/rate")
def rate_monitor():
    import time, requests as _req, concurrent.futures
    now = time.time()
    if _RATE_CACHE["data"] and now - _RATE_CACHE["ts"] < _RATE_TTL:
        return jsonify({"ok": True, **_RATE_CACHE["data"]})

    FRED_KEY  = os.environ.get("FRED_API_KEY", "")
    FRED_BASE = "https://api.stlouisfed.org/fred"

    def fred2(series_id, limit=3):
        """Return last `limit` clean observations as list of {date, value}."""
        params = {"series_id": series_id, "api_key": FRED_KEY,
                  "file_type": "json", "sort_order": "desc", "limit": limit}
        r = _req.get(f"{FRED_BASE}/series/observations", params=params, timeout=12)
        r.raise_for_status()
        out = []
        for obs in reversed(r.json().get("observations", [])):
            v = obs.get("value", ".")
            if v != ".":
                try: out.append({"date": obs["date"], "value": float(v)})
                except: pass
        return out

    # Each group fetched in its own thread
    def fetch_overnight():
        return {
            "sofr":       fred2("SOFR"),
            "sofr30":     fred2("SOFR30DAYAVG"),
            "sofr90":     fred2("SOFR90DAYAVG"),
            "sofr180":    fred2("SOFR180DAYAVG"),
            "dff":        fred2("DFF"),
            "prime":      fred2("PRIME"),
            "dtb3":       fred2("DTB3"),   # 3-Month T-Bill secondary market
        }

    def fetch_treasury():
        return {
            "dgs1mo":  fred2("DGS1MO"),
            "dgs3mo":  fred2("DGS3MO"),
            "dgs6mo":  fred2("DGS6MO"),
            "dgs1":    fred2("DGS1"),
            "dgs2":    fred2("DGS2"),
            "dgs3":    fred2("DGS3"),
            "dgs5":    fred2("DGS5"),
            "dgs7":    fred2("DGS7"),
            "dgs10":   fred2("DGS10"),
            "dgs20":   fred2("DGS20"),
            "dgs30":   fred2("DGS30"),
        }

    def fetch_real():
        return {
            "dfii5":   fred2("DFII5"),
            "dfii7":   fred2("DFII7"),
            "dfii10":  fred2("DFII10"),
            "dfii20":  fred2("DFII20"),
            "dfii30":  fred2("DFII30"),
        }

    def fetch_spreads():
        return {
            "t10y2y":  fred2("T10Y2Y"),
            "t10y3m":  fred2("T10Y3M"),
            "igOas":   fred2("BAMLC0A0CM"),
            "bbbOas":  fred2("BAMLC0A4CBBB"),
            "hyOas":   fred2("BAMLH0A0HYM2"),
            "aaOas":   fred2("BAMLC0A1CAAA"),
        }

    try:
        result = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            jobs = {
                "overnight": ex.submit(fetch_overnight),
                "treasury":  ex.submit(fetch_treasury),
                "real":      ex.submit(fetch_real),
                "spreads":   ex.submit(fetch_spreads),
            }
            for k, fut in jobs.items():
                try: result.update(fut.result(timeout=20))
                except: pass
        _RATE_CACHE["data"] = result
        _RATE_CACHE["ts"]   = now
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── GC FRED (Treasury Yield Curve — multi-date snapshots + history) ──
_GC_FRED_CACHE = {"data": None, "ts": 0}
_GC_FRED_TTL   = 3600

TREASURY_TENORS = [
    ("1M",  "DGS1MO"),
    ("3M",  "DGS3MO"),
    ("6M",  "DGS6MO"),
    ("1Y",  "DGS1"),
    ("2Y",  "DGS2"),
    ("3Y",  "DGS3"),
    ("5Y",  "DGS5"),
    ("7Y",  "DGS7"),
    ("10Y", "DGS10"),
    ("20Y", "DGS20"),
    ("30Y", "DGS30"),
]

@app.route("/api/gc_fred")
def gc_fred():
    import time, requests as _req, concurrent.futures, datetime
    now = time.time()
    if _GC_FRED_CACHE["data"] and now - _GC_FRED_CACHE["ts"] < _GC_FRED_TTL:
        return jsonify({"ok": True, **_GC_FRED_CACHE["data"]})

    FRED_KEY  = os.environ.get("FRED_API_KEY", "")
    FRED_BASE = "https://api.stlouisfed.org/fred"

    def fred_series(series_id, limit=300):
        params = {"series_id": series_id, "api_key": FRED_KEY,
                  "file_type": "json", "sort_order": "desc", "limit": limit}
        r = _req.get(f"{FRED_BASE}/series/observations", params=params, timeout=12)
        r.raise_for_status()
        out = []
        for obs in reversed(r.json().get("observations", [])):
            v = obs.get("value", ".")
            if v != ".":
                try: out.append({"date": obs["date"], "value": float(v)})
                except: pass
        return out

    def fetch_tenor(label, series_id):
        return label, fred_series(series_id, limit=300)

    try:
        series_data = {}  # label -> [{date,value}]
        with concurrent.futures.ThreadPoolExecutor(max_workers=11) as ex:
            futs = {ex.submit(fetch_tenor, lbl, sid): lbl for lbl, sid in TREASURY_TENORS}
            for fut in concurrent.futures.as_completed(futs):
                try:
                    lbl, data = fut.result(timeout=15)
                    series_data[lbl] = data
                except: pass

        # For each tenor, find the value at a given date (most recent on or before target)
        def snap(target_date_str):
            row = {}
            for lbl, obs in series_data.items():
                hits = [o for o in obs if o["date"] <= target_date_str]
                if hits: row[lbl] = hits[-1]["value"]
            return row

        # Compute target dates
        today = datetime.date.today()
        def biz_ago(days):
            d = today - datetime.timedelta(days=days)
            return d.strftime("%Y-%m-%d")

        result = {
            "current": snap(today.strftime("%Y-%m-%d")),
            "m1ago":   snap(biz_ago(30)),
            "m3ago":   snap(biz_ago(91)),
            "y1ago":   snap(biz_ago(365)),
            "history": {lbl: obs for lbl, obs in series_data.items()},
            "tenors":  [lbl for lbl, _ in TREASURY_TENORS],
            "asOf":    today.strftime("%Y-%m-%d"),
        }
        _GC_FRED_CACHE["data"] = result
        _GC_FRED_CACHE["ts"]   = now
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── EARNINGS (DoltHub: post-no-preference/earnings) ────────────────────────
DOLTHUB_BASE = "https://www.dolthub.com/api/v1alpha1/post-no-preference/earnings/master"
_ERN_CACHE   = {}                       # ticker → {"data": {...}, "ts": 0}
_ERN_TTL     = 3600                     # 1 hour
_ECAL_CACHE  = {}                       # week_str → {"data": {...}, "ts": 0}
_ECAL_TTL    = 1800                     # 30 min
_ECAL_MCAP_CACHE = {}                   # frozenset(tickers) → {"data": {...}, "ts": 0}
_ECAL_MCAP_TTL   = 86400               # 24 hours
_EM_CACHE    = {}                       # ticker → {"data": {...}, "ts": 0}
_EM_TTL      = 3600                     # 1 hour

def dolthub_query(sql):
    import requests as _req
    r = _req.get(DOLTHUB_BASE, params={"q": sql}, timeout=15)
    r.raise_for_status()
    d = r.json()
    if d.get("query_execution_status") != "Success":
        return []
    return d.get("rows", [])

def _sanitize_ticker(t):
    import re
    return re.sub(r"[^A-Z0-9.\-]", "", t.upper())[:20]


# ── GP (Graph Plot — flexible chart overlay) ──────
_GP_CACHE = {}   # series_id → {"data": {...}, "ts": 0}
_GP_TTL   = 1800  # 30 min

def _gp_fetch_one(sid):
    """Fetch a single series: try FRED first, fall back to yfinance close prices."""
    import time, requests as _req
    now = time.time()
    cached = _GP_CACHE.get(sid)
    if cached and cached.get("data") and now - cached["ts"] < _GP_TTL:
        return cached["data"]

    FRED_KEY = os.environ.get("FRED_API_KEY", "")
    FRED_BASE = "https://api.stlouisfed.org/fred"

    # Try FRED
    try:
        meta_r = _req.get(f"{FRED_BASE}/series",
            params={"series_id": sid, "api_key": FRED_KEY, "file_type": "json"},
            timeout=8)
        meta_r.raise_for_status()
        slist = meta_r.json().get("seriess", [])
        if not slist:
            raise ValueError("not found in FRED")
        s = slist[0]
        obs_r = _req.get(f"{FRED_BASE}/series/observations",
            params={"series_id": sid, "api_key": FRED_KEY,
                    "file_type": "json", "sort_order": "asc"},
            timeout=20)
        obs_r.raise_for_status()
        data = [{"date": o["date"], "value": float(o["value"])}
                for o in obs_r.json().get("observations", [])
                if o.get("value", ".") != "."]
        result = {
            "id":        sid,
            "label":     s.get("title", sid),
            "units":     s.get("units_short") or s.get("units", ""),
            "source":    "fred",
            "frequency": s.get("frequency_short", ""),
            "data":      data,
        }
    except Exception:
        # yfinance fallback
        t = yf.Ticker(sid)
        hist = t.history(period="max", interval="1d")
        if hist.empty:
            raise ValueError(f"Series '{sid}' not found in FRED or yfinance")
        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass
        data = []
        for dt, row in hist.iterrows():
            try:
                data.append({"date": str(dt)[:10], "value": round(float(row["Close"]), 4)})
            except Exception:
                pass
        result = {
            "id":        sid,
            "label":     info.get("longName") or info.get("shortName") or sid,
            "units":     "USD",
            "source":    "yfinance",
            "frequency": "Daily",
            "data":      data,
        }

    _GP_CACHE[sid] = {"data": result, "ts": now}
    return result


@app.route("/api/gp")
def gp():
    import time, concurrent.futures
    raw = request.args.get("series", "").strip().upper()
    if not raw:
        return jsonify({"ok": False, "error": "No series specified"})
    ids = [x.strip() for x in raw.split(",") if x.strip()][:4]

    results = [None] * len(ids)
    errors  = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(_gp_fetch_one, sid): i for i, sid in enumerate(ids)}
        for fut, i in futs.items():
            try:
                results[i] = fut.result(timeout=30)
            except Exception as e:
                errors.append(str(e))

    series = [r for r in results if r is not None]
    if not series:
        return jsonify({"ok": False, "error": errors[0] if errors else "No data found"})
    return jsonify({"ok": True, "series": series})


# ── ECO (Economic Release Calendar via FRED) ──────
_ECO_CACHE = {"data": None, "ts": 0}
_ECO_TTL   = 1800  # 30 min

# release_name_substring → {cat, impact, time ET, series, fmt, better_hi}
_ECO_META = {
    "Employment Situation":                 {"cat":"labor",     "impact":3,"time":"08:30","series":"PAYEMS",          "fmt":"diff_k",   "better_hi":True},
    "Unemployment Insurance Weekly Claims": {"cat":"labor",     "impact":2,"time":"08:30","series":"ICSA",            "fmt":"persons_k","better_hi":False},
    "Job Openings and Labor Turnover":      {"cat":"labor",     "impact":2,"time":"10:00","series":"JTSJOL",          "fmt":"level_m",  "better_hi":True},
    "ADP National Employment":              {"cat":"labor",     "impact":2,"time":"08:15","series":"PAYEMS",          "fmt":"diff_k",   "better_hi":True},
    "Consumer Price Index":                 {"cat":"inflation", "impact":3,"time":"08:30","series":"CPIAUCSL",        "fmt":"yoy",      "better_hi":False},
    "Producer Price Index":                 {"cat":"inflation", "impact":2,"time":"08:30","series":"PPIACO",          "fmt":"yoy",      "better_hi":False},
    "Personal Income and Outlays":          {"cat":"inflation", "impact":3,"time":"08:30","series":"PCEPILFE",        "fmt":"yoy",      "better_hi":False},
    "Gross Domestic Product":               {"cat":"growth",    "impact":3,"time":"08:30","series":"A191RL1Q225SBEA","fmt":"level_pct","better_hi":True},
    "G.17 Industrial Production":           {"cat":"growth",    "impact":2,"time":"09:15","series":"INDPRO",          "fmt":"mom",      "better_hi":True},
    "Industrial Production":                {"cat":"growth",    "impact":2,"time":"09:15","series":"INDPRO",          "fmt":"mom",      "better_hi":True},
    "Retail Sales":                         {"cat":"growth",    "impact":2,"time":"08:30","series":"RSXFS",           "fmt":"mom",      "better_hi":True},
    "Advance Retail":                       {"cat":"growth",    "impact":2,"time":"08:30","series":"RSXFS",           "fmt":"mom",      "better_hi":True},
    "Durable Goods Orders":                 {"cat":"growth",    "impact":2,"time":"08:30","series":"DGORDER",         "fmt":"mom",      "better_hi":True},
    "ISM Manufacturing":                    {"cat":"growth",    "impact":2,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "PMI":                                  {"cat":"growth",    "impact":2,"time":"09:45","series":None,              "fmt":None,       "better_hi":True},
    "Construction Spending":                {"cat":"growth",    "impact":1,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "Factory Orders":                       {"cat":"growth",    "impact":1,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "Business Inventories":                 {"cat":"growth",    "impact":1,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "Gross National Product":               {"cat":"growth",    "impact":2,"time":"08:30","series":None,              "fmt":None,       "better_hi":True},
    "FOMC":                                 {"cat":"monetary",  "impact":3,"time":"14:00","series":"FEDFUNDS",        "fmt":"level_pct","better_hi":None},
    "New Residential Construction":         {"cat":"housing",   "impact":1,"time":"08:30","series":"HOUST",           "fmt":"level_k",  "better_hi":True},
    "Existing Home Sales":                  {"cat":"housing",   "impact":1,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "New Home Sales":                       {"cat":"housing",   "impact":1,"time":"10:00","series":None,              "fmt":None,       "better_hi":True},
    "Housing Starts":                       {"cat":"housing",   "impact":1,"time":"08:30","series":"HOUST",           "fmt":"level_k",  "better_hi":True},
    "S&P/Case-Shiller":                     {"cat":"housing",   "impact":1,"time":"09:00","series":None,              "fmt":None,       "better_hi":True},
    "Primary Mortgage Market":              {"cat":"housing",   "impact":1,"time":"N/A",  "series":None,              "fmt":None,       "better_hi":False},
    "Trade Balance":                        {"cat":"trade",     "impact":2,"time":"08:30","series":None,              "fmt":None,       "better_hi":True},
    "International Trade":                  {"cat":"trade",     "impact":2,"time":"08:30","series":None,              "fmt":None,       "better_hi":True},
    "Current Account":                      {"cat":"trade",     "impact":1,"time":"08:30","series":None,              "fmt":None,       "better_hi":False},
    "Consumer Confidence":                  {"cat":"sentiment", "impact":2,"time":"10:00","series":"UMCSENT",         "fmt":"level",    "better_hi":True},
    "Consumer Sentiment":                   {"cat":"sentiment", "impact":2,"time":"10:00","series":"UMCSENT",         "fmt":"level",    "better_hi":True},
    "University of Michigan":               {"cat":"sentiment", "impact":2,"time":"10:00","series":"UMCSENT",         "fmt":"level",    "better_hi":True},
}

# Release name prefixes to exclude (false-positive substring matches)
_ECO_EXCLUDE_PREFIXES = (
    "Research Consumer Price Index",
    "Debt to Gross Domestic Product",
    "Gross Domestic Product by ",
    "State Unemployment Insurance",
    "Monthly State Retail",
    "H.15 Selected Interest",
    "Federal Funds Data",
)

@app.route("/api/eco")
def eco_calendar():
    import time, requests as _req, concurrent.futures
    from datetime import date, timedelta as td
    from collections import defaultdict
    now = time.time()
    if _ECO_CACHE["data"] and now - _ECO_CACHE["ts"] < _ECO_TTL:
        return jsonify({"ok": True, "events": _ECO_CACHE["data"]})

    FRED_KEY = os.environ.get("FRED_API_KEY", "")
    today    = date.today()
    from_dt  = (today - td(days=14)).isoformat()
    to_dt    = (today + td(days=42)).isoformat()

    def classify(name):
        for prefix in _ECO_EXCLUDE_PREFIXES:
            if name.startswith(prefix):
                return None
        name_u = name.upper()
        for keyword, meta in _ECO_META.items():
            if keyword.upper() in name_u:
                return meta
        return None

    def fred_obs(series_id, limit=14):
        try:
            r = _req.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params={"series_id": series_id, "api_key": FRED_KEY,
                        "file_type": "json", "sort_order": "desc", "limit": limit},
                timeout=10
            )
            r.raise_for_status()
            out = []
            for obs in reversed(r.json().get("observations", [])):
                v = obs.get("value", ".")
                if v != ".":
                    try: out.append({"date": obs["date"], "value": float(v)})
                    except: pass
            return out
        except:
            return []

    def fmt_values(obs, fmt):
        import datetime as _dt
        n = len(obs)
        if n < 2:
            return None, None, None, None, None
        v = [o["value"] for o in obs]
        try:
            pd = _dt.date.fromisoformat(obs[-1]["date"])
            period = pd.strftime("%b %Y")
        except:
            period = obs[-1]["date"][:7]
        if fmt == "diff_k":
            if n < 3: return None, None, None, None, period
            an = v[-1] - v[-2]; pn = v[-2] - v[-3]
            s = lambda x: f"{'+'if x>=0 else''}{x:,.0f}K"
            return s(an), s(pn), an, pn, period
        elif fmt == "level_k":
            # value is already in thousands (e.g. HOUST housing starts)
            an, pn = v[-1], v[-2]
            return f"{an:,.0f}K", f"{pn:,.0f}K", an, pn, period
        elif fmt == "persons_k":
            # value is in persons; divide by 1000 to display as "NNNk"
            an, pn = v[-1]/1000, v[-2]/1000
            return f"{an:.0f}K", f"{pn:.0f}K", an, pn, period
        elif fmt == "level_m":
            an, pn = v[-1]/1000, v[-2]/1000
            return f"{an:.2f}M", f"{pn:.2f}M", an, pn, period
        elif fmt == "yoy":
            if n < 14: return None, None, None, None, period
            an = (v[-1] - v[-13]) / abs(v[-13]) * 100
            pn = (v[-2] - v[-14]) / abs(v[-14]) * 100
            return f"{an:.1f}%", f"{pn:.1f}%", an, pn, period
        elif fmt == "mom":
            if n < 3: return None, None, None, None, period
            an = (v[-1] - v[-2]) / abs(v[-2]) * 100
            pn = (v[-2] - v[-3]) / abs(v[-3]) * 100
            s = lambda x: f"{'+'if x>=0 else''}{x:.1f}%"
            return s(an), s(pn), an, pn, period
        elif fmt == "level_pct":
            an, pn = v[-1], v[-2]
            return f"{an:.2f}%", f"{pn:.2f}%", an, pn, period
        elif fmt == "level":
            an, pn = v[-1], v[-2]
            return f"{an:.1f}", f"{pn:.1f}", an, pn, period
        return None, None, None, None, period

    try:
        r = _req.get(
            "https://api.stlouisfed.org/fred/releases/dates",
            params={"api_key": FRED_KEY, "file_type": "json", "sort_order": "asc",
                    "include_release_dates_with_no_data": "true",
                    "realtime_start": from_dt, "realtime_end": to_dt, "limit": 1000},
            timeout=15
        )
        r.raise_for_status()
        raw = r.json().get("release_dates", [])

        # Classify and dedup by (date, rid)
        classified = []
        seen = set()
        for entry in raw:
            name = entry.get("release_name", "")
            dt   = entry.get("date", "")
            rid  = entry.get("release_id")
            meta = classify(name)
            if meta is None:
                continue
            key = (dt, rid)
            if key in seen:
                continue
            seen.add(key)
            classified.append({"date": dt, "name": name, "meta": meta, "rid": rid,
                                "past": dt < today.isoformat()})

        # Per-rid: keep at most 1 past (most recent) + 1 upcoming (nearest)
        rid_groups = defaultdict(list)
        for e in classified:
            rid_groups[e["rid"]].append(e)
        final = []
        for entries in rid_groups.values():
            entries.sort(key=lambda x: x["date"])
            past = [e for e in entries if e["past"]]
            upcoming = [e for e in entries if not e["past"]]
            if past:     final.append(past[-1])
            if upcoming: final.append(upcoming[0])
        classified = final

        # Fetch unique series in parallel; yoy needs 14+ clean points → request 20
        needed_series = {}
        for e in classified:
            s = e["meta"]["series"]; fmt = e["meta"]["fmt"]
            if s:
                lim = 20 if fmt == "yoy" else 8
                needed_series[s] = max(needed_series.get(s, 0), lim)
        obs_cache = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            futures = {ex.submit(fred_obs, s, lim): s for s, lim in needed_series.items()}
            for fut, s in futures.items():
                try: obs_cache[s] = fut.result(timeout=12)
                except: obs_cache[s] = []

        events = []
        for e in classified:
            m = e["meta"]
            ev = {"date": e["date"], "name": e["name"], "category": m["cat"],
                  "rid": e["rid"], "past": e["past"], "time": m["time"],
                  "impact": m["impact"], "country": "US",
                  "actual": None, "prior": None, "actual_num": None, "prior_num": None,
                  "period": None, "better_hi": m["better_hi"]}
            if m["series"] and m["fmt"]:
                obs = obs_cache.get(m["series"], [])
                if obs:
                    act, pri, an, pn, period = fmt_values(obs, m["fmt"])
                    ev["actual"] = act; ev["prior"] = pri
                    ev["actual_num"] = an; ev["prior_num"] = pn
                    ev["period"] = period
            events.append(ev)

        events.sort(key=lambda x: (x["date"], x["time"] or "ZZ"))
        _ECO_CACHE["data"] = events
        _ECO_CACHE["ts"]   = now
        return jsonify({"ok": True, "events": events})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── MOST (Most Active) ────────────────────────
_MOST_CACHE = {"data": None, "ts": 0}
_MOST_TTL   = 300  # 5 minutes

@app.route("/api/most")
def most_active():
    import time, requests as _req
    now = time.time()
    if _MOST_CACHE["data"] and now - _MOST_CACHE["ts"] < _MOST_TTL:
        return jsonify({"ok": True, "results": _MOST_CACHE["data"]})

    # Yahoo Finance predefined screener — real-time most active US equities
    url = (
        "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
        "?formatted=false&lang=en-US&region=US&scrIds=most_actives&count=30"
    )
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
    }
    try:
        resp = _req.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        quotes = resp.json()["finance"]["result"][0]["quotes"]
        results = []
        for q in quotes:
            price = q.get("regularMarketPrice")
            prev  = q.get("regularMarketPreviousClose")
            pct   = q.get("regularMarketChangePercent")
            vol   = q.get("regularMarketVolume", 0)
            results.append({
                "sym":       q.get("symbol", "—"),
                "name":      q.get("shortName") or q.get("longName") or "—",
                "price":     price,
                "changePct": pct,
                "volume":    vol,
            })
        _MOST_CACHE["data"] = results
        _MOST_CACHE["ts"]   = now
        return jsonify({"ok": True, "results": results})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Screener unavailable: {e}"})


# ── PRED (Prediction Markets — Kalshi + Polymarket) ───────────────────────
_PRED_CACHE = {"data": None, "ts": 0}
_PRED_TTL   = 300  # 5-minute cache

def _extract_outcome_name(q):
    """Shorten a Polymarket question to just the subject name.
    'Will Donald Trump win the 2028 election?' → 'Donald Trump'
    'Will Bitcoin reach $200k?'               → 'Bitcoin'
    """
    import re
    if not q: return ''
    s = re.sub(r'^(will|does|is|can|has|did|could|would|should|may|might|do|are|was|were)\s+',
               '', q, flags=re.IGNORECASE)
    # strip from first action verb onward
    VERBS = (r'win|lose|be(?:come|at|named|elected|re-elected)?|get|take|finish|leave|exit|'
             r'resign|run|lead|pass|fail|declare|announce|sign|approve|reach|hit|break|'
             r'cross|exceed|drop|fall|rise|stay|remain|raise|cut|increase|decrease|reduce|'
             r'end|start|launch|file|survive|return|join|enter|happen|occur|complete|release|'
             r'report|beat|earn|miss|gain|sell|buy|issue|default|crash|rally|hold|keep|'
             r'receive|secure|flip|switch|adopt|implement|deploy|announce|confirm|deny')
    s = re.sub(rf'\s+(?:{VERBS})\b.*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'^the\s+', '', s, flags=re.IGNORECASE)
    s = re.sub(r'[?,.\s]+$', '', s).strip()
    return s or q[:30]

def _normalize_pred_title(s):
    import re
    STOP = {'will','the','a','an','be','in','on','at','by','or','and','to','of',
            'for','is','as','it','this','that','from','with','has','have',
            'who','what','when','where','does','do'}
    s = s.lower()
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return set(s.split()) - STOP

def _fetch_kalshi_events():
    import requests as _req
    # Fetch events (grouped) instead of raw markets — eliminates duplicate outcome rows
    url = ("https://api.elections.kalshi.com/trade-api/v2/events"
           "?status=open&with_nested_markets=true&limit=200")
    r = _req.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    r.raise_for_status()
    out = []
    for ev in r.json().get("events", []):
        markets = ev.get("markets") or []
        if not markets:
            continue
        # Aggregate volume/OI and build per-outcome list
        total_vol  = sum(float(m.get("volume_fp")       or 0) for m in markets)
        vol24      = sum(float(m.get("volume_24h_fp")    or 0) for m in markets)
        total_oi   = sum(float(m.get("open_interest_fp") or 0) for m in markets)

        outcomes = []
        for mk in markets:
            bid = float(mk.get("yes_bid_dollars") or 0) or None
            ask = float(mk.get("yes_ask_dollars") or 0) or None
            mid = round((bid + ask) / 2, 4) if (bid and ask) else None
            if mid == 0.0: mid = None
            outcomes.append({
                "title":     mk.get("title", ""),
                "ticker":    mk.get("ticker", ""),
                "yes_price": mid,
                "yes_bid":   bid,
                "yes_ask":   ask,
                "volume":    float(mk.get("volume_fp") or 0),
            })
        outcomes.sort(key=lambda x: x["yes_price"] or 0, reverse=True)

        # Leading market = highest yes_price outcome
        m = markets[0] if len(markets) == 1 else max(
            markets, key=lambda x: float(x.get("yes_bid_dollars") or 0))

        yes_bid = float(m.get("yes_bid_dollars") or 0)
        yes_ask = float(m.get("yes_ask_dollars") or 0)
        yes_mid = round((yes_bid + yes_ask) / 2, 4) if (yes_bid or yes_ask) else None
        if yes_mid == 0.0: yes_mid = None

        title = ev.get("title") or m.get("title", "")
        out.append({
            "platform":      "kalshi",
            "id":            ev.get("event_ticker", ""),
            "title":         title,
            "yes_price":     yes_mid,
            "yes_bid":       yes_bid or None,
            "yes_ask":       yes_ask or None,
            "volume":        total_vol,
            "volume24h":     vol24,
            "open_interest": total_oi,
            "liquidity":     float(ev.get("liquidity_dollars") or 0),
            "close_time":    m.get("close_time", ""),
            "created_time":  ev.get("created_time") or m.get("open_time") or "",
            "outcome_count": len(markets),
            "outcomes":      outcomes,
        })
    return out

def _fetch_poly_events():
    import requests as _req, json as _json
    # Events endpoint groups outcome markets — eliminates duplicate rows
    # sortBy/sortDirection are the correct Polymarket Gamma API params
    url = ("https://gamma-api.polymarket.com/events"
           "?active=true&closed=false&limit=200&sortBy=volume24hr&sortDirection=DESC")
    r = _req.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    r.raise_for_status()
    out = []
    for ev in r.json():
        markets = ev.get("markets") or []
        if not markets:
            continue
        # Volume/liquidity live at the event level (more reliable than summing markets)
        vol24 = float(ev.get("volume24hr") or 0)
        liq   = float(ev.get("liquidity")  or 0)
        total_vol = float(ev.get("volume") or 0)

        # Build per-outcome list and find leading (max) YES price
        best_yes = None
        outcomes = []
        for mk in markets:
            prices = mk.get("outcomePrices") or []
            if isinstance(prices, str):
                try: prices = _json.loads(prices)
                except: prices = []
            p = float(prices[0]) if prices else None
            if p is not None and p > 0 and (best_yes is None or p > best_yes):
                best_yes = p

            outcome_names = mk.get("outcomes") or []
            if isinstance(outcome_names, str):
                try: outcome_names = _json.loads(outcome_names)
                except: outcome_names = []
            clob_ids = mk.get("clobTokenIds") or []
            if isinstance(clob_ids, str):
                try: clob_ids = _json.loads(clob_ids)
                except: clob_ids = []
            outcomes.append({
                "title":      _extract_outcome_name(mk.get("question") or (outcome_names[0] if outcome_names else "")),
                "clob_token": clob_ids[0] if clob_ids else None,
                "yes_price":  round(p, 4) if (p is not None and p > 0) else None,
                "volume":     float(mk.get("volume") or 0),
            })
        outcomes.sort(key=lambda x: x["yes_price"] or 0, reverse=True)
        yes_price = best_yes

        title = ev.get("title") or ""
        out.append({
            "platform":      "polymarket",
            "id":            str(ev.get("id") or ""),
            "title":         title,
            "yes_price":     round(yes_price, 4) if yes_price is not None else None,
            "yes_bid":       None,
            "yes_ask":       None,
            "volume":        total_vol,
            "volume24h":     vol24,
            "open_interest": float(ev.get("openInterest") or 0),
            "liquidity":     liq,
            "close_time":    ev.get("endDate") or "",
            "created_time":  ev.get("createdAt") or ev.get("startDate") or "",
            "outcome_count": len(markets),
            "outcomes":      outcomes,
        })
    return out

def _find_arb_pairs(kalshi, poly):
    # Best-effort keyword matching — verify manually before trading.
    poly_norm = [
        (m, _normalize_pred_title(m["title"]))
        for m in poly if m["yes_price"] is not None
    ]
    pairs = []
    for km in kalshi:
        if km["yes_price"] is None: continue
        kwords = _normalize_pred_title(km["title"])
        if len(kwords) < 2: continue
        best, best_score = None, 0.0
        for pm, pwords in poly_norm:
            if len(pwords) < 2: continue
            score = len(kwords & pwords) / max(len(kwords | pwords), 1)
            if score > best_score:
                best_score, best = score, pm
        if best and best_score >= 0.30:
            spread = round(abs(km["yes_price"] - best["yes_price"]) * 100, 1)
            pairs.append({
                "kalshi_title": km["title"],
                "poly_title":   best["title"],
                "kalshi_yes":   km["yes_price"],
                "poly_yes":     best["yes_price"],
                "spread_cents": spread,
                "kalshi_id":    km["id"],
                "poly_id":      best["id"],
                "match_score":  round(best_score, 2),
                "vol24_kalshi": km["volume24h"],
                "vol24_poly":   best["volume24h"],
            })
    pairs.sort(key=lambda x: (x["spread_cents"], x["match_score"]), reverse=True)
    return pairs[:50]

@app.route("/api/pred")
def pred_markets():
    import time, concurrent.futures
    now = time.time()
    if _PRED_CACHE["data"] and now - _PRED_CACHE["ts"] < _PRED_TTL:
        return jsonify({"ok": True, **_PRED_CACHE["data"]})
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            kf = ex.submit(_fetch_kalshi_events)
            pf = ex.submit(_fetch_poly_events)
            try:    kalshi = kf.result(timeout=18)
            except: kalshi = []
            try:    poly   = pf.result(timeout=18)
            except: poly   = []
        arb = _find_arb_pairs(kalshi, poly)
        result = {"kalshi": kalshi, "polymarket": poly, "arb": arb}
        _PRED_CACHE["data"] = result
        _PRED_CACHE["ts"]   = now
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/pred/history")
def pred_history():
    platform  = request.args.get("platform")
    market_id = request.args.get("market")
    if not platform or not market_id:
        return jsonify({"ok": False, "error": "platform and market required"})
    import requests as _req
    try:
        if platform == "poly":
            url = (f"https://clob.polymarket.com/prices-history"
                   f"?market={market_id}&interval=max&fidelity=60")
            r = _req.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
            r.raise_for_status()
            history = [{"time": int(pt["t"]), "value": round(float(pt["p"]) * 100, 2)}
                       for pt in r.json().get("history", [])]
        elif platform == "kalshi":
            # Try elections API first (public, same host as events); fall back to trading API
            for base in ("https://api.elections.kalshi.com", "https://trading-api.kalshi.com"):
                try:
                    url = f"{base}/trade-api/v2/markets/{market_id}/history?limit=1000"
                    r = _req.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
                    r.raise_for_status()
                    break
                except Exception:
                    continue
            pts = r.json().get("history", [])
            history = []
            for pt in pts:
                ts = int(pt.get("ts", 0))
                # Kalshi ts may be seconds or milliseconds
                t = ts // 1000 if ts > 1_700_000_000_000 else ts
                p = float(pt.get("yes_price", 0))
                # yes_price is 0-1 fraction; multiply to get 0-100 percentage
                v = round(p * 100 if p <= 1.0 else p, 2)
                if t > 0 and v > 0:
                    history.append({"time": t, "value": v})
        else:
            return jsonify({"ok": False, "error": "unknown platform"})
        return jsonify({"ok": True, "history": history})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── FOCUS (single security live price) ────────
@app.route("/api/focus/<ticker>")
def focus(ticker):
    if _is_crypto_ticker(ticker):
        try:
            sym = _binance_sym(ticker)
            r = requests.get(f"{_BINANCE_BASE_URL}/ticker/24hr", params={"symbol": sym}, timeout=4)
            if r.ok:
                d = r.json()
                price = float(d['lastPrice'])
                prev  = float(d['openPrice'])
                chg   = price - prev
                pct   = (chg / prev * 100) if prev else 0
                return jsonify({
                    "ok": True, "ticker": ticker.upper(),
                    "name":      sym,
                    "price":     price,
                    "change":    chg,
                    "changePct": pct,
                    "high":      float(d['highPrice']),
                    "low":       float(d['lowPrice']),
                    "volume":    float(d['volume']),
                    "marketCap": None,
                    "bid": None, "ask": None,
                })
        except Exception:
            pass  # fall through to yfinance
    try:
        t = yf.Ticker(ticker)
        info = t.info
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev  = info.get("previousClose")
        chg   = (price - prev) if (price and prev) else None
        pct   = ((chg/prev)*100) if (chg and prev) else None
        return jsonify({
            "ok": True, "ticker": ticker.upper(),
            "name":  info.get("shortName","—"),
            "price": price, "change": chg, "changePct": pct,
            "high":  info.get("dayHigh"), "low": info.get("dayLow"),
            "volume":info.get("volume"),
            "bid":   info.get("bid"), "ask": info.get("ask"),
            "marketCap": fmt_large(info.get("marketCap")),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── GC (Yield Curve) ──────────────────────────────────────────────────────────
@app.route("/api/gc")
def yield_curve():
    country = request.args.get("country", "US").upper()
    if country == "US":
        return _yield_curve_us()
    return _yield_curve_sovereign(country)


def _yield_curve_us():
    """
    Primary: US Treasury FiscalData API — official par yields, all 12 tenors.
    Real-time overlay: yfinance ^IRX/^FVX/^TNX/^TYX for 3M, 5Y, 10Y, 30Y.
    """
    # Treasury API key → short label → yfinance real-time ticker (None if unavailable)
    TENOR_META = [
        ("1 Mo",  "1M",  None),
        ("2 Mo",  "2M",  None),
        ("3 Mo",  "3M",  "^IRX"),
        ("6 Mo",  "6M",  None),
        ("1 Yr",  "1Y",  None),
        ("2 Yr",  "2Y",  None),
        ("3 Yr",  "3Y",  None),
        ("5 Yr",  "5Y",  "^FVX"),
        ("7 Yr",  "7Y",  None),
        ("10 Yr", "10Y", "^TNX"),
        ("20 Yr", "20Y", None),
        ("30 Yr", "30Y", "^TYX"),
    ]

    # 1. Treasury FiscalData API (all 12 tenors, previous business day)
    treas_curve, record_date = get_ust_yield_curve()

    # 2. yfinance real-time override for 4 available tickers
    yf_live = {}
    for _, _, sym in TENOR_META:
        if sym and sym not in yf_live:
            try:
                info  = yf.Ticker(sym).info
                price = info.get("regularMarketPrice") or info.get("currentPrice")
                if price:
                    yf_live[sym] = round(float(price), 3)
            except Exception:
                pass

    # 3. Merge: Treasury as base, yfinance overrides where available
    yields_ordered = []
    yields_dict    = {}
    for api_key, label, sym in TENOR_META:
        val    = treas_curve.get(api_key)
        source = "treasury"
        if sym and sym in yf_live:
            val    = yf_live[sym]
            source = "live"
        if val is not None:
            val = round(float(val), 3)
        yields_ordered.append({"tenor": label, "yield": val, "source": source})
        yields_dict[label] = val

    # 4. Spread & inversion signals
    def _spread(a, b):
        va, vb = yields_dict.get(a), yields_dict.get(b)
        if va is None or vb is None:
            return None, None
        return round((vb - va) * 100, 1), bool(va > vb)

    sp_2y10y, inv_2y10y = _spread("2Y", "10Y")
    sp_3m10y, inv_3m10y = _spread("3M", "10Y")
    sp_5y30y, inv_5y30y = _spread("5Y", "30Y")
    sp_2y5y,  inv_2y5y  = _spread("2Y", "5Y")

    # 5. Inverted segments (index of left point where yield descends)
    inv_segs = [
        i for i in range(len(yields_ordered) - 1)
        if yields_ordered[i]["yield"] is not None
        and yields_ordered[i + 1]["yield"] is not None
        and yields_ordered[i + 1]["yield"] < yields_ordered[i]["yield"]
    ]

    return jsonify({
        "ok":               True,
        "country":          "US",
        "record_date":      record_date,
        "yieldsOrdered":    yields_ordered,
        "yields":           yields_dict,
        "spreads": {
            "2y10y": {"bp": sp_2y10y, "inverted": inv_2y10y, "label": "2Y/10Y"},
            "3m10y": {"bp": sp_3m10y, "inverted": inv_3m10y, "label": "3M/10Y"},
            "5y30y": {"bp": sp_5y30y, "inverted": inv_5y30y, "label": "5Y/30Y"},
            "2y5y":  {"bp": sp_2y5y,  "inverted": inv_2y5y,  "label": "2Y/5Y"},
        },
        "inverted":         bool(inv_2y10y or inv_3m10y),
        "invertedSegments": inv_segs,
        "spread3m10y_bp":   sp_3m10y,   # kept for backwards compat
    })


def _yield_curve_sovereign(country):
    """Fallback for non-US: yfinance tickers from SOVEREIGN_DB."""
    db = SOVEREIGN_DB.get(country)
    if not db:
        return jsonify({"ok": False, "error": f"Unknown country: {country}"}), 404

    ORDER = ["3M","6M","1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"]
    tenors  = db.get("tenors", {})
    ordered = sorted(tenors.keys(), key=lambda k: ORDER.index(k) if k in ORDER else 99)

    yields_ordered = []
    yields_dict    = {}
    for label in ordered:
        val = None
        try:
            info  = yf.Ticker(tenors[label]).info
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            if price:
                val = round(float(price), 3)
        except Exception:
            pass
        yields_ordered.append({"tenor": label, "yield": val, "source": "live"})
        yields_dict[label] = val

    def _spread(a, b):
        va, vb = yields_dict.get(a), yields_dict.get(b)
        if va is None or vb is None: return None, None
        return round((vb - va) * 100, 1), bool(va > vb)

    sp_2y10y, inv_2y10y = _spread("2Y", "10Y")
    sp_3m10y, inv_3m10y = _spread("3M", "10Y")

    inv_segs = [
        i for i in range(len(yields_ordered) - 1)
        if yields_ordered[i]["yield"] and yields_ordered[i+1]["yield"]
        and yields_ordered[i+1]["yield"] < yields_ordered[i]["yield"]
    ]

    return jsonify({
        "ok":               True,
        "country":          country,
        "record_date":      None,
        "yieldsOrdered":    yields_ordered,
        "yields":           yields_dict,
        "spreads": {
            "2y10y": {"bp": sp_2y10y, "inverted": inv_2y10y, "label": "2Y/10Y"},
            "3m10y": {"bp": sp_3m10y, "inverted": inv_3m10y, "label": "3M/10Y"},
        },
        "inverted":         bool(inv_2y10y or inv_3m10y),
        "invertedSegments": inv_segs,
        "spread3m10y_bp":   sp_3m10y,
    })


# ── COMMODITY FORWARD CURVES ──────────────────────────
@app.route("/api/commodity_curve/<commodity>")
def commodity_curve(commodity):
    """
    Returns spot + available front months for a commodity.
    Uses yfinance continuous front-month as spot, then tries named contract months.
    Structure: contango (futures > spot) or backwardation (spot > futures).
    """
    CURVES = {
        "crude":  {
            "name": "WTI Crude Oil",
            "tickers": ["CL=F", "CLM25.NYM", "CLU25.NYM", "CLZ25.NYM", "CLH26.NYM"],
            "labels":  ["Spot", "Jun 25", "Sep 25", "Dec 25", "Mar 26"],
            "unit": "USD/bbl"
        },
        "gold": {
            "name": "Gold",
            "tickers": ["GC=F", "GCM25.CMX", "GCZ25.CMX", "GCM26.CMX"],
            "labels":  ["Spot", "Jun 25", "Dec 25", "Jun 26"],
            "unit": "USD/troy oz"
        },
        "natgas": {
            "name": "Natural Gas",
            "tickers": ["NG=F", "NGM25.NYM", "NGU25.NYM", "NGZ25.NYM", "NGH26.NYM"],
            "labels":  ["Spot", "Jun 25", "Sep 25", "Dec 25", "Mar 26"],
            "unit": "USD/MMBtu"
        },
        "corn": {
            "name": "Corn",
            "tickers": ["ZC=F", "ZCN25.CBT", "ZCZ25.CBT", "ZCH26.CBT"],
            "labels":  ["Spot", "Jul 25", "Dec 25", "Mar 26"],
            "unit": "USc/bu"
        },
        "wheat": {
            "name": "Wheat",
            "tickers": ["ZW=F", "ZWN25.CBT", "ZWZ25.CBT", "ZWH26.CBT"],
            "labels":  ["Spot", "Jul 25", "Dec 25", "Mar 26"],
            "unit": "USc/bu"
        },
        "soybeans": {
            "name": "Soybeans",
            "tickers": ["ZS=F", "ZSN25.CBT", "ZSX25.CBT", "ZSH26.CBT"],
            "labels":  ["Spot", "Jul 25", "Nov 25", "Mar 26"],
            "unit": "USc/bu"
        },
        "copper": {
            "name": "Copper",
            "tickers": ["HG=F", "HGN25.CMX", "HGZ25.CMX"],
            "labels":  ["Spot", "Jul 25", "Dec 25"],
            "unit": "USD/lb"
        },
        "silver": {
            "name": "Silver",
            "tickers": ["SI=F", "SIN25.CMX", "SIZ25.CMX"],
            "labels":  ["Spot", "Jul 25", "Dec 25"],
            "unit": "USD/troy oz"
        },
    }

    key = commodity.lower()
    if key not in CURVES:
        return jsonify({"ok": False, "error": f"Unknown commodity '{commodity}'. Options: {list(CURVES.keys())}"})

    cfg = CURVES[key]
    points = []
    for i, sym in enumerate(cfg["tickers"]):
        try:
            t     = yf.Ticker(sym)
            info  = t.info
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            if price:
                points.append({"label": cfg["labels"][i], "price": round(float(price), 4)})
        except:
            pass

    if not points:
        return jsonify({"ok": False, "error": "No price data available for this commodity curve."})

    spot   = points[0]["price"] if points else None
    far    = points[-1]["price"] if len(points) > 1 else None
    is_contango = (far and spot and far > spot)
    spread_pct  = round(((far - spot) / spot) * 100, 2) if (far and spot) else None

    return jsonify({
        "ok": True,
        "commodity": key,
        "name":      cfg["name"],
        "unit":      cfg["unit"],
        "points":    points,
        "isContango":    is_contango,
        "spreadPct":     spread_pct,
        "structure":     "CONTANGO" if is_contango else "BACKWARDATION",
        "structureNote": ("Futures trade above spot — implies storage cost premium, bearish carry signal."
                          if is_contango else
                          "Spot trades above futures — supply tightness, bullish carry signal.")
    })




# ══════════════════════════════════════════════════════════════════════════
#  SOVG — WORLDWIDE SOVEREIGN BOND MONITOR
#  Bloomberg-style: SOVG, WB, GOVT
#
#  Ticker format used:
#    US Treasuries: ^IRX (3M), ^FVX (5Y), ^TNX (10Y), ^TYX (30Y)
#    International: {TENOR}YT=RR  e.g. DE10YT=RR (German Bund 10Y)
#    This is the Reuters Real-Time format hosted on Yahoo Finance.
#    Confirmed working tickers from Yahoo Finance bond screener.
# ══════════════════════════════════════════════════════════════════════════

SOVEREIGN_DB = {
    "US": {
        "name": "United States", "currency": "USD", "region": "Americas",
        "rating": "AA+", "flag": "🇺🇸", "debt_gdp": 123.3,
        "tenors": {
            "3M":  "^IRX",
            "5Y":  "^FVX",
            "10Y": "^TNX",
            "30Y": "^TYX",
        },
        "benchmark": "10Y", "benchmark_sym": "^TNX",
    },
    "DE": {
        "name": "Germany (Bund)", "currency": "EUR", "region": "Europe",
        "rating": "AAA", "flag": "🇩🇪", "debt_gdp": 63.6,
        "tenors": {
            "2Y":  "DE2YT=RR",
            "5Y":  "DE5YT=RR",
            "10Y": "DE10YT=RR",
            "30Y": "DE30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "DE10YT=RR",
    },
    "GB": {
        "name": "United Kingdom (Gilt)", "currency": "GBP", "region": "Europe",
        "rating": "AA", "flag": "🇬🇧", "debt_gdp": 101.1,
        "tenors": {
            "2Y":  "GB2YT=RR",
            "5Y":  "GB5YT=RR",
            "10Y": "GB10YT=RR",
            "30Y": "GB30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "GB10YT=RR",
    },
    "JP": {
        "name": "Japan (JGB)", "currency": "JPY", "region": "Asia-Pacific",
        "rating": "A+", "flag": "🇯🇵", "debt_gdp": 261.3,
        "tenors": {
            "2Y":  "JP2YT=RR",
            "5Y":  "JP5YT=RR",
            "10Y": "JP10YT=RR",
            "30Y": "JP30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "JP10YT=RR",
    },
    "FR": {
        "name": "France (OAT)", "currency": "EUR", "region": "Europe",
        "rating": "AA-", "flag": "🇫🇷", "debt_gdp": 111.6,
        "tenors": {
            "2Y":  "FR2YT=RR",
            "5Y":  "FR5YT=RR",
            "10Y": "FR10YT=RR",
            "30Y": "FR30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "FR10YT=RR",
    },
    "IT": {
        "name": "Italy (BTP)", "currency": "EUR", "region": "Europe",
        "rating": "BBB", "flag": "🇮🇹", "debt_gdp": 139.8,
        "tenors": {
            "2Y":  "IT2YT=RR",
            "5Y":  "IT5YT=RR",
            "10Y": "IT10YT=RR",
            "30Y": "IT30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "IT10YT=RR",
    },
    "ES": {
        "name": "Spain (Bonos)", "currency": "EUR", "region": "Europe",
        "rating": "A", "flag": "🇪🇸", "debt_gdp": 107.7,
        "tenors": {
            "2Y":  "ES2YT=RR",
            "5Y":  "ES5YT=RR",
            "10Y": "ES10YT=RR",
            "30Y": "ES30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "ES10YT=RR",
    },
    "CA": {
        "name": "Canada", "currency": "CAD", "region": "Americas",
        "rating": "AAA", "flag": "🇨🇦", "debt_gdp": 46.5,
        "tenors": {
            "2Y":  "CA2YT=RR",
            "5Y":  "CA5YT=RR",
            "10Y": "CA10YT=RR",
            "30Y": "CA30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CA10YT=RR",
    },
    "AU": {
        "name": "Australia", "currency": "AUD", "region": "Asia-Pacific",
        "rating": "AAA", "flag": "🇦🇺", "debt_gdp": 52.1,
        "tenors": {
            "2Y":  "AU2YT=RR",
            "5Y":  "AU5YT=RR",
            "10Y": "AU10YT=RR",
            "30Y": "AU30YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "AU10YT=RR",
    },
    "CN": {
        "name": "China (CGB)", "currency": "CNY", "region": "Asia-Pacific",
        "rating": "A+", "flag": "🇨🇳", "debt_gdp": 51.9,
        "tenors": {
            "2Y":  "CN2YT=RR",
            "5Y":  "CN5YT=RR",
            "10Y": "CN10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CN10YT=RR",
    },
    "CH": {
        "name": "Switzerland", "currency": "CHF", "region": "Europe",
        "rating": "AAA", "flag": "🇨🇭", "debt_gdp": 39.2,
        "tenors": {
            "2Y":  "CH2YT=RR",
            "10Y": "CH10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CH10YT=RR",
    },
    "NL": {
        "name": "Netherlands", "currency": "EUR", "region": "Europe",
        "rating": "AAA", "flag": "🇳🇱", "debt_gdp": 49.5,
        "tenors": {
            "10Y": "NL10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "NL10YT=RR",
    },
    "SE": {
        "name": "Sweden", "currency": "SEK", "region": "Europe",
        "rating": "AAA", "flag": "🇸🇪", "debt_gdp": 31.2,
        "tenors": {
            "2Y":  "SE2YT=RR",
            "10Y": "SE10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "SE10YT=RR",
    },
    "NO": {
        "name": "Norway", "currency": "NOK", "region": "Europe",
        "rating": "AAA", "flag": "🇳🇴", "debt_gdp": 40.6,
        "tenors": {
            "10Y": "NO10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "NO10YT=RR",
    },
    "DK": {
        "name": "Denmark", "currency": "DKK", "region": "Europe",
        "rating": "AAA", "flag": "🇩🇰", "debt_gdp": 29.0,
        "tenors": {
            "10Y": "DK10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "DK10YT=RR",
    },
    "PT": {
        "name": "Portugal", "currency": "EUR", "region": "Europe",
        "rating": "BBB+", "flag": "🇵🇹", "debt_gdp": 112.4,
        "tenors": {
            "2Y":  "PT2YT=RR",
            "10Y": "PT10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "PT10YT=RR",
    },
    "GR": {
        "name": "Greece", "currency": "EUR", "region": "Europe",
        "rating": "BB+", "flag": "🇬🇷", "debt_gdp": 161.9,
        "tenors": {
            "2Y":  "GR2YT=RR",
            "10Y": "GR10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "GR10YT=RR",
    },
    "BR": {
        "name": "Brazil", "currency": "BRL", "region": "Americas",
        "rating": "BB", "flag": "🇧🇷", "debt_gdp": 88.6,
        "tenors": {
            "2Y":  "BR2YT=RR",
            "10Y": "BR10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "BR10YT=RR",
    },
    "MX": {
        "name": "Mexico", "currency": "MXN", "region": "Americas",
        "rating": "BBB-", "flag": "🇲🇽", "debt_gdp": 52.7,
        "tenors": {
            "2Y":  "MX2YT=RR",
            "10Y": "MX10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "MX10YT=RR",
    },
    "IN": {
        "name": "India", "currency": "INR", "region": "Asia-Pacific",
        "rating": "BBB-", "flag": "🇮🇳", "debt_gdp": 84.0,
        "tenors": {
            "2Y":  "IN2YT=RR",
            "10Y": "IN10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "IN10YT=RR",
    },
    "KR": {
        "name": "South Korea", "currency": "KRW", "region": "Asia-Pacific",
        "rating": "AA", "flag": "🇰🇷", "debt_gdp": 50.4,
        "tenors": {
            "2Y":  "KR2YT=RR",
            "10Y": "KR10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "KR10YT=RR",
    },
    "SG": {
        "name": "Singapore (SGS)", "currency": "SGD", "region": "Asia-Pacific",
        "rating": "AAA", "flag": "🇸🇬", "debt_gdp": 167.8,
        "tenors": {
            "2Y":  "SG2YT=RR",
            "10Y": "SG10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "SG10YT=RR",
    },
    "NZ": {
        "name": "New Zealand", "currency": "NZD", "region": "Asia-Pacific",
        "rating": "AA+", "flag": "🇳🇿", "debt_gdp": 52.1,
        "tenors": {
            "2Y":  "NZ2YT=RR",
            "10Y": "NZ10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "NZ10YT=RR",
    },
    "ZA": {
        "name": "South Africa", "currency": "ZAR", "region": "Africa",
        "rating": "BB-", "flag": "🇿🇦", "debt_gdp": 73.4,
        "tenors": {
            "10Y": "ZA10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "ZA10YT=RR",
    },
    "TR": {
        "name": "Turkey", "currency": "TRY", "region": "Europe",
        "rating": "B+", "flag": "🇹🇷", "debt_gdp": 31.4,
        "tenors": {
            "2Y":  "TR2YT=RR",
            "10Y": "TR10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "TR10YT=RR",
    },
    "PL": {
        "name": "Poland", "currency": "PLN", "region": "Europe",
        "rating": "A-", "flag": "🇵🇱", "debt_gdp": 49.2,
        "tenors": {
            "2Y":  "PL2YT=RR",
            "10Y": "PL10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "PL10YT=RR",
    },
    "CZ": {
        "name": "Czech Republic", "currency": "CZK", "region": "Europe",
        "rating": "AA-", "flag": "🇨🇿", "debt_gdp": 44.2,
        "tenors": {
            "10Y": "CZ10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CZ10YT=RR",
    },
    "HU": {
        "name": "Hungary", "currency": "HUF", "region": "Europe",
        "rating": "BBB", "flag": "🇭🇺", "debt_gdp": 73.7,
        "tenors": {
            "10Y": "HU10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "HU10YT=RR",
    },
    "ID": {
        "name": "Indonesia", "currency": "IDR", "region": "Asia-Pacific",
        "rating": "BBB", "flag": "🇮🇩", "debt_gdp": 39.6,
        "tenors": {
            "2Y":  "ID2YT=RR",
            "10Y": "ID10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "ID10YT=RR",
    },
    "TH": {
        "name": "Thailand", "currency": "THB", "region": "Asia-Pacific",
        "rating": "BBB+", "flag": "🇹🇭", "debt_gdp": 60.2,
        "tenors": {
            "10Y": "TH10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "TH10YT=RR",
    },
    "MY": {
        "name": "Malaysia", "currency": "MYR", "region": "Asia-Pacific",
        "rating": "A-", "flag": "🇲🇾", "debt_gdp": 67.6,
        "tenors": {
            "3Y":  "MY3YT=RR",
            "10Y": "MY10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "MY10YT=RR",
    },
    "AT": {
        "name": "Austria", "currency": "EUR", "region": "Europe",
        "rating": "AA+", "flag": "🇦🇹", "debt_gdp": 74.9,
        "tenors": {
            "10Y": "AT10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "AT10YT=RR",
    },
    "BE": {
        "name": "Belgium", "currency": "EUR", "region": "Europe",
        "rating": "AA-", "flag": "🇧🇪", "debt_gdp": 105.2,
        "tenors": {
            "10Y": "BE10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "BE10YT=RR",
    },
    "FI": {
        "name": "Finland", "currency": "EUR", "region": "Europe",
        "rating": "AA+", "flag": "🇫🇮", "debt_gdp": 73.6,
        "tenors": {
            "10Y": "FI10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "FI10YT=RR",
    },
    "IE": {
        "name": "Ireland", "currency": "EUR", "region": "Europe",
        "rating": "AA-", "flag": "🇮🇪", "debt_gdp": 44.0,
        "tenors": {
            "10Y": "IE10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "IE10YT=RR",
    },
    "IL": {
        "name": "Israel", "currency": "ILS", "region": "Middle East",
        "rating": "A+", "flag": "🇮🇱", "debt_gdp": 60.8,
        "tenors": {
            "10Y": "IL10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "IL10YT=RR",
    },
    "SA": {
        "name": "Saudi Arabia", "currency": "SAR", "region": "Middle East",
        "rating": "A+", "flag": "🇸🇦", "debt_gdp": 26.2,
        "tenors": {
            "10Y": "SA10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "SA10YT=RR",
    },
    "CO": {
        "name": "Colombia", "currency": "COP", "region": "Americas",
        "rating": "BB+", "flag": "🇨🇴", "debt_gdp": 56.1,
        "tenors": {
            "10Y": "CO10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CO10YT=RR",
    },
    "CL": {
        "name": "Chile", "currency": "CLP", "region": "Americas",
        "rating": "A", "flag": "🇨🇱", "debt_gdp": 36.3,
        "tenors": {
            "10Y": "CL10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "CL10YT=RR",
    },
    "RO": {
        "name": "Romania", "currency": "RON", "region": "Europe",
        "rating": "BBB-", "flag": "🇷🇴", "debt_gdp": 49.0,
        "tenors": {
            "10Y": "RO10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "RO10YT=RR",
    },
    "PH": {
        "name": "Philippines", "currency": "PHP", "region": "Asia-Pacific",
        "rating": "BBB+", "flag": "🇵🇭", "debt_gdp": 57.9,
        "tenors": {
            "10Y": "PH10YT=RR",
        },
        "benchmark": "10Y", "benchmark_sym": "PH10YT=RR",
    },
}


# ── Sovereign bond data sources ───────────────────────────────────────
#
#  Reuters =RR tickers are no longer available on Yahoo Finance.
#  We now use three sources:
#    1. yfinance  — US Treasuries only (^TNX, ^FVX, ^TYX, ^IRX)
#    2. ECB IRS   — European countries (monthly averages)
#    3. OECD KEI  — Non-European countries (monthly averages)
#
#  Bulk data is cached in _SOVG_CACHE for CACHE_TTL seconds so that
#  a single page-load doesn't trigger dozens of API round-trips.
# ──────────────────────────────────────────────────────────────────────

import time as _time
import io as _io
import re as _re

_SOVG_CACHE: dict = {}
_CACHE_TTL       = 4 * 3600   # 4 hours — successful fetch
_CACHE_TTL_RETRY = 5 * 60     # 5 minutes — retry after failed fetch

# 2-letter SOVEREIGN_DB code -> ECB IRS series key (monthly, 10Y)
_ECB_SERIES = {
    "AT": "M.AT.L.L40.CI.0000.EUR.N.Z",
    "BE": "M.BE.L.L40.CI.0000.EUR.N.Z",
    "CZ": "M.CZ.L.L40.CI.0000.CZK.N.Z",
    "DE": "M.DE.L.L40.CI.0000.EUR.N.Z",
    "DK": "M.DK.L.L40.CI.0000.DKK.N.Z",
    "ES": "M.ES.L.L40.CI.0000.EUR.N.Z",
    "FI": "M.FI.L.L40.CI.0000.EUR.N.Z",
    "FR": "M.FR.L.L40.CI.0000.EUR.N.Z",
    # GB intentionally omitted — ECB stopped reporting UK data after Brexit (last obs 2020)
    # UK Gilt data fetched separately from Bank of England API
    "GR": "M.GR.L.L40.CI.0000.EUR.N.Z",
    "HU": "M.HU.L.L40.CI.0000.HUF.N.Z",
    "IE": "M.IE.L.L40.CI.0000.EUR.N.Z",
    "IT": "M.IT.L.L40.CI.0000.EUR.N.Z",
    "NL": "M.NL.L.L40.CI.0000.EUR.N.Z",
    "PL": "M.PL.L.L40.CI.0000.PLN.N.Z",
    "PT": "M.PT.L.L40.CI.0000.EUR.N.Z",
    "RO": "M.RO.L.L40.CI.0000.RON.N.Z",
    "SE": "M.SE.L.L40.CI.0000.SEK.N.Z",
}

# 2-letter SOVEREIGN_DB code -> OECD 3-letter country code
_OECD_CODES = {
    "AU": "AUS", "BR": "BRA", "CA": "CAN", "CH": "CHE",
    "CL": "CHL", "CO": "COL", "ID": "IDN", "IL": "ISR",
    "IN": "IND", "JP": "JPN", "KR": "KOR", "MX": "MEX",
    "NO": "NOR", "NZ": "NZL", "ZA": "ZAF",
}


def _fetch_ecb_bulk(n_obs=24):
    """Return {country_2letter: [(period, value), ...]} from ECB IRS."""
    import requests, pandas as pd
    countries  = "+".join(sorted({s.split(".")[1] for s in _ECB_SERIES.values()}))
    currencies = "+".join(sorted({s.split(".")[6] for s in _ECB_SERIES.values()}))
    url = (f"https://data-api.ecb.europa.eu/service/data/IRS/"
           f"M.{countries}.L.L40.CI.0000.{currencies}.N.Z"
           f"?format=csvdata&lastNObservations={n_obs}")
    try:
        r = requests.get(url, headers={"User-Agent": "KineticTerminal/2.0"}, timeout=20)
        if r.status_code != 200:
            return {}
        df = pd.read_csv(_io.StringIO(r.text))
        # Build reverse map: ECB 2-letter REF_AREA -> SOVEREIGN_DB code (same for Europe)
        result = {}
        for code2 in _ECB_SERIES:
            ref_area = _ECB_SERIES[code2].split(".")[1]
            sub = df[df["REF_AREA"] == ref_area].sort_values("TIME_PERIOD")
            vals = []
            for _, row in sub.iterrows():
                try:
                    vals.append((str(row["TIME_PERIOD"]), round(float(row["OBS_VALUE"]), 3)))
                except (ValueError, KeyError):
                    pass
            if vals:
                result[code2] = vals
        return result
    except Exception:
        return {}


def _fetch_boe_bulk(n_obs=24):
    """Return {'GB': [(date, value), ...]} from Bank of England IADB (daily 10Y gilt)."""
    import requests, io, pandas as pd
    url = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp"
           "?csv.x=yes&Datefrom=01/Jan/2022&Dateto=now&SeriesCodes=IUDMNPY&CSVF=TN&UsingCodes=Y")
    try:
        r = requests.get(url, headers={"User-Agent": "KineticTerminal/2.0"}, timeout=15)
        if r.status_code != 200:
            return {}
        df = pd.read_csv(_io.StringIO(r.text))
        df.columns = ["date", "yield"]
        df = df.dropna(subset=["yield"]).sort_values("date")
        # Convert 'DD Mon YYYY' dates to ISO format for consistency
        df["date"] = pd.to_datetime(df["date"], format="%d %b %Y", errors="coerce").dt.strftime("%Y-%m-%d")
        df = df.dropna(subset=["date"])
        vals = [(row["date"], round(float(row["yield"]), 3)) for _, row in df.iterrows()]
        # Downsample to weekly (last value per week) for the sparkline, keep last n_obs weeks
        if len(vals) > n_obs:
            step = max(1, len(vals) // n_obs)
            vals = vals[::step][-n_obs:]
        return {"GB": vals} if vals else {}
    except Exception:
        return {}


def _fetch_oecd_bulk(n_obs=24):
    """Return {country_2letter: [(period, value), ...]} from OECD KEI IRLT."""
    import requests
    codes3 = "+".join(set(_OECD_CODES.values()))
    url = (f"https://sdmx.oecd.org/public/rest/data/"
           f"OECD.SDD.STES,DSD_KEI@DF_KEI,4.0/"
           f"{codes3}.M.IRLT.PA._Z._Z._Z"
           f"?lastNObservations={n_obs}&format=csvdata")
    try:
        r = requests.get(url, headers={"User-Agent": "KineticTerminal/2.0"}, timeout=20)
        if r.status_code != 200:
            return {}
        # OECD returns XML even when csvdata is requested for this endpoint
        oecd3_data: dict = {}
        for block in _re.findall(
                r"<generic:Series>(.*?)</generic:Series>", r.text, _re.DOTALL):
            dims = dict(_re.findall(r'id="([^"]+)" value="([^"]+)"', block))
            if dims.get("FREQ") != "M":
                continue
            code3   = dims.get("REF_AREA", "")
            periods = _re.findall(r'TIME_PERIOD[^"]*"[^"]*"([^"]+)"', block)
            values  = _re.findall(r'ObsValue value="([^"]+)"', block)
            if code3 and values:
                pairs = []
                for p, v in zip(periods, values):
                    try:
                        pairs.append((p, round(float(v), 3)))
                    except ValueError:
                        pass
                oecd3_data[code3] = sorted(pairs, key=lambda x: x[0])
        reverse = {v: k for k, v in _OECD_CODES.items()}
        return {reverse[c3]: vals for c3, vals in oecd3_data.items() if c3 in reverse}
    except Exception:
        return {}


def _fetch_us_bulk(n_obs=24):
    """Return {'US': [(date, value), ...]} from yfinance ^TNX weekly history."""
    try:
        import yfinance as yf
        hist = yf.Ticker("^TNX").history(period="2y", interval="1wk")
        if hist.empty:
            return {}
        pairs = [(str(dt)[:10], round(float(row["Close"]), 3))
                 for dt, row in hist.iterrows()]
        return {"US": pairs[-n_obs:]} if pairs else {}
    except Exception:
        return {}


def _get_sovg_data():
    """
    Return cached sovereign yield data dict.
    Structure: { country_2letter: [(period_str, yield_float), ...] }

    All four sources are fetched in parallel. Per-source TTLs mean a
    rate-limited source retries after 5 min instead of waiting 4 hours.
    """
    import concurrent.futures

    now  = _time.time()
    data = dict(_SOVG_CACHE.get("data", {}))

    def _needs_refresh(key):
        ts  = _SOVG_CACHE.get(f"ts_{key}", 0)
        ok  = _SOVG_CACHE.get(f"ok_{key}", False)
        ttl = _CACHE_TTL if ok else _CACHE_TTL_RETRY
        return now - ts > ttl

    sources = {
        "ecb":  (_fetch_ecb_bulk,  _needs_refresh("ecb")),
        "oecd": (_fetch_oecd_bulk, _needs_refresh("oecd")),
        "boe":  (_fetch_boe_bulk,  _needs_refresh("boe")),
        "us":   (_fetch_us_bulk,   _needs_refresh("us")),
    }

    # Only fetch sources that need refreshing, all in parallel
    to_fetch = {k: fn for k, (fn, needed) in sources.items() if needed}
    if not to_fetch:
        return data

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(fn, 24): key for key, fn in to_fetch.items()}
        for future in concurrent.futures.as_completed(futures):
            key = futures[future]
            try:
                result = future.result()
                data.update(result)
                _SOVG_CACHE[f"ts_{key}"] = now
                _SOVG_CACHE[f"ok_{key}"] = bool(result)
            except Exception:
                _SOVG_CACHE[f"ts_{key}"] = now
                _SOVG_CACHE[f"ok_{key}"] = False

    _SOVG_CACHE["data"] = data
    return data


def fetch_yield(country_code):
    """
    Return current 10Y yield (float %) for a country, or None.
    country_code: 2-letter SOVEREIGN_DB key (US, DE, GB, JP, ...)
    """
    data = _get_sovg_data()
    series = data.get(country_code)
    if series:
        return series[-1][1]
    return None


def fetch_yield_history(country_code, _period="2y"):
    """
    Return (dates_list, values_list) of historical yields for a country.
    _period is ignored (kept for backward compatibility); returns all cached obs.
    """
    data = _get_sovg_data()
    series = data.get(country_code)
    if not series:
        return [], []
    dates  = [p for p, _ in series]
    values = [v for _, v in series]
    return dates, values


# ── SOVG: World Bond Monitor ───────────────────────────────────────────
@app.route("/api/sovg")
def sovg_world():
    """
    World bond monitor.
    Returns benchmark 10Y yield + 1D/1W/1M changes + spread vs US for every country.
    Query param: region=all|Americas|Europe|Asia-Pacific|Middle East|Africa
    """
    import concurrent.futures

    region_filter = request.args.get("region", "all")

    countries = {
        k: v for k, v in SOVEREIGN_DB.items()
        if region_filter == "all" or v["region"] == region_filter
    }

    def fetch_country(code):
        meta = SOVEREIGN_DB[code]

        dates, hist_vals = fetch_yield_history(code, "1y")
        clean = [v for v in hist_vals if v is not None]
        current = clean[-1] if clean else None

        # Monthly data: index -2 = ~1 month ago, -3 = ~2 months ago
        # For US we have weekly data so use finer buckets
        is_weekly = code == "US"
        chg_1d = round(clean[-1] - clean[-2], 3) if is_weekly and len(clean) >= 2 else None
        chg_1w = round(clean[-1] - clean[-5], 3) if is_weekly and len(clean) >= 5 else None
        chg_1m = (round(clean[-1] - clean[-5], 3) if is_weekly and len(clean) >= 5
                  else round(clean[-1] - clean[-2], 3) if not is_weekly and len(clean) >= 2
                  else None)

        return {
            "code":      code,
            "name":      meta["name"],
            "flag":      meta["flag"],
            "currency":  meta["currency"],
            "region":    meta["region"],
            "rating":    meta["rating"],
            "debt_gdp":  meta.get("debt_gdp"),
            "yield10y":  current,
            "chg1d":     chg_1d,
            "chg1w":     chg_1w,
            "chg1m":     chg_1m,
            "sparkline": clean[-20:],
        }

    # Parallel fetch — speeds up 40-country load significantly
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        futures = {ex.submit(fetch_country, code): code for code in countries}
        for future in concurrent.futures.as_completed(futures):
            try:
                results.append(future.result())
            except Exception:
                pass

    # Sort by 10Y yield desc (highest yielders = most risk first), nulls last
    results.sort(key=lambda x: (x["yield10y"] is None, -(x["yield10y"] or 0)))

    # Compute spread vs US 10Y (in basis points)
    us_yield = next((r["yield10y"] for r in results if r["code"] == "US"), None)
    for r in results:
        if r["yield10y"] is not None and us_yield is not None:
            r["spreadVsUS"] = round((r["yield10y"] - us_yield) * 100, 1)
        else:
            r["spreadVsUS"] = None

    return jsonify({
        "ok":         True,
        "bonds":      results,
        "usYield10y": us_yield,
        "count":      len(results),
        "regions":    sorted(set(v["region"] for v in SOVEREIGN_DB.values())),
    })


# ── SOVG: Single Country Full Curve ───────────────────────────────────
@app.route("/api/sovg/<country_code>")
def sovg_country(country_code):
    """
    Full yield curve + 2Y history for a specific country.
    country_code: US, DE, GB, JP, FR, IT, ES, CA, AU, CN, etc.
    """
    import concurrent.futures

    code = country_code.upper()
    if code not in SOVEREIGN_DB:
        available = sorted(SOVEREIGN_DB.keys())
        return jsonify({"ok": False, "error": f"Unknown country '{code}'. Available: {available}"})

    meta = SOVEREIGN_DB[code]

    TENOR_ORDER = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]

    # For US, multi-tenor data is available from yfinance directly
    US_TENOR_TICKERS = {"3M": "^IRX", "5Y": "^FVX", "10Y": "^TNX", "30Y": "^TYX"}

    def fetch_tenor_point(tenor, sym):
        if code == "US":
            try:
                import yfinance as yf
                info  = yf.Ticker(sym).info
                price = info.get("regularMarketPrice") or info.get("currentPrice")
                return {"tenor": tenor, "yield": round(float(price), 3) if price else None}
            except Exception:
                return {"tenor": tenor, "yield": None}
        # Non-US: only 10Y benchmark available from ECB/OECD
        if tenor == "10Y":
            return {"tenor": tenor, "yield": fetch_yield(code)}
        return {"tenor": tenor, "yield": None}

    tenors_to_fetch = US_TENOR_TICKERS if code == "US" else meta["tenors"]
    curve_points = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(fetch_tenor_point, tenor, sym): tenor
                   for tenor, sym in tenors_to_fetch.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                curve_points.append(future.result())
            except Exception:
                pass

    # Sort ascending by duration
    curve_points.sort(
        key=lambda x: TENOR_ORDER.index(x["tenor"]) if x["tenor"] in TENOR_ORDER else 99
    )

    # History for the benchmark tenor
    dates, vals = fetch_yield_history(code, "2y")
    clean_vals  = [v for v in vals if v is not None]

    # Yield curve stats
    valid = [p for p in curve_points if p["yield"] is not None]
    short_tenors = ["3M", "6M", "1Y", "2Y"]
    long_tenors  = ["10Y", "20Y", "30Y"]
    short_end = next((p["yield"] for p in valid if p["tenor"] in short_tenors), None)
    long_end  = next((p["yield"] for p in reversed(valid) if p["tenor"] in long_tenors), None)
    bench_y   = next((p["yield"] for p in valid if p["tenor"] == meta["benchmark"]), None)

    is_inverted = (short_end is not None and long_end is not None and short_end > long_end)
    slope_bp    = round((long_end - short_end) * 100, 1) if (short_end and long_end) else None

    # Spread vs US 10Y
    us_10y       = fetch_yield("US")
    spread_vs_us = round((bench_y - us_10y) * 100, 1) if (bench_y and us_10y) else None

    hi52 = round(max(clean_vals), 3) if clean_vals else None
    lo52 = round(min(clean_vals), 3) if clean_vals else None

    return jsonify({
        "ok":            True,
        "code":          code,
        "name":          meta["name"],
        "flag":          meta["flag"],
        "currency":      meta["currency"],
        "region":        meta["region"],
        "rating":        meta["rating"],
        "debt_gdp":      meta.get("debt_gdp"),
        "curve":         curve_points,
        "benchmarkTenor": meta["benchmark"],
        "benchmarkYield": bench_y,
        "isInverted":    is_inverted,
        "slopeBp":       slope_bp,
        "spreadVsUSbp":  spread_vs_us,
        "hi52":          hi52,
        "lo52":          lo52,
        "history":       {"dates": dates, "values": vals},
    })


# ── SOVG: Countries list ───────────────────────────────────────────────
@app.route("/api/sovg/countries")
def sovg_countries():
    return jsonify({
        "ok": True,
        "countries": [
            {
                "code":     k,
                "name":     v["name"],
                "flag":     v["flag"],
                "region":   v["region"],
                "rating":   v["rating"],
                "debt_gdp": v.get("debt_gdp"),
            }
            for k, v in SOVEREIGN_DB.items()
        ]
    })


# ── SOVM: Sovereign Debt Monitor (Deep Analysis) ──────────────────────────
_SOVM_CACHE = {}
_SOVM_TTL   = 300  # 5 minutes


def _sovm_rsi(yields, period=14):
    """14-day RSI on a yield series."""
    if len(yields) < period + 1:
        return None
    changes = [yields[i] - yields[i-1] for i in range(1, len(yields))]
    tail   = changes[-period:]
    gains  = [max(c, 0) for c in tail]
    losses = [max(-c, 0) for c in tail]
    ag = sum(gains) / period
    al = sum(losses) / period
    if al < 1e-10:
        return 100.0
    return round(100.0 - 100.0 / (1.0 + ag / al), 1)


def _sovm_stats(yields_series, period_days):
    """Compute SOVM range stats for a specific lookback window."""
    window = yields_series[-max(2, period_days):]
    if len(window) < 2:
        return None
    current  = window[-1]
    prev     = window[-2]
    chg_bps  = round((current - prev) * 100.0, 1)

    daily_chg = [window[i] - window[i-1] for i in range(1, len(window))]
    n = len(daily_chg)
    if n >= 2:
        mean_dc  = sum(daily_chg) / n
        var_dc   = sum((x - mean_dc)**2 for x in daily_chg) / (n - 1)
        sd_daily = var_dc ** 0.5
        sd_day   = round(chg_bps / (sd_daily * 100.0), 2) if sd_daily > 1e-8 else None
    else:
        sd_day = None

    low  = round(min(window), 3)
    high = round(max(window), 3)
    n2   = len(window)
    avg  = round(sum(window) / n2, 3)
    diff_bps = round((current - avg) * 100.0, 1)

    mean_w = sum(window) / n2
    var_w  = sum((x - mean_w)**2 for x in window) / (n2 - 1) if n2 > 1 else 0
    sd_level    = var_w ** 0.5
    sd_from_avg = round(diff_bps / (sd_level * 100.0), 2) if sd_level > 1e-8 else None

    return {
        "chg_bps":     chg_bps,
        "sd_day":      sd_day,
        "low":         low,
        "high":        high,
        "avg":         avg,
        "diff_bps":    diff_bps,
        "sd_from_avg": sd_from_avg,
    }


def _sovm_build_row(label, tenor, yields_series):
    """Build one SOVM table row dict from a yield/spread series."""
    if not yields_series or len(yields_series) < 2:
        return None
    current   = yields_series[-1]
    sparkline = [round(y, 3) for y in yields_series[-10:]]
    rsi       = _sovm_rsi(yields_series)
    PERIODS   = {"1M": 21, "3M": 63, "6M": 126, "1Y": 252}
    stats     = {k: _sovm_stats(yields_series, d) for k, d in PERIODS.items()}
    return {
        "label":     label,
        "tenor":     tenor,
        "current":   round(current, 3),
        "sparkline": sparkline,
        "rsi":       rsi,
        "stats":     stats,
    }


def _fetch_us_treasury_sovm():
    """Fetch 1 year of daily UST yields via yfinance.
    Returns {tenor: [float, ...]} in chronological order."""
    US_TICKERS = {"3M": "^IRX", "5Y": "^FVX", "10Y": "^TNX", "30Y": "^TYX"}
    result = {}
    for tenor, sym in US_TICKERS.items():
        result[tenor] = _fetch_yf_daily_1y(sym)
    return result


def _fetch_yf_daily_1y(ticker):
    """1 year of daily close for a yfinance ticker, returns list[float]."""
    try:
        hist = yf.Ticker(ticker).history(period="1y", interval="1d")
        if hist.empty:
            return []
        return [round(float(v), 3) for v in hist["Close"].dropna()]
    except Exception:
        return []


@app.route("/api/sovm")
@app.route("/api/sovm/<country_code>")
def sovm(country_code="US"):
    import time as _t
    import concurrent.futures

    code = country_code.upper()
    if code not in SOVEREIGN_DB:
        return jsonify({"ok": False, "error": f"Unknown country '{code}'"})

    cached = _SOVM_CACHE.get(code)
    if cached and _t.time() - cached["ts"] < _SOVM_TTL:
        return jsonify(cached["data"])

    meta        = SOVEREIGN_DB[code]
    TENOR_ORDER = ["1M","3M","6M","1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"]

    # ── Fetch daily yield history ─────────────────────────────────────────
    if code == "US":
        try:
            tenor_yields = _fetch_us_treasury_sovm()
        except Exception as e:
            return jsonify({"ok": False, "error": f"US yield fetch error: {e}"})
        bench_tenors = ["3M","5Y","10Y","30Y"]
    else:
        tenor_tickers = meta.get("tenors", {})
        tenor_yields  = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(_fetch_yf_daily_1y, sym): t
                    for t, sym in tenor_tickers.items()}
            for f in concurrent.futures.as_completed(futs):
                t = futs[f]
                try:
                    tenor_yields[t] = f.result()
                except Exception:
                    tenor_yields[t] = []
        bench_tenors = sorted(
            [t for t, v in tenor_yields.items() if v],
            key=lambda x: TENOR_ORDER.index(x) if x in TENOR_ORDER else 99
        )

    LABEL_MAP = {
        "US":"UST","DE":"BUND","GB":"GILT","JP":"JGB","FR":"OAT",
        "IT":"BTP","ES":"BONO","CA":"CAN","AU":"ACGB","CN":"CGB","CH":"SWISS",
    }
    prefix = LABEL_MAP.get(code, code)

    # ── Benchmark rows ────────────────────────────────────────────────────
    benchmarks = []
    for tenor in bench_tenors:
        row = _sovm_build_row(f"{prefix} {tenor}", tenor, tenor_yields.get(tenor, []))
        if row:
            benchmarks.append(row)

    def get_series(t):
        return tenor_yields.get(t) or []

    def spread_series(t_short, t_long):
        s, l = get_series(t_short), get_series(t_long)
        if not s or not l:
            return []
        mn = min(len(s), len(l))
        return [round((l[-mn+i] - s[-mn+i]) * 100.0, 2) for i in range(mn)]

    # ── Curves — pick the best available short/long anchors ──────────────
    avail = set(bench_tenors)
    short_anchor = next((t for t in ["2Y","3M","1Y","3Y"] if t in avail), None)
    CANDIDATE_PAIRS = [
        ("2Y","5Y"),("2Y","10Y"),("2Y","30Y"),("5Y","10Y"),
        ("3M","5Y"),("3M","10Y"),("3M","30Y"),("5Y","30Y"),("10Y","30Y"),
    ]
    curves = []
    seen_pairs = set()
    for sh, lg in CANDIDATE_PAIRS:
        if sh not in avail or lg not in avail:
            continue
        key = (sh, lg)
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        lbl = f"{sh}-{lg}"
        row = _sovm_build_row(lbl, lbl, spread_series(sh, lg))
        if row:
            row["unit"] = "bps"
            curves.append(row)

    # ── Butterflies: short + long - 2*mid (bps) ──────────────────────────
    FLY_DEFS = []
    if {"2Y","5Y","10Y"} <= avail:
        FLY_DEFS.append(("2Y","5Y","10Y","2Y-5Y-10Y"))
    if {"2Y","10Y","30Y"} <= avail:
        FLY_DEFS.append(("2Y","10Y","30Y","2Y-10Y-30Y"))
    if {"3M","5Y","10Y"} <= avail:
        FLY_DEFS.append(("3M","5Y","10Y","3M-5Y-10Y"))
    if {"3M","10Y","30Y"} <= avail:
        FLY_DEFS.append(("3M","10Y","30Y","3M-10Y-30Y"))

    butterflies = []
    for sh, mi, lg, lbl in FLY_DEFS:
        ss, ms, ls = get_series(sh), get_series(mi), get_series(lg)
        if not ss or not ms or not ls:
            continue
        mn  = min(len(ss), len(ms), len(ls))
        fly = [round((ss[-mn+i] + ls[-mn+i] - 2*ms[-mn+i]) * 100.0, 2) for i in range(mn)]
        row = _sovm_build_row(lbl, lbl, fly)
        if row:
            row["unit"] = "bps"
            butterflies.append(row)

    result = {
        "ok":          True,
        "country":     code,
        "name":        meta["name"],
        "flag":        meta["flag"],
        "currency":    meta["currency"],
        "rating":      meta.get("rating", "—"),
        "debt_gdp":    meta.get("debt_gdp"),
        "benchmarks":  benchmarks,
        "curves":      curves,
        "butterflies": butterflies,
        "inflation":   [],
        "cds":         [],
        "ts":          datetime.utcnow().isoformat(),
    }
    _SOVM_CACHE[code] = {"ts": _t.time(), "data": result}
    return jsonify(result)


# ─────────────────────────────────────────────
#  MODL — Historical Financial Model (SEC XBRL)
# ─────────────────────────────────────────────
_MODL_HEADERS = {'User-Agent': 'Mihir TerminalProject (mihir1027@gmail.com)'}

@app.route("/api/modl/namespaces/<ticker>")
def modl_namespaces(ticker):
    """Debug: shows what namespaces and concept counts exist for a ticker."""
    import requests as _req
    ticker = ticker.upper()
    cik_map = _req.get("https://www.sec.gov/files/company_tickers.json", headers=_MODL_HEADERS, timeout=10).json()
    cik = None
    for _, co in cik_map.items():
        if co.get('ticker','').upper() == ticker:
            cik = str(co['cik_str']).zfill(10); break
    if not cik:
        return jsonify({"error": "not found"})
    facts = _req.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers=_MODL_HEADERS, timeout=30).json()
    summary = {}
    for ns, ns_data in facts.get('facts', {}).items():
        concepts = list(ns_data.keys())
        summary[ns] = {"count": len(concepts), "sample": concepts[:10]}
    return jsonify(summary)

@app.route("/api/modl/<ticker>")
def modl_route(ticker):
    import requests as _req
    ticker = ticker.upper()

    # 1. CIK lookup
    try:
        cik_map = _req.get("https://www.sec.gov/files/company_tickers.json", headers=_MODL_HEADERS, timeout=10).json()
        cik = None; ent_name = ticker
        for _, co in cik_map.items():
            if co.get('ticker','').upper() == ticker:
                cik = str(co['cik_str']).zfill(10)
                ent_name = co.get('title', ticker)
                break
        if not cik:
            return jsonify({"ok": False, "error": f"{ticker} not found in SEC database"})
    except Exception as e:
        return jsonify({"ok": False, "error": f"CIK lookup failed: {e}"})

    # 2. Fetch company facts (all XBRL data in one call)
    try:
        facts_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
        facts_data = _req.get(facts_url, headers=_MODL_HEADERS, timeout=30).json()
        gaap = facts_data.get('facts', {}).get('us-gaap', {})
    except Exception as e:
        return jsonify({"ok": False, "error": f"EDGAR XBRL fetch failed: {e}"})

    # 3. Extraction helpers
    def _best_entries(concept, unit_key):
        entries = gaap.get(concept, {}).get('units', {}).get(unit_key, [])
        best = {}
        for e in entries:
            if e.get('form') not in ('10-Q', '10-K'):
                continue
            fp = e.get('fp', '')
            fy = e.get('fy')
            if not fy or fp not in ('Q1', 'Q2', 'Q3', 'FY'):
                continue
            k = (fy, fp)
            if k not in best or e.get('filed', '') > best[k].get('filed', ''):
                best[k] = e
        return best

    def get_flow(concepts):
        """Flow items (IS, CF): de-cumulate YTD → individual quarters. Returns {(fy,q): val_millions}"""
        for concept in concepts:
            best = _best_entries(concept, 'USD')
            if not best:
                continue
            result = {}
            for fy in set(y for (y, _) in best):
                q1v  = best.get((fy,'Q1'),{}).get('val')
                q2cv = best.get((fy,'Q2'),{}).get('val')
                q3cv = best.get((fy,'Q3'),{}).get('val')
                annv = best.get((fy,'FY'),{}).get('val')
                if q1v  is not None: result[(fy,1)] = q1v  / 1e6
                if q2cv is not None: result[(fy,2)] = (q2cv - (q1v or 0)) / 1e6
                if q3cv is not None: result[(fy,3)] = (q3cv - (q2cv or 0)) / 1e6
                if annv is not None and q3cv is not None:
                    result[(fy,4)] = (annv - q3cv) / 1e6
                if annv is not None: result[(fy,0)] = annv / 1e6
            return result or None
        return None

    def get_instant(concepts):
        """Instant items (BS): point-in-time. Returns {(fy,q): val_millions}"""
        for concept in concepts:
            best = _best_entries(concept, 'USD')
            if not best:
                continue
            qmap = {'Q1':1,'Q2':2,'Q3':3,'FY':4}
            result = {}
            for (fy,fp), e in best.items():
                q = qmap[fp]
                result[(fy,q)] = e['val'] / 1e6
                if fp == 'FY': result[(fy,0)] = e['val'] / 1e6
            return result or None
        return None

    def get_per_share(concepts):
        """EPS: USD/shares unit, de-cumulated same as flow."""
        for concept in concepts:
            best = _best_entries(concept, 'USD/shares')
            if not best:
                continue
            result = {}
            for fy in set(y for (y, _) in best):
                q1v  = best.get((fy,'Q1'),{}).get('val')
                q2cv = best.get((fy,'Q2'),{}).get('val')
                q3cv = best.get((fy,'Q3'),{}).get('val')
                annv = best.get((fy,'FY'),{}).get('val')
                if q1v  is not None: result[(fy,1)] = q1v
                if q2cv is not None: result[(fy,2)] = q2cv - (q1v or 0)
                if q3cv is not None: result[(fy,3)] = q3cv - (q2cv or 0)
                if annv is not None and q3cv is not None:
                    result[(fy,4)] = annv - q3cv
                if annv is not None: result[(fy,0)] = annv
            return result or None
        return None

    def get_shares(concepts):
        """Shares outstanding: shares unit, instantaneous-style."""
        for concept in concepts:
            best = _best_entries(concept, 'shares')
            if not best:
                continue
            qmap = {'Q1':1,'Q2':2,'Q3':3,'FY':4}
            result = {}
            for (fy,fp), e in best.items():
                q = qmap[fp]
                result[(fy,q)] = e['val'] / 1e6
                if fp == 'FY': result[(fy,0)] = e['val'] / 1e6
            return result or None
        return None

    # 3.5 Label helper (used by segments and KPI sections)
    import re as _re_lbl
    def _camel_label(s):
        s = _re_lbl.sub(r'([a-z])([A-Z])', r'\1 \2', s)
        s = _re_lbl.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', s)
        return s.strip().title()

    # 4. Fetch all needed concepts
    F = get_flow; I = get_instant
    # IS — expanded fallback lists cover more company types (banks, SaaS, insurance, retail, etc.)
    rev      = F(['RevenueFromContractWithCustomerExcludingAssessedTax',
                  'RevenueFromContractWithCustomerIncludingAssessedTax',
                  'Revenues','SalesRevenueNet','SalesRevenueGoodsNet',
                  'RevenuesNetOfInterestExpense',
                  'InterestAndDividendIncomeOperating',
                  'BrokerageCommissionsRevenue','RealEstateRevenueNet',
                  'RevenueFromRelatedParties','SubscriptionRevenue',
                  'SalesRevenueServicesNet','OilAndGasRevenue'])
    cogs     = F(['CostOfGoodsAndServicesSold','CostOfRevenue','CostOfGoodsSold',
                  'CostOfServices','CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization',
                  'CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization'])
    gp_raw   = F(['GrossProfit'])
    rd       = F(['ResearchAndDevelopmentExpense',
                  'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'])
    sga      = F(['SellingGeneralAndAdministrativeExpense',
                  'GeneralAndAdministrativeExpense',
                  'SellingExpense','MarketingExpense',
                  'SellingAndMarketingExpense'])
    da_is    = F(['DepreciationAndAmortization',
                  'DepreciationAmortizationAndAccretionNet'])
    oth_opex = F(['OtherOperatingIncomeExpense','OtherOperatingIncome',
                  'OtherCostAndExpenseOperating'])
    op_inc   = F(['OperatingIncomeLoss','IncomeLossFromContinuingOperations'])
    int_exp  = F(['InterestExpense','InterestAndDebtExpense',
                  'InterestExpenseDebt','InterestExpenseOther'])
    int_inc  = F(['InterestIncomeExpenseNet','InvestmentIncomeInterest',
                  'InterestIncomeExpenseNonoperatingNet','InterestAndOtherIncome'])
    eq_earn  = F(['IncomeLossFromEquityMethodInvestments'])
    oth_inc  = F(['OtherNonoperatingIncomeExpense','OtherNonoperatingIncome',
                  'NonoperatingIncomeExpense'])
    pretax   = F(['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
                  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
                  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'])
    tax      = F(['IncomeTaxExpenseBenefit','CurrentIncomeTaxExpenseBenefit'])
    net_inc  = F(['NetIncomeLoss','ProfitLoss','NetIncomeLossAvailableToCommonStockholdersBasic'])
    eps      = get_per_share(['EarningsPerShareBasic','EarningsPerShareDiluted'])
    shares   = get_shares(['WeightedAverageNumberOfSharesOutstandingBasic','CommonStockSharesOutstanding',
                           'WeightedAverageNumberOfDilutedSharesOutstanding'])
    # BS
    cash     = I(['CashAndCashEquivalentsAtCarryingValue','Cash',
                  'CashAndDueFromBanks','CashCashEquivalentsAndShortTermInvestments'])
    rest_c   = I(['RestrictedCashAndCashEquivalents','RestrictedCash',
                  'RestrictedCashAndCashEquivalentsAtCarryingValue'])
    ar       = I(['AccountsReceivableNetCurrent','ReceivablesNetCurrent',
                  'AccountsReceivableNet','TradeAndOtherReceivablesNetCurrent'])
    inv      = I(['InventoryNet','InventoryFinishedGoods','InventoryGross'])
    prep     = I(['PrepaidExpenseAndOtherAssets','PrepaidExpenseAndOtherAssetsCurrent',
                  'PrepaidExpenseCurrent'])
    tax_rec  = I(['IncomeTaxesReceivable','IncomeTaxReceivable'])
    c_ast    = I(['AssetsCurrent'])
    ppe      = I(['PropertyPlantAndEquipmentNet','PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'])
    gw       = I(['Goodwill'])
    rou      = I(['OperatingLeaseRightOfUseAsset','OperatingLeaseRightOfUseAssetBeforeImpairment'])
    intang   = I(['IntangibleAssetsNetExcludingGoodwill','FiniteLivedIntangibleAssetsNet',
                  'IntangibleAssetsNetIncludingGoodwill'])
    oth_ast  = I(['OtherAssetsNoncurrent','OtherAssets'])
    tot_ast  = I(['Assets'])
    ap       = I(['AccountsPayableCurrent','AccountsPayable'])
    def_rev  = I(['ContractWithCustomerLiabilityCurrent','DeferredRevenueCurrent',
                  'ContractWithCustomerLiability','DeferredRevenue'])
    accr     = I(['AccruedLiabilitiesCurrent','AccruedLiabilities',
                  'EmployeeRelatedLiabilitiesCurrent'])
    c_debt   = I(['LongTermDebtCurrent','DebtCurrent','ShortTermBorrowings',
                  'NotesPayableCurrent','CommercialPaper'])
    c_lease  = I(['OperatingLeaseLiabilityCurrent'])
    c_liab   = I(['LiabilitiesCurrent'])
    lt_dbt   = I(['LongTermDebtNoncurrent','LongTermDebt','LongTermNotesPayable',
                  'SeniorLongTermNotes'])
    lt_ls    = I(['OperatingLeaseLiabilityNoncurrent','OperatingLeaseLiability'])
    def_tx   = I(['DeferredIncomeTaxLiabilitiesNet','DeferredTaxLiabilitiesNoncurrent'])
    oth_lb   = I(['OtherLiabilitiesNoncurrent','OtherLiabilities'])
    tot_lb   = I(['Liabilities'])
    com_stk  = I(['CommonStockValue'])
    apic     = I(['AdditionalPaidInCapitalCommonStock','AdditionalPaidInCapital'])
    retain   = I(['RetainedEarningsAccumulatedDeficit','RetainedEarningsAppropriated'])
    aoci     = I(['AccumulatedOtherComprehensiveIncomeLossNetOfTax',
                  'AccumulatedOtherComprehensiveIncomeLoss'])
    equity   = I(['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'])
    # CF
    dep_cf   = F(['DepreciationDepletionAndAmortization','DepreciationAndAmortization',
                  'DepreciationAmortizationAndAccretionNet'])
    deftx_cf = F(['DeferredIncomeTaxExpenseBenefit'])
    sbc      = F(['ShareBasedCompensation','AllocatedShareBasedCompensationExpense'])
    imp      = F(['AssetImpairmentCharges','GoodwillImpairmentLoss'])
    gdl      = F(['GainLossOnDispositionOfAssets','GainLossOnSaleOfBusiness'])
    debt_x   = F(['GainsLossesOnExtinguishmentOfDebt'])
    adc      = F(['AmortizationOfFinancingCosts','AmortizationOfDebtIssuanceCosts'])
    wc       = F(['IncreaseDecreaseInOperatingCapital','IncreaseDecreaseInOperatingLiabilities'])
    oth_nc   = F(['OtherNoncashIncomeExpense','OtherOperatingActivitiesCashFlowStatement'])
    cfo      = F(['NetCashProvidedByUsedInOperatingActivities'])
    capex    = F(['PaymentsToAcquirePropertyPlantAndEquipment',
                  'PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets'])
    acq      = F(['PaymentsToAcquireBusinessesNetOfCashAcquired',
                  'PaymentsToAcquireBusinessesGross'])
    p_lb     = F(['ProceedsFromSaleLeasebackTransactions'])
    p_ppe    = F(['ProceedsFromSaleOfPropertyPlantAndEquipment',
                  'ProceedsFromSalesOfAssetsInvestingActivities'])
    cfi      = F(['NetCashProvidedByUsedInInvestingActivities'])
    d_proc   = F(['ProceedsFromIssuanceOfLongTermDebt','ProceedsFromIssuanceOfDebt',
                  'ProceedsFromDebtNetOfIssuanceCosts'])
    d_rep    = F(['RepaymentsOfLongTermDebt','RepaymentsOfDebt','RepaymentsOfNotesPayable'])
    r_proc   = F(['ProceedsFromLinesOfCredit','ProceedsFromRepaymentsOfShortTermDebt'])
    r_rep    = F(['RepaymentsOfLinesOfCredit'])
    buyb     = F(['PaymentsForRepurchaseOfCommonStock','PaymentsForRepurchaseOfEquity'])
    fl_pay   = F(['FinanceLeasePrincipalPayments'])
    opt_ex   = F(['ProceedsFromStockOptionsExercised','ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions'])
    divs     = F(['PaymentsOfDividends','PaymentsOfDividendsCommonStock',
                  'PaymentsOfDividendsAndDividendEquivalentsOnCommonStockAndRestrictedStockUnits'])
    cff      = F(['NetCashProvidedByUsedInFinancingActivities'])
    fx       = F(['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents','EffectOfExchangeRateOnCash'])

    # Track all backbone concepts so dynamic scan can skip them
    _BACKBONE_CONCEPTS = {
        'RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax',
        'Revenues','SalesRevenueNet','SalesRevenueGoodsNet','RevenuesNetOfInterestExpense',
        'InterestAndDividendIncomeOperating','BrokerageCommissionsRevenue','RealEstateRevenueNet',
        'RevenueFromRelatedParties','SubscriptionRevenue','SalesRevenueServicesNet','OilAndGasRevenue',
        'CostOfGoodsAndServicesSold','CostOfRevenue','CostOfGoodsSold','CostOfServices',
        'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization',
        'CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization',
        'GrossProfit','ResearchAndDevelopmentExpense','ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost',
        'SellingGeneralAndAdministrativeExpense','GeneralAndAdministrativeExpense',
        'SellingExpense','MarketingExpense','SellingAndMarketingExpense',
        'DepreciationAndAmortization','DepreciationAmortizationAndAccretionNet',
        'OtherOperatingIncomeExpense','OtherOperatingIncome','OtherCostAndExpenseOperating',
        'OperatingIncomeLoss','IncomeLossFromContinuingOperations',
        'InterestExpense','InterestAndDebtExpense','InterestExpenseDebt','InterestExpenseOther',
        'InterestIncomeExpenseNet','InvestmentIncomeInterest','InterestIncomeExpenseNonoperatingNet','InterestAndOtherIncome',
        'IncomeLossFromEquityMethodInvestments',
        'OtherNonoperatingIncomeExpense','OtherNonoperatingIncome','NonoperatingIncomeExpense',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic',
        'IncomeTaxExpenseBenefit','CurrentIncomeTaxExpenseBenefit',
        'NetIncomeLoss','ProfitLoss','NetIncomeLossAvailableToCommonStockholdersBasic',
        'EarningsPerShareBasic','EarningsPerShareDiluted',
        'WeightedAverageNumberOfSharesOutstandingBasic','CommonStockSharesOutstanding',
        'WeightedAverageNumberOfDilutedSharesOutstanding',
        'CashAndCashEquivalentsAtCarryingValue','Cash','CashAndDueFromBanks','CashCashEquivalentsAndShortTermInvestments',
        'RestrictedCashAndCashEquivalents','RestrictedCash','RestrictedCashAndCashEquivalentsAtCarryingValue',
        'AccountsReceivableNetCurrent','ReceivablesNetCurrent','AccountsReceivableNet','TradeAndOtherReceivablesNetCurrent',
        'InventoryNet','InventoryFinishedGoods','InventoryGross',
        'PrepaidExpenseAndOtherAssets','PrepaidExpenseAndOtherAssetsCurrent','PrepaidExpenseCurrent',
        'IncomeTaxesReceivable','IncomeTaxReceivable','AssetsCurrent',
        'PropertyPlantAndEquipmentNet','PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization',
        'Goodwill','OperatingLeaseRightOfUseAsset','OperatingLeaseRightOfUseAssetBeforeImpairment',
        'IntangibleAssetsNetExcludingGoodwill','FiniteLivedIntangibleAssetsNet','IntangibleAssetsNetIncludingGoodwill',
        'OtherAssetsNoncurrent','OtherAssets','Assets',
        'AccountsPayableCurrent','AccountsPayable',
        'ContractWithCustomerLiabilityCurrent','DeferredRevenueCurrent','ContractWithCustomerLiability','DeferredRevenue',
        'AccruedLiabilitiesCurrent','AccruedLiabilities','EmployeeRelatedLiabilitiesCurrent',
        'LongTermDebtCurrent','DebtCurrent','ShortTermBorrowings','NotesPayableCurrent','CommercialPaper',
        'OperatingLeaseLiabilityCurrent','LiabilitiesCurrent',
        'LongTermDebtNoncurrent','LongTermDebt','LongTermNotesPayable','SeniorLongTermNotes',
        'OperatingLeaseLiabilityNoncurrent','OperatingLeaseLiability',
        'DeferredIncomeTaxLiabilitiesNet','DeferredTaxLiabilitiesNoncurrent',
        'OtherLiabilitiesNoncurrent','OtherLiabilities','Liabilities',
        'CommonStockValue','AdditionalPaidInCapitalCommonStock','AdditionalPaidInCapital',
        'RetainedEarningsAccumulatedDeficit','RetainedEarningsAppropriated',
        'AccumulatedOtherComprehensiveIncomeLossNetOfTax','AccumulatedOtherComprehensiveIncomeLoss',
        'StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
        'DepreciationDepletionAndAmortization','DeferredIncomeTaxExpenseBenefit',
        'ShareBasedCompensation','AllocatedShareBasedCompensationExpense',
        'AssetImpairmentCharges','GoodwillImpairmentLoss','GainLossOnDispositionOfAssets','GainLossOnSaleOfBusiness',
        'GainsLossesOnExtinguishmentOfDebt','AmortizationOfFinancingCosts','AmortizationOfDebtIssuanceCosts',
        'IncreaseDecreaseInOperatingCapital','IncreaseDecreaseInOperatingLiabilities',
        'OtherNoncashIncomeExpense','OtherOperatingActivitiesCashFlowStatement',
        'NetCashProvidedByUsedInOperatingActivities',
        'PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets',
        'PaymentsToAcquireBusinessesNetOfCashAcquired','PaymentsToAcquireBusinessesGross',
        'ProceedsFromSaleLeasebackTransactions',
        'ProceedsFromSaleOfPropertyPlantAndEquipment','ProceedsFromSalesOfAssetsInvestingActivities',
        'NetCashProvidedByUsedInInvestingActivities',
        'ProceedsFromIssuanceOfLongTermDebt','ProceedsFromIssuanceOfDebt','ProceedsFromDebtNetOfIssuanceCosts',
        'RepaymentsOfLongTermDebt','RepaymentsOfDebt','RepaymentsOfNotesPayable',
        'ProceedsFromLinesOfCredit','ProceedsFromRepaymentsOfShortTermDebt','RepaymentsOfLinesOfCredit',
        'PaymentsForRepurchaseOfCommonStock','PaymentsForRepurchaseOfEquity','FinanceLeasePrincipalPayments',
        'ProceedsFromStockOptionsExercised','ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions',
        'PaymentsOfDividends','PaymentsOfDividendsCommonStock',
        'PaymentsOfDividendsAndDividendEquivalentsOnCommonStockAndRestrictedStockUnits',
        'NetCashProvidedByUsedInFinancingActivities',
        'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents','EffectOfExchangeRateOnCash',
    }

    # Derived: Gross Profit if not directly filed
    if gp_raw is None and rev and cogs:
        gp_raw = {k: rev.get(k,0) - cogs.get(k,0) for k in set(rev)|set(cogs) if rev.get(k) is not None and cogs.get(k) is not None}
    gp = gp_raw

    # Derived: Model Net Cash
    def _net_cash():
        keys = set()
        for d in [cash, rest_c, c_debt, lt_dbt]:
            if d: keys.update(d)
        r = {}
        for k in keys:
            c_=  (cash  or {}).get(k) or 0
            rc = (rest_c or {}).get(k) or 0
            cd = (c_debt or {}).get(k) or 0
            ld = (lt_dbt or {}).get(k) or 0
            r[k] = c_ + rc - cd - ld
        return r or None
    net_cash = _net_cash()

    # 5. Determine columns from revenue/net_income data
    avail = set()
    for d in [rev, net_inc, cfo]:
        if d:
            for (fy, q) in d:
                if q and q > 0: avail.add((fy, q))
    avail = sorted(avail)
    recent = avail[-12:] if len(avail) > 12 else avail  # show last 12 quarters

    # Which fiscal years are complete (have Q1-Q4)?
    fy_qs = {}
    for (fy, q) in avail:
        fy_qs.setdefault(fy, set()).add(q)
    complete_fys = [fy for fy, qs in sorted(fy_qs.items()) if {1,2,3,4}.issubset(qs)]

    # 4 estimate quarters after the last actual
    est_cols = []
    if recent:
        lfy, lq = recent[-1]
        for i in range(1,5):
            nq = lq + i
            nfy = lfy + (nq-1)//4
            nq  = ((nq-1)%4)+1
            est_cols.append((nfy, nq))

    # Build columns list — quarterly actuals, then annual columns per FY shown, then estimates
    columns = []
    shown_ann = set()
    for (fy, q) in recent:
        columns.append({'label': f"Q{q} '{str(fy)[2:]}", 'year': fy, 'quarter': q, 'type': 'actual'})
        if q == 4 and fy in complete_fys and fy not in shown_ann:
            columns.append({'label': f"FY {fy}", 'year': fy, 'quarter': 0, 'type': 'annual'})
            shown_ann.add(fy)
    for (fy, q) in est_cols:
        columns.append({'label': f"Q{q} '{str(fy)[2:]}E", 'year': fy, 'quarter': q, 'type': 'estimate'})

    # 6. Row-value builder helpers
    def rv(data, neg=False):
        if data is None: return [None]*len(columns)
        out = []
        for c in columns:
            v = data.get((c['year'], c['quarter']))
            if v is not None and neg: v = -v
            out.append(round(v, 6) if v is not None else None)
        return out

    def pct_row(num_d, den_d):
        out = []
        for c in columns:
            n = (num_d or {}).get((c['year'],c['quarter']))
            d = (den_d or {}).get((c['year'],c['quarter']))
            out.append(round(n/d, 6) if (n is not None and d and d != 0) else None)
        return out

    def yoy_row(data):
        out = []
        for c in columns:
            if c['quarter'] == 0: out.append(None); continue
            cur = (data or {}).get((c['year'],c['quarter']))
            prv = (data or {}).get((c['year']-1,c['quarter']))
            out.append(round((cur-prv)/abs(prv), 6) if (cur is not None and prv and prv != 0) else None)
        return out

    def mkrow(label, data, bold=False, fmt='num', neg=False, blank=False, section=False):
        return {'label':label,'bold':bold,'fmt':fmt,'neg':neg,'blank':blank,'section':section,'values':rv(data,neg)}

    def mkcalc(label, vals, bold=False, fmt='num', blank=False, section=False):
        return {'label':label,'bold':bold,'fmt':fmt,'neg':False,'blank':blank,'section':section,'values':vals}

    def mkblank():
        return {'label':'','blank':True,'values':[None]*len(columns),'bold':False,'fmt':'num','section':False}

    def mksect(title):
        return {'label':title,'section':True,'blank':False,'bold':False,'fmt':'num','values':[None]*len(columns)}

    # 6.5  Revenue Segments ─────────────────────────────────────────────────
    import re as _re_seg
    def _seg_label(raw):
        s = raw.split(':')[-1]
        s = _re_seg.sub(r'Member$', '', s)
        s = _re_seg.sub(r'([a-z])([A-Z])', r'\1 \2', s)
        s = _re_seg.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', s)
        return s.strip().title()

    def _build_seg_vals(best_dict):
        vals = {}
        for fy in set(y for (y, _) in best_dict):
            q1e = best_dict.get((fy,'Q1')); q2e = best_dict.get((fy,'Q2'))
            q3e = best_dict.get((fy,'Q3')); ane  = best_dict.get((fy,'FY'))
            q1v = q1e['val'] if q1e else None
            q2v = q2e['val'] if q2e else None
            q3v = q3e['val'] if q3e else None
            anv = ane['val']  if ane  else None
            if q1v is not None: vals[(fy,1)] = round(q1v/1e6, 6)
            if q2v is not None: vals[(fy,2)] = round((q2v-(q1v or 0))/1e6, 6)
            if q3v is not None: vals[(fy,3)] = round((q3v-(q2v or 0))/1e6, 6)
            if anv is not None and q3v is not None:
                vals[(fy,4)] = round((anv-q3v)/1e6, 6)
            if anv is not None: vals[(fy,0)] = round(anv/1e6, 6)
        return vals

    # 1) Dimensioned entries from us-gaap revenue concepts (segment field)
    _seg_buckets = {}   # {seg_label: {(fy,fp): entry}}
    _rev_concepts_seg = [
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'Revenues','SalesRevenueNet','SalesRevenueGoodsNet',
        'RevenueFromContractWithCustomerExcludingAssessedTaxAbstract',
    ]
    for _c in _rev_concepts_seg:
        for _e in gaap.get(_c, {}).get('units', {}).get('USD', []):
            _seg = _e.get('segment')
            if not _seg or not isinstance(_seg, dict): continue
            if _e.get('form') not in ('10-Q','10-K'): continue
            _fp = _e.get('fp',''); _fy = _e.get('fy')
            if not _fy or _fp not in ('Q1','Q2','Q3','FY'): continue
            _lbl = _seg_label(_seg.get('value','') or '')
            if not _lbl or _lbl.lower() in ('consolidated','total','all other'): continue
            if _lbl not in _seg_buckets: _seg_buckets[_lbl] = {}
            _k = (_fy, _fp)
            if _k not in _seg_buckets[_lbl] or _e.get('filed','') > _seg_buckets[_lbl][_k].get('filed',''):
                _seg_buckets[_lbl][_k] = _e

    # 2) Revenue-like concepts from company-specific namespaces
    _rev_kw = _re_seg.compile(r'(revenue|netsales|net_sales|salesnet|productsale|servicesale|segment.*rev|rev.*segment)', _re_seg.I)
    for _ns, _ns_data in facts_data.get('facts', {}).items():
        if _ns in ('us-gaap', 'dei', 'ifrs-full'): continue
        for _concept, _cdata in _ns_data.items():
            if not _rev_kw.search(_concept): continue
            _entries = _cdata.get('units', {}).get('USD', [])
            _qe = [e for e in _entries if e.get('form') in ('10-Q','10-K')
                   and e.get('fp') in ('Q1','Q2','Q3','FY') and e.get('fy')]
            if len(_qe) < 2: continue
            _lbl = _camel_label(_concept)
            if _lbl not in _seg_buckets:
                _seg_buckets[_lbl] = {(_e['fy'], _e['fp']): _e for _e in _qe}

    rows_segs = []
    for _lbl, _best in _seg_buckets.items():
        _v = _build_seg_vals(_best)
        if not _v: continue
        _mapped = sum(1 for c in columns if _v.get((c['year'],c['quarter'])) is not None)
        if _mapped < 2: continue
        rows_segs.append((_mapped, _lbl, _v))
    rows_segs.sort(key=lambda x: -x[0])
    rows_segs = [mkrow(lbl, v) for _, lbl, v in rows_segs]

    # 6.6  Dynamic backbone — catch us-gaap concepts not covered above ──────
    import re as _re_dyn
    _CF_PAT  = _re_dyn.compile(r'(Proceeds|PaymentsTo|PaymentsFor|Repayment|NetCash|IncreaseDecrease|FinanceLease)', _re_dyn.I)
    _BS_PAT  = _re_dyn.compile(r'(Asset|Liabilit|Equity|Payable|Receivable|Inventor|Deposit|Goodwill|Intangible|Capital|Reserve|Debt(?!.*Expense)|Borrowing)', _re_dyn.I)
    dyn_is = []; dyn_bs = []; dyn_cf = []
    for _concept, _cdata in gaap.items():
        if _concept in _BACKBONE_CONCEPTS: continue
        _usd = _cdata.get('units', {}).get('USD', [])
        if not _usd: continue
        # Determine flow vs instant
        _form_entries = [e for e in _usd if e.get('form') in ('10-Q','10-K')
                         and e.get('fp') in ('Q1','Q2','Q3','FY') and e.get('fy')
                         and not e.get('segment')]
        if len(_form_entries) < 2: continue
        _is_flow = any('start' in e for e in _form_entries)
        if _is_flow:
            _v = get_flow([_concept])
        else:
            _v = get_instant([_concept])
        if not _v: continue
        _mapped = sum(1 for c in columns if _v.get((c['year'],c['quarter'])) is not None)
        if _mapped < 3: continue
        _lbl = _camel_label(_concept)
        if _is_flow:
            if _CF_PAT.search(_concept):
                dyn_cf.append((_mapped, _lbl, _v))
            else:
                dyn_is.append((_mapped, _lbl, _v))
        else:
            dyn_bs.append((_mapped, _lbl, _v))
    dyn_is.sort(key=lambda x: -x[0]); dyn_bs.sort(key=lambda x: -x[0]); dyn_cf.sort(key=lambda x: -x[0])

    # 7. Build sections
    rows_is = [
        mkrow('Revenue', rev),
        mkrow('Cost of Revenue', cogs),
        mkrow('Gross Profit', gp, bold=True),
        mkblank(),
        mksect('OPERATING EXPENSES'),
        mkrow('Research & Development', rd),
        mkrow('Sales, General & Administrative', sga),
        mkrow('Depreciation & Amortization', da_is),
        mkrow('Other Operating Income/Expense', oth_opex),
        mkrow('Operating Income', op_inc, bold=True),
        mkblank(),
        mksect('OTHER INCOME / EXPENSE'),
        mkrow('Interest Expense', int_exp, neg=True),
        mkrow('Interest Income', int_inc),
        mkrow('Equity in Earnings of Affiliates', eq_earn),
        mkrow('Other Income / Expense', oth_inc),
        mkrow('Pre-Tax Income', pretax, bold=True),
        mkrow('Income Tax', tax),
        mkrow('Net Income', net_inc, bold=True),
        mkblank(),
        mkrow('EPS (Basic)', eps, fmt='eps'),
        mkrow('Shares Outstanding (M)', shares, fmt='shares'),
    ]
    # Append dynamic IS items not in backbone
    if dyn_is:
        rows_is += [mkblank(), mksect('ADDITIONAL LINE ITEMS')]
        rows_is += [mkrow(lbl, v) for _, lbl, v in dyn_is[:25]]

    rows_mg = [
        mkcalc('Revenue y/y', yoy_row(rev), fmt='pct'),
        mkcalc('Gross Margin', pct_row(gp, rev), fmt='pct'),
        mkcalc('Operating Margin', pct_row(op_inc, rev), fmt='pct'),
        mkcalc('Tax Rate', pct_row(tax, pretax), fmt='pct'),
        mkcalc('Net Margin', pct_row(net_inc, rev), fmt='pct'),
    ]

    rows_bs = [
        mkrow('Model Net Cash', net_cash, bold=True),
        mkblank(),
        mksect('CURRENT ASSETS'),
        mkrow('Cash & Equivalents', cash),
        mkrow('Restricted Cash', rest_c),
        mkrow('Accounts Receivable', ar),
        mkrow('Inventories', inv),
        mkrow('Prepaid Expenses', prep),
        mkrow('Income Tax Receivable', tax_rec),
        mkrow('Current Assets', c_ast, bold=True),
        mkblank(),
        mksect('NON-CURRENT ASSETS'),
        mkrow('PP&E, net', ppe),
        mkrow('Goodwill', gw),
        mkrow('Operating Lease ROU Asset', rou),
        mkrow('Intangible Assets', intang),
        mkrow('Other Non-Current Assets', oth_ast),
        mkrow('Total Assets', tot_ast, bold=True),
        mkblank(),
        mksect('CURRENT LIABILITIES'),
        mkrow('Accounts Payable', ap),
        mkrow('Deferred Revenue', def_rev),
        mkrow('Accrued Expenses', accr),
        mkrow('Current Portion of Debt', c_debt),
        mkrow('Current Operating Lease Liabilities', c_lease),
        mkrow('Current Liabilities', c_liab, bold=True),
        mkblank(),
        mksect('NON-CURRENT LIABILITIES'),
        mkrow('Long-Term Debt', lt_dbt),
        mkrow('Operating Lease Liabilities', lt_ls),
        mkrow('Deferred Income Taxes', def_tx),
        mkrow('Other Non-Current Liabilities', oth_lb),
        mkrow('Total Liabilities', tot_lb, bold=True),
        mkblank(),
        mksect('EQUITY'),
        mkrow('Common Stock', com_stk),
        mkrow('Additional Paid-In Capital', apic),
        mkrow('Retained Earnings / Accum. Deficit', retain),
        mkrow('Accumulated Other Comprehensive Loss', aoci),
        mkrow("Stockholders' Equity", equity, bold=True),
    ]
    # Append dynamic BS items not in backbone
    if dyn_bs:
        rows_bs += [mkblank(), mksect('ADDITIONAL LINE ITEMS')]
        rows_bs += [mkrow(lbl, v) for _, lbl, v in dyn_bs[:25]]

    rows_cf = [
        mkrow('Net Income', net_inc, bold=True),
        mkrow('D&A', dep_cf),
        mkrow('Deferred Income Tax', deftx_cf),
        mkrow('Stock-Based Compensation', sbc),
        mkrow('Impairment Charges', imp),
        mkrow('(Gain)/Loss on Disposal', gdl),
        mkrow('Loss on Debt Extinguishment', debt_x),
        mkrow('Amortization of Debt Issuance Costs', adc),
        mkrow('Changes in Working Capital', wc),
        mkrow('Other Non-Cash Items', oth_nc),
        mkrow('Cash from Operations (CFFO)', cfo, bold=True),
        mkblank(),
        mksect('INVESTING'),
        mkrow('Capital Expenditures', capex, neg=True),
        mkrow('Acquisitions', acq, neg=True),
        mkrow('Proceeds from Sale-Leaseback', p_lb),
        mkrow('Proceeds from Sale of PP&E', p_ppe),
        mkrow('Cash from Investing (CFFI)', cfi, bold=True),
        mkblank(),
        mksect('FINANCING'),
        mkrow('Proceeds from Debt Issuance', d_proc),
        mkrow('Repayments of Debt', d_rep, neg=True),
        mkrow('Proceeds from Revolver', r_proc),
        mkrow('Repayments of Revolver', r_rep, neg=True),
        mkrow('Share Repurchases', buyb, neg=True),
        mkrow('Finance Lease Payments', fl_pay, neg=True),
        mkrow('Stock Option Exercises', opt_ex),
        mkrow('Dividends Paid', divs, neg=True),
        mkrow('Cash from Financing (CFFF)', cff, bold=True),
        mkblank(),
        mkrow('FX Effect on Cash', fx),
    ]
    # Append dynamic CF items not in backbone
    if dyn_cf:
        rows_cf += [mkblank(), mksect('ADDITIONAL LINE ITEMS')]
        rows_cf += [mkrow(lbl, v) for _, lbl, v in dyn_cf[:20]]

    # 8. KPI extraction — scan all non-us-gaap namespaces + dei for company-specific metrics
    def _extract_kpi_vals(entries, unit_key):
        """Extract quarterly values; detects instant vs. period via presence of 'start' field."""
        q_entries = [e for e in entries if e.get('form') in ('10-Q','10-K')
                     and e.get('fp') in ('Q1','Q2','Q3','FY') and e.get('fy')]
        if len(q_entries) < 2:
            return None
        best = {}
        for e in q_entries:
            k = (e['fy'], e['fp'])
            if k not in best or e.get('filed','') > best[k].get('filed',''):
                best[k] = e
        # Detect instant vs flow: instant only if ALL entries lack a 'start' date
        is_instant = all('start' not in best[k] for k in best)
        scale = 1e6 if unit_key in ('USD', 'shares') else 1.0
        result = {}
        for fy in set(y for (y,_) in best):
            q1e = best.get((fy,'Q1')); q2e = best.get((fy,'Q2'))
            q3e = best.get((fy,'Q3')); ane = best.get((fy,'FY'))
            q1v = q1e['val'] if q1e else None
            q2v = q2e['val'] if q2e else None
            q3v = q3e['val'] if q3e else None
            anv = ane['val'] if ane else None
            if is_instant:
                if q1v is not None: result[(fy,1)] = round(q1v/scale, 4)
                if q2v is not None: result[(fy,2)] = round(q2v/scale, 4)
                if q3v is not None: result[(fy,3)] = round(q3v/scale, 4)
                if anv is not None: result[(fy,4)] = round(anv/scale, 4)
                if anv is not None: result[(fy,0)] = round(anv/scale, 4)
            else:
                if q1v is not None: result[(fy,1)] = round(q1v/scale, 4)
                if q2v is not None: result[(fy,2)] = round((q2v-(q1v or 0))/scale, 4)
                if q3v is not None: result[(fy,3)] = round((q3v-(q2v or 0))/scale, 4)
                if anv is not None and q3v is not None:
                    result[(fy,4)] = round((anv-q3v)/scale, 4)
                if anv is not None: result[(fy,0)] = round(anv/scale, 4)
        return result or None

    # Skip unit keys that aren't displayable numbers
    _SKIP_UNITS = {'sqft', 'acre', 'bbl', 'MMBbls', 'MWh', 'kWh', 'MW', 'GWh'}

    rows_kpi = []
    seen_labels = set()
    kpi_candidates = []  # (mapped_count, label, row) for sorting
    for ns, ns_data in facts_data.get('facts', {}).items():
        if ns in ('us-gaap', 'dei', 'ifrs-full'):
            continue  # us-gaap in main model; dei is entity metadata, not operating KPIs
        for concept, cdata in ns_data.items():
            for unit_key, entries in cdata.get('units', {}).items():
                if unit_key in _SKIP_UNITS or ('/' in unit_key and unit_key != 'USD/shares'):
                    continue
                kpi_vals = _extract_kpi_vals(entries, unit_key)
                if not kpi_vals:
                    continue
                mapped = sum(1 for c in columns if kpi_vals.get((c['year'],c['quarter'])) is not None)
                if mapped < 2:
                    continue
                label = _camel_label(concept)
                if label in seen_labels:
                    continue
                seen_labels.add(label)
                if unit_key == 'USD':
                    fmt = 'num'
                elif unit_key == 'shares':
                    fmt = 'shares'
                else:
                    fmt = 'num'  # counts/pure units — show negatives in red
                kpi_candidates.append((mapped, label, mkrow(label, kpi_vals, fmt=fmt)))
    # Sort by data coverage descending so most populated KPIs appear first
    kpi_candidates.sort(key=lambda x: -x[0])
    rows_kpi = [r for _, _, r in kpi_candidates]

    sections_out = [
        {"title": "INCOME STATEMENT", "rows": rows_is},
        {"title": "MARGINS & RATIOS",  "rows": rows_mg},
        {"title": "BALANCE SHEET",     "rows": rows_bs},
        {"title": "CASH FLOW",         "rows": rows_cf},
    ]
    if rows_segs:
        sections_out.insert(0, {"title": "REVENUE SEGMENTS", "rows": rows_segs})
    if rows_kpi:
        sections_out.insert(0, {"title": "KEY PERFORMANCE INDICATORS", "rows": rows_kpi})

    return jsonify({
        "ok": True,
        "ticker": ticker,
        "name": ent_name,
        "columns": columns,
        "sections": sections_out,
    })


# ── BIO ───────────────────────────────────────────
@app.route("/api/bio")
def bio():
    import requests
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"ok": False, "error": "No query provided."})
    try:
        hdrs = {"User-Agent": "KineticTerminal/1.0 (finance terminal)"}

        # 1. Search Wikipedia for the best matching page
        sr = requests.get("https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query,
                    "srlimit": 1, "format": "json"},
            headers=hdrs, timeout=8)
        sr.raise_for_status()
        results = sr.json().get("query", {}).get("search", [])
        if not results:
            return jsonify({"ok": False, "error": f"No Wikipedia article found for '{query}'."})

        page_title = results[0]["title"]
        slug = page_title.replace(" ", "_")

        # 2. REST summary — thumbnail, short description, wikibase_item (Wikidata ID)
        r2 = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
            headers=hdrs, timeout=8)
        r2.raise_for_status()
        summary = r2.json()
        wikidata_id = summary.get("wikibase_item", "")

        # 3. Full intro extract (much longer than REST summary's extract)
        r3 = requests.get("https://en.wikipedia.org/w/api.php",
            params={"action": "query", "titles": page_title, "prop": "extracts",
                    "exintro": True, "explaintext": True, "format": "json"},
            headers=hdrs, timeout=8)
        r3.raise_for_status()
        pages = r3.json().get("query", {}).get("pages", {})
        full_extract = next(iter(pages.values()), {}).get("extract", summary.get("extract", ""))

        # 4. Wikidata structured facts (education, employer, positions, occupation)
        facts = []
        if wikidata_id:
            PROPS = {
                "P69":  "Education",
                "P39":  "Positions Held",
                "P108": "Employer",
                "P106": "Occupation",
            }
            wd = requests.get("https://www.wikidata.org/w/api.php",
                params={"action": "wbgetentities", "ids": wikidata_id,
                        "props": "claims", "format": "json"},
                headers=hdrs, timeout=8)
            wd.raise_for_status()
            claims = wd.json().get("entities", {}).get(wikidata_id, {}).get("claims", {})

            # Collect all QIDs referenced across the properties we care about
            prop_qids = {}
            all_qids = set()
            for prop_id, label in PROPS.items():
                qids = []
                for snak in claims.get(prop_id, []):
                    mv = snak.get("mainsnak", {}).get("datavalue", {}).get("value", {})
                    if isinstance(mv, dict) and "id" in mv:
                        qids.append(mv["id"])
                        all_qids.add(mv["id"])
                if qids:
                    prop_qids[label] = qids

            # Batch-resolve QIDs to English labels
            qid_labels = {}
            if all_qids:
                lb = requests.get("https://www.wikidata.org/w/api.php",
                    params={"action": "wbgetentities", "ids": "|".join(all_qids),
                            "props": "labels", "languages": "en", "format": "json"},
                    headers=hdrs, timeout=8)
                lb.raise_for_status()
                for qid, ent in lb.json().get("entities", {}).items():
                    lbl = ent.get("labels", {}).get("en", {}).get("value")
                    if lbl:
                        qid_labels[qid] = lbl

            for label, qids in prop_qids.items():
                values = [qid_labels.get(q, q) for q in qids]
                facts.append({"label": label, "values": values})

        return jsonify({
            "ok":          True,
            "title":       summary.get("title", page_title),
            "description": summary.get("description", ""),
            "extract":     full_extract,
            "thumbnail":   (summary.get("thumbnail") or {}).get("source", None),
            "url":         (summary.get("content_urls") or {}).get("desktop", {}).get("page",
                            f"https://en.wikipedia.org/wiki/{slug}"),
            "facts":       facts,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── ERN: Earnings detail for a ticker ─────────────────────────────────────
@app.route("/api/ern/<ticker>")
def ern(ticker):
    import time, concurrent.futures
    sym = _sanitize_ticker(ticker)
    now = time.time()
    cached = _ERN_CACHE.get(sym)
    if cached and now - cached["ts"] < _ERN_TTL:
        return jsonify(cached["data"])
    try:
        def fetch_next_date():
            rows = dolthub_query(
                f"SELECT date, `when` FROM earnings_calendar "
                f"WHERE act_symbol='{sym}' AND date >= CURDATE() "
                f"ORDER BY date ASC LIMIT 1"
            )
            return rows[0] if rows else {}

        def fetch_eps_history():
            return dolthub_query(
                f"SELECT period_end_date, reported, estimate "
                f"FROM eps_history WHERE act_symbol='{sym}' "
                f"ORDER BY period_end_date DESC LIMIT 8"
            )

        def fetch_eps_estimates():
            return dolthub_query(
                f"SELECT period, period_end_date, consensus, recent, high, low, `count`, year_ago "
                f"FROM eps_estimate WHERE act_symbol='{sym}' "
                f"AND date=(SELECT MAX(date) FROM eps_estimate WHERE act_symbol='{sym}') "
                f"ORDER BY period_end_date ASC LIMIT 6"
            )

        def fetch_sales_estimates():
            return dolthub_query(
                f"SELECT period, period_end_date, consensus, recent, high, low, `count`, year_ago "
                f"FROM sales_estimate WHERE act_symbol='{sym}' "
                f"AND date=(SELECT MAX(date) FROM sales_estimate WHERE act_symbol='{sym}') "
                f"ORDER BY period_end_date ASC LIMIT 6"
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            fnd = ex.submit(fetch_next_date)
            feh = ex.submit(fetch_eps_history)
            fee = ex.submit(fetch_eps_estimates)
            fse = ex.submit(fetch_sales_estimates)
            try:    next_info        = fnd.result(timeout=20)
            except: next_info        = {}
            try:    eps_history      = feh.result(timeout=20)
            except: eps_history      = []
            try:    eps_estimates    = fee.result(timeout=20)
            except: eps_estimates    = []
            try:    sales_estimates  = fse.result(timeout=20)
            except: sales_estimates  = []

        result = {
            "ok": True,
            "ticker": sym,
            "next_date": next_info.get("date"),
            "when": next_info.get("when"),
            "eps_history":      eps_history,
            "eps_estimates":    eps_estimates,
            "sales_estimates":  sales_estimates,
        }
        _ERN_CACHE[sym] = {"data": result, "ts": now}
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── ECAL: Earnings calendar (week view) ───────────────────────────────────
@app.route("/api/ecal")
def ecal():
    import time
    now = time.time()
    week = request.args.get("week", "")  # YYYY-MM-DD Monday of desired week
    cache_key = week or "current"
    cached = _ECAL_CACHE.get(cache_key)
    if cached and now - cached["ts"] < _ECAL_TTL:
        return jsonify(cached["data"])
    try:
        if week:
            sql = (
                f"SELECT act_symbol, date, `when` FROM earnings_calendar "
                f"WHERE date >= '{week}' AND date < DATE_ADD('{week}', INTERVAL 7 DAY) "
                f"ORDER BY date ASC LIMIT 500"
            )
        else:
            sql = (
                "SELECT act_symbol, date, `when` FROM earnings_calendar "
                "WHERE date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) "
                "AND date < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY) "
                "ORDER BY date ASC LIMIT 500"
            )
        rows = dolthub_query(sql)
        result = {"ok": True, "events": rows}
        _ECAL_CACHE[cache_key] = {"data": result, "ts": now}
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── ECAL MCAP: batch market-cap lookup for earnings calendar ──────────────
@app.route("/api/ecal/mcap")
def ecal_mcap():
    import time as _time
    tickers_str = request.args.get("tickers", "")
    if not tickers_str:
        return jsonify({"ok": False, "error": "no tickers"})
    tickers = [t.strip().upper() for t in tickers_str.split(",") if t.strip()]
    cache_key = frozenset(tickers)
    now = _time.time()
    cached = _ECAL_MCAP_CACHE.get(cache_key)
    if cached and now - cached["ts"] < _ECAL_MCAP_TTL:
        return jsonify({"ok": True, "mcap": cached["data"]})

    def fetch_one(sym):
        try:
            fi = yf.Ticker(sym).fast_info
            mc = getattr(fi, 'market_cap', None)
            if mc and mc > 0:
                return (sym, round(mc / 1_000_000, 2))
        except Exception:
            pass
        # fallback to .info if fast_info failed
        try:
            mc = yf.Ticker(sym).info.get('marketCap')
            if mc and mc > 0:
                return (sym, round(mc / 1_000_000, 2))
        except Exception:
            pass
        return (sym, None)

    mcap = {}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
            for sym, val in ex.map(fetch_one, tickers):
                if val is not None:
                    mcap[sym] = val
    except Exception:
        pass

    _ECAL_MCAP_CACHE[cache_key] = {"data": mcap, "ts": now}
    return jsonify({"ok": True, "mcap": mcap})


# ── EM: Earnings Matrix ───────────────────────────────────────────────────
@app.route("/api/em/<ticker>")
def em_route(ticker):
    import time, concurrent.futures, requests as _req, datetime
    import yfinance as yf
    sym = _sanitize_ticker(ticker)
    now = time.time()
    cached = _EM_CACHE.get(sym)
    if cached and now - cached["ts"] < _EM_TTL:
        return jsonify(cached["data"])
    try:
        def fetch_eps_hist():
            return dolthub_query(
                f"SELECT period_end_date, reported, estimate FROM eps_history "
                f"WHERE act_symbol='{sym}' ORDER BY period_end_date ASC"
            )
        def fetch_rev():
            qtrs = dolthub_query(
                f"SELECT date, sales FROM income_statement "
                f"WHERE act_symbol='{sym}' AND period='Quarter' ORDER BY date ASC"
            )
            ann = dolthub_query(
                f"SELECT date, sales FROM income_statement "
                f"WHERE act_symbol='{sym}' AND period='Year' ORDER BY date ASC"
            )
            return {"qtrs": qtrs, "ann": ann}
        def fetch_eps_est():
            return dolthub_query(
                f"SELECT period, period_end_date, consensus, high, low, `count`, year_ago "
                f"FROM eps_estimate WHERE act_symbol='{sym}' "
                f"AND date=(SELECT MAX(date) FROM eps_estimate WHERE act_symbol='{sym}') "
                f"ORDER BY period_end_date ASC"
            )
        def fetch_rev_est():
            return dolthub_query(
                f"SELECT period, period_end_date, consensus, high, low, `count`, year_ago "
                f"FROM sales_estimate WHERE act_symbol='{sym}' "
                f"AND date=(SELECT MAX(date) FROM sales_estimate WHERE act_symbol='{sym}') "
                f"ORDER BY period_end_date ASC"
            )
        def fetch_bs():
            rows = dolthub_query(
                f"SELECT book_value_per_share FROM balance_sheet_equity "
                f"WHERE act_symbol='{sym}' ORDER BY date DESC LIMIT 1"
            )
            return rows[0] if rows else {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            feh = ex.submit(fetch_eps_hist)
            frv = ex.submit(fetch_rev)
            fee = ex.submit(fetch_eps_est)
            fre = ex.submit(fetch_rev_est)
            fbs = ex.submit(fetch_bs)
            try:    eps_hist = feh.result(timeout=20)
            except: eps_hist = []
            try:    rev_data = frv.result(timeout=20)
            except: rev_data = {"qtrs": [], "ann": []}
            try:    eps_est  = fee.result(timeout=20)
            except: eps_est  = []
            try:    rev_est  = fre.result(timeout=20)
            except: rev_est  = []
            try:    bs_row   = fbs.result(timeout=20)
            except: bs_row   = {}

        # Fill missing period_end_date for estimate rows (DoltHub sometimes returns null)
        def _fill_ped(rows):
            today = datetime.date.today()
            m, y = today.month, today.year
            if   m <= 3:  cq = datetime.date(y,  3, 31); nq = datetime.date(y,  6, 30)
            elif m <= 6:  cq = datetime.date(y,  6, 30); nq = datetime.date(y,  9, 30)
            elif m <= 9:  cq = datetime.date(y,  9, 30); nq = datetime.date(y, 12, 31)
            else:         cq = datetime.date(y, 12, 31); nq = datetime.date(y+1, 3, 31)
            for row in rows:
                if row.get('period_end_date'): continue
                p = (row.get('period') or '').lower()
                if   'current quarter' in p or 'current qtr' in p: row['period_end_date'] = str(cq)
                elif 'next quarter'    in p or 'next qtr'    in p: row['period_end_date'] = str(nq)
                elif 'current year'    in p:                        row['period_end_date'] = f"{y}-12-31"
                elif 'next year'       in p:                        row['period_end_date'] = f"{y+1}-12-31"
            return rows
        eps_est = _fill_ped(eps_est)
        rev_est = _fill_ped(rev_est)

        # SEC EDGAR verification — own simple extraction, no MODL dependency
        sec_eps, sec_rev = {}, {}
        try:
            cik_resp = _req.get("https://www.sec.gov/files/company_tickers.json",
                                headers=_MODL_HEADERS, timeout=10).json()
            cik = None
            for _, co in cik_resp.items():
                if co.get('ticker', '').upper() == sym:
                    cik = str(co['cik_str']).zfill(10); break
            if cik:
                gaap = _req.get(
                    f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
                    headers=_MODL_HEADERS, timeout=30
                ).json().get('facts', {}).get('us-gaap', {})

                def _deq(concept, unit):
                    """De-cumulate XBRL YTD entries → {period_end_date: quarterly_value}"""
                    entries = gaap.get(concept, {}).get('units', {}).get(unit, [])
                    best = {}
                    for e in entries:
                        if e.get('form') not in ('10-Q', '10-K'): continue
                        fp = e.get('fp', '')
                        if fp not in ('Q1', 'Q2', 'Q3', 'FY'): continue
                        k = (e.get('fy'), fp)
                        if k not in best or e.get('filed', '') > best[k].get('filed', ''):
                            best[k] = e
                    out = {}
                    for fy in {y for (y, _) in best}:
                        q1 = best.get((fy, 'Q1')); q2 = best.get((fy, 'Q2'))
                        q3 = best.get((fy, 'Q3')); an = best.get((fy, 'FY'))
                        if q1:           out[q1['end']] = q1['val']
                        if q2 and q1:    out[q2['end']] = q2['val'] - (q1['val'] or 0)
                        if q3 and q2:    out[q3['end']] = q3['val'] - (q2['val'] or 0)
                        if an and q3:    out[an['end']] = an['val'] - (q3['val'] or 0)
                    return {k: v for k, v in out.items() if v is not None}

                for c in ['EarningsPerShareDiluted', 'EarningsPerShareBasic']:
                    r2 = _deq(c, 'USD/shares')
                    if r2: sec_eps = r2; break
                for c in ['RevenueFromContractWithCustomerExcludingAssessedTax',
                           'Revenues', 'SalesRevenueNet']:
                    r2 = _deq(c, 'USD')
                    if r2: sec_rev = r2; break
        except Exception:
            pass  # SEC unavailable — degrade gracefully

        def chk(dolt_val, sec_dict, date_key, tol=0.03):
            sv = sec_dict.get(date_key)
            if sv is None: return 'na'
            try:
                d_v, s_v = float(dolt_val), float(sv)
                if s_v == 0: return 'ok' if abs(d_v) < 0.01 else 'warn'
                return 'ok' if abs(d_v - s_v) / abs(s_v) <= tol else 'warn'
            except: return 'na'

        eps_hist_v = [
            {"date": h["period_end_date"], "reported": h["reported"],
             "estimate": h["estimate"],
             "sec": chk(h["reported"], sec_eps, h["period_end_date"])}
            for h in eps_hist
        ]
        rev_qtrs = rev_data.get("qtrs", [])
        rev_hist_v = [
            {"date": r["date"], "sales": r["sales"],
             "sec": chk(r["sales"], sec_rev, r["date"])}
            for r in rev_qtrs
        ]

        # Valuation multiples
        valuation = {}
        try:
            info   = yf.Ticker(sym).info
            price  = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
            mktcap = float(info.get("marketCap") or 0)
            bvps   = float(bs_row.get("book_value_per_share") or 0)
            if price:
                last4_eps = [float(h["reported"]) for h in eps_hist_v[-4:]
                             if h["reported"] is not None]
                ltm_eps = sum(last4_eps) if len(last4_eps) == 4 else None
                last4_rev = [float(r["sales"]) for r in rev_hist_v[-4:]
                             if r["sales"] is not None]
                ltm_rev = sum(last4_rev) if len(last4_rev) == 4 else None
                fy1_eps = fy2_eps = fy1_rev = fy2_rev = None
                for e in eps_est:
                    p = (e.get("period") or "").lower()
                    if "current year" in p and fy1_eps is None:
                        fy1_eps = float(e["consensus"] or 0) or None
                    if "next year" in p and fy2_eps is None:
                        fy2_eps = float(e["consensus"] or 0) or None
                for e in rev_est:
                    p = (e.get("period") or "").lower()
                    if "current year" in p and fy1_rev is None:
                        fy1_rev = float(e["consensus"] or 0) or None
                    if "next year" in p and fy2_rev is None:
                        fy2_rev = float(e["consensus"] or 0) or None
                def sd(a, b):
                    try: return round(float(a) / float(b), 2) if a and b and float(b) != 0 else None
                    except: return None
                cur_yr = datetime.datetime.now().year
                valuation = {
                    "price": price, "fy1_year": cur_yr, "fy2_year": cur_yr + 1,
                    "pe": {"ltm": sd(price, ltm_eps), "fy1": sd(price, fy1_eps),
                           "fy2": sd(price, fy2_eps)},
                    "ps": {"ltm": sd(mktcap, ltm_rev), "fy1": sd(mktcap, fy1_rev),
                           "fy2": sd(mktcap, fy2_rev)},
                    "pb": {"ltm": sd(price, bvps)},
                }
        except Exception:
            pass

        result = {
            "ok": True, "ticker": sym,
            "eps_hist": eps_hist_v,
            "eps_est":  eps_est,
            "rev_hist": rev_hist_v,
            "rev_ann":  rev_data.get("ann", []),
            "rev_est":  rev_est,
            "valuation": valuation,
        }
        _EM_CACHE[sym] = {"data": result, "ts": now}
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


if __name__ == "__main__":
    print("\n" + "="*52)
    print("  KINETIC TERMINAL -- Backend Online")
    print("  http://localhost:5000")
    print("  Data: Yahoo Finance (~10-15min delay)")
    print("  Bond tickers: Reuters format (XX10YT=RR)")
    print("="*52 + "\n")
    app.run(debug=True, port=5000, host="0.0.0.0")