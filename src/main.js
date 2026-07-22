import './styles/index.css'

import { shadowEvaluationsDownloadUrl } from './api/shadowEvaluations.js'
import { dashboardConfig } from './config.js'
import { createCatchupChart } from './charts/catchupChart.js'
import { createForecastErrorChart } from './charts/forecastErrorChart.js'
import { LiveController } from './controllers/liveController.js'
import { RecentController } from './controllers/recentController.js'
import { normalizeMarketWindow } from './domain/marketWindow.js'
import {
  buildShadowSeries,
  chooseOpeningThreshold,
  deriveLiveGhost,
  normalizeContextActualSeries,
} from './domain/shadowSeries.js'
import { buildForecastPerformanceModel } from './domain/forecastPerformance.js'
import {
  createDashboardStore,
  createInitialDashboardState,
  createResource,
} from './state/dashboardStore.js'
import { readDashboardRoute, writeDashboardRoute } from './state/routeState.js'
import { mountAppShell } from './views/appShell.js'
import { renderCoverageStrip } from './views/coverageStrip.js'
import { renderForecastPerformance } from './views/forecastPerformanceCard.js'
import { renderHeader } from './views/header.js'
import { renderMarketControls } from './views/marketControls.js'
import { renderPointsTable } from './views/pointsTable.js'
import { renderSignalCard } from './views/signalCard.js'
import { renderStatusBanner } from './views/statusBanner.js'
import {
  createLiveSignalViewModel,
  createPointTableRows,
  createRecentSignalViewModel,
  shortIdentity,
} from './viewModels/dashboardViewModel.js'

const HISTORICAL_LABEL = 'Configured candidate — historical primary unverified'

function emptyIdentity(reason = 'Selection identity pending') {
  return {
    projectionVisible: true,
    code: 'pending',
    reason,
    lineLabel: HISTORICAL_LABEL,
    verifiedPrimary: false,
    selectionIdentity: null,
  }
}

function resetModeResources() {
  return {
    discovery: createResource(),
    live: createResource(),
    evaluations: createResource(),
    context: createResource(),
    sources: createResource(),
  }
}

function resetMarketResources(resources) {
  return {
    ...resources,
    evaluations: createResource(),
    context: createResource(),
    sources: createResource(),
  }
}

function resourceLastSuccess(resources) {
  return Math.max(
    0,
    ...Object.values(resources).map((resource) => resource.lastSuccessMs || 0),
  ) || null
}

function connectionState(state) {
  const resources = Object.values(state.resources)
  const hasError = resources.some((resource) => resource.status === 'error' || resource.error !== null)
  const primaryNames = state.mode === 'live'
    ? ['live', 'evaluations', 'context']
    : ['evaluations', 'context']
  const primary = primaryNames.map((name) => state.resources[name])
  const hasPrimarySuccess = primary.some((resource) => resource.status === 'success')
  const hasPrimaryError = primary.some(
    (resource) => resource.status === 'error' || resource.error !== null,
  )

  if (!hasPrimarySuccess && hasPrimaryError) return 'offline'
  if (hasPrimarySuccess && hasError) return 'degraded'
  if (hasPrimarySuccess) return 'online'
  if (hasError) return 'offline'
  return 'connecting'
}

function liveSignal(payload) {
  return payload?.signals?.chainlink_catchup ?? null
}

function hasLineValue(points = []) {
  return points.some((point) => point?.plotValue !== null && point?.value !== null)
}

function fallbackShadowModel({ market, context, sources, live, mode }) {
  const signal = liveSignal(live)
  const mismatch = signal?.model_version && signal.model_version !== dashboardConfig.primaryModelVersion
  const identity = mismatch
    ? {
        projectionVisible: false,
        code: 'configured-live-model-mismatch',
        reason: `Configured model ${dashboardConfig.primaryModelVersion} does not match live model ${signal.model_version}. Projections are hidden.`,
        banner: `Configured model ${dashboardConfig.primaryModelVersion} does not match live model ${signal.model_version}. Projections are hidden.`,
        lineLabel: HISTORICAL_LABEL,
      }
    : emptyIdentity()

  const contextualActual = normalizeContextActualSeries(context, market)
  const result = {
    market,
    actual: [],
    futures: [],
    projected: [],
    baseline: [],
    error: [],
    points: [],
    separators: [],
    stats: {
      attempts: 0,
      scored: 0,
      invalid: 0,
      validWithoutActual: 0,
      futuresMatched: 0,
      futuresMissing: 0,
    },
    identity,
    projectionVisible: identity.projectionVisible,
    threshold: chooseOpeningThreshold(context, sources),
  }
  result.series = { actual: [], futures: [], projected: [], baseline: [], error: [], contextualActual }
  result.ghost = mode === 'live'
    ? deriveLiveGhost(live, {
        market,
        maturedPoints: [],
        configuredModelVersion: dashboardConfig.primaryModelVersion,
        identity,
      })
    : null
  return result
}

function chartDataFromState(state) {
  const market = normalizeMarketWindow(state.market)
  if (!market) return null

  const evaluations = state.resources.evaluations.data
  const context = state.resources.context.data
  const sources = state.resources.sources.data
  const live = state.resources.live.data

  const shadow = evaluations
    ? buildShadowSeries(evaluations, {
        market,
        configuredModelVersion: dashboardConfig.primaryModelVersion,
        livePayload: state.mode === 'live' ? live : null,
        mode: state.mode,
        isCurrentMarket: state.mode === 'live',
        contextualData: context,
        sources,
      })
    : fallbackShadowModel({ market, context, sources, live, mode: state.mode })

  return {
    market,
    shadow,
    chartModel: {
      mode: state.mode,
      market,
      shadowSeries: shadow,
      contextualActual: shadow.series?.contextualActual || [],
      liveGhost: shadow.ghost,
      threshold: shadow.threshold,
      projectionVisible: shadow.projectionVisible,
    },
  }
}

function coverageFrom(state, shadow) {
  const apiCoverage = state.resources.evaluations.data?.coverage
  if (apiCoverage) return apiCoverage

  const cadence = state.resources.evaluations.data?.model?.evaluation_cadence_ms
  const windowBuckets = Number.isFinite(cadence) && cadence > 0
    ? Math.floor(shadow.market.durationMs / cadence)
    : 0
  return {
    window_buckets: windowBuckets,
    observed_buckets: shadow.stats.attempts,
    attempts: shadow.stats.attempts,
    scored: shadow.stats.scored,
    invalid: shadow.stats.invalid,
    valid_without_actual: shadow.stats.validWithoutActual,
    unobserved_buckets_as_of_response: null,
  }
}

function statusFor(state, chartData) {
  const resources = state.resources
  const shadow = chartData?.shadow

  if (shadow?.identity?.projectionVisible === false) {
    const selectionMismatch = [
      'current-selection-identity-mismatch',
      'live-selection-unverified',
      'live-selection-identity-invalid',
    ].includes(shadow.identity.code)
    return {
      kind: 'error',
      title: shadow.identity.code === 'selection-change'
        ? 'Selection changed during this market'
        : selectionMismatch
          ? 'Configured/live selection mismatch'
          : 'Projection configuration mismatch',
      message: shadow.identity.banner || shadow.identity.reason,
    }
  }

  const connection = connectionState(state)
  if (connection === 'offline') {
    const lastSuccess = resourceLastSuccess(resources)
    return {
      kind: 'error',
      title: 'API unavailable',
      message: lastSuccess
        ? `The private API tunnel is not responding. Last successful response: ${new Date(lastSuccess).toISOString()}.`
        : 'The private API tunnel is not responding. Keep the SSH port-forward open and retry.',
    }
  }

  if (resources.live.status === 'error' && state.mode === 'live') {
    return {
      kind: 'warning',
      title: 'Live feed unavailable',
      message: 'Retained evaluations, including forecast-time futures inputs, remain visible; the live signal and future ghost are not fresh.',
    }
  }

  if (resources.evaluations.status === 'error') {
    return {
      kind: 'warning',
      title: 'Projection history unavailable',
      message: 'The paired evaluation route failed. Healthy live or one-second context remains visible.',
    }
  }

  if (resources.context.status === 'error' && resources.evaluations.data) {
    return {
      kind: 'info',
      title: 'One-second context unavailable',
      message: 'Paired actual and projected evidence is still available for this market.',
    }
  }

  if (
    state.mode === 'recent' &&
    resources.evaluations.status === 'success' &&
    Array.isArray(resources.evaluations.data?.points) &&
    resources.evaluations.data.points.length === 0
  ) {
    return {
      kind: 'info',
      title: 'Projection history not retained',
      message: 'No projection history is retained for this market. Actual Chainlink data is still available.',
    }
  }

  if (state.banner) return state.banner
  return null
}

class DashboardApplication {
  constructor(root) {
    const route = readDashboardRoute()
    this.refs = mountAppShell(root)
    this.store = createDashboardStore({
      ...createInitialDashboardState(route.mode),
      selectedMarketId: route.selectedMarketId,
    })
    this.chart = createCatchupChart(this.refs.chart)
    this.errorChart = null
    this.liveController = new LiveController({
      modelVersion: dashboardConfig.primaryModelVersion,
      onEvent: (event) => this.handleControllerEvent(event),
    })
    this.recentController = new RecentController({
      modelVersion: dashboardConfig.primaryModelVersion,
      onEvent: (event) => this.handleControllerEvent(event),
    })

    this.unsubscribe = this.store.subscribe((state) => this.render(state))
    this.bindEvents()
    this.render(this.store.getState())
    this.applyRoute(route)
    this.clockTimer = window.setInterval(() => this.renderClock(), 1000)
  }

  bindEvents() {
    this.refs.modeButtons.forEach((button) => {
      button.addEventListener('click', () => this.setMode(button.dataset.mode))
    })
    this.refs.previousButton.addEventListener('click', () => this.moveRecent(1))
    this.refs.nextButton.addEventListener('click', () => this.moveRecent(-1))
    this.refs.refreshButton.addEventListener('click', () => this.recentController.refreshSelected())
    window.addEventListener('popstate', () => this.applyRoute(readDashboardRoute()))
    window.addEventListener('beforeunload', () => this.dispose(), { once: true })
  }

  applyRoute(route) {
    if (route.mode === 'live') {
      this.recentController.stop()
      this.store.setState((state) => ({
        ...state,
        mode: 'live',
        selectedMarketId: null,
        market: null,
        banner: null,
        resources: resetModeResources(),
      }))
      this.liveController.start()
      return
    }

    this.liveController.stop()
    this.store.setState((state) => ({
      ...state,
      mode: 'recent',
      selectedMarketId: route.selectedMarketId,
      market: null,
      banner: null,
      resources: resetModeResources(),
    }))
    void this.recentController.start(route.selectedMarketId)
  }

  setMode(mode) {
    if (mode !== 'live' && mode !== 'recent') return
    const state = this.store.getState()
    if (state.mode === mode) return
    writeDashboardRoute({ mode, selectedMarketId: null })
    this.applyRoute({ mode, selectedMarketId: null })
  }

  moveRecent(offset) {
    const state = this.store.getState()
    if (state.mode !== 'recent') return
    const index = state.markets.findIndex((market) => market.marketId === state.selectedMarketId)
    const target = state.markets[index + offset]
    if (!target) return

    writeDashboardRoute({ mode: 'recent', selectedMarketId: target.marketId })
    void this.recentController.selectMarket(target.marketId)
  }

  handleControllerEvent(event) {
    const state = this.store.getState()
    if (event.source !== state.mode) return

    if (event.type === 'resource') {
      if (
        (event.name === 'live' || event.name === 'evaluations') &&
        event.status === 'loading' &&
        state.resources[event.name].data !== null
      ) {
        return
      }
      const now = Date.now()
      this.store.setState((current) => {
        const previous = current.resources[event.name] || createResource()
        const resource = event.status === 'success'
          ? {
              ...previous,
              status: 'success',
              data: event.data,
              error: null,
              lastSuccessMs: now,
            }
          : event.status === 'error'
            ? { ...previous, status: 'error', error: event.error }
            : { ...previous, status: 'loading' }

        return {
          ...current,
          resources: { ...current.resources, [event.name]: resource },
          serverTimeMs: Number.isFinite(event.serverTimeMs) ? event.serverTimeMs : current.serverTimeMs,
          serverTimeObservedAt: Number.isFinite(event.serverTimeMs) ? now : current.serverTimeObservedAt,
        }
      })
      return
    }

    if (event.type === 'markets') {
      this.store.setState({ markets: event.markets })
      return
    }

    if (event.type === 'market') {
      this.store.setState((current) => {
        const changed = current.selectedMarketId !== event.market.marketId
        const changedResources = changed ? resetMarketResources(current.resources) : current.resources
        return {
          ...current,
          selectedMarketId: event.market.marketId,
          market: event.market,
          banner: null,
          resources:
            changed && current.mode === 'live'
              ? { ...changedResources, live: { ...createResource(), status: 'loading' } }
              : changedResources,
        }
      })

      if (state.mode === 'recent') {
        const route = readDashboardRoute()
        if (route.selectedMarketId !== event.market.marketId) {
          writeDashboardRoute(
            { mode: 'recent', selectedMarketId: event.market.marketId },
            { replace: route.selectedMarketId === null },
          )
        }
      }
      return
    }

    if (event.type === 'market-missing') {
      this.store.setState({
        banner: {
          kind: 'warning',
          title: 'Recent market no longer available',
          message: 'Discovery is being refreshed. Use the previous-market arrow to choose another completed market.',
        },
      })
      return
    }

    if (event.type === 'selection-empty') {
      this.store.setState({
        banner: {
          kind: 'info',
          title: 'No completed markets discovered',
          message: 'Recent mode will be available after a completed market is returned by the API.',
        },
      })
    }
  }

  serverNow(state = this.store.getState()) {
    if (!Number.isFinite(state.serverTimeMs) || !Number.isFinite(state.serverTimeObservedAt)) return null
    return state.serverTimeMs + Math.max(0, Date.now() - state.serverTimeObservedAt)
  }

  renderClock() {
    const state = this.store.getState()
    renderHeader(this.refs, {
      connection: connectionState(state),
      serverTimeMs: this.serverNow(state),
      lastSuccessMs: resourceLastSuccess(state.resources),
    })
  }

  render(state) {
    const data = chartDataFromState(state)
    const marketIndex = state.markets.findIndex((market) => market.marketId === state.selectedMarketId)
    const busy = Object.values(state.resources).some((resource) => resource.status === 'loading')
    const chartTitle = 'Actual vs projected Chainlink and forecast futures'
    const selectedMarket = data?.market || state.market
    const selectedMarketId = selectedMarket?.marketId ?? selectedMarket?.market_id
    const evaluationReport = state.resources.evaluations.data
    const evaluationMarket = normalizeMarketWindow(evaluationReport?.market)
    const completed =
      state.mode === 'recent' &&
      Number.isSafeInteger(selectedMarketId) &&
      selectedMarketId >= 0 &&
      evaluationMarket?.marketId === selectedMarketId &&
      evaluationReport?.coverage?.market_window_elapsed === true
    const downloadUrl = completed
      ? shadowEvaluationsDownloadUrl(selectedMarketId, dashboardConfig.primaryModelVersion)
      : null

    this.renderClock()
    this.refs['chart-title'].textContent = chartTitle
    this.refs.chart.setAttribute(
      'aria-label',
      `Horizontally scrollable ${chartTitle} chart. Use the timeline control to inspect the full five-minute market.`,
    )
    renderMarketControls(this.refs, {
      mode: state.mode,
      market: data?.market || state.market,
      marketIndex,
      marketCount: state.markets.length,
      busy,
      completed,
      downloadUrl,
    })
    renderStatusBanner(this.refs, statusFor(state, data))

    if (!data) {
      this.chart.clear()
      this.refs['chart-stage'].setAttribute('aria-busy', String(busy))
      this.refs['chart-empty'].hidden = false
      this.refs['empty-title'].textContent = state.mode === 'live' ? 'Waiting for current market' : 'Choose a recent market'
      this.refs['empty-copy'].textContent = connectionState(state) === 'offline'
        ? 'Open the private SSH tunnel to reconnect the dashboard API.'
        : 'The chart window will lock as soon as the API returns a market identity.'
      renderCoverageStrip(this.refs, null, { live: state.mode === 'live' })
      renderForecastPerformance(this.refs, null, {
        resource: state.resources.evaluations,
      })
      this.errorChart?.clear()
      this.refs['error-strip'].hidden = true
      renderSignalCard(
        this.refs,
        state.mode === 'live'
          ? createLiveSignalViewModel({
              live: state.resources.live.data,
              config: dashboardConfig,
              identity: emptyIdentity(),
            })
          : createRecentSignalViewModel([]),
      )
      renderPointsTable(this.refs, [])
      this.refs['chart-summary'].textContent = 'No market evidence is currently displayed.'
      return
    }

    const { shadow, chartModel, market } = data
    const contextualActual = shadow.series?.contextualActual || []
    const futures = shadow.futures || []
    const contextualActualVisibleByDefault = (shadow.points || []).length === 0
    const hasEvidence =
      hasLineValue(shadow.actual) ||
      hasLineValue(futures) ||
      hasLineValue(shadow.projected) ||
      (contextualActualVisibleByDefault && hasLineValue(contextualActual)) ||
      Boolean(shadow.ghost)
    const chartBusy =
      !hasEvidence &&
      [state.resources.evaluations, state.resources.context].some((resource) => resource.status === 'loading')

    this.chart.update(chartModel)
    this.refs['chart-stage'].setAttribute('aria-busy', String(chartBusy))
    this.refs['chart-empty'].hidden = hasEvidence
    this.refs['chart-panel'].classList.toggle(
      'dimmed',
      connectionState(state) === 'offline' && hasEvidence,
    )
    this.refs['empty-title'].textContent = state.mode === 'live' ? 'No evidence observed yet' : 'No retained price evidence'
    this.refs['empty-copy'].textContent = state.mode === 'live'
      ? 'The fixed market window is ready and will grow as observations mature.'
      : 'This market has no paired evaluations or one-second actual context to plot.'

    this.refs['chart-meta'].textContent = `Market ${market.marketId ?? '—'} · ${shadow.stats.scored} scored · scrollable 05:00 · starts at 60s`
    const futuresAvailable = futures.filter(
      (point) => point?.separator !== true && Number.isFinite(point?.plotValue),
    ).length
    const futuresMissing = futures.filter(
      (point) => point?.separator !== true && !Number.isFinite(point?.plotValue),
    ).length
    const futuresSummary = ` ${futuresAvailable} forecast rows include a persisted futures input and ${futuresMissing} render a futures gap.`
    const visibleSeriesSummary = shadow.projectionVisible
      ? 'Actual Chainlink, projected Chainlink, and persisted futures-at-forecast inputs are visible when retained.'
      : 'Projection rendering is suppressed because identity validation failed; actual Chainlink and persisted futures-at-forecast inputs remain visible.'
    this.refs['chart-summary'].textContent = `Market ${market.marketId ?? 'unknown'} contains ${shadow.stats.attempts} retained attempts, ${shadow.stats.scored} scored forecast points, and ${shadow.stats.invalid} invalid attempts.${futuresSummary} ${visibleSeriesSummary}`

    const signalView = state.mode === 'live'
      ? createLiveSignalViewModel({
          live: state.resources.live.data,
          config: dashboardConfig,
          identity: shadow.identity,
        })
      : shadow.identity.projectionVisible === false
        ? {
            kicker: 'Selected evidence',
            title: 'Projection hidden',
            state: 'invalid',
            stateLabel: 'Actual only',
            heroValue: '—',
            heroCaption: shadow.identity.reason,
            metrics: [],
          }
        : createRecentSignalViewModel(shadow.points)
    renderSignalCard(this.refs, signalView)
    renderCoverageStrip(this.refs, coverageFrom(state, shadow), { live: state.mode === 'live' })
    renderPointsTable(this.refs, createPointTableRows(shadow.points))

    const evaluations = state.resources.evaluations.data
    const performanceModel = evaluations
      ? buildForecastPerformanceModel(evaluations, {
          requestedMarketId: market.marketId,
          configuredModelVersion: dashboardConfig.primaryModelVersion,
          identity: shadow.identity,
        })
      : null
    renderForecastPerformance(this.refs, performanceModel, {
      resource: state.resources.evaluations,
    })

    const errorSeries = shadow.error ?? shadow.series?.error ?? []
    const scoredErrors = errorSeries.filter(
      (point) => point?.plotValue !== null && Number.isFinite(point?.plotValue),
    )
    const errorStripVisible = Boolean(evaluations) && shadow.projectionVisible === true
    this.refs['error-strip'].hidden = !errorStripVisible
    this.refs['error-strip'].classList.toggle(
      'dimmed',
      errorStripVisible && state.resources.evaluations.status === 'error',
    )
    if (errorStripVisible) {
      this.errorChart ??= createForecastErrorChart(this.refs['error-chart'])
      this.errorChart.update(chartModel)
      this.refs['error-empty'].hidden = scoredErrors.length > 0
      this.refs['error-empty'].textContent = state.mode === 'live'
        ? 'Waiting for causally scored forecast errors.'
        : 'No causally scored forecast errors are retained for this market.'
      this.refs['error-summary'].textContent = scoredErrors.length > 0
        ? `${scoredErrors.length} signed forecast errors are plotted at their target times. Positive values are above actual and negative values are below actual.`
        : 'No signed forecast errors are displayed.'
    } else {
      this.errorChart?.clear()
    }

    const horizonMs = evaluations?.model?.horizon_ms ?? liveSignal(state.resources.live.data)?.horizon_ms ?? 3000
    const identity = shadow.identity.selectionIdentity || shadow.identity.liveIdentity
    this.refs['footer-model'].textContent = dashboardConfig.primaryModelVersion
    this.refs['footer-horizon'].textContent = `${(horizonMs / 1000).toFixed(1)}s horizon`
    this.refs['footer-identity'].textContent = `${shadow.identity.lineLabel || HISTORICAL_LABEL} · ${shortIdentity(identity)}`
  }

  dispose() {
    window.clearInterval(this.clockTimer)
    this.liveController.stop()
    this.recentController.stop()
    this.chart.dispose()
    this.errorChart?.dispose()
    this.unsubscribe?.()
  }
}

new DashboardApplication(document.querySelector('#app'))
