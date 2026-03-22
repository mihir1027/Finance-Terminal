# Finance Terminal

A Bloomberg-style terminal running in your browser. Live quotes, macro data, prediction markets, equity screener, and more.

---

## Setup

### 1. Clone the repo
```
git clone https://github.com/mihir1027/Finance-Terminal.git
cd Finance-Terminal
```

### 2. Install dependencies
```
pip install -r requirements.txt
```

### 3. Get your API keys (all free tiers work)

You need to sign up for each service and get a free API key. These are just strings of letters and numbers they give you — no payment required.

| Key | Sign up here |
|-----|-------------|
| `FINNHUB_API_KEY` | https://finnhub.io — click "Get free API key" |
| `TWELVE_DATA_API_KEY` | https://twelvedata.com — click "Get your free API key" |
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `FMP_API_KEY` | https://site.financialmodelingprep.com/developer/docs |
| `MASSIVE_API_KEY` | Optional — you can leave this blank |

### 4. Set up your `.env` file

The `.env` file is where you store your API keys so the app can use them. You are **creating a new file** — you are not deleting anything.

**Step 1 — Create the file by copying the template:**

On Mac/Linux:
```
cp .env.example .env
```
On Windows (Command Prompt):
```
copy .env.example .env
```
On Windows (PowerShell):
```
Copy-Item .env.example .env
```

This creates a new file called `.env` in the same folder. The `.env.example` file stays untouched.

**Step 2 — Open `.env` in a text editor.**

You can use Notepad, VS Code, or any text editor. The file will look like this:
```
FINNHUB_API_KEY=your_finnhub_key_here
TWELVE_DATA_API_KEY=your_twelve_data_key_here
FRED_API_KEY=your_fred_api_key_here
FMP_API_KEY=your_fmp_key_here
MASSIVE_API_KEY=your_massive_api_key_here
PROVIDER_VERBOSE=false
```

**Step 3 — Replace each placeholder with your actual key.**

For example, if your Finnhub key is `abc123xyz`, change:
```
FINNHUB_API_KEY=your_finnhub_key_here
```
to:
```
FINNHUB_API_KEY=abc123xyz
```

Do this for each key. For `MASSIVE_API_KEY`, just leave it blank like this if you don't have one:
```
MASSIVE_API_KEY=
```

**Step 4 — Save the file.** Do not rename it — it must be called exactly `.env`.

> Your `.env` file is listed in `.gitignore`, which means git will never upload it. Your keys stay on your computer only.

---

### 5. Run it
```
python main.py
```
Then open your browser to **http://localhost:5000**
