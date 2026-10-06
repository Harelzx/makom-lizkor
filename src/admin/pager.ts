/** One page of a list, newest first; `next` continues it, null at its end. */
export type Page<T> = { items: T[]; next: string | null }

/** What a list shows: its rows (null before the first answer), where it continues, and the last failure, if any. */
export type PagerState<T> = { items: T[] | null; next: string | null; error: string; failed: "refresh" | "more" | null; busy: boolean }

/**
 * A moderators' list read a page at a time. One request is on its way at a time, and a refresh supersedes whatever
 * is still coming: a late older page would otherwise land on the refreshed rows with a cursor the refresh replaced,
 * and bring back what was already handled. A failure keeps the rows already shown, so a moment without the server
 * never reads as an empty queue.
 */
export function createPager<T>(fetch: (cursor: string | null) => Promise<Page<T> | string>, emit: (state: PagerState<T>) => void) {
  let state: PagerState<T> = { items: null, next: null, error: "", failed: null, busy: false }
  let generation = 0
  const set = (change: Partial<PagerState<T>>) => emit((state = { ...state, ...change }))

  async function refresh() {
    const mine = ++generation
    set({ busy: true })
    const page = await fetch(null)
    if (mine !== generation) return
    if (typeof page === "string") return set({ error: page, failed: "refresh", busy: false })
    set({ items: page.items, next: page.next, error: "", failed: null, busy: false })
  }

  async function more() {
    if (state.busy || !state.next) return
    const mine = generation
    set({ busy: true })
    const page = await fetch(state.next)
    if (mine !== generation) return
    if (typeof page === "string") return set({ error: page, failed: "more", busy: false })
    set({ items: [...(state.items ?? []), ...page.items], next: page.next, error: "", failed: null, busy: false })
  }

  return { refresh, more }
}
