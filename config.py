import os
from dotenv import load_dotenv

# Load variables from the hidden .env file
load_dotenv()

# Export the keys so other files can import them
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")
TWELVE_DATA_API_KEY = os.getenv("TWELVE_DATA_API_KEY")
FRED_API_KEY = os.getenv("FRED_API_KEY")
MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY", "")

if not FINNHUB_API_KEY:
    raise ValueError("Missing Finnhub API Key. Check your .env file.")