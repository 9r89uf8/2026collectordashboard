export const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 5_000]);

export function retryDelayMs(
  consecutiveFailures,
  retryDelays = RETRY_DELAYS_MS,
) {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new TypeError("consecutiveFailures must be a positive integer");
  }
  if (!Array.isArray(retryDelays) || retryDelays.length === 0) {
    throw new TypeError("retryDelays must be a non-empty array");
  }

  const delay = retryDelays[
    Math.min(consecutiveFailures - 1, retryDelays.length - 1)
  ];
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError("retry delays must be non-negative finite numbers");
  }
  return delay;
}

function normalizePollerArguments(taskOrOptions, suppliedOptions) {
  if (typeof taskOrOptions === "function") {
    return { ...suppliedOptions, task: taskOrOptions };
  }
  if (taskOrOptions && typeof taskOrOptions === "object") {
    return taskOrOptions;
  }
  throw new TypeError("createPoller requires a polling task");
}

function validateDelay(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
}

/**
 * Create a recursive, non-overlapping poll.
 *
 * `task` receives `(signal, context)`. The next timeout is created only after
 * the returned promise settles. `pause`, `refresh`, and `stop` abort the
 * current AbortSignal; a replacement task is still held until the prior task
 * has actually settled, which preserves the no-overlap guarantee even when a
 * task is slow to react to abort.
 */
export function createPoller(taskOrOptions, suppliedOptions = {}) {
  const options = normalizePollerArguments(taskOrOptions, suppliedOptions);
  const task = options.task ?? options.poll;
  const intervalMs = options.intervalMs;
  const retryDelays = options.retryDelays ?? RETRY_DELAYS_MS;
  const runImmediately = options.immediate ?? true;
  const onError = options.onError;
  const externalSignal = options.signal;
  const setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout;

  if (typeof task !== "function") {
    throw new TypeError("polling task must be a function");
  }
  validateDelay(intervalMs, "intervalMs");
  if (!Array.isArray(retryDelays) || retryDelays.length === 0) {
    throw new TypeError("retryDelays must be a non-empty array");
  }
  retryDelays.forEach((delay) => validateDelay(delay, "retry delay"));
  if (onError !== undefined && typeof onError !== "function") {
    throw new TypeError("onError must be a function");
  }
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("timer functions are required");
  }

  let state = "idle";
  let timerId = null;
  let requestController = null;
  let inFlightPromise = null;
  let consecutiveFailures = 0;
  let immediatePending = false;
  let externalAbortListener = null;

  function clearScheduled() {
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function schedule(delay) {
    if (state !== "running" || timerId !== null || inFlightPromise !== null) {
      return;
    }

    timerId = setTimeoutFn(() => {
      timerId = null;
      void execute();
    }, delay);
  }

  async function reportError(error, context) {
    if (!onError) {
      return;
    }
    try {
      await onError(error, context);
    } catch {
      // An observer must not permanently stop polling. The original request
      // failure remains represented by the retry state.
    }
  }

  async function execute() {
    if (state !== "running") {
      return;
    }
    if (inFlightPromise !== null) {
      immediatePending = true;
      return inFlightPromise;
    }

    const controller = new AbortController();
    requestController = controller;
    let nextDelay = intervalMs;

    const operation = (async () => {
      try {
        await task(controller.signal, {
          consecutiveFailures,
          refresh: () => refresh(),
        });

        if (!controller.signal.aborted) {
          consecutiveFailures = 0;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          consecutiveFailures += 1;
          nextDelay = retryDelayMs(consecutiveFailures, retryDelays);
          await reportError(error, {
            consecutiveFailures,
            retryInMs: nextDelay,
          });
        }
      }
    })();

    inFlightPromise = operation;

    try {
      await operation;
    } finally {
      if (requestController === controller) {
        requestController = null;
      }
      if (inFlightPromise === operation) {
        inFlightPromise = null;
      }

      if (state === "running") {
        if (immediatePending) {
          immediatePending = false;
          schedule(0);
        } else {
          schedule(nextDelay);
        }
      }
    }
  }

  function attachExternalSignal() {
    if (!externalSignal || externalAbortListener) {
      return;
    }
    externalAbortListener = () => stop(externalSignal.reason);
    externalSignal.addEventListener("abort", externalAbortListener, {
      once: true,
    });
  }

  function detachExternalSignal() {
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener("abort", externalAbortListener);
      externalAbortListener = null;
    }
  }

  function start({ immediate = runImmediately } = {}) {
    if (state === "stopped") {
      return false;
    }
    if (externalSignal?.aborted) {
      state = "stopped";
      return false;
    }
    if (state === "running") {
      return false;
    }

    attachExternalSignal();
    state = "running";
    immediatePending = false;
    schedule(immediate ? 0 : intervalMs);
    return true;
  }

  function pause(reason = "Polling paused") {
    if (state === "stopped" || state === "paused") {
      return false;
    }

    state = "paused";
    immediatePending = false;
    clearScheduled();
    requestController?.abort(reason);
    return true;
  }

  function resume({ immediate = true } = {}) {
    if (state === "stopped" || state === "running") {
      return false;
    }
    if (externalSignal?.aborted) {
      stop(externalSignal.reason);
      return false;
    }

    attachExternalSignal();
    state = "running";
    consecutiveFailures = 0;

    if (inFlightPromise !== null) {
      immediatePending = immediate;
    } else {
      schedule(immediate ? 0 : intervalMs);
    }
    return true;
  }

  function refresh({ abortCurrent = false } = {}) {
    if (state !== "running") {
      return false;
    }

    clearScheduled();
    if (inFlightPromise !== null) {
      immediatePending = true;
      if (abortCurrent) {
        requestController?.abort("Polling refresh superseded the request");
      }
    } else {
      schedule(0);
    }
    return true;
  }

  function stop(reason = "Polling stopped") {
    if (state === "stopped") {
      return false;
    }

    state = "stopped";
    immediatePending = false;
    clearScheduled();
    requestController?.abort(reason);
    detachExternalSignal();
    return true;
  }

  function whenIdle() {
    return inFlightPromise
      ? inFlightPromise.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
  }

  return {
    start,
    pause,
    resume,
    refresh,
    runNow: refresh,
    stop,
    abort: stop,
    whenIdle,
    get state() {
      return state;
    },
    get running() {
      return state === "running";
    },
    get paused() {
      return state === "paused";
    },
    get inFlight() {
      return inFlightPromise !== null;
    },
    get failures() {
      return consecutiveFailures;
    },
  };
}

/**
 * Coordinate several pollers with page visibility.
 *
 * `onVisibleRefresh(signal)` is awaited while every child remains paused. It
 * is the hook for the required immediate anchored `/current/live` refresh;
 * normal child cadences resume only after that hook settles.
 */
export function createPollingGroup(
  pollersOrOptions = [],
  suppliedOptions = {},
) {
  const options = Array.isArray(pollersOrOptions)
    ? { ...suppliedOptions, pollers: pollersOrOptions }
    : pollersOrOptions;
  const pollers = options.pollers ?? [];
  const documentRef = options.documentRef ?? globalThis.document;
  const onVisibleRefresh = options.onVisibleRefresh;
  const onError = options.onError;

  if (!Array.isArray(pollers)) {
    throw new TypeError("pollers must be an array");
  }
  if (
    onVisibleRefresh !== undefined &&
    typeof onVisibleRefresh !== "function"
  ) {
    throw new TypeError("onVisibleRefresh must be a function");
  }

  let state = "idle";
  let transitionId = 0;
  let refreshController = null;
  let listening = false;

  function listen() {
    if (!listening && documentRef?.addEventListener) {
      documentRef.addEventListener("visibilitychange", handleVisibility);
      listening = true;
    }
  }

  function unlisten() {
    if (listening && documentRef?.removeEventListener) {
      documentRef.removeEventListener("visibilitychange", handleVisibility);
      listening = false;
    }
  }

  function pause(reason = "Page hidden") {
    if (state === "stopped") {
      return false;
    }
    transitionId += 1;
    state = "paused";
    refreshController?.abort(reason);
    pollers.forEach((poller) => poller.pause(reason));
    return true;
  }

  async function resume({ immediate = true } = {}) {
    if (state === "stopped") {
      return false;
    }

    const ownTransition = ++transitionId;
    state = "resuming";
    await Promise.all(pollers.map((poller) => poller.whenIdle()));

    if (state === "stopped" || ownTransition !== transitionId) {
      return false;
    }

    let anchored = false;
    if (immediate && onVisibleRefresh) {
      const controller = new AbortController();
      refreshController = controller;
      try {
        await onVisibleRefresh(controller.signal);
        anchored = !controller.signal.aborted;
      } catch (error) {
        if (!controller.signal.aborted && onError) {
          await onError(error);
        }
      } finally {
        if (refreshController === controller) {
          refreshController = null;
        }
      }
    }

    if (state === "stopped" || ownTransition !== transitionId) {
      return false;
    }

    state = "running";
    const childImmediate = immediate && !anchored;
    pollers.forEach((poller) => {
      if (poller.state === "idle") {
        poller.start({ immediate: childImmediate });
      } else {
        poller.resume({ immediate: childImmediate });
      }
    });
    return true;
  }

  function start() {
    if (state !== "idle") {
      return false;
    }
    listen();
    if (documentRef?.hidden) {
      state = "paused";
      pollers.forEach((poller) => poller.pause("Page hidden"));
    } else {
      void resume({ immediate: true });
    }
    return true;
  }

  function stop(reason = "Polling group stopped") {
    if (state === "stopped") {
      return false;
    }
    transitionId += 1;
    state = "stopped";
    refreshController?.abort(reason);
    pollers.forEach((poller) => poller.stop(reason));
    unlisten();
    return true;
  }

  function handleVisibility() {
    if (documentRef.hidden) {
      pause("Page hidden");
    } else {
      void resume({ immediate: true });
    }
  }

  return {
    start,
    pause,
    resume,
    stop,
    abort: stop,
    get state() {
      return state;
    },
  };
}
