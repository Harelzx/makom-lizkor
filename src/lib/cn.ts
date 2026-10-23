// The project's class merger. It has to know the design system's type scale and elevation:
// otherwise `text-title-2` looks like a text *color* to the merger and is dropped next to `text-ink-1`. The admin's
// own sizes (`text-a-13` …) too.
import { createCn } from "cn/config"

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "statement",
            "title-1",
            "title-2",
            "title-3",
            "headline",
            "body-lg",
            "body",
            "label",
            "caption",
            "micro",
            (v: string) => /^a-\d+$/.test(v),
          ],
        },
      ],
      shadow: [{ shadow: ["chip", "float", "panel", "brand"] }],
    },
  },
})
