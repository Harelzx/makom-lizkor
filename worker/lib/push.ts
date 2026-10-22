/**
 * A technical alert to the owner's phone as well (ntfy, the topic in NTFY_TOPIC), beside the mail: it doesn't go
 * through Gmail, so an alert whose mail can't go still arrives. The alerts are codes and counts, never anyone's data.
 * Best effort: a push that fails changes nothing else. No topic (development, tests): nothing is sent.
 */
export async function pushAlert(env: Env, title: string, message: string): Promise<boolean> {
  const topic = env.NTFY_TOPIC?.trim()
  if (!topic) return false
  try {
    const response = await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, title, message: message.slice(0, 3500), tags: ["warning"] }),
      signal: AbortSignal.timeout(10_000),
    })
    return response.ok
  } catch {
    return false
  }
}
