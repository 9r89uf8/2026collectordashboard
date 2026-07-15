function formatUtc(ms, includeDate = false) {
  if (!Number.isFinite(ms)) return '—'

  const options = {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }

  if (includeDate) {
    options.month = 'short'
    options.day = '2-digit'
  }

  return new Date(ms).toLocaleString('en-GB', options).replace(',', '')
}

export function formatMarketWindow(market) {
  if (!market) return 'Awaiting market identity'
  const startMs = market.marketStartMs ?? market.market_start_ms ?? market.startMs
  const endMs = market.marketEndMs ?? market.market_end_ms ?? market.endMs
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'Market window unavailable'

  const crossesDay = new Date(startMs).getUTCDate() !== new Date(endMs).getUTCDate()
  return `${formatUtc(startMs, true)} – ${formatUtc(endMs, crossesDay)} UTC`
}

export function renderMarketControls(
  refs,
  { mode = 'live', market, marketIndex = -1, marketCount = 0, busy = false } = {},
) {
  refs.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })

  refs['market-state'].textContent =
    mode === 'live'
      ? 'Following current window'
      : market
        ? `Completed market ${market.marketId ?? market.market_id ?? ''}`
        : 'Choose a recent market'
  refs['market-window'].textContent = formatMarketWindow(market)

  refs.previousButton.disabled = mode === 'live' || marketCount === 0 || marketIndex >= marketCount - 1 || busy
  refs.nextButton.disabled = mode === 'live' || marketIndex <= 0 || busy
  refs.refreshButton.hidden = mode !== 'recent'
  refs.refreshButton.disabled = busy
  refs.refreshButton.classList.toggle('is-spinning', busy)
}

export { formatUtc }
