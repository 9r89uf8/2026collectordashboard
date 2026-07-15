const port = Number(process.argv[2] || 9222)
const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
const target = tabs.find((tab) => tab.type === 'page' && tab.url.includes('127.0.0.1:5173'))
if (!target) throw new Error('Dashboard tab was not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})

function call(method, params = {}) {
  const id = nextId
  nextId += 1
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Browser evaluation failed')
  }
  return response.result.value
}

await call('Runtime.enable')

if (process.argv.includes('--reload')) {
  await evaluate('location.reload()')
  await wait(5200)
  const ready = await evaluate(`({
    search: location.search,
    api: document.querySelector('[data-ref="connection-label"]')?.textContent,
    state: document.querySelector('[data-ref="market-state"]')?.textContent,
    rows: document.querySelector('[data-ref="point-count"]')?.textContent,
  })`)
  socket.close()
  process.stdout.write(`${JSON.stringify({ ready }, null, 2)}\n`)
  process.exit(0)
}

if (process.argv.includes('--failure')) {
  await evaluate(`document.querySelector('[data-action="refresh"]')?.click()`)
  await wait(2200)
  const failure = await evaluate(`({
    api: document.querySelector('[data-ref="connection-label"]')?.textContent,
    banner: document.querySelector('[data-ref="status-region"]')?.textContent.replace(/\\s+/g, ' ').trim(),
    chartReady: document.querySelector('[data-ref="chart"]')?.classList.contains('chart-canvas--ready'),
    chartDimmed: document.querySelector('[data-ref="chart-panel"]')?.classList.contains('dimmed'),
    rowsPreserved: document.querySelector('[data-ref="point-count"]')?.textContent,
  })`)
  socket.close()
  process.stdout.write(`${JSON.stringify({ failure }, null, 2)}\n`)
  process.exit(0)
}

await wait(6500)

const live = await evaluate(`({
  mode: document.querySelector('[data-mode="live"]')?.getAttribute('aria-pressed'),
  api: document.querySelector('[data-ref="connection-label"]')?.textContent,
  market: document.querySelector('[data-ref="market-window"]')?.textContent,
  chartReady: document.querySelector('[data-ref="chart"]')?.classList.contains('chart-canvas--ready'),
  signal: document.querySelector('[data-ref="signal-state"]')?.textContent,
  refreshHidden: document.querySelector('[data-action="refresh"]')?.hidden,
  consoleTitle: document.title,
})`)

await evaluate(`document.querySelector('[data-mode="recent"]')?.click()`)
await wait(2200)

const recent = await evaluate(`({
  mode: document.querySelector('[data-mode="recent"]')?.getAttribute('aria-pressed'),
  search: location.search,
  state: document.querySelector('[data-ref="market-state"]')?.textContent,
  scored: document.querySelector('[data-ref="signal-state"]')?.textContent,
  rows: document.querySelector('[data-ref="point-count"]')?.textContent,
  refreshVisible: !document.querySelector('[data-action="refresh"]')?.hidden,
  banner: document.querySelector('[data-ref="status-region"]')?.textContent.trim(),
})`)

await evaluate(`document.querySelector('[data-action="previous"]')?.click()`)
await wait(1800)

const navigation = await evaluate(`({
  search: location.search,
  state: document.querySelector('[data-ref="market-state"]')?.textContent,
  window: document.querySelector('[data-ref="market-window"]')?.textContent,
})`)

socket.close()
process.stdout.write(`${JSON.stringify({ live, recent, navigation }, null, 2)}\n`)
