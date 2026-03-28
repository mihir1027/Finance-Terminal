// Ambient declarations for per-window state stored on `window`
// These are set dynamically by panel renderers; TypeScript just needs to know they exist.

interface Window {
  // Per-window function stores (keyed by window ID)
  _fat: ((tabIndex: number) => void) | undefined;
  _hdt: ((tabIndex: number) => void) | undefined;
  _desTb: Record<string, { setMode: Function; setInt: Function; setType: Function }> | undefined;
  _paletteExec: ((idx: number) => void) | undefined;
  _ecalNav: ((dir: number) => void) | undefined;

  // Per-window TradingView / chart state
  [key: `_tvInt_${string}`]: ((interval: string) => void) | undefined;
  [key: `_tvType_${string}`]: ((type: string) => void) | undefined;
  [key: `_tvPop_${string}`]: ((sym: string) => void) | undefined;

  // PDF/preference state
  _pdfChartUp: string | undefined;
  _pdfChartDown: string | undefined;
  _sentThresh: number | undefined;

  // Panel workspace state
  _predCharts: Record<string, any> | undefined;
  _eqsWS: Record<string, any> | undefined;
  _gcLw: Record<string, any> | undefined;
  _modl: Record<string, any> | undefined;
  _sovm: Record<string, any> | undefined;

  // External chart libraries (loaded via CDN <script> tags)
  LightweightCharts: any;
  TradingView: any;
}
