const MIN_INTERVAL_MS = 1000;
const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_MS = 5000;
export function sleep(ms, signal) {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export async function pollDeviceFlow(options) {
  const deadline = typeof options.expiresInSeconds === "number" ? Date.now() + options.expiresInSeconds * 1000 : Number.POSITIVE_INFINITY;
  let intervalMs = Math.max(MIN_INTERVAL_MS, Math.floor((options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000));
  let slowDowns = 0;
  while (Date.now() < deadline) {
    if (options.signal?.aborted)
      throw new Error("aborted");
    const result = await options.poll();
    if (result.status === "complete")
      return result.value;
    if (result.status === "failed")
      throw new Error(result.message);
    if (result.status === "slow_down") {
      slowDowns += 1;
      intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs + SLOW_DOWN_INCREMENT_MS);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      break;
    await sleep(Math.min(intervalMs, remaining), options.signal);
  }
  throw new Error(slowDowns > 0 ? "设备授权超时（多次 slow_down，可能是时钟漂移）" : "设备授权超时");
}
