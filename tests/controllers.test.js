import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getCurrentLive: vi.fn(),
  getMarketData: vi.fn(),
  getMarketSources: vi.fn(),
  getMarkets: vi.fn(),
  getShadowEvaluations: vi.fn(),
}))

vi.mock('../src/api/markets.js', () => ({
  getCurrentLive: apiMocks.getCurrentLive,
  getMarketData: apiMocks.getMarketData,
  getMarketSources: apiMocks.getMarketSources,
  getMarkets: apiMocks.getMarkets,
}))

vi.mock('../src/api/shadowEvaluations.js', () => ({
  getShadowEvaluations: apiMocks.getShadowEvaluations,
}))

import { HttpError } from '../src/api/client.js'
import { LiveController } from '../src/controllers/liveController.js'
import { RecentController } from '../src/controllers/recentController.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function market(marketId, marketStartMs = marketId * 300_000) {
  return {
    market_id: marketId,
    market_start_ms: marketStartMs,
    market_end_ms: marketStartMs + 300_000,
  }
}

function livePayload(marketId) {
  return {
    ...market(marketId),
    server_time_ms: market(marketId).market_start_ms + 1_000,
    prices: { chainlink: { value: null } },
    signals: { chainlink_catchup: null },
  }
}

function payloadFor(marketId, extra = {}) {
  return {
    market: market(marketId),
    server_time_ms: market(marketId).market_end_ms,
    ...extra,
  }
}

function fakeDocument(initiallyHidden = false) {
  const target = new EventTarget()
  target.hidden = initiallyHidden
  return target
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

describe('LiveController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    apiMocks.getMarketData.mockResolvedValue(payloadFor(1))
    apiMocks.getMarketSources.mockResolvedValue(payloadFor(1))
    apiMocks.getMarkets.mockResolvedValue({ markets: [market(1)] })
    apiMocks.getShadowEvaluations.mockResolvedValue(payloadFor(1, { points: [] }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits while initially hidden, then runs one anchored refresh before polling', async () => {
    const documentRef = fakeDocument(true)
    apiMocks.getCurrentLive.mockResolvedValue(livePayload(1))
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef,
      onEvent: vi.fn(),
    })

    controller.start()
    await flushPromises()
    expect(apiMocks.getCurrentLive).not.toHaveBeenCalled()

    documentRef.hidden = false
    documentRef.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()

    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    expect(apiMocks.getShadowEvaluations).toHaveBeenCalledTimes(1)
    expect(apiMocks.getMarketData).toHaveBeenCalledTimes(1)
    expect(apiMocks.getMarketSources).toHaveBeenCalledTimes(1)
    expect(apiMocks.getMarkets).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(2)
    expect(apiMocks.getShadowEvaluations).toHaveBeenCalledTimes(2)

    documentRef.hidden = true
    documentRef.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    documentRef.hidden = false
    documentRef.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(3)

    controller.stop()
  })

  it('keeps the one-second live poller running while a secondary refresh is slow', async () => {
    const slowContext = deferred()
    apiMocks.getCurrentLive.mockResolvedValue(livePayload(1))
    apiMocks.getMarketData.mockReturnValue(slowContext.promise)
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef: fakeDocument(false),
      onEvent: vi.fn(),
    })

    controller.start()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()

    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    expect(apiMocks.getMarketData).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(2)

    controller.stop()
    slowContext.resolve(payloadFor(1))
    await flushPromises()
  })

  it('emits the backend server time with a successful live response', async () => {
    const events = []
    apiMocks.getCurrentLive.mockResolvedValue(livePayload(1))
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef: fakeDocument(false),
      onEvent: (event) => events.push(event),
    })
    const signal = new AbortController().signal
    await controller.fetchLive(signal)

    const success = events.find((event) => (
      event.type === 'resource' && event.name === 'live' && event.status === 'success'
    ))
    expect(success).toEqual(expect.objectContaining({
      type: 'resource',
      name: 'live',
      status: 'success',
      serverTimeMs: livePayload(1).server_time_ms,
    }))
  })

  it('serializes rapid hide/show visible refreshes even when abort is ignored', async () => {
    const firstLive = deferred()
    const secondLive = deferred()
    const documentRef = fakeDocument(false)
    apiMocks.getCurrentLive
      .mockReturnValueOnce(firstLive.promise)
      .mockReturnValueOnce(secondLive.promise)
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef,
      onEvent: vi.fn(),
    })

    controller.start()
    await flushPromises()
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)

    documentRef.hidden = true
    documentRef.dispatchEvent(new Event('visibilitychange'))
    documentRef.hidden = false
    documentRef.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)

    firstLive.resolve(livePayload(1))
    await flushPromises()
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(2)

    secondLive.resolve(livePayload(1))
    await flushPromises()
    controller.stop()
  })

  it('emits one error per failed request and backs off after the first scheduled retry', async () => {
    const failure = new Error('API offline')
    const events = []
    apiMocks.getCurrentLive.mockRejectedValue(failure)
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef: fakeDocument(false),
      onEvent: (event) => events.push(event),
    })

    controller.start()
    await flushPromises()

    const liveErrors = () => events.filter(
      (event) => event.type === 'resource' && event.name === 'live' && event.status === 'error',
    )
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    expect(liveErrors()).toHaveLength(1)

    // The visible-anchor attempt is outside the poller. The first scheduled
    // retry uses the normal one-second cadence; once that fails, backoff is 1 s.
    await vi.advanceTimersByTimeAsync(999)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(2)
    expect(liveErrors()).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(999)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(apiMocks.getCurrentLive).toHaveBeenCalledTimes(3)
    expect(liveErrors()).toHaveLength(3)

    controller.stop()
  })

  it('aborts old anchored pollers and rejects a late old-market evaluation', async () => {
    const oldEvaluation = deferred()
    const events = []
    const refresh = vi.fn()
    const controller = new LiveController({
      modelVersion: 'catchup_ratio_l3000_b100',
      documentRef: fakeDocument(false),
      onEvent: (event) => events.push(event),
    })
    controller.anchor = {
      marketId: 1,
      marketStartMs: 300_000,
      marketEndMs: 600_000,
    }
    controller.pollers = {
      evaluationsPoller: { refresh },
      dataPoller: { refresh },
      sourcesPoller: { refresh },
      discoveryPoller: { refresh },
    }
    apiMocks.getShadowEvaluations.mockReturnValue(oldEvaluation.promise)

    const request = controller.fetchEvaluations(new AbortController().signal)
    controller.switchAnchor({
      marketId: 2,
      marketStartMs: 600_000,
      marketEndMs: 900_000,
    })
    oldEvaluation.resolve(payloadFor(1, { points: [{ target_ms: 400_000 }] }))
    await request

    expect(refresh).toHaveBeenCalledTimes(4)
    expect(refresh).toHaveBeenCalledWith({ abortCurrent: true })
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'resource',
      name: 'evaluations',
      status: 'success',
    }))
  })
})

describe('RecentController', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    apiMocks.getMarketData.mockResolvedValue(payloadFor(1))
    apiMocks.getMarketSources.mockResolvedValue(payloadFor(1))
    apiMocks.getShadowEvaluations.mockResolvedValue(payloadFor(1, { points: [] }))
  })

  it('does not accept a discovery response that settles after stop', async () => {
    const discovery = deferred()
    const events = []
    apiMocks.getMarkets.mockReturnValue(discovery.promise)
    const controller = new RecentController({
      modelVersion: 'catchup_ratio_l3000_b100',
      onEvent: (event) => events.push(event),
    })

    const starting = controller.start()
    controller.stop()
    discovery.resolve({ markets: [market(1)] })
    await starting

    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'resource',
      name: 'discovery',
      status: 'success',
    }))
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'market' }))
  })

  it('lets a newer discovery supersede an abort-unfriendly older response', async () => {
    const first = deferred()
    const second = deferred()
    const events = []
    apiMocks.getMarkets
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const controller = new RecentController({
      modelVersion: 'catchup_ratio_l3000_b100',
      onEvent: (event) => events.push(event),
    })

    const oldRefresh = controller.start()
    const newRefresh = controller.refreshDiscovery()
    second.resolve({ markets: [market(2)] })
    await newRefresh
    first.resolve({ markets: [market(1)] })
    await oldRefresh

    const selectedIds = events
      .filter((event) => event.type === 'market')
      .map((event) => event.market.marketId)
    expect(selectedIds).toEqual([2])
    expect(controller.markets.map((entry) => entry.marketId)).toEqual([2])

    controller.stop()
  })

  it('keeps healthy resources, reports context 404, and refreshes discovery', async () => {
    const events = []
    apiMocks.getMarkets
      .mockResolvedValueOnce({ markets: [market(1)] })
      .mockResolvedValueOnce({ markets: [market(2)] })
    apiMocks.getMarketData.mockRejectedValue(
      new HttpError(new Response('{}', { status: 404, statusText: 'Not Found' })),
    )
    apiMocks.getMarketSources.mockResolvedValue(payloadFor(1, { sources: [] }))
    apiMocks.getShadowEvaluations.mockResolvedValue(payloadFor(1, { points: [] }))
    const controller = new RecentController({
      modelVersion: 'catchup_ratio_l3000_b100',
      onEvent: (event) => events.push(event),
    })

    await controller.start()

    expect(events).toContainEqual(expect.objectContaining({
      type: 'resource',
      name: 'context',
      status: 'error',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'resource',
      name: 'sources',
      status: 'success',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'resource',
      name: 'evaluations',
      status: 'success',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'market-missing',
      marketId: 1,
    }))
    expect(apiMocks.getMarkets).toHaveBeenCalledTimes(2)
    expect(controller.markets.map((entry) => entry.marketId)).toEqual([2])
    expect(apiMocks.getMarketData).toHaveBeenCalledTimes(1)

    controller.stop()
  })
})
