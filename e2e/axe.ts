import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

// Israeli Standard 5568 adopts WCAG 2.0 at level AA, so these are the rules axe runs. An automated pass finds only part
// of what matters; the accessibility statement in src/data/legal.ts says what was checked by hand, and how.
const TAGS = ["wcag2a", "wcag2aa"]

export async function audit(page: Page) {
  // Contrast is a property of the settled page: wait out the transitions and animations still running (a theme's
  // colour change, a dialog's entrance), which a slow machine (CI's WebKit, without a GPU) can be measured in the middle of.
  // Endless ones (the glow's breath, the clippings' drift) never finish and are left alone, and a paused one would wait
  // forever, so the wait has a ceiling.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((done) => setTimeout(done, 3000)),
    ]),
  )
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  if (violations.length)
    await test.info().attach("accessibility-violations", { body: JSON.stringify(violations, null, 2), contentType: "application/json" })
  // the rule and the elements it caught, so a failure reads as something to fix
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([])
}
