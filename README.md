# Oracle Catch-Up dashboard

Local-only research dashboard for comparing each short-horizon projected Chainlink price with causal Chainlink and the persisted Binance futures input used when that forecast was generated.

The interface is permanently labeled **Shadow / Experimental**. It is a model-observation tool, not a probability, settlement prediction, confidence interval, or trading recommendation.

## Run locally

1. Open an SSH tunnel to the private read-only FastAPI service and keep the terminal open:

   ```powershell
   ssh -N -L 9000:127.0.0.1:9000 DROPLET_USER@DROPLET_IP
   ```

2. Install dependencies and start Vite:

   ```powershell
   npm install
   npm run dev
   ```

3. Open only `http://127.0.0.1:5173`.

All browser requests use the same-origin `/api` path. Vite proxies that path to the locally forwarded port; the dashboard does not require CORS or a public API listener.

## Configuration

Local dashboard settings live in the ignored `.env.local` file:

```dotenv
API_PROXY_TARGET=http://127.0.0.1:9000
VITE_PRIMARY_MODEL_VERSION=catchup_ratio_l3000_b100
VITE_CHAINLINK_RECEIVED_STALE_MS=2500
VITE_CHAINLINK_SOURCE_STALE_MS=5000
```

Do not put credentials, SSH keys, or database URLs in a `VITE_*` variable; Vite exposes those values to browser code.

## Evaluation-series alignment

Persisted evaluations are generated every 500 ms. In Live mode the dashboard
polls the ID-addressed evaluation route every second, so a response normally
adds about two points. All three comparison series use each row's authoritative
`target_ms`:

| Chart series | Persisted value |
| --- | --- |
| Projection | `projected_chainlink` |
| Actual Chainlink | `actual_chainlink` |
| Futures input at forecast generation | `futures_at_forecast` |

`futures_at_forecast` is the causal futures observation available to the model
at `generated_ms`; it is shifted to `target_ms` only to compare the model input,
projection, and eventual Chainlink outcome on one target-aligned chart. It is
not an actual futures price observed at the target and must be labeled
accordingly. A null value renders as a gap.

The futures-input series comes from the PostgreSQL-backed shadow-evaluation
response, so Live and Recent modes can reconstruct it after a reload. The chart
does not poll `/api/markets/current/live` at high frequency, maintain a browser
futures buffer, or substitute top-level `futures.last` or signal-level
`futures_now` for this persisted field. `/markets/current/live` remains
latest-only data for the live signal and ghost marker.

## Downloading a finished evaluation report

Recent mode offers `Download JSON` only for a selected finished market. The
link uses the validated `shadowEvaluationsDownloadUrl(marketId, modelVersion)`
helper and the fixed, ID-addressed proxy route:

```text
/api/markets/{market_id}/shadow-evaluations/download?model_version={model_version}
```

The UI never uses a `/current` download URL. The server returns the retained
schema-v2 evaluation report directly as JSON with this attachment filename:

```text
btc_5m_market_{market_id}_shadow_evaluations_{model_version}.json
```

Shadow evaluations are retained in PostgreSQL for seven days (168 hours).
Downloads are therefore a bounded research export, not permanent archival;
once a market's evaluation rows age out, the dashboard cannot recreate them.

## Verification

```powershell
npm test
npm run build
npm run preview
```

Preview binds to `127.0.0.1:4173` and uses the same `/api` proxy.

For local visual QA without the SSH tunnel, run these commands in separate
terminals, then open `http://127.0.0.1:5173`:

```powershell
node tests/manual/mockApiServer.mjs
npm run dev
```
