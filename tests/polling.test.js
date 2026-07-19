import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETRY_DELAYS_MS,
  createPoller,
  retryDelayMs,
} from "../src/controllers/polling.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("retryDelayMs", () => {
  it("uses the bounded 1, 2, 4, then 5 second retry sequence", () => {
    expect(RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 5_000]);
    expect([1, 2, 3, 4, 5, 20].map((attempt) => retryDelayMs(attempt))).toEqual(
      [1_000, 2_000, 4_000, 5_000, 5_000, 5_000],
    );
  });
});

describe("createPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps start-time cadence after settlement and never overlaps requests", async () => {
    const first = deferred();
    let active = 0;
    let maximumActive = 0;
    let calls = 0;

    const poller = createPoller(
      async () => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (calls === 1) {
          await first.promise;
        }
        active -= 1;
      },
      { intervalMs: 2_000 },
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(1);
    expect(maximumActive).toBe(1);

    first.resolve();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    expect(maximumActive).toBe(1);

    poller.stop();
  });

  it("subtracts request duration from the healthy polling interval", async () => {
    const task = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const poller = createPoller(task, { intervalMs: 100 });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("backs off after failures and resets to normal cadence after success", async () => {
    const retryMetadata = [];
    const outcomes = ["failure", "failure", "failure", "failure", "success"];
    const task = vi.fn(async () => {
      if (outcomes.shift() === "failure") {
        throw new Error("offline");
      }
    });
    const poller = createPoller(task, {
      intervalMs: 10_000,
      onError: (_error, metadata) => retryMetadata.push(metadata),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(task).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(5);

    expect(retryMetadata.map(({ retryInMs }) => retryInMs)).toEqual([
      1_000,
      2_000,
      4_000,
      5_000,
    ]);
    expect(poller.failures).toBe(0);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(task).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(6);

    poller.stop();
  });

  it("aborts on pause and waits for the old task to settle before resuming", async () => {
    const oldRequest = deferred();
    const signals = [];
    const task = vi.fn(async (signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        // Deliberately ignore abort to prove resume cannot overlap this task.
        await oldRequest.promise;
      }
    });
    const poller = createPoller(task, { intervalMs: 1_000 });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    poller.pause();
    expect(signals[0].aborted).toBe(true);
    poller.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);

    oldRequest.resolve();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("aborts an in-flight request and cancels future work when stopped", async () => {
    const signals = [];
    const task = vi.fn(
      (signal) =>
        new Promise((resolve) => {
          signals.push(signal);
          signal.addEventListener("abort", resolve, { once: true });
        }),
    );
    const poller = createPoller(task, { intervalMs: 1_000 });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    poller.stop("Mode changed");
    expect(signals[0].aborted).toBe(true);
    await poller.whenIdle();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(task).toHaveBeenCalledTimes(1);
    expect(poller.state).toBe("stopped");
  });

  it("honors an external lifecycle AbortSignal", async () => {
    const lifecycle = new AbortController();
    let requestSignal;
    const task = vi.fn(
      (signal) =>
        new Promise((resolve) => {
          requestSignal = signal;
          signal.addEventListener("abort", resolve, { once: true });
        }),
    );
    const poller = createPoller(task, {
      intervalMs: 1_000,
      signal: lifecycle.signal,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    lifecycle.abort("Market changed");
    expect(requestSignal.aborted).toBe(true);
    await poller.whenIdle();
    expect(poller.state).toBe("stopped");
  });
});
