// Cloudflare's browser check before a submission or a correction is sent (spec 12). The script loads only when something
// is about to be sent, never during the opening. The widget stays out of sight unless Cloudflare asks the visitor to
// interact, and then it appears at the bottom of the screen.
const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let loading: Promise<Turnstile> | null = null

function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_missing")))
    s.onerror = () => reject(new Error("turnstile_unreachable"))
    document.head.appendChild(s)
  }).catch((err) => {
    loading = null // the next send tries to load it again
    throw err
  })
  return loading
}

/** A fresh, single-use token for this action; null when the check can't run now (the send is then retried later). */
export async function turnstileToken(action: "submit" | "revise" | "report"): Promise<string | null> {
  if (!SITEKEY) return null
  let t: Turnstile
  try {
    t = await load()
  } catch {
    return null
  }
  const host = document.createElement("div")
  Object.assign(host.style, {
    position: "fixed",
    insetInline: "0",
    bottom: "16px",
    display: "flex",
    justifyContent: "center",
    zIndex: "100",
  })
  document.body.appendChild(host)
  return new Promise((resolve) => {
    let id = ""
    const done = (token: string | null) => {
      clearTimeout(timer)
      if (id) t.remove(id)
      host.remove()
      resolve(token)
    }
    const timer = setTimeout(() => done(null), 60_000)
    id = t.render(host, {
      sitekey: SITEKEY,
      action,
      appearance: "interaction-only",
      language: "he",
      callback: (token: string) => done(token),
      "error-callback": () => done(null),
      "timeout-callback": () => done(null),
    })
  })
}
