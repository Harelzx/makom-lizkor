import type { readImportPacket } from "../import-packet"

/** The prototype's import file: two made-up places without photos, so the import can be tried without a real packet. */
export const samplePacket = () =>
  ({
    places: [
      { id: "demo-import-garden", name_he: "גן הזיכרון בכניסה למושב (דמה)", photos: [] },
      { id: "demo-import-lookout", name_he: "מצפור הבשור (דמה)", photos: [] },
    ],
    pictures: new Map(),
    photoCount: 0,
  }) as unknown as ReturnType<typeof readImportPacket>
