// The site picks night or day by the hour; this page follows the moderator's own system setting, unless they chose
// one with the toggle. That choice is a convenience of this browser only, so a storage that refuses it changes nothing.
const KEY = "makom-admin-theme"
const system = matchMedia("(prefers-color-scheme: dark)")

function chosen(): "light" | "dark" | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : null
  } catch {
    return null
  }
}

export const isDark = () => (chosen() ?? (system.matches ? "dark" : "light")) === "dark"

export function applyTheme() {
  const dark = isDark()
  document.documentElement.classList.toggle("dark", dark)
  // Native checkboxes, date pickers and scrollbars follow too.
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

export function toggleTheme() {
  try {
    localStorage.setItem(KEY, isDark() ? "light" : "dark")
  } catch {
    /* not kept: the toggle still applies to this page */
    document.documentElement.classList.toggle("dark")
    return
  }
  applyTheme()
}

system.addEventListener("change", applyTheme)
