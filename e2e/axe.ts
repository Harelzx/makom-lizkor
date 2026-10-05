import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"

// Israeli Standard 5568 adopts WCAG 2.0 at level AA, so these are the rules axe runs. An automated pass finds only part
// of what matters; the accessibility statement in src/data/legal.ts says what was checked by hand, and how.
const TAGS = ["wcag2a", "wcag2aa"]

export async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  // the rule and the elements it caught, so a failure reads as something to fix
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([])
}
