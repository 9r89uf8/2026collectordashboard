export const FINGERPRINT = "2e403435a541b7fd7e431dc38ebeee62f88743c63ce8043088361fe7ac61b749";
export const ARTIFACT = "890a08366d45cb33978f1c382f2030b62a50281a3606a4caa7ddfac3e1570699";
export const OTHER_FINGERPRINT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OTHER_ARTIFACT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const MODEL_VERSION = "catchup_ratio_l3000_b100";

export const MARKET = Object.freeze({
  market_id: 42,
  market_start_ms: 1_000_000,
  market_end_ms: 1_300_000,
  boundary: "[start_ms,end_ms)",
});

function attempt(overrides = {}) {
  const generatedMs = overrides.generated_ms ?? 997_000;
  return {
    selection_fingerprint_sha256: FINGERPRINT,
    selection_artifact_sha256: ARTIFACT,
    model_version: MODEL_VERSION,
    beta: "1",
    generated_ms: generatedMs,
    target_ms: overrides.target_ms ?? generatedMs + 3_000,
    matured_ms: overrides.matured_ms ?? generatedMs + 3_005,
    horizon_ms: 3_000,
    valid: true,
    status: "valid",
    invalid_reasons: [],
    state: "anchored",
    forecast_market_id: generatedMs < MARKET.market_start_ms ? 41 : 42,
    full_horizon_before_forecast_market_end: true,
    chainlink_at_forecast: "64080.47",
    chainlink_at_forecast_source_timestamp_ms: generatedMs - 120,
    chainlink_at_forecast_received_ms: generatedMs - 45,
    futures_at_forecast: "64137.91",
    futures_at_forecast_source_timestamp_ms: generatedMs - 85,
    futures_at_forecast_received_ms: generatedMs - 15,
    projected_chainlink: "64103.07",
    actual_chainlink: "64099.82",
    actual_chainlink_source_timestamp_ms: overrides.target_ms ?? generatedMs + 3_000,
    actual_chainlink_received_ms: overrides.target_ms ?? generatedMs + 3_000,
    actual_chainlink_age_at_target_ms: 167,
    pending_move: "22.60",
    pending_move_bps: "3.526815580472490292",
    direction: "up",
    forecast_error: "3.25",
    baseline_error: "-19.35",
    ...overrides,
  };
}

export const COMPLETED_EVALUATIONS = Object.freeze({
  schema_version: 2,
  server_time_ms: MARKET.market_end_ms + 5_000,
  evaluation_semantics: {
    scored_input_max_future_skew_ms: 0,
  },
  market: MARKET,
  model: {
    model_version: MODEL_VERSION,
    horizon_ms: 3_000,
    beta: "1",
    evaluation_cadence_ms: 500,
    selection_identities: [
      {
        fingerprint_sha256: FINGERPRINT,
        artifact_sha256: ARTIFACT,
      },
    ],
  },
  coverage: {
    window_buckets: 600,
    market_window_elapsed: true,
    observed_buckets: 4,
    unobserved_buckets_as_of_response: 596,
    attempts: 5,
    valid_forecasts: 4,
    scored: 3,
    invalid: 1,
    valid_without_actual: 1,
  },
  points: [
    // Generated in market 41, but its target belongs to selected market 42.
    attempt({ generated_ms: 997_000 }),
    attempt({
      generated_ms: 997_500,
      projected_chainlink: "64104.00",
      futures_at_forecast: "64138.44",
    }),
    attempt({
      generated_ms: 998_000,
      valid: false,
      status: "invalid",
      invalid_reasons: ["chainlink_stale"],
      projected_chainlink: null,
      chainlink_at_forecast: null,
      chainlink_at_forecast_source_timestamp_ms: null,
      chainlink_at_forecast_received_ms: null,
      futures_at_forecast: null,
      futures_at_forecast_source_timestamp_ms: null,
      futures_at_forecast_received_ms: null,
      actual_chainlink: null,
      actual_chainlink_source_timestamp_ms: null,
      actual_chainlink_received_ms: null,
      actual_chainlink_age_at_target_ms: null,
      pending_move: null,
      pending_move_bps: null,
      direction: null,
      forecast_error: null,
      baseline_error: null,
    }),
    // The 998_500 generation bucket is deliberately absent.
    attempt({
      generated_ms: 999_000,
      projected_chainlink: "64106.00",
      futures_at_forecast: "64140.60",
      actual_chainlink: null,
      actual_chainlink_source_timestamp_ms: null,
      actual_chainlink_received_ms: null,
      actual_chainlink_age_at_target_ms: null,
      forecast_error: null,
      baseline_error: null,
    }),
    // A target at the half-open end belongs to the next market.
    attempt({
      generated_ms: 1_297_000,
      target_ms: MARKET.market_end_ms,
      futures_at_forecast: "64212.75",
    }),
  ],
});

export const PERFORMANCE_COHORT = Object.freeze({
  selection_identity: {
    fingerprint_sha256: FINGERPRINT,
    artifact_sha256: ARTIFACT,
  },
  scored_points: 2,
  forecast: {
    mean_absolute_error_usd: "3.25",
    median_absolute_error_usd: "3.25",
    p95_absolute_error_usd: "3.25",
    maximum_absolute_error_usd: "3.25",
    root_mean_squared_error_usd: "4.20",
    mean_signed_error_usd: "0.42",
  },
  no_change_baseline: {
    mean_absolute_error_usd: "19.35",
    root_mean_squared_error_usd: "20.10",
  },
  mean_absolute_advantage_usd: "16.10",
  mae_skill_vs_no_change: "0.832041343669250646",
  rmse_skill_vs_no_change: "0.791044776119402985",
  paired_comparison: {
    wins: 2,
    ties: 0,
    losses: 0,
    win_rate: "1",
    tie_rate: "0",
    loss_rate: "0",
  },
});

export const PERFORMANCE_EVALUATIONS = Object.freeze({
  schema_version: 2,
  server_time_ms: MARKET.market_end_ms + 5_000,
  evaluation_semantics: COMPLETED_EVALUATIONS.evaluation_semantics,
  market: MARKET,
  model: COMPLETED_EVALUATIONS.model,
  coverage: {
    window_buckets: 600,
    market_window_elapsed: true,
    observed_buckets: 3,
    unobserved_buckets_as_of_response: 597,
    attempts: 4,
    valid_forecasts: 3,
    scored: 2,
    invalid: 1,
    valid_without_actual: 1,
  },
  points: COMPLETED_EVALUATIONS.points.slice(0, 4),
  performance: { cohorts: [PERFORMANCE_COHORT] },
});

export const LIVE_PAYLOAD = Object.freeze({
  server_time_ms: 1_003_050,
  ...MARKET,
  prices: {
    chainlink: {
      value: "64100.01",
      received_age_ms: 75,
      source_age_ms: 180,
    },
  },
  futures: {
    last: {
      value: "64112.50",
      source_timestamp_ms: 1_003_020,
      time_ms: 1_003_020,
      received_ms: 1_003_035,
      source_age_ms: 30,
      received_age_ms: 15,
    },
  },
  signals: {
    chainlink_catchup: {
      model_version: MODEL_VERSION,
      generated_ms: 1_003_000,
      horizon_ms: 3_000,
      valid: true,
      status: "valid",
      invalid_reasons: [],
      projected_chainlink: "64108.25",
      selection_fingerprint_sha256: FINGERPRINT,
      selection_artifact_sha256: ARTIFACT,
      market: {
        market_id: 42,
        market_start_ms: MARKET.market_start_ms,
        market_end_ms: MARKET.market_end_ms,
      },
    },
  },
});

export { attempt as evaluationAttempt };
