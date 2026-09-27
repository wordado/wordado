/** Runs `fn` over `items` with at most `limit` in flight; results keep item order. The first failure rejects, and no new item starts after it. */
export async function mapLimit<I, O>(items: readonly I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out: O[] = Array.from({ length: items.length })
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next
      next += 1
      try {
        out[i] = await fn(items[i]!, i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}
