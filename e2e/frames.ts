import type { Locator, Page } from "@playwright/test"

export interface Frame {
  t: number
  /** the box as the eye sees it, transforms included */
  x: number
  y: number
  w: number
  h: number
  /** smallest corner radius actually drawn, in screen pixels */
  radius: number
  opacity: number
}

/**
 * Records `selector` on every animation frame while `act` runs and for `ms` after.
 * Radii are resolved the way the browser draws them: percentages against the layout box, then scaled by any transform.
 */
export async function record(page: Page, selector: string, act: () => Promise<unknown>, ms = 1200): Promise<Frame[]> {
  await page.evaluate(
    ([sel, dur]) => {
      const w = window as unknown as { __frames: unknown[]; __done: Promise<void> }
      w.__frames = []
      const px = (v: string, size: number) => (v.endsWith("%") ? (parseFloat(v) / 100) * size : parseFloat(v) || 0)
      const t0 = performance.now()
      w.__done = new Promise((done) => {
        const tick = () => {
          const el = document.querySelector<HTMLElement>(sel)
          if (el) {
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            const sx = el.offsetWidth ? r.width / el.offsetWidth : 1
            const sy = el.offsetHeight ? r.height / el.offsetHeight : 1
            const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius]
            const radius = Math.min(
              ...corners.flatMap((c) => {
                const [h, v = h] = c.split(" ")
                return [px(h, el.offsetWidth) * sx, px(v, el.offsetHeight) * sy]
              }),
            )
            w.__frames.push({ t: performance.now() - t0, x: r.x, y: r.y, w: r.width, h: r.height, radius, opacity: +cs.opacity })
          }
          if (performance.now() - t0 < dur) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
    },
    [selector, ms] as const,
  )
  await act()
  await page.evaluate(() => (window as unknown as { __done: Promise<void> }).__done)
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)
}

/**
 * Waits until the page renders quietly: `run` frames in a row, each under `ms`. The camera's flight to a place lasts
 * 2.8 s and tiles keep arriving after it; a panel recorded while the map still repaints every frame measured the
 * machine's load, not the panel's motion. Gives up after `timeout` and lets the measurement speak for itself.
 */
export async function settle(page: Page, { run = 20, ms = 25, timeout = 12_000 } = {}) {
  await page.evaluate(
    ([run, ms, timeout]) =>
      new Promise<void>((done) => {
        const start = performance.now()
        let last = start
        let quiet = 0
        const tick = (now: number) => {
          quiet = now - last < ms ? quiet + 1 : 0
          last = now
          if (quiet >= run || now - start > timeout) done()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    [run, ms, timeout] as const,
  )
}

/** Lands straight in the day view on one place, skipping the opening, once the map has stopped moving. */
export async function openPlace(page: Page, id = "car-wall-tkuma") {
  await page.goto(`/#/place/${id}`)
  await page.getByRole("button", { name: "כל המקומות" }).waitFor()
  await page.waitForTimeout(1500)
  await settle(page)
}

export const visible = async (l: Locator) => (await l.count()) > 0 && l.first().isVisible()
