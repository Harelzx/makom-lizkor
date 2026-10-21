import { z } from "zod"

// The site-health view's schema on its own (no database code), shared by the Worker and the moderators' page.

const count = z.number().int().nonnegative()
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)

/**
 * The hourly counters as stored (lib/metrics.ts): `http_<status>` rows are a 1-in-`sample_every` sample of what the
 * Worker answered, with their summed and slow (2 s or more) response times; `err_<what>` rows count every server error,
 * failed scheduled part and browser report whole. Codes only: nothing of a request or a person.
 */
export const SiteHealth = z
  .object({
    generated_at: iso,
    /** The serving version's tag (release-<sha>), or null for an untagged upload. */
    version: z.string().max(80).nullable(),
    sample_every: count,
    window_hours: count,
    hours: z.array(
      z
        .object({
          hour: iso,
          code: z.string().regex(/^(http_[1-5]\d\d|err_[a-z][a-z0-9_]{0,47})$/),
          samples: count,
          total_ms: count,
          slow: count,
        })
        .strict(),
    ),
  })
  .strict()
export type SiteHealth = z.infer<typeof SiteHealth>
