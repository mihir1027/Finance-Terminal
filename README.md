# Finance Terminal

A Bloomberg-style financial terminal that runs in your browser. quotes, charts, macro data, analyst estimates, SEC filings, prediction markets, and more.

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![Flask](https://img.shields.io/badge/Flask-backend-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)


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

All services have free tiers — no payment required. Good to have them all.

| Variable | Where to get it |
|---|---|
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io) — click "Get free API key" |
| `TWELVE_DATA_API_KEY` | [twelvedata.com](https://twelvedata.com) — click "Get your free API key" |
| `FRED_API_KEY` | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `MASSIVE_API_KEY` | Optional — leave blank if you don't have one |
| `SEC_USER_AGENT` | Your name + email (e.g. `Jane Doe jane@example.com`) — required by the SEC to access EDGAR filings |

      28 +TIINGO_API_KEY=               # tiingo.com — quote fallback + news                     
      29 +ALPHA_VANTAGE_API_KEY=        # alphavantage.co — chart indicators + quote fallback    
      30 +MARKETSTACK_API_KEY=          # marketstack.com — global equity fallback               
      31 +EODHD_API_KEY=                # eodhd.com — global ticker fallback                     
      32 +FIXER_API_KEY=                # fixer.io — historical forex rates                      
      33 +MASSIVE_API_KEY=              # Very good to have
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
  PROVIDER_VERBOSE=true                                                                                 
  FRED_API_KEY=your_key_here                                                                            
  MASSIVE_API_KEY=your_key_here                                                                         
  FMP_API_KEY=your_key_here
  EIA_API_KEY=your_key_here
  TIINGO_API_KEY=your_key_here                                                                          
  ALPHA_VANTAGE_API_KEY=your_key_here
  CURRENCY_LAYER_API_KEY=your_key_here                                                                  
  MARKETSTACK_API_KEY=your_key_here
  EODHD_API_KEY=your_key_here                                                                           
  FIXER_API_KEY=your_key_here
  USDA_FAS_API_KEY=your_key_here  


```

> `.env` is listed in `.gitignore` — your keys are never committed or uploaded.

### 5. Build the frontend

```bash
npm install
npm run build
```

### 6. Run the server

```bash
python app.py
```

Then open **http://localhost:5001** in your browser.

> **All API keys must be sourced and added to your `.env` file for the terminal to work.** Missing keys will cause data panels to show errors or return no data.

---

## CLI Macro Terminal (optional)

`main.py` is a separate keyboard-driven terminal for commodity prices and yield curves:

```bash
python main.py
```

Use `F1`–`F5` to switch commodities. Shows US Treasury yield curves and CME futures chains plotted with matplotlib.

---


The app automatically falls back to the next provider if one fails or is rate-limited.

---

## Project Structure

```
finance-terminal/
├── app.py           # Flask backend — all API routes
├── providers.py     # Multi-provider data fallback logic
├── config.py        # Loads API keys from .env
├── curves.py        # Yield curve and futures data
├── edgar.py         # SEC EDGAR filing integration
├── research.py      # Research utilities
├── src/             # TypeScript/Vite frontend source
│   ├── core/        # CLI, window manager, utilities
│   ├── panels/      # All terminal panel modules
│   └── styles/      # CSS stylesheets
├── package.json
├── vite.config.ts
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
