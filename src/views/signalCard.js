function appendMetric(list, metric) {
  const row = document.createElement('div')
  row.className = 'metric-row'

  const label = document.createElement('dt')
  label.textContent = metric.label
  if (metric.title) label.title = metric.title

  const value = document.createElement('dd')
  value.className = `metric-value mono${metric.tone ? ` is-${metric.tone}` : ''}`
  value.textContent = metric.value ?? '—'
  if (metric.title) value.title = metric.title

  row.append(label, value)
  list.append(row)
}

export function renderSignalCard(refs, viewModel = {}) {
  const state = viewModel.state || 'unavailable'
  refs['signal-kicker'].textContent = viewModel.kicker || 'Current endpoint'
  refs['signal-title'].textContent = viewModel.title || 'Signal summary'
  refs['signal-state'].className = `signal-state-pill is-${state}`
  refs['signal-state'].textContent = viewModel.stateLabel || 'Unavailable'
  refs['hero-label'].textContent = viewModel.heroLabel || 'Projected Chainlink (+3.0s)'
  refs['hero-value'].textContent = viewModel.heroValue || '—'
  refs['hero-value'].classList.toggle('is-dimmed', Boolean(viewModel.dimmed))
  refs['hero-caption'].textContent = viewModel.heroCaption || 'No current shadow projection'

  refs['signal-metrics'].replaceChildren()
  ;(viewModel.metrics || []).forEach((metric) => appendMetric(refs['signal-metrics'], metric))
}
