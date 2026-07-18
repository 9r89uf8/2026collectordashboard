export function mountAppShell(root) {
  root.innerHTML = `
    <div class="dashboard-shell">
      <header class="topbar">
        <div class="brand-block">
          <div class="brand-mark" aria-hidden="true">
            <span></span><span></span>
          </div>
          <div class="brand-copy">
            <p class="eyebrow">Forecast evidence console</p>
            <div class="brand-title-row">
              <h1>Oracle Catch-Up</h1>
              <span class="experiment-badge">Shadow / Experimental</span>
            </div>
          </div>
        </div>
        <div class="connection-cluster">
          <span class="connection-pill is-connecting" data-ref="connection">
            <span class="connection-dot" aria-hidden="true"></span>
            <span data-ref="connection-label">Connecting</span>
          </span>
          <span class="utc-clock mono" data-ref="utc-clock">--:--:-- UTC</span>
        </div>
      </header>

      <nav class="market-toolbar" aria-label="Dashboard mode and market selection">
        <div class="mode-switch" role="group" aria-label="Dashboard mode">
          <button class="segmented-button is-active" type="button" data-mode="live" aria-pressed="true">
            <span class="live-pulse" aria-hidden="true"></span>Live
          </button>
          <button class="segmented-button" type="button" data-mode="recent" aria-pressed="false">Recent</button>
        </div>

        <div class="market-navigator">
          <button class="nav-button" type="button" data-action="previous" aria-label="Previous discovered market">
            <span aria-hidden="true">&#8592;</span>
          </button>
          <div class="market-window-label">
            <span class="market-state-label" data-ref="market-state">Following current window</span>
            <strong class="mono" data-ref="market-window">Awaiting market identity</strong>
          </div>
          <button class="nav-button" type="button" data-action="next" aria-label="Next discovered market">
            <span aria-hidden="true">&#8594;</span>
          </button>
        </div>

        <button class="refresh-button" type="button" data-action="refresh" hidden>
          <span aria-hidden="true">&#8635;</span>Refresh
        </button>
      </nav>

      <div class="status-region" data-ref="status-region" aria-live="polite" aria-atomic="true"></div>

      <main class="dashboard-grid">
        <section class="chart-panel panel" aria-labelledby="chart-title" data-ref="chart-panel">
          <div class="panel-heading chart-heading">
            <div>
              <p class="chart-kicker">Target-time comparison</p>
              <h2 class="chart-title" id="chart-title">Actual vs projected Chainlink</h2>
            </div>
            <p class="chart-meta mono" data-ref="chart-meta">Fixed 05:00 UTC window</p>
          </div>

          <div class="chart-stage" data-ref="chart-stage" aria-busy="true">
            <div class="chart-canvas" data-ref="chart" role="img" aria-label="Chainlink actual and projected price chart"></div>
            <div class="chart-empty-state" data-ref="chart-empty">
              <div class="empty-state-orbit" aria-hidden="true"></div>
              <strong data-ref="empty-title">Waiting for market evidence</strong>
              <span data-ref="empty-copy">The chart will populate when the private API tunnel responds.</span>
            </div>
          </div>

          <section class="forecast-error-strip" data-ref="error-strip" aria-labelledby="forecast-error-title" hidden>
            <div class="forecast-error-heading">
              <div>
                <p class="chart-kicker">Target-time residuals</p>
                <h3 id="forecast-error-title">Signed forecast error</h3>
              </div>
              <p class="forecast-error-legend"><span class="error-key error-key--positive"></span>above actual <span class="error-key error-key--negative"></span>below actual</p>
            </div>
            <div class="forecast-error-stage">
              <div class="forecast-error-chart" data-ref="error-chart" role="img" aria-label="Signed forecast error at each target time"></div>
              <p class="forecast-error-empty" data-ref="error-empty">Waiting for causally scored forecast errors.</p>
            </div>
            <p class="sr-only" data-ref="error-summary">No signed forecast errors are displayed.</p>
          </section>

          <p class="sr-only" data-ref="chart-summary" aria-live="polite">
            No market evidence is currently displayed.
          </p>

          <details class="details-disclosure" data-ref="points-disclosure">
            <summary>Inspect recent scored points <span data-ref="point-count">0 rows</span></summary>
            <div class="table-scroll">
              <table class="points-table">
                <caption class="sr-only">Recent scored forecast points for the selected market</caption>
                <thead>
                  <tr>
                    <th scope="col">Target UTC</th>
                    <th scope="col">Projected</th>
                    <th scope="col">Actual</th>
                    <th scope="col">Error</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody data-ref="points-body"></tbody>
              </table>
            </div>
          </details>
        </section>

        <aside class="insight-rail" aria-label="Signal and coverage summary">
          <section class="signal-card panel" aria-labelledby="signal-title">
            <div class="card-header">
              <div>
                <p class="card-kicker" data-ref="signal-kicker">Current endpoint</p>
                <h2 class="card-title" id="signal-title" data-ref="signal-title">Signal summary</h2>
              </div>
              <span class="signal-state-pill" data-ref="signal-state">Unavailable</span>
            </div>
            <div class="hero-metric">
              <span class="metric-label" data-ref="hero-label">Projected Chainlink (+3.0s)</span>
              <strong class="hero-metric-value mono" data-ref="hero-value">—</strong>
              <span class="hero-metric-caption" data-ref="hero-caption">No current shadow projection</span>
            </div>
            <dl class="metric-list" data-ref="signal-metrics"></dl>
          </section>

          <section class="performance-card panel" data-ref="performance-card" aria-labelledby="performance-title" aria-busy="true">
            <div class="card-header performance-header">
              <div>
                <p class="card-kicker">Paired forecast evidence</p>
                <h2 class="card-title" id="performance-title" data-ref="performance-title">Forecast performance</h2>
              </div>
              <span class="performance-badge" data-ref="performance-badge" hidden>So far</span>
            </div>
            <p class="performance-subtitle" data-ref="performance-subtitle">Shadow / Experimental</p>
            <div class="performance-body" data-ref="performance-body"></div>
            <p class="sr-only" data-ref="performance-summary">Forecast performance is loading.</p>
          </section>

          <section class="coverage-card panel" aria-labelledby="coverage-title">
            <div class="card-header">
              <div>
                <p class="card-kicker">Retained evidence</p>
                <h2 class="card-title" id="coverage-title">Coverage</h2>
              </div>
              <span class="coverage-ratio mono" data-ref="coverage-ratio">0 / 0</span>
            </div>
            <div class="coverage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-ref="coverage-bar">
              <span data-ref="coverage-fill"></span>
            </div>
            <div class="coverage-grid" data-ref="coverage-grid"></div>
            <p class="coverage-note muted" data-ref="coverage-note">Coverage will appear with the selected market.</p>
          </section>
        </aside>
      </main>

      <footer class="model-footer">
        <div class="footer-model">
          <span>Configured model</span>
          <strong class="mono" data-ref="footer-model">catchup_ratio_l3000_b100</strong>
          <span class="footer-separator" aria-hidden="true">/</span>
          <span class="mono" data-ref="footer-horizon">3.0s horizon</span>
          <span class="footer-separator" aria-hidden="true">/</span>
          <span class="mono" data-ref="footer-identity">Selection identity pending</span>
        </div>
        <p class="footer-disclaimer">
          Model observation only. Not a probability, settlement prediction, confidence interval, or trading recommendation.
        </p>
      </footer>
    </div>
  `

  const refs = {}
  root.querySelectorAll('[data-ref]').forEach((element) => {
    refs[element.dataset.ref] = element
  })

  refs.modeButtons = [...root.querySelectorAll('[data-mode]')]
  refs.previousButton = root.querySelector('[data-action="previous"]')
  refs.nextButton = root.querySelector('[data-action="next"]')
  refs.refreshButton = root.querySelector('[data-action="refresh"]')

  return refs
}
