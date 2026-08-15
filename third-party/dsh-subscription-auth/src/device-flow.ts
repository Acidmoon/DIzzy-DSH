/**
 * RFC 8628 OAuth 设备授权流程的共享轮询逻辑（Grok / Kimi 共用）。
 * @module dsh-subscription-auth/device-flow
 */

export type DevicePollResult<T> =
  | { status: 'complete'; value: T }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'failed'; message: string }

export interface DeviceFlowOptions<T> {
  poll(): DevicePollResult<T> | Promise<DevicePollResult<T>>
  intervalSeconds?: number
  expiresInSeconds?: number
  signal?: AbortSignal
}

const MIN_INTERVAL_MS = 1000
const DEFAULT_INTERVAL_SECONDS = 5
const SLOW_DOWN_INCREMENT_MS = 5000

/** 可中止的 sleep。 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 轮询设备授权令牌直到完成 / 失败 / 超时 / 取消。 */
export async function pollDeviceFlow<T>(options: DeviceFlowOptions<T>): Promise<T> {
  const deadline =
    typeof options.expiresInSeconds === 'number'
      ? Date.now() + options.expiresInSeconds * 1000
      : Number.POSITIVE_INFINITY
  let intervalMs = Math.max(
    MIN_INTERVAL_MS,
    Math.floor((options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000),
  )
  let slowDowns = 0
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('aborted')
    const result = await options.poll()
    if (result.status === 'complete') return result.value
    if (result.status === 'failed') throw new Error(result.message)
    if (result.status === 'slow_down') {
      slowDowns += 1
      intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs + SLOW_DOWN_INCREMENT_MS)
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining), options.signal)
  }
  throw new Error(
    slowDowns > 0
      ? '设备授权超时（多次 slow_down，可能是时钟漂移）'
      : '设备授权超时',
  )
}
