export function importCurated(options: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  base: string
  records: readonly unknown[]
  readPhoto: (file: string) => Promise<{ file: Uint8Array; thumb: Uint8Array; name: string }>
  headers: Record<string, string>
}): Promise<{ created: string[]; skipped: string[] }>
