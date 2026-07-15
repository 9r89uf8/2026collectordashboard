import { getCurrentLive, getMarketData, getMarketSources, getMarkets } from '../api/markets.js'
import { getShadowEvaluations } from '../api/shadowEvaluations.js'
import { createPoller, createPollingGroup } from './polling.js'
import { isAbortError, marketFromPayload, marketsFromPayload, serverTimeOf } from './controllerUtils.js'

export class LiveController {
  constructor({ modelVersion, onEvent, documentRef = globalThis.document }) {
    this.modelVersion = modelVersion
    this.onEvent = onEvent
    this.documentRef = documentRef
    this.anchor = null
    this.pollers = null
    this.group = null
  }

  emit(event) {
    this.onEvent?.({ source: 'live', ...event })
  }

  start() {
    this.stop()

    const livePoller = createPoller(
      (signal) => this.fetchLive(signal),
      { intervalMs: 1000 },
    )
    const evaluationsPoller = createPoller(
      (signal) => this.fetchEvaluations(signal),
      { intervalMs: 2000 },
    )
    const dataPoller = createPoller(
      (signal) => this.fetchContext(signal),
      { intervalMs: 5000 },
    )
    const sourcesPoller = createPoller(
      (signal) => this.fetchSources(signal),
      { intervalMs: 5000 },
    )
    const discoveryPoller = createPoller(
      (signal) => this.fetchDiscovery(signal),
      { intervalMs: 30_000 },
    )

    this.pollers = { livePoller, evaluationsPoller, dataPoller, sourcesPoller, discoveryPoller }
    this.group = createPollingGroup(Object.values(this.pollers), {
      documentRef: this.documentRef,
      onVisibleRefresh: async (signal) => {
        try {
          await this.fetchLive(signal)
        } catch (error) {
          if (signal.aborted || isAbortError(error)) return

          // fetchLive already emitted the resource error. Keep discovery
          // independent and let the live poller retry after its normal
          // one-second cadence instead of duplicating the failed request now.
          await Promise.allSettled([this.fetchDiscovery(signal)])
          return
        }
        if (!this.anchor || signal.aborted) return
        await Promise.allSettled([
          this.fetchEvaluations(signal),
          this.fetchContext(signal),
          this.fetchSources(signal),
          this.fetchDiscovery(signal),
        ])
      },
    })
    return this.group.start()
  }

  stop() {
    this.group?.stop('Live mode stopped')
    this.group = null
    this.pollers = null
    this.anchor = null
  }

  switchAnchor(market) {
    const previousId = this.anchor?.marketId
    this.anchor = market
    this.emit({ type: 'market', market, rollover: previousId != null && previousId !== market.marketId })

    if (previousId !== market.marketId && this.pollers) {
      if (previousId != null) {
        this.emit({ type: 'rollover', previousMarketId: previousId, market })
      }
      this.pollers.evaluationsPoller.refresh({ abortCurrent: true })
      this.pollers.dataPoller.refresh({ abortCurrent: true })
      this.pollers.sourcesPoller.refresh({ abortCurrent: true })
      this.pollers.discoveryPoller.refresh({ abortCurrent: true })
    }
  }

  async fetchLive(signal) {
    this.emit({ type: 'resource', name: 'live', status: 'loading' })
    try {
      const payload = await getCurrentLive({ signal })
      if (signal.aborted) return
      const market = marketFromPayload(payload)
      if (!market) throw new Error('Live response did not include a valid market window')
      if (!this.anchor || this.anchor.marketId !== market.marketId) this.switchAnchor(market)
      else this.anchor = market

      this.emit({
        type: 'resource',
        name: 'live',
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
      return payload
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted) {
        this.emit({ type: 'resource', name: 'live', status: 'error', error })
      }
      throw error
    }
  }

  async fetchEvaluations(signal) {
    const anchor = this.anchor
    if (!anchor) return
    this.emit({ type: 'resource', name: 'evaluations', status: 'loading' })

    try {
      const payload = await getShadowEvaluations(anchor.marketId, {
        modelVersion: this.modelVersion,
        signal,
        live: true,
      })
      if (signal.aborted || this.anchor?.marketId !== anchor.marketId) return
      this.emit({
        type: 'resource',
        name: 'evaluations',
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted && this.anchor?.marketId === anchor.marketId) {
        this.emit({ type: 'resource', name: 'evaluations', status: 'error', error })
      }
      throw error
    }
  }

  async fetchContext(signal) {
    const anchor = this.anchor
    if (!anchor) return
    this.emit({ type: 'resource', name: 'context', status: 'loading' })
    return this.fetchAnchoredResource(
      'context',
      anchor,
      signal,
      () => getMarketData(anchor.marketId, { signal, live: true, fillDisplay: false }),
    )
  }

  async fetchSources(signal) {
    const anchor = this.anchor
    if (!anchor) return
    this.emit({ type: 'resource', name: 'sources', status: 'loading' })
    return this.fetchAnchoredResource(
      'sources',
      anchor,
      signal,
      () => getMarketSources(anchor.marketId, { signal, live: true }),
    )
  }

  async fetchAnchoredResource(name, anchor, signal, fetcher) {
    try {
      const payload = await fetcher()
      if (signal.aborted || this.anchor?.marketId !== anchor.marketId) return
      this.emit({
        type: 'resource',
        name,
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
      return payload
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted && this.anchor?.marketId === anchor.marketId) {
        this.emit({ type: 'resource', name, status: 'error', error })
      }
      throw error
    }
  }

  async fetchDiscovery(signal) {
    this.emit({ type: 'resource', name: 'discovery', status: 'loading' })
    try {
      const payload = await getMarkets({
        limit: 10,
        includeCurrent: true,
        signal,
        live: true,
      })
      if (signal.aborted) return
      this.emit({
        type: 'resource',
        name: 'discovery',
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
      this.emit({ type: 'markets', markets: marketsFromPayload(payload) })
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted) {
        this.emit({ type: 'resource', name: 'discovery', status: 'error', error })
      }
      throw error
    }
  }
}
