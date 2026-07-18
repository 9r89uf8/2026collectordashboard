import {
  describeBias,
  describeMaeAdvantage,
  describeMaeChange,
  describeRmseChange,
  formatRatioMagnitudeAsPercent,
  formatUsdMagnitude,
} from '../domain/decimalFormat.js'
import {
  exactPerformanceIdentity,
  performanceTone,
  shortPerformanceIdentity,
} from '../domain/forecastPerformance.js'

const TOOLTIPS = Object.freeze({
  mae: 'Average absolute difference between projected and causally observed Chainlink prices.',
  median: 'Half of scored absolute errors were at or below this value.',
  p95: 'The empirical nearest-rank 95th percentile of scored absolute errors. It is not a confidence bound.',
  maximum: 'Largest observed absolute forecast error in this cohort and market.',
  rmse: 'Error measure that gives larger misses more weight than MAE.',
  bias: 'Mean signed error. Positive means projections averaged above actual; negative means below.',
  baseline: 'Error if Chainlink had remained at its forecast-time value until each target.',
  skill: 'Relative change in MAE versus the paired no-change baseline. It can be lower, equal, or higher.',
  paired: 'Share of paired targets where forecast absolute error was smaller than no-change absolute error.',
})

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function label(text, tooltip) {
  return `<dt${tooltip ? ` title="${escapeHtml(tooltip)}"` : ''}>${escapeHtml(text)}</dt>`
}

function value(text, { tone = '', primary = false, title = '' } = {}) {
  const classes = ['performance-value', 'mono', primary ? 'is-primary' : '', tone ? `is-${tone}` : '']
    .filter(Boolean)
    .join(' ')
  return `<dd class="${classes}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</dd>`
}

function metricRow(name, metricValue, options = {}) {
  return `<div class="performance-row">${label(name, options.tooltip)}${value(metricValue, options)}</div>`
}

function coverageLine(coverage) {
  return `${coverage.scored} scored · ${coverage.attempts} attempts · ${coverage.invalid} invalid · ${coverage.valid_without_actual} valid without actual`
}

function horizonLabel(model) {
  const horizonMs = model?.horizon_ms
  return Number.isSafeInteger(horizonMs) && horizonMs > 0
    ? `${(horizonMs / 1000).toFixed(1)} s horizon`
    : 'Forecast horizon unavailable'
}

function updatedLabel(serverTimeMs) {
  if (!Number.isSafeInteger(serverTimeMs)) return 'last update unavailable'
  return `last updated ${new Date(serverTimeMs).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })} UTC`
}

function exactIdentityBlock(cohort) {
  const exact = exactPerformanceIdentity(cohort.selectionIdentity)
  if (!exact) return ''
  return `<div class="performance-identity">
    <span>Full selection / artifact identity</span>
    <code tabindex="0">${escapeHtml(exact)}</code>
  </div>`
}

function cohortDiagnostic(cohort) {
  const forecast = cohort.forecast
  const baseline = cohort.noChangeBaseline
  return `<article class="cohort-diagnostic">
    <div class="cohort-diagnostic__heading">
      <strong>${escapeHtml(shortPerformanceIdentity(cohort.selectionIdentity))}</strong>
      <span class="mono">${cohort.scoredPoints} scored</span>
    </div>
    <dl>
      ${metricRow('Forecast MAE', formatUsdMagnitude(forecast.mean_absolute_error_usd), { tooltip: TOOLTIPS.mae, title: forecast.mean_absolute_error_usd ?? '' })}
      ${metricRow('No-change MAE', formatUsdMagnitude(baseline.mean_absolute_error_usd), { tooltip: TOOLTIPS.baseline, title: baseline.mean_absolute_error_usd ?? '' })}
      ${metricRow('MAE change', describeMaeChange(cohort.maeSkillVsNoChange), {
        tooltip: TOOLTIPS.skill,
        tone: performanceTone(cohort.maeSkillVsNoChange),
        title: cohort.maeSkillVsNoChange ?? '',
      })}
    </dl>
    ${exactIdentityBlock(cohort)}
  </article>`
}

function detailsBlock(model) {
  const cohort = model.cohort
  const report = model.report
  const forecast = cohort.forecast
  const baseline = cohort.noChangeBaseline
  return `<details class="performance-details">
    <summary>Details and diagnostics</summary>
    <dl class="performance-detail-list">
      ${metricRow('RMSE', formatUsdMagnitude(forecast.root_mean_squared_error_usd), { tooltip: TOOLTIPS.rmse, title: forecast.root_mean_squared_error_usd ?? '' })}
      ${metricRow('No-change baseline RMSE', formatUsdMagnitude(baseline.root_mean_squared_error_usd), { tooltip: TOOLTIPS.baseline, title: baseline.root_mean_squared_error_usd ?? '' })}
      ${metricRow('RMSE change vs no change', describeRmseChange(cohort.rmseSkillVsNoChange), {
        tooltip: TOOLTIPS.rmse,
        tone: performanceTone(cohort.rmseSkillVsNoChange),
        title: cohort.rmseSkillVsNoChange ?? '',
      })}
      ${metricRow('Average bias', describeBias(forecast.mean_signed_error_usd), { tooltip: TOOLTIPS.bias, title: forecast.mean_signed_error_usd ?? '' })}
      ${metricRow('Metric sample size', `${cohort.scoredPoints} scored targets`)}
    </dl>
    <p class="performance-selection-label">${escapeHtml(model.identityLabel)} · ${escapeHtml(shortPerformanceIdentity(cohort.selectionIdentity))}</p>
    ${exactIdentityBlock(cohort)}
    <p class="performance-diagnostic-note">Report timestamp: ${escapeHtml(updatedLabel(report.serverTimeMs))}</p>
  </details>`
}

function readyMarkup(model) {
  const { cohort, report } = model
  const forecast = cohort.forecast
  const baseline = cohort.noChangeBaseline
  const paired = cohort.pairedComparison
  const isUnscored = model.state === 'unscored'
  const emptyValue = '—'
  const mae = isUnscored ? emptyValue : formatUsdMagnitude(forecast.mean_absolute_error_usd)
  const baselineMae = isUnscored ? emptyValue : formatUsdMagnitude(baseline.mean_absolute_error_usd)
  const change = isUnscored ? emptyValue : describeMaeChange(cohort.maeSkillVsNoChange)
  const advantage = isUnscored ? emptyValue : describeMaeAdvantage(cohort.meanAbsoluteAdvantageUsd)
  const pairedRate = isUnscored ? emptyValue : formatRatioMagnitudeAsPercent(paired.win_rate)

  return `${isUnscored ? `<div class="performance-state"><strong>${escapeHtml(model.title)}</strong></div>` : ''}
    <dl class="performance-primary-grid">
      ${metricRow('Average absolute error (MAE)', mae, { tooltip: TOOLTIPS.mae, primary: true, title: forecast.mean_absolute_error_usd ?? '' })}
      ${metricRow('No-change baseline MAE', baselineMae, { tooltip: TOOLTIPS.baseline, primary: true, title: baseline.mean_absolute_error_usd ?? '' })}
      ${metricRow('MAE change vs no change', change, {
        tooltip: TOOLTIPS.skill,
        tone: isUnscored ? '' : performanceTone(cohort.maeSkillVsNoChange),
        title: cohort.maeSkillVsNoChange ?? '',
      })}
      ${metricRow('MAE advantage vs no change', advantage, {
        tooltip: TOOLTIPS.baseline,
        tone: isUnscored ? '' : performanceTone(cohort.meanAbsoluteAdvantageUsd),
        title: cohort.meanAbsoluteAdvantageUsd ?? '',
      })}
    </dl>
    <dl class="performance-distribution-grid">
      <div>${label('Typical abs. error', TOOLTIPS.median)}${value(isUnscored ? emptyValue : formatUsdMagnitude(forecast.median_absolute_error_usd), { title: forecast.median_absolute_error_usd ?? '' })}</div>
      <div>${label('P95 absolute error', TOOLTIPS.p95)}${value(isUnscored ? emptyValue : formatUsdMagnitude(forecast.p95_absolute_error_usd), { title: forecast.p95_absolute_error_usd ?? '' })}</div>
      <div>${label('Largest absolute error', TOOLTIPS.maximum)}${value(isUnscored ? emptyValue : formatUsdMagnitude(forecast.maximum_absolute_error_usd), { title: forecast.maximum_absolute_error_usd ?? '' })}</div>
    </dl>
    <div class="paired-comparison" title="${escapeHtml(TOOLTIPS.paired)}">
      <div>
        <span>Closer than no change</span>
        <strong class="mono">${isUnscored ? emptyValue : `${paired.wins} closer · ${paired.ties} equal · ${paired.losses} worse`}</strong>
      </div>
      <strong class="paired-rate mono"${paired.win_rate !== null ? ` title="${escapeHtml(paired.win_rate)}"` : ''}>${escapeHtml(pairedRate)}</strong>
    </div>
    <p class="performance-coverage mono">${escapeHtml(coverageLine(report.coverage))}</p>
    ${detailsBlock(model)}
    <p class="performance-footnote">Descriptive for this five-minute market; overlapping forecasts.</p>`
}

function stateMarkup(model) {
  const diagnostics = model.state === 'selection-change' && model.cohorts?.length
    ? `<details class="performance-details"><summary>Inspect ${model.cohorts.length} selection cohorts</summary><div class="cohort-diagnostics">${model.cohorts.map(cohortDiagnostic).join('')}</div></details>`
    : ''
  const coverage = model.report?.coverage
    ? `<p class="performance-coverage mono">${escapeHtml(coverageLine(model.report.coverage))}</p>`
    : ''
  return `<div class="performance-state performance-state--${escapeHtml(model.state)}">
    <strong>${escapeHtml(model.title)}</strong>
    ${model.message ? `<span>${escapeHtml(model.message)}</span>` : ''}
  </div>${coverage}${diagnostics}`
}

function loadingMarkup() {
  return `<div class="performance-skeleton" aria-hidden="true">
    <span class="skeleton"></span><span class="skeleton"></span>
    <span class="skeleton"></span><span class="skeleton"></span>
    <span class="skeleton"></span>
  </div>`
}

function accessibleSummary(model) {
  if (!model) return 'Forecast performance reporting is unavailable.'
  if (model.state !== 'ready' && model.state !== 'unscored') {
    const coverage = model.report?.coverage
    return `${model.title}. ${model.message || ''}${coverage ? ` ${coverageLine(coverage)}.` : ''}`.trim()
  }
  const { cohort, report } = model
  if (model.state === 'unscored') {
    return `${model.title} ${coverageLine(report.coverage)}.`
  }
  return `Forecast average absolute error ${formatUsdMagnitude(cohort.forecast.mean_absolute_error_usd)}. No-change baseline average absolute error ${formatUsdMagnitude(cohort.noChangeBaseline.mean_absolute_error_usd)}. MAE change ${describeMaeChange(cohort.maeSkillVsNoChange)}. ${cohort.pairedComparison.wins} closer, ${cohort.pairedComparison.ties} equal, and ${cohort.pairedComparison.losses} worse than no change. ${coverageLine(report.coverage)}.`
}

export function renderForecastPerformance(refs, model, { resource = null } = {}) {
  const body = refs['performance-body']
  if (!body) return

  const hasPriorData = Boolean(model?.report)
  const loading = !model && resource?.status !== 'error'
  refs['performance-badge'].hidden = true
  refs['performance-title'].textContent = 'Forecast performance'
  refs['performance-subtitle'].textContent = 'Shadow / Experimental'
  refs['performance-card'].classList.toggle('dimmed', resource?.status === 'error' && hasPriorData)

  if (loading) {
    refs['performance-card'].setAttribute('aria-busy', 'true')
    body.innerHTML = loadingMarkup()
    refs['performance-summary'].textContent = 'Forecast performance is loading.'
    return
  }

  refs['performance-card'].setAttribute('aria-busy', 'false')
  if (!model) {
    const status = resource?.error?.status
    const title = status === 404
      ? 'Market not found.'
      : status === 422
        ? 'Configuration/request error.'
        : 'Evaluation reporting unavailable.'
    body.innerHTML = stateMarkup({
      state: 'request-error',
      title,
      message: 'Other healthy dashboard data remains available.',
    })
    refs['performance-summary'].textContent = `${title} Other healthy dashboard data remains available.`
    return
  }

  const report = model.report
  if (report) {
    refs['performance-title'].textContent = report.active
      ? 'Forecast performance so far'
      : 'Forecast performance'
    refs['performance-subtitle'].textContent = `${horizonLabel(report.model)} · ${report.coverage.scored} scored targets · Shadow / Experimental`
    refs['performance-badge'].hidden = !report.active
    refs['performance-badge'].textContent = 'So far'
  }

  body.innerHTML = model.state === 'ready' || model.state === 'unscored'
    ? readyMarkup(model)
    : stateMarkup(model)
  refs['performance-summary'].textContent = accessibleSummary(model)

  if (resource?.status === 'error' && report) {
    body.insertAdjacentHTML(
      'afterbegin',
      `<p class="performance-stale">Stale — ${escapeHtml(updatedLabel(report.serverTimeMs))}</p>`,
    )
  }
}

export { TOOLTIPS as PERFORMANCE_TOOLTIPS }
