/** Typography only: stored visitor text, links, ids and snapshot hashes stay untouched. */
export const plainDashes = (text: string) => text.replace(/[\u2013\u2014]/g, "-")

/** Database prose may predate the site's copy. Normalize visible fields when projecting it into UI records. */
export function displayTextFields<T>(value: T, prose = false): T {
  if (typeof value === "string") return (prose ? plainDashes(value) : value) as T
  if (Array.isArray(value)) return value.map((v) => displayTextFields(v, prose)) as T
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        displayTextFields(v, /(?:_he$|^(?:inMemoryOf|accessNote|author|story|progress)$)/.test(key)),
      ]),
    ) as T
  return value
}
