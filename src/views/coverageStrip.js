function coveragePercent(coverage) {
  const observed = Number(coverage?.observed_buckets ?? coverage?.observedBuckets ?? 0)
  const total = Number(coverage?.window_buckets ?? coverage?.windowBuckets ?? 0)
  if (!Number.isFinite(observed) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (observed / total) * 100))
}

function coverageValue(coverage, snake, camel) {
  return coverage?.[snake] ?? coverage?.[camel] ?? 0
}

export function renderCoverageStrip(refs, coverage, { live = false } = {}) {
  const observed = coverageValue(coverage, 'observed_buckets', 'observedBuckets')
  const total = coverageValue(coverage, 'window_buckets', 'windowBuckets')
  const percent = coveragePercent(coverage)

  refs['coverage-ratio'].textContent = `${observed} / ${total}`
  refs['coverage-bar'].setAttribute('aria-valuenow', String(Math.round(percent)))
  refs['coverage-bar'].setAttribute('aria-label', `${Math.round(percent)} percent of evaluation buckets observed`)
  refs['coverage-fill'].style.width = `${percent}%`

  const items = [
    ['Attempts', coverageValue(coverage, 'attempts', 'attempts')],
    ['Scored', coverageValue(coverage, 'scored', 'scored')],
    ['Invalid', coverageValue(coverage, 'invalid', 'invalid')],
    ['Unscored', coverageValue(coverage, 'valid_without_actual', 'validWithoutActual')],
  ]

  refs['coverage-grid'].replaceChildren()
  items.forEach(([label, value]) => {
    const item = document.createElement('div')
    item.className = 'coverage-item'
    const number = document.createElement('strong')
    number.className = 'mono'
    number.textContent = String(value)
    const copy = document.createElement('span')
    copy.textContent = label
    item.append(number, copy)
    refs['coverage-grid'].append(item)
  })

  const missing = coverage?.unobserved_buckets_as_of_response ?? coverage?.unobservedBucketsAsOfResponse
  refs['coverage-note'].textContent = live && missing == null
    ? 'Live coverage is measured only through the current response.'
    : missing > 0
      ? `${missing} retained observation bucket${missing === 1 ? '' : 's'} absent as of this response.`
      : total > 0
        ? 'All expected retained buckets were observed as of this response.'
        : 'Coverage will appear with the selected market.'
}

export { coveragePercent }
