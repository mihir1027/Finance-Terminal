# Finance Terminal

A Bloomberg-style financial terminal that runs in your browser. Live quotes, charts, macro data, analyst estimates, SEC filings, prediction markets, and more.

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![Flask](https://img.shields.io/badge/Flask-backend-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Features

- **Live Quotes** — Real-time stock, ETF, crypto, forex, and commodity prices with multi-provider fallback (Finnhub → Twelve Data → yfinance)
- **Charts** — Interactive candlestick charts powered by TradingView Lightweight Charts
- **Company Overview** — Description, fundamentals, earnings history, and valuation metrics
- **Analyst Estimates** — Ratings, price targets, and consensus estimates
- **SEC Filings** — Latest 10-K, 10-Q, and 8-K filings via EDGAR
- **Macro Data** — World indices, global commodities, forex matrix, US Treasury yield curves
- **News** — Per-ticker and market-wide news feed
- **Prediction Markets** — Event contract prices
- **CLI Macro Terminal** — Keyboard-driven commodity and yield curve viewer (`main.py`)

---

## Prerequisites

- Python 3.8 or higher
- pip

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/mihir1027/finance-terminal.git
cd finance-terminal
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Get your API keys

All services have free tiers — no payment required.

| Variable | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io) — click "Get free API key" |
| `TWELVE_DATA_API_KEY` | [twelvedata.com](https://twelvedata.com) — click "Get your free API key" |
| `FRED_API_KEY` | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `FMP_API_KEY` | [financialmodelingprep.com/developer/docs](https://site.financialmodelingprep.com/developer/docs) |
| `MASSIVE_API_KEY` | Optional — leave blank if you don't have one |

### 4. Configure your `.env` file

Copy the template and fill in your keys:

**Mac/Linux:**
```bash
cp .env.example .env
```

**Windows (Command Prompt):**
```
copy .env.example .env
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

Open `.env` in any text editor and replace the placeholder values:

```env
FINNHUB_API_KEY=your_key_here
TWELVE_DATA_API_KEY=your_key_here
FRED_API_KEY=your_key_here
FMP_API_KEY=your_key_here
MASSIVE_API_KEY=              # leave blank if unused
PROVIDER_VERBOSE=false
```

> `.env` is listed in `.gitignore` — your keys are never committed or uploaded.

### 5. Run the server

```bash
python app.py
```

Then open **http://localhost:5000** in your browser.

---

## CLI Macro Terminal (optional)

`main.py` is a separate keyboard-driven terminal for commodity prices and yield curves:

```bash
python main.py
```

Use `F1`–`F5` to switch commodities. Shows US Treasury yield curves and CME futures chains plotted with matplotlib.

---

## API Keys — Free Tier Limits

| Provider | Free Tier |
|---|---|
| Finnhub | 60 requests/minute |
| Twelve Data | 800 requests/day |
| FRED | Unlimited (public data) |
| FMP | 250 requests/day |
| Binance | No key required (crypto data) |

The app automatically falls back to the next provider if one fails or is rate-limited.

---

## Project Structure

```
finance-terminal/
├── app.py           # Flask backend — all API routes
├── main.py          # CLI macro terminal
├── providers.py     # Multi-provider data fallback logic
├── config.py        # Loads API keys from .env
├── curves.py        # Yield curve and futures data
├── edgar.py         # SEC EDGAR filing integration
├── index.html       # Frontend UI (Bloomberg-style)
├── requirements.txt
├── .env.example     # API key template
└── .gitignore
```

---

## Troubleshooting

**App starts but quotes show "N/A"**
- Double-check your `.env` file has valid API keys with no extra spaces
- Make sure the `.env` file is in the same folder as `app.py`

**`ModuleNotFoundError`**
- Run `pip install -r requirements.txt` again
- If using a virtual environment, make sure it's activated

**Port 5000 already in use**
- Change the port at the bottom of `app.py`: `app.run(port=5001)`

---

## License

MIT
