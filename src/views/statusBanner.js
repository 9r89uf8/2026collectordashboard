export function renderStatusBanner(refs, status) {
  const region = refs['status-region']
  region.replaceChildren()

  if (!status?.message) return

  const banner = document.createElement('div')
  banner.className = `status-banner is-${status.kind || 'info'}`
  banner.setAttribute('role', status.kind === 'error' ? 'alert' : 'status')

  const icon = document.createElement('span')
  icon.className = 'status-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = status.kind === 'error' ? '!' : status.kind === 'warning' ? '!' : 'i'

  const copy = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = status.title || 'Dashboard notice'
  const message = document.createElement('span')
  message.textContent = status.message
  copy.append(title, message)

  banner.append(icon, copy)
  region.append(banner)
}
