import type { Page } from "@playwright/test"

/**
 * The moderators' page is an inbox: every waiting item is a row named by what it is (a proposal by its name, a request
 * as «בקשה על …»), and the one chosen opens beside the list as an article of the same name.
 */
export async function openItem(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click()
  return page.getByRole("article", { name })
}
