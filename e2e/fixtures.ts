import { test as base } from "@playwright/test"

export * from "@playwright/test"

/**
 * Every spec's `test`: the runner's own, and after each test it closes the browser contexts that test opened itself
 * (browser.newContext()). The runner closes only its `context` fixture; the browser is the worker's, and with one
 * worker it lives for the whole run, so a context left open kept its page running the app (the map, the feed's 30 s
 * check) through every later spec. A full run's failure snapshot showed backend-flow's page fifteen tests on (adviser a56,
 * CI-EVIDENCE-1), and the late timeouts came on a machine those pages kept busy.
 */
export const test = base.extend<{ closeOwnContexts: void }>({
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
