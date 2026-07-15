export function readDashboardRoute(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search)
  const mode = params.get('mode') === 'recent' ? 'recent' : 'live'
  const marketParam = params.get('market')
  const selectedMarketId = marketParam && /^\d+$/.test(marketParam)
    ? Number(marketParam)
    : null

  return {
    mode,
    selectedMarketId: mode === 'recent' ? selectedMarketId : null,
  }
}

export function writeDashboardRoute(
  { mode, selectedMarketId },
  { replace = false, historyLike = window.history } = {},
) {
  const params = new URLSearchParams()
  params.set('mode', mode === 'recent' ? 'recent' : 'live')
  if (mode === 'recent' && selectedMarketId !== null && selectedMarketId !== undefined) {
    params.set('market', String(selectedMarketId))
  }

  const url = `/?${params.toString()}`
  historyLike[replace ? 'replaceState' : 'pushState']({}, '', url)
  return url
}
