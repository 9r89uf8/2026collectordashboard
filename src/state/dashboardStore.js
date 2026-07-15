export function createResource() {
  return {
    status: 'idle',
    data: null,
    error: null,
    lastSuccessMs: null,
  }
}

export function createInitialDashboardState(mode = 'live') {
  return {
    mode,
    selectedMarketId: null,
    market: null,
    markets: [],
    serverTimeMs: null,
    serverTimeObservedAt: null,
    banner: null,
    resources: {
      discovery: createResource(),
      live: createResource(),
      evaluations: createResource(),
      context: createResource(),
      sources: createResource(),
    },
  }
}

export function createDashboardStore(initialState = createInitialDashboardState()) {
  let state = initialState
  const subscribers = new Set()

  return {
    getState() {
      return state
    },

    setState(update) {
      const next = typeof update === 'function' ? update(state) : update
      state = { ...state, ...next }
      subscribers.forEach((subscriber) => subscriber(state))
      return state
    },

    updateResource(name, update) {
      const current = state.resources[name] || createResource()
      const next = typeof update === 'function' ? update(current) : update
      state = {
        ...state,
        resources: {
          ...state.resources,
          [name]: { ...current, ...next },
        },
      }
      subscribers.forEach((subscriber) => subscriber(state))
      return state.resources[name]
    },

    subscribe(subscriber) {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
  }
}
