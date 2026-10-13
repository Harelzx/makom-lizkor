import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { Queue } from "./queue"
import { Reports } from "./reports"
import { CuratedImport } from "./curated-import"
import { Operations } from "./operations"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The site's body never scrolls (the map fills it), so the admin page scrolls on its own. Requests come first:
        each one is reviewed urgently (spec 6). */}
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 p-6">
        <h1 className="sr-only">ניהול · מקום לזכור</h1>
        <Operations />
        <Reports />
        <Queue />
        <CuratedImport />
      </div>
    </main>
  </StrictMode>,
)
