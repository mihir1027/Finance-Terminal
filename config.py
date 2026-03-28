import os
from dotenv import load_dotenv

# Load variables from the hidden .env file
load_dotenv()

# Export the keys so other files can import them
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")
TWELVE_DATA_API_KEY = os.getenv("TWELVE_DATA_API_KEY")
FRED_API_KEY = os.getenv("FRED_API_KEY")
MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY", "")
EIA_API_KEY = os.getenv("EIA_API_KEY", "")
TIINGO_API_KEY = os.getenv("TIINGO_API_KEY", "")
ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY", "")
CURRENCY_LAYER_API_KEY = os.getenv("CURRENCY_LAYER_API_KEY", "")
MARKETSTACK_API_KEY = os.getenv("MARKETSTACK_API_KEY", "")
EODHD_API_KEY = os.getenv("EODHD_API_KEY", "")
FIXER_API_KEY = os.getenv("FIXER_API_KEY", "")
USDA_FAS_API_KEY = os.getenv("USDA_FAS_API_KEY", "")

if not FINNHUB_API_KEY:
    raise ValueError("Missing Finnhub API Key. Check your .env file.")