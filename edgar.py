import requests
import pandas as pd

# --- SEC REQUIRED HEADER ---
# You MUST change this to your actual name and email, or the SEC will block you.
SEC_HEADERS = {
    'User-Agent': 'Mihir TerminalProject (mihir1027@gmail.com)'
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


# --- Quick Local Test ---
if __name__ == "__main__":
    print("Pinging the SEC EDGAR Database...")
    filings_df, company_name = get_recent_filings("AAPL")

    if filings_df is not None:
        print(f"\nRecent Filings for {company_name}:")
        print(filings_df.to_string(index=False))
    else:
        print(company_name)  # This prints the error message if it failed