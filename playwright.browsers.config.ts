import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// The accessibility checks again in WebKit, Safari's engine: a second browser beside the main suite's Chromium. Only
// the accessibility specs; the motion checks sample Chromium's frames and stay there. `npm run e2e:browsers`.
export default defineConfig({
  ...base,
  projects: [
    { name: "webkit", testMatch: /a11y\.spec\.ts$/, use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit-phone", testMatch: /a11y-phone\.spec\.ts$/, use: { ...devices["iPhone 13"] } },
  ],
})
