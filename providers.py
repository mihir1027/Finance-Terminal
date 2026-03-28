"""
providers.py — Hierarchical data provider with automatic fallback.

Quote chain:  Massive → Twelve Data → Tiingo → Finnhub → Alpha Vantage → yfinance
Each provider returns a dict on success, or None on failure.
"""

import os
import re
import requests
import yfinance as yf
import finnhub
import config
from config import FINNHUB_API_KEY, TWELVE_DATA_API_KEY, TIINGO_API_KEY, ALPHA_VANTAGE_API_KEY

# Set PROVIDER_VERBOSE=false in .env to silence provider log lines
_VERBOSE = os.getenv("PROVIDER_VERBOSE", "true").lower() == "true"

# ─────────────────────────────────────────────
#  BINANCE (crypto — no API key required)
# ─────────────────────────────────────────────
_BINANCE_BASE = "https://data-api.binance.vision/api/v3"

def _is_crypto(ticker):
    return bool(re.match(r'^[A-Z0-9]+-USD$', ticker))

def _binance_sym(ticker):
    """BTC-USD -> BTCUSDT"""
    return ticker.replace('-USD', 'USDT').replace('-', '')

def _quote_binance(ticker):
    sym = _binance_sym(ticker)
    try:
        r = requests.get(f"{_BINANCE_BASE}/ticker/24hr", params={"symbol": sym}, timeout=5)
        if r.status_code != 200:
            return None
        d = r.json()
        price = float(d['lastPrice'])
        prev  = float(d['openPrice'])
        chg   = float(d['priceChange'])
        chgp  = float(d['priceChangePercent']) / 100
        return {
            "ticker":    ticker,
            "name":      sym,
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": chgp,
            "open":      float(d['openPrice']),
            "high":      float(d['highPrice']),
            "low":       float(d['lowPrice']),
            "volume":    float(d['volume']),
            "avgVolume": None,
            "marketCap": None,
            "currency":  "USD",
            "exchange":  "Binance",
            "source":    "Binance",
        }
    except Exception:
        return None

def _log(msg):
    if _VERBOSE:
        print(msg)

finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)

TWELVE_DATA_BASE = "https://api.twelvedata.com"


# ─────────────────────────────────────────────
#  PROVIDER 1 — Massive
# ─────────────────────────────────────────────

def _quote_massive(ticker):
    """Try Massive first — enterprise-grade real-time data."""
    try:
        key = config.MASSIVE_API_KEY
        if not key:
            return None
        url = f"https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}"
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=6)
        if r.status_code != 200:
            return None
        data = r.json().get("results", {})
        last  = (data.get("lastTrade") or {}).get("p")
        prev  = (data.get("prevDay")   or {}).get("c")
        day   = data.get("day") or {}
        quote = data.get("lastQuote") or {}
        if last is None:
            return None
        chg = round(last - prev, 4) if prev else None
        pct = round(chg / prev * 100, 4) if prev and prev != 0 else None
        return {
            "source":    "massive",
            "ticker":    ticker.upper(),
            "name":      "—",
            "price":     last,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      day.get("o"),
            "high":      day.get("h"),
            "low":       day.get("l"),
            "volume":    day.get("v"),
            "bid":       quote.get("p"),
            "ask":       quote.get("P"),
            "exchange":  "—",
            "currency":  "USD",
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PROVIDER 2 — Twelve Data
# ─────────────────────────────────────────────

def _quote_twelve_data(ticker):
    """Try Twelve Data second — 800 free calls/day."""
    try:
        url = f"{TWELVE_DATA_BASE}/quote"
        params = {"symbol": ticker, "apikey": TWELVE_DATA_API_KEY}
        r = requests.get(url, params=params, timeout=5)
        data = r.json()

        # Twelve Data returns {"code": 400, "message": "..."} on errors
        if data.get("code") or data.get("status") == "error":
            return None

        price = float(data["close"])
        prev  = float(data["previous_close"])
        chg   = price - prev
        pct   = (chg / prev) * 100 if prev else None

        return {
            "source":    "twelve_data",
            "ticker":    ticker.upper(),
            "name":      data.get("name", "—"),
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      float(data.get("open") or 0) or None,
            "high":      float(data.get("high") or 0) or None,
            "low":       float(data.get("low") or 0) or None,
            "volume":    int(data.get("volume") or 0) or None,
            "exchange":  data.get("exchange", "—"),
            "currency":  data.get("currency", "USD"),
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PROVIDER 3 — Tiingo
# ─────────────────────────────────────────────

def _quote_tiingo(ticker):
    """Try Tiingo — 100 free calls/day, validated EOD data."""
    try:
        if not TIINGO_API_KEY:
            return None
        headers = {"Content-Type": "application/json", "Authorization": f"Token {TIINGO_API_KEY}"}
        r = requests.get(
            f"https://api.tiingo.com/tiingo/daily/{ticker}/prices",
            headers=headers, timeout=5
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if not data or not isinstance(data, list):
            return None
        d = data[0]
        price = d.get("close") or d.get("adjClose")
        prev  = d.get("prevClose")
        if not price:
            return None
        chg = round(price - prev, 4) if prev else None
        pct = round(chg / prev * 100, 4) if (chg and prev) else None
        return {
            "source":    "tiingo",
            "ticker":    ticker.upper(),
            "name":      "—",
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      d.get("open"),
            "high":      d.get("high"),
            "low":       d.get("low"),
            "volume":    d.get("volume"),
            "exchange":  "—",
            "currency":  "USD",
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PROVIDER 4 — Finnhub
# ─────────────────────────────────────────────

def _quote_finnhub(ticker):
    """Try Finnhub fourth — 60 calls/min."""
    try:
        quote = finnhub_client.quote(ticker)
        if not quote or quote.get("c", 0) == 0:
            return None

        price = quote["c"]
        prev  = quote["pc"]
        chg   = price - prev
        pct   = (chg / prev) * 100 if prev else None

        return {
            "source":    "finnhub",
            "ticker":    ticker.upper(),
            "name":      "—",
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      quote.get("o"),
            "high":      quote.get("h"),
            "low":       quote.get("l"),
            "volume":    None,
            "exchange":  "—",
            "currency":  "USD",
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PROVIDER 5 — Alpha Vantage
# ─────────────────────────────────────────────

def _quote_alpha_vantage(ticker):
    """Try Alpha Vantage — 5 req/min free, no daily cap."""
    try:
        if not ALPHA_VANTAGE_API_KEY:
            return None
        r = requests.get(
            "https://www.alphavantage.co/query",
            params={"function": "GLOBAL_QUOTE", "symbol": ticker, "apikey": ALPHA_VANTAGE_API_KEY},
            timeout=6
        )
        if r.status_code != 200:
            return None
        gq = r.json().get("Global Quote", {})
        if not gq or not gq.get("05. price"):
            return None
        price = float(gq["05. price"])
        prev  = float(gq.get("08. previous close") or 0) or None
        chg   = float(gq.get("09. change") or 0) or None
        pct   = float(gq.get("10. change percent", "0%").replace("%", "")) or None
        return {
            "source":    "alpha_vantage",
            "ticker":    ticker.upper(),
            "name":      "—",
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      float(gq.get("02. open") or 0) or None,
            "high":      float(gq.get("03. high") or 0) or None,
            "low":       float(gq.get("04. low") or 0) or None,
            "volume":    int(gq.get("06. volume") or 0) or None,
            "exchange":  "—",
            "currency":  "USD",
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PROVIDER 6 — yfinance (last resort)
# ─────────────────────────────────────────────

def _quote_yfinance(ticker):
    """Last resort — unlimited but unofficial."""
    try:
        t = yf.Ticker(ticker)
        info = t.info

        price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
        prev  = info.get("previousClose") or info.get("regularMarketPreviousClose")

        chg = (price - prev) if (price and prev) else None
        pct = ((chg / prev) * 100) if (chg and prev) else None

        return {
            "source":    "yfinance",
            "ticker":    ticker.upper(),
            "name":      info.get("shortName") or info.get("longName", "—"),
            "price":     price,
            "prev":      prev,
            "change":    chg,
            "changePct": pct,
            "open":      info.get("open"),
            "high":      info.get("dayHigh"),
            "low":       info.get("dayLow"),
            "volume":    info.get("volume"),
            "avgVolume": info.get("averageVolume"),
            "bid":       info.get("bid"),
            "ask":       info.get("ask"),
            "marketCap": info.get("marketCap"),
            "exchange":  info.get("exchange", "—"),
            "currency":  info.get("currency", "USD"),
        }
    except Exception:
        return None


# ─────────────────────────────────────────────
#  PUBLIC INTERFACE
# ─────────────────────────────────────────────

def get_quote(ticker):
    """
    Return a quote dict for the given ticker by trying providers in order:
      1. Massive
      2. Twelve Data
      3. Tiingo
      4. Finnhub
      5. Alpha Vantage
      6. yfinance

    Returns None if all providers fail.
    """
    chain = [_quote_massive, _quote_twelve_data, _quote_tiingo, _quote_finnhub, _quote_alpha_vantage, _quote_yfinance]
    if _is_crypto(ticker):
        chain = [_quote_binance] + chain
    for provider in chain:
        result = provider(ticker)
        if result:
            _log(f"[providers] {ticker} -> {result['source']}")
            return result

    _log(f"[providers] {ticker} → ALL PROVIDERS FAILED")
    return None
