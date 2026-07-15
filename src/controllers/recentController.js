import { getMarketData, getMarketSources, getMarkets } from '../api/markets.js'
import { getShadowEvaluations } from '../api/shadowEvaluations.js'
import { HttpError } from '../api/client.js'
import { isAbortError, marketFromPayload, marketIdOf, marketsFromPayload, serverTimeOf } from './controllerUtils.js'

export class RecentController {
  constructor({ modelVersion, onEvent }) {
    this.modelVersion = modelVersion
    this.onEvent = onEvent
    this.controller = null
    this.selectionController = null
    this.active = false
    this.markets = []
    this.selectedMarketId = null
  }

  emit(event) {
    this.onEvent?.({ source: 'recent', ...event })
  }

  async start(preferredMarketId = null) {
    this.stop()
    this.active = true
    return this.refreshDiscovery(preferredMarketId)
  }

  stop() {
    this.active = false
    this.controller?.abort('Recent mode stopped')
    this.selectionController?.abort('Recent selection stopped')
    this.controller = null
    this.selectionController = null
  }

  async refreshDiscovery(
    preferredMarketId = this.selectedMarketId,
    { loadSelection = true } = {},
  ) {
    if (!this.active) return

    this.controller?.abort('Recent discovery superseded')
    const controller = new AbortController()
    this.controller = controller

    this.emit({ type: 'resource', name: 'discovery', status: 'loading' })

    try {
      const payload = await getMarkets({
        limit: 10,
        includeCurrent: false,
        signal: controller.signal,
      })
      if (!this.active || controller.signal.aborted || this.controller !== controller) return

      this.markets = marketsFromPayload(payload)
      this.emit({
        type: 'resource',
        name: 'discovery',
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
      this.emit({ type: 'markets', markets: this.markets })

      const preferred = this.markets.find((market) => market.marketId === Number(preferredMarketId))
      const selected = preferred || this.markets[0] || null
      if (selected && loadSelection) {
        await this.selectMarket(selected.marketId)
      } else if (!selected && loadSelection) {
        this.emit({ type: 'selection-empty' })
      }
    } catch (error) {
      if (
        this.active &&
        this.controller === controller &&
        !controller.signal.aborted &&
        !isAbortError(error)
      ) {
        this.emit({ type: 'resource', name: 'discovery', status: 'error', error })
      }
    }
  }

  async selectMarket(marketId, { refreshDiscoveryOnMissing = true } = {}) {
    if (!this.active) return

    const normalizedId = Number(marketId)
    if (!Number.isSafeInteger(normalizedId) || normalizedId < 0) return

    this.selectionController?.abort('Recent market selection changed')
    const controller = new AbortController()
    this.selectionController = controller
    this.selectedMarketId = normalizedId

    const discovered = this.markets.find((market) => market.marketId === normalizedId)
    this.emit({ type: 'market', market: discovered || { marketId: normalizedId } })

    for (const name of ['context', 'sources', 'evaluations']) {
      this.emit({ type: 'resource', name, status: 'loading' })
    }

    const tasks = [
      this.fetchResource('context', () => getMarketData(normalizedId, {
        signal: controller.signal,
        fillDisplay: false,
      }), controller, refreshDiscoveryOnMissing),
      this.fetchResource('sources', () => getMarketSources(normalizedId, {
        signal: controller.signal,
      }), controller),
      this.fetchResource('evaluations', () => getShadowEvaluations(normalizedId, {
        modelVersion: this.modelVersion,
        signal: controller.signal,
      }), controller),
    ]

    await Promise.allSettled(tasks)
  }

  async refreshSelected() {
    if (!this.active || this.selectedMarketId === null) return
    await this.selectMarket(this.selectedMarketId)
  }

  async fetchResource(name, fetcher, controller, refreshDiscoveryOnMissing = false) {
    try {
      const payload = await fetcher()
      if (controller.signal.aborted || this.selectionController !== controller) return

      const market = marketFromPayload(payload)
      if (market && marketIdOf(market) === this.selectedMarketId) {
        this.emit({ type: 'market', market })
      }
      this.emit({
        type: 'resource',
        name,
        status: 'success',
        data: payload,
        serverTimeMs: serverTimeOf(payload),
      })
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return
      this.emit({ type: 'resource', name, status: 'error', error })

      if (refreshDiscoveryOnMissing && error instanceof HttpError && error.status === 404) {
        const missingMarketId = this.selectedMarketId
        this.emit({ type: 'market-missing', marketId: missingMarketId })
        await this.refreshDiscovery(null, { loadSelection: false })
      }
    }
  }
}
