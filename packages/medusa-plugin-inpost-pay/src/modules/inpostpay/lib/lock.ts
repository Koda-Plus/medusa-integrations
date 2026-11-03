/**
 * One task per key at a time in this process: a second one waits for the
 * first. Only this process: several instances of the server do not see
 * each other's locks.
 */
const locks = new Map<string, Promise<unknown>>()

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const chained = previous.then(() => mine)
  locks.set(key, chained)
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    release()
    if (locks.get(key) === chained) locks.delete(key)
  }
}
