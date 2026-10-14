import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// The accessibility checks again in Firefox and in WebKit, Safari's engine, beside the main suite's Chromium. Only the
// accessibility specs; the motion checks sample Chromium's frames and stay there. Firefox has no phone emulation, so
// the phone check runs in WebKit only. `npm run e2e:browsers`.
export default defineConfig({
  ...base,
  projects: [
    { name: "seed", testMatch: /seed\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      dependencies: ["seed"],
      testMatch: /a11y\.spec\.ts$/,
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "webkit",
      dependencies: ["seed"],
      testMatch: /a11y\.spec\.ts$/,
      // CI's runner has no GPU: WebKit draws the map in software at about 1.5 frames a second, and the entrances and
      // the night switch's colour transition were measured mid-way (the sound choice at opacity 0, the search text
      // halfway to night). These checks are of the settled page, which reduced motion gives at once; the site honours
      // it everywhere, and the motion itself is checked in Chromium.
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" },
    },
    {
      name: "webkit-phone",
      dependencies: ["seed"],
      testMatch:
        /(a11y-phone|phone-followup|location-feedback|location-keyboard|location-review|performance-guards|photo|security-headers)\.spec\.ts$/,
      use: { ...devices["iPhone 13"] },
    },
  ],
})
