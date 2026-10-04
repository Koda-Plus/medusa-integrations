/**
 * RETRIES. A failed call is classified once (`retryable` comes from the bridge
 * or from the kind of network failure) and then scheduled here.
 */

export interface RetryPlan {
  /** `pending` with a later `nextAttemptAt`, or `failed` for good. */
  status: "pending" | "failed"
  nextAttemptAt: Date | null
}

/** Delay before the attempt that follows `attempts` failed ones, with up to 10 % jitter. */
export function retryDelaySeconds(attempts: number, steps: readonly number[], random: () => number = Math.random): number {
  if (steps.length === 0) return 60
  const index = Math.min(Math.max(attempts - 1, 0), steps.length - 1)
  const base = steps[index]
  const jitter = base * 0.1 * random()
  return Math.round(base + jitter)
}

/**
 * What happens to a task after a failed attempt. `attempts` already counts
 * the attempt that just failed.
 */
export function planRetry(args: {
  attempts: number
  retryable: boolean
  maxAttempts: number
  steps: readonly number[]
  now: Date
  random?: () => number
}): RetryPlan {
  if (!args.retryable || args.attempts >= args.maxAttempts) return { status: "failed", nextAttemptAt: null }
  const delay = retryDelaySeconds(args.attempts, args.steps, args.random)
  return { status: "pending", nextAttemptAt: new Date(args.now.getTime() + delay * 1000) }
}
