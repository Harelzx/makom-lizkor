import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// The accessibility checks again in Firefox and in WebKit, Safari's engine, beside the main suite's Chromium. Only the
// accessibility specs; the motion checks sample Chromium's frames and stay there. Firefox has no phone emulation, so
// the phone check runs in WebKit only. `npm run e2e:browsers`.
export default defineConfig({
  ...base,
  projects: [
    { name: "firefox", testMatch: /a11y\.spec\.ts$/, use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit", testMatch: /a11y\.spec\.ts$/, use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit-phone", testMatch: /a11y-phone\.spec\.ts$/, use: { ...devices["iPhone 13"] } },
  ],
})
