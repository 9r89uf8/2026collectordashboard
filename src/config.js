const ACCEPTED_MODELS = Object.freeze([
  'catchup_ratio_l3000_b100',
  'catchup_ratio_l3500_b100',
  'catchup_ratio_l4000_b100',
])

export function parsePositiveBase10Integer(value, fallback, name) {
  const candidate = value === undefined || value === '' ? String(fallback) : String(value)

  if (!/^\d+$/.test(candidate)) {
    throw new Error(`${name} must be a positive base-10 integer`)
  }

  const parsed = Number(candidate)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive base-10 integer`)
  }

  return parsed
}

export function createDashboardConfig(env = {}) {
  const primaryModelVersion =
    env.VITE_PRIMARY_MODEL_VERSION || 'catchup_ratio_l3000_b100'

  if (!ACCEPTED_MODELS.includes(primaryModelVersion)) {
    throw new Error(
      `VITE_PRIMARY_MODEL_VERSION must be one of: ${ACCEPTED_MODELS.join(', ')}`,
    )
  }

  return Object.freeze({
    primaryModelVersion,
    chainlinkReceivedStaleMs: parsePositiveBase10Integer(
      env.VITE_CHAINLINK_RECEIVED_STALE_MS,
      2500,
      'VITE_CHAINLINK_RECEIVED_STALE_MS',
    ),
    chainlinkSourceStaleMs: parsePositiveBase10Integer(
      env.VITE_CHAINLINK_SOURCE_STALE_MS,
      5000,
      'VITE_CHAINLINK_SOURCE_STALE_MS',
    ),
  })
}

export { ACCEPTED_MODELS }

export const dashboardConfig = createDashboardConfig(import.meta.env)
