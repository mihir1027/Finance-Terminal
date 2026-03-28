import msvcrt
import pandas as pd
import matplotlib.pyplot as plt
from curves import get_ust_yield_curve, get_real_futures_curve, get_spot_finnhub

# Mapping string maturities to actual mathematical time (in years) to fix the X-Axis
MATURITY_YEARS = {
    '1 Mo': 1 / 12, '2 Mo': 2 / 12, '3 Mo': 3 / 12, '6 Mo': 0.5,
    '1 Yr': 1.0, '2 Yr': 2.0, '3 Yr': 3.0, '5 Yr': 5.0,
    '7 Yr': 7.0, '10 Yr': 10.0, '20 Yr': 20.0, '30 Yr': 30.0
}

# The commodity database
COMMODITIES = {
    "1": {"name": "WTI Crude Oil", "symbol": "CL", "exchange": ".NYM"},
    "2": {"name": "Natural Gas", "symbol": "NG", "exchange": ".NYM"},
    "3": {"name": "Gold", "symbol": "GC", "exchange": ".CMX"},
    "4": {"name": "Silver", "symbol": "SI", "exchange": ".CMX"},
    "5": {"name": "Corn", "symbol": "ZC", "exchange": ".CBT"}
}


def display_terminal(ust_curve, ust_date, futures_curve, eur_usd_spot, comm_name):
    print("\n" + "=" * 50)
    print(f" US TREASURY YIELD CURVE (As of {ust_date})")
    print("=" * 50)
    if ust_curve:
        print(pd.DataFrame(list(ust_curve.items()), columns=['Maturity', 'Yield (%)']).to_string(index=False))

    print("\n" + "=" * 50)
    print(f" COMMODITIES FUTURES CURVE ({comm_name})")
    print("=" * 50)
    if futures_curve:
        print(pd.DataFrame(list(futures_curve.items()), columns=['Contract', 'Price (USD)']).to_string(index=False))

    print("\n" + "=" * 50)
    print(" CURRENCIES SPOT (Finnhub Data)")
    print("=" * 50)
    print(f" EUR/USD Spot:  {eur_usd_spot}")
    print("=" * 50 + "\n")


def plot_curves(ust_curve, futures_curve, comm_name):
    # Use a highly professional plotting style
    plt.style.use('dark_background')
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    fig.patch.set_facecolor('#121212')

    if ust_curve:
        # Plot mathematically accurate X-values
        x_values = [MATURITY_YEARS[k] for k in ust_curve.keys()]
        y_values = list(ust_curve.values())

        ax1.plot(x_values, y_values, marker='o', color='#00ff00', linewidth=2)
        ax1.set_title("US Treasury Yield Curve", color='white', pad=15)
        ax1.set_ylabel("Yield (%)", color='white')

        # Keep the readable labels but put them at the right spacing
        ax1.set_xticks(x_values)
        ax1.set_xticklabels(list(ust_curve.keys()), rotation=45, color='lightgrey')
        ax1.grid(True, linestyle='--', alpha=0.3)
        ax1.set_facecolor('#1e1e1e')

    if futures_curve:
        ax2.plot(list(futures_curve.keys()), list(futures_curve.values()), marker='s', color='#ff3333', linewidth=2)
        ax2.set_title(f"{comm_name} Forward Curve", color='white', pad=15)
        ax2.set_ylabel("Price (USD)", color='white')
        ax2.tick_params(axis='x', rotation=45, colors='lightgrey')
        ax2.tick_params(axis='y', colors='lightgrey')
        ax2.grid(True, linestyle='--', alpha=0.3)
        ax2.set_facecolor('#1e1e1e')

    plt.tight_layout()
    plt.show()


# F1–F5 scan codes from msvcrt on Windows
_FKEY_MAP = {
    b'\x3b': "1",  # F1
    b'\x3c': "2",  # F2
    b'\x3d': "3",  # F3
    b'\x3e': "4",  # F4
    b'\x3f': "5",  # F5
}

def _read_fkey():
    """Block until the user presses F1–F5 and return the matching commodity key."""
    while True:
        ch = msvcrt.getch()
        # Special keys arrive as 0x00 or 0xe0 followed by a scan code byte
        if ch in (b'\x00', b'\xe0'):
            scan = msvcrt.getch()
            if scan in _FKEY_MAP:
                return _FKEY_MAP[scan]


def main():
    print("=========================================")
    print("             MACRO TERMINAL              ")
    print("=========================================\n")

    print("Available Commodities:")
    for key, data in COMMODITIES.items():
        print(f"  [F{key}] {data['name']}")

    print("\nPress F1–F5 to select a commodity: ", end="", flush=True)
    choice = _read_fkey()
    print(f"F{choice}")  # echo the pressed key

    selected_comm = COMMODITIES[choice]

    print(f"\n[ SYSTEM ] Fetching official UST Data...")
    print(f"[ SYSTEM ] Pulling CME Contract Chain for {selected_comm['name']}...")
    print(f"[ SYSTEM ] Pinging Finnhub for Spot FX...\n")

    # Run the data engine
    ust_curve, ust_date = get_ust_yield_curve()
    futures_curve = get_real_futures_curve(selected_comm['symbol'], selected_comm['exchange'], 6)
    eur_usd_spot = get_spot_finnhub("OANDA:EUR_USD")

    # Display results
    display_terminal(ust_curve, ust_date, futures_curve, eur_usd_spot, selected_comm['name'])
    plot_curves(ust_curve, futures_curve, selected_comm['name'])


if __name__ == "__main__":
    main()