/**
 * chart.ts — Lightweight Charts abstraction layer
 * Single createChart() call for every non-TradingView chart surface.
 * TradingView stays for G/GIP/DES panels (OHLCV).
 */

const LW = () => (window as any).LightweightCharts;

const BASE_OPTS = {
  layout: {
    background: { type: 'solid', color: '#131313' },
    textColor: '#c0c8d8',
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
  },
  grid: { vertLines: { color: '#1c1c1c' }, horzLines: { color: '#1e1e1e' } },
  rightPriceScale: { borderColor: '#2c2c2c', scaleMargins: { top: 0.08, bottom: 0.08 } },
  crosshair: {
    vertLine: { color: '#3a3a3a', labelBackgroundColor: '#1e2535' },
    horzLine: { color: '#3a3a3a', labelBackgroundColor: '#1e2535' },
  },
};

const registry = new Map<string, any>();

export interface LWSeries {
  type: 'line' | 'area' | 'histogram' | 'baseline' | 'band';
  /** For time-series: { time: 'YYYY-MM-DD', value: number }
   *  For categorical: { time: number (index), value: number, color?: string }
   *  For band: data = max5yr series, bandMin = min5yr series */
  data: Array<{ time: any; value: number; color?: string }>;
  /** For type='band': the lower boundary data (min5yr) */
  bandMin?: Array<{ time: any; value: number }>;
  color?: string;
  lineWidth?: number;
  /** Render as dashed line */
  dashed?: boolean;
  priceFormat?: object;
  /** Which price scale axis to use. When any series uses 'left', left scale is auto-enabled. */
  axis?: 'left' | 'right';
}

export interface LWChartConfig {
  container: HTMLElement;
  series: LWSeries[];
  height?: number;
  timeVisible?: boolean;
  handleScroll?: boolean;
  handleScale?: boolean;
  /** Auto-fit time axis after rendering (default true) */
  fitContent?: boolean;
  /** Render Y values as percentages (e.g. yield curves) */
  pctFormat?: boolean;
  /** Categorical X-axis labels (e.g. tenor names, contract labels).
   *  When set, series data.time should be integer indices 0,1,2,… */
  categories?: string[];
}

export function createChart(id: string, cfg: LWChartConfig): any {
  destroyChart(id);

  const pctFmt = { type: 'custom', formatter: (p: number) => (+p).toFixed(2) + '%' };

  const timeScaleOpts: any = {
    borderColor: '#2c2c2c',
    timeVisible: cfg.timeVisible ?? false,
    fixLeftEdge: true,
    fixRightEdge: true,
  };
  let localizationOpts: any = {};
  if (cfg.categories) {
    const cats = cfg.categories;
    timeScaleOpts.tickMarkFormatter = (time: number) => cats[time] ?? String(time);
    localizationOpts.timeFormatter   = (time: number) => cats[time] ?? String(time);
  }

  const hasLeft = cfg.series.some(s => s.axis === 'left');

  const chart = LW().createChart(cfg.container, {
    ...BASE_OPTS,
    width: cfg.container.clientWidth,
    height: cfg.height ?? cfg.container.clientHeight ?? 200,
    timeScale: timeScaleOpts,
    localization: localizationOpts,
    handleScroll: cfg.handleScroll ?? false,
    handleScale: cfg.handleScale ?? false,
    ...(hasLeft ? { leftPriceScale: { visible: true, borderColor: '#2c2c2c', scaleMargins: { top: 0.08, bottom: 0.08 } } } : {}),
  });

  for (const s of cfg.series) {
    const fmt = s.priceFormat ?? (cfg.pctFormat ? pctFmt : undefined);
    let series: any;

    switch (s.type) {
      case 'area':
        series = chart.addAreaSeries({
          lineColor: s.color ?? '#F08C00',
          topColor: (s.color ?? '#F08C00') + '33',
          bottomColor: (s.color ?? '#F08C00') + '00',
          lineWidth: s.lineWidth ?? 1.5,
          lastValueVisible: true,
          priceLineVisible: false,
          priceFormat: fmt,
          priceScaleId: s.axis === 'left' ? 'left' : 'right',
        });
        break;
      case 'band': {
        // Seasonal min/max range band: two stacked area series.
        // Max area fills from the top down (tinted); min area fills from min down
        // with the chart background color, masking the lower portion — leaving a
        // visible shaded band between min and max.
        const bgColor   = '#131313';
        const bandColor = s.color ?? '#888888';
        const maxSeries = chart.addAreaSeries({
          lineColor:        'transparent',
          topColor:         bandColor + '28',
          bottomColor:      bandColor + '28',
          lineWidth:        1,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat:      fmt,
        });
        const minSeries = chart.addAreaSeries({
          lineColor:        'transparent',
          topColor:         bgColor,
          bottomColor:      bgColor,
          lineWidth:        1,
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat:      fmt,
        });
        minSeries.setData(s.bandMin ?? []);
        series = maxSeries;  // outer setData(s.data) fills the max series
        break;
      }
      case 'histogram':
        series = chart.addHistogramSeries({
          color: s.color ?? '#4ade80',
          lastValueVisible: true,
          priceLineVisible: false,
          priceFormat: fmt,
          priceScaleId: s.axis === 'left' ? 'left' : 'right',
        });
        break;
      case 'baseline':
        series = chart.addBaselineSeries({
          baseValue: { type: 'price', price: 0 },
          topLineColor: '#4ade80',
          bottomLineColor: '#f87171',
          lastValueVisible: true,
          priceLineVisible: false,
          priceFormat: fmt,
        });
        break;
      default: // line
        series = chart.addLineSeries({
          color: s.color ?? '#F08C00',
          lineWidth: s.lineWidth ?? 1.5,
          lineStyle: s.dashed ? 2 : 0,
          lastValueVisible: true,
          priceLineVisible: false,
          priceFormat: fmt,
          priceScaleId: s.axis === 'left' ? 'left' : 'right',
        });
    }

    series.setData(s.data);
  }

  if (cfg.fitContent !== false) {
    chart.timeScale().fitContent();
  }

  registry.set(id, chart);

  new ResizeObserver(() => {
    chart.applyOptions({
      width: cfg.container.clientWidth,
      height: cfg.container.clientHeight || cfg.height || 200,
    });
  }).observe(cfg.container);

  return chart;
}

export function destroyChart(id: string) {
  const existing = registry.get(id);
  if (existing) {
    try { existing.remove(); } catch (_) {}
    registry.delete(id);
  }
}

export function getChart(id: string) {
  return registry.get(id);
}
