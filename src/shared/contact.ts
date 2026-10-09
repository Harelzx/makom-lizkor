import { z } from "./zod"
import { text } from "./contract"

export const ContactInput = z
  .object({
    email: z.email().max(254),
    message: text({ max: 2000, multiline: true }),
  })
  .strict()
export type ContactInput = z.infer<typeof ContactInput>
