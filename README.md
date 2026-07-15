# Oracle Catch-Up dashboard

Local-only research dashboard for comparing each short-horizon projected Chainlink price with the causal Chainlink price observed at that forecast's target time.

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

## Verification

```powershell
npm test
npm run build
npm run preview
```

Preview binds to `127.0.0.1:4173` and uses the same `/api` proxy.
# 2026collectordashboard
