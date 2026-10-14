import { test as base } from "@playwright/test"

export * from "@playwright/test"

/**
 * Every spec's `test`: the runner's own, and after each test it closes the browser contexts that test opened itself
 * (browser.newContext()). The runner closes only its `context` fixture; the browser is the worker's, and with one
 * worker it lives for the whole run, so a context left open kept its page running the app (the map, the feed's 30 s
 * check) through every later spec. A full run's failure snapshot showed backend-flow's page fifteen tests on (adviser a56,
 * CI-EVIDENCE-1), and the late timeouts came on a machine those pages kept busy.
 */
/**
 * `noWebGL: true` (a project's `use`) gives every page a browser that can't draw the map, as with hardware acceleration
 * off. The compatibility run sets it for desktop Firefox and WebKit: CI's runners have no GPU, Firefox there has no
 * WebGL2 at all, and WebKit drew the map in software at about 1.5 frames a second, which left entrances and the night
 * switch measured half-way. The map itself is checked in Chromium; these runs check everything around it.
 */
export type Options = { noWebGL: boolean }

export const test = base.extend<{ closeOwnContexts: void } & Options>({
  noWebGL: [false, { option: true }],
  page: async ({ page, noWebGL }, provide) => {
    if (noWebGL)
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          return /webgl/.test(type) ? null : original.call(this, type as "2d", ...(rest as []))
        } as typeof original
      })
    await provide(page)
  },
  closeOwnContexts: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts())
      await use()
      await Promise.all(
        browser
          .contexts()
          .filter((c) => !before.has(c))
          .map((c) => c.close()),
      )
    },
    { auto: true },
  ],
})
