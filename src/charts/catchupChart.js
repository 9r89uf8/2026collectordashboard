import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  DEFAULT_CHART_PALETTE,
  createCatchupChartOptions,
} from "./catchupChartOptions.js";

echarts.use([
  LineChart,
  ScatterChart,
  AriaComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COMPACT_BREAKPOINT_PX = 680;

const CSS_PALETTE_PROPERTIES = Object.freeze({
  page: "--page",
  panel: "--panel",
  panelRaised: "--panel-raised",
  grid: "--grid",
  text: "--text",
  muted: "--muted",
  actual: "--actual",
  futures: "--futures",
  projected: "--projected",
  baseline: "--baseline",
  threshold: "--threshold",
  positive: "--positive",
  negative: "--negative",
});

function readChartPalette(element) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return DEFAULT_CHART_PALETTE;
  }

  const styles = window.getComputedStyle(element);
  const palette = {};
  for (const [key, property] of Object.entries(CSS_PALETTE_PROPERTIES)) {
    palette[key] = styles.getPropertyValue(property).trim() || DEFAULT_CHART_PALETTE[key];
  }
  return palette;
}

function currentWidth(container) {
  const width = container.getBoundingClientRect?.().width ?? container.clientWidth;
  return Number.isFinite(width) && width > 0 ? width : 900;
}

function chartContextKey(value) {
  const market = value?.market ?? value?.window ?? {};
  const mode = value?.mode ?? "unknown";
  const marketId =
    value?.marketId ??
    value?.market_id ??
    market.marketId ??
    market.market_id ??
    market.id ??
    "unknown";
  const startMs =
    value?.marketStartMs ??
    value?.market_start_ms ??
    market.startMs ??
    market.marketStartMs ??
    market.market_start_ms ??
    "unknown";
  const endMs =
    value?.marketEndMs ??
    value?.market_end_ms ??
    market.endMs ??
    market.marketEndMs ??
    market.market_end_ms ??
    "unknown";
  return `${mode}:${marketId}:${startMs}:${endMs}`;
}

function reducedMotionMedia() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function subscribeToMedia(media, listener) {
  if (!media) return () => {};
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener?.(listener);
  return () => media.removeListener?.(listener);
}

/**
 * Mounts an ECharts instance with responsive resize and reduced-motion
 * handling. The controller deliberately accepts normalized data only.
 */
export function createCatchupChart(container, options = {}) {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError("createCatchupChart requires a chart container element.");
  }

  const media = options.reducedMotionMedia ?? reducedMotionMedia();
  const existing = echarts.getInstanceByDom(container);
  const chart = existing ?? echarts.init(container, options.theme ?? null, {
    renderer: "canvas",
    useDirtyRect: true,
    devicePixelRatio: options.devicePixelRatio,
  });
  let disposed = false;
  let model = null;
  let resizeFrame = null;
  let lastWidth = currentWidth(container);
  let compact = lastWidth < COMPACT_BREAKPOINT_PX;
  let legendSelected = {};
  let activeContextKey = null;

  container.classList.add("chart-canvas--ready");
  container.dataset.chart = "oracle-catch-up";

  function runtime() {
    const width = currentWidth(container);
    return {
      palette: readChartPalette(container),
      containerWidth: width,
      compact: width < COMPACT_BREAKPOINT_PX,
      reducedMotion: media?.matches === true,
      legendSelected,
    };
  }

  function render(nextModel = model) {
    if (disposed) throw new Error("Cannot render a disposed catch-up chart.");
    if (!nextModel) return;
    const nextContextKey = chartContextKey(nextModel);
    if (activeContextKey !== null && nextContextKey !== activeContextKey) {
      legendSelected = {};
    }
    activeContextKey = nextContextKey;
    model = nextModel;
    chart.setOption(createCatchupChartOptions(model, runtime()), {
      notMerge: true,
      lazyUpdate: false,
      silent: false,
    });
  }

  function resize() {
    if (disposed) return;
    const width = currentWidth(container);
    const nextCompact = width < COMPACT_BREAKPOINT_PX;
    chart.resize({ animation: { duration: 0 } });

    // Rebuild layout only when it materially changed. Ordinary pixel changes
    // are handled by ECharts' resize; breakpoint and text-width changes need
    // fresh options for the legend note and grid inset.
    if (model && (nextCompact !== compact || Math.abs(width - lastWidth) >= 24)) {
      lastWidth = width;
      compact = nextCompact;
      render();
    } else {
      lastWidth = width;
      compact = nextCompact;
    }
  }

  function queueResize() {
    if (resizeFrame !== null) return;
    const requestFrame = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    resizeFrame = requestFrame(() => {
      resizeFrame = null;
      resize();
    });
  }

  function handleLegendSelection(event) {
    legendSelected = { ...event.selected };
  }

  chart.on("legendselectchanged", handleLegendSelection);

  const ResizeObserverConstructor = options.ResizeObserver ?? globalThis.ResizeObserver;
  const resizeObserver = ResizeObserverConstructor
    ? new ResizeObserverConstructor(queueResize)
    : null;
  resizeObserver?.observe(container);
  if (!resizeObserver && typeof window !== "undefined") {
    window.addEventListener("resize", queueResize, { passive: true });
  }

  const unsubscribeMotion = subscribeToMedia(media, () => {
    if (model) render();
  });

  const controller = {
    chart,
    render,
    update: render,
    setModel: render,
    resize,
    clear() {
      if (disposed) return;
      model = null;
      activeContextKey = null;
      legendSelected = {};
      chart.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      if (!resizeObserver && typeof window !== "undefined") {
        window.removeEventListener("resize", queueResize);
      }
      unsubscribeMotion();
      chart.off("legendselectchanged", handleLegendSelection);
      if (resizeFrame !== null) {
        const cancelFrame = globalThis.cancelAnimationFrame ?? clearTimeout;
        cancelFrame(resizeFrame);
      }
      container.classList.remove("chart-canvas--ready");
      delete container.dataset.chart;
      chart.dispose();
    },
  };

  if (options.initialModel) render(options.initialModel);
  return controller;
}

export const mountCatchupChart = createCatchupChart;

export { createCatchupChartOptions } from "./catchupChartOptions.js";

export default createCatchupChart;
