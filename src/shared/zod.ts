import { z } from "zod"

// No generated code: zod's probe for it (new Function) is an eval the site's policy refuses (spec 11), and the Worker's
// runtime refuses it too. zod decides when a schema is built, so every shared schema takes z from here: the setting
// then runs before the first of them, whichever module loads first. The schemas are small, so interpreting them costs
// nothing a visitor would notice.
z.config({ jitless: true })

export { z }
