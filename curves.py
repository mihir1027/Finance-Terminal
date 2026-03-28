import requests
import yfinance as yf
import finnhub
import datetime
from config import FINNHUB_API_KEY

# Connect to Finnhub securely
finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)


def get_ust_yield_curve():
    """Fetches the official US Treasury Yield Curve."""
    url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/yield_curve?sort=-record_date&page[size]=1"
    try:
        response = requests.get(url).json()
        data = response['data'][0]

        maturities = {
            '1 Mo': data.get('bc_1month'), '2 Mo': data.get('bc_2month'),
            '3 Mo': data.get('bc_3month'), '6 Mo': data.get('bc_6month'),
            '1 Yr': data.get('bc_1year'), '2 Yr': data.get('bc_2year'),
            '3 Yr': data.get('bc_3year'), '5 Yr': data.get('bc_5year'),
            '7 Yr': data.get('bc_7year'), '10 Yr': data.get('bc_10year'),
            '20 Yr': data.get('bc_20year'), '30 Yr': data.get('bc_30year')
        }

        curve = {k: float(v) for k, v in maturities.items() if v is not None}
        return curve, data.get('record_date')
    except Exception as e:
        print(f"Error fetching UST curve: {e}")
        return {}, None


def get_real_futures_curve(base_symbol="CL", exchange=".NYM", num_months=6):
    """Dynamically rolls through CME contract months to build a forward curve."""
    month_codes = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']

    current_date = datetime.datetime.now()
    current_month_idx = current_date.month - 1
    current_year = current_date.year % 100

    curve_data = {}

    # 1. Front Month (Continuous)
    try:
        front_price = yf.Ticker(f"{base_symbol}=F").history(period="1d")['Close'].iloc[-1]
        curve_data['Spot/Front'] = round(front_price, 2)
    except:
        pass

    # 2. Build the forward months
    for i in range(1, num_months + 1):
        target_month_idx = (current_month_idx + i) % 12
        target_year = current_year + ((current_month_idx + i) // 12)

        code = month_codes[target_month_idx]
        ticker_str = f"{base_symbol}{code}{target_year}{exchange}"

        try:
            hist = yf.Ticker(ticker_str).history(period="1d")
            if not hist.empty:
                curve_data[f"{code}{target_year}"] = round(hist['Close'].iloc[-1], 2)
        except:
            continue

    return curve_data


def get_spot_finnhub(symbol):
    """Fetches real-time spot prices from Finnhub."""
    try:
        quote = finnhub_client.quote(symbol)
        if quote and quote.get('c', 0) > 0:
            return quote['c']
    except:
        pass
    return "N/A"