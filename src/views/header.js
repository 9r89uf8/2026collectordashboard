function formatClock(serverTimeMs) {
  if (!Number.isFinite(serverTimeMs)) return '--:--:-- UTC'

  return `${new Date(serverTimeMs).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })} UTC`
}

export function renderHeader(refs, { connection = 'connecting', serverTimeMs, lastSuccessMs } = {}) {
  const labels = {
    online: 'API connected',
    offline: 'API unavailable',
    degraded: 'API degraded',
    connecting: 'Connecting',
  }

  refs.connection.className = `connection-pill is-${connection}`
  refs['connection-label'].textContent = labels[connection] || labels.connecting
  refs.connection.title = lastSuccessMs
    ? `Last successful response ${new Date(lastSuccessMs).toISOString()}`
    : 'No successful API response yet'
  refs['utc-clock'].textContent = formatClock(serverTimeMs)
}

export { formatClock }
