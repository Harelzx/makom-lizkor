# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"מקום לזכור" (Makom Lizkor) is a static, Hebrew, RTL memorial map for the people murdered and killed on 7 October 2023. It shows monuments, lookouts, benches, groves and gardens, plus a page for each of the 22 attacked communities with its return status. The site opens at 06:29 on a dark map, and a sunrise turns it to morning. There is no backend. All data ships in JSON, and anything a visitor adds stays in their browser's IndexedDB.

## Repository layout

This directory (`web/`) is v2, the current site, and the git repository. It's the only place that gets development. Its parent folder is not under git and holds:

- `../app/`: v1, a frozen archive that covers memorials across all of Israel's wars. Don't change it.
- `../launch/`: launch assets (LinkedIn post, cover, demo video, stills) and ad-hoc Playwright capture/perf scripts in `../launch/tools/`, which has its own `package.json`. These scripts aren't part of the test suite.
- `../docs/`: written in Hebrew. `../docs/design-system.md` is the source of truth for design and motion rules, and `../docs/data-notes.md` records the data scope decisions.
- `../.claude/launch.json`: the preview server entries (`makom-lizkor-v2` runs this app on :5190).

## Commands

Run every command from this directory.

```bash
npm install            # postinstall runs patch-package (patches/vaul+1.1.2.patch passes `modal` to the drawer context; re-check it before bumping vaul)
npm run dev            # http://localhost:5174 (strictPort)
npm run build          # tsc -b && vite build → dist/
npm run typecheck      # tsc -b: src (tsconfig.app), vite.config (tsconfig.node), e2e + playwright.config (tsconfig.e2e)
npm run lint           # eslint
npm run format         # prettier --write over all ts/tsx/js/mjs
npm run format:check   # what to run before calling a change done
npm run e2e            # Playwright against the dev server on :5190
npm run e2e:prod       # builds, then runs the same specs against vite preview on :4174
npx playwright test e2e/routing.spec.ts          # one file
npx playwright test -g "shared link to a place"  # one test by name
node scripts/build-data.mjs                      # regenerate src/data/*.json from data-src/
```

- The only tests are Playwright e2e tests. There is no unit-test runner. The specs find elements by their **Hebrew accessible names** (`getByRole("button", { name: "כל המקומות" })`), so renaming a Hebrew label can break a test.
- `panel.spec.ts` samples real animation frames through `e2e/frames.ts` to check motion quality: no squared corners mid-spring, no single-frame jumps. Specs run serially (`workers: 1`).
- Ports are deliberately different: 5174 for `npm run dev`, 5190 for Playwright and the `makom-lizkor-v2` entry in `../.claude/launch.json` (with `reuseExistingServer`, the preview server and e2e share one process), and 4174 for prod e2e. Don't "unify" them.
- **Prettier is enforced**: no semicolons, double quotes, trailing commas, `printWidth` 140, with Tailwind classes sorted by `prettier-plugin-tailwindcss` (including inside `cn()` and `cva()`). An override keeps `src/components/ui/**` at shadcn's own format (80 columns, `es5` commas), so output from `shadcn add` drops in without churn. After editing, run `npm run format` and make sure `format:check` passes.
- `vite build` warns that some chunks exceed 500 kB. Those chunks are MapLibre's own library (the lazy `controller` chunk) and its worker, which already load after the opening. The warning is expected and can't be fixed by splitting.

## Architecture

### State and phases (`src/store.ts`)
A single Zustand store holds everything: the seed places, the visitor's local places, tributes, the selection, the tab, open dialogs and the journey index. The `phase` field is the app's main state machine:

- `intro` (the 06:29 opening) → `dawn` (the sunrise is playing) → `day` (the site itself). `components/intro.tsx` drives this sequence: it sets `dawn`, awaits `shiftLight("morning")`, then sets `day`.
- `App.tsx` toggles `.dark` on `<html>`, and the `theme-color` meta, from `phase` and `light`. The interface is dark during the intro and in night mode.
- `INTRO_SEEN` in localStorage makes return visits skip straight to the name. A `#/place/<id>` link skips the intro entirely: `linkedPlaceId()` resolves the place before the first render.

### Routing (`useHashRoute` in `App.tsx`)
The only route is `#/place/<id>`, kept in sync with `selectedId`. Opening a card from the list pushes a history entry, so the browser Back button (or a swipe back on a phone) closes the card. Moving from one place to another replaces the entry instead. An unknown id falls back to `#/` and flies to the envelope view. Ids that start with `local-` are visitor-added places. They load asynchronously, so the router trusts them.

### Persistence (`src/lib/storage.ts`)
Persistence uses an `idb-keyval` store named `makom-lizkor-v2`/`v1`, with the keys `local` (the visitor's places) and `tributes` (anemones left at each place). Uploaded photos are downscaled and re-encoded, which strips EXIF data, then stored as data URLs. Nothing is sent over the network.

### Map (`src/map/`)
- `controller.ts` is an **imperative module-level singleton** around the MapLibre instance. It exposes `getMap`, `flyToPlace`, `flyToEnvelope`, `shiftLight`, `startOrbit`, `returnToDawn` and `setLabels`. React code reaches it with `await import("@/map/controller")` so MapLibre stays out of the first bundle. Keep that pattern.
- `palette.ts` defines the `NIGHT` and `MORNING` palettes. The `BINDINGS` table in `style.ts` maps each palette key to a layer paint property, and the sunrise tween walks that table. **A new colored layer needs a palette key in both palettes and a row in `BINDINGS`.**
- `map-canvas.tsx` renders one DOM `maplibregl.Marker` per place and portals a React flower into each one. Marker scale comes from a `--mk` CSS variable on the container, written only when the coarse zoom step changes. The flowers use a shared SVG sprite (`flower-sprite.tsx`, `<use>`), and their bloom is a CSS transition.
- These settings are load-bearing for MapLibre v6: `optimizeDeps.exclude: ["maplibre-gl"]` and `worker.format: "es"` in `vite.config.ts`, and the explicit `setWorkerUrl(workerUrl)` in `controller.ts`.
- Tiles and terrain come from OpenFreeMap and AWS, so the map needs network access. The camera is clamped to Israel (`maxBounds`).
- Basemap labels for community names are suppressed (`OWN_LABELS` in `style.ts`) because the app draws its own.

### The opening's headlines (`src/data/headlines.ts`, `src/components/montage.tsx`)
The opening's count is a montage:
- **Rising:** as the count reaches a headline's date, its clipping rises from the depth behind the number out to its place, slowing in without passing it. Nothing hits or shakes: the build-up comes from the pace and the pile. A slam with a screen shake was tried and rejected as angry, not fitting a memorial.
- **Rushing in:** once the count lands, the camera rushes through the pile toward the words (`rush` in `lib/motion.ts`, 1.5 s). The number flies past the camera first, each layer's zoom jumps to `RUSH_ZOOM` (up to 2.5×) so the clippings sweep past to the edges and off the screen, darkening as they go, and the words come out of the depth from half their size. In the next scene the words only drift in (`push`). Words always end at exactly their own size and get no `will-change`: a promoted layer keeps text rasterized at its starting size, and it would end blurred.
- **Floating:** the pile drifts, dimmed, behind the words.
- **Falling:** at «ולא נשכח» each clipping falls onto a memorial site. The site's screen position comes from `screenPoints` in the controller. The layers' zoom stops where it is when the fall begins (it's a motion value per layer), and the fall is aimed through that zoom, so it lands on the site even when someone skips mid-rush. The ember and its light undo that zoom (`lens`), so they're the same size whatever it was. The camera is held (`setTimeHeld`) and drifts again 2.6 seconds later.

Content rules:
- **Headlines** are in our own words, each with a source link.
- **Photos** are freely licensed from Wikimedia Commons and stored as 240×180 WebP files (about 10 KB each) in `public/headlines/`. They're credited in About, under «שלוש השנים בכותרות».
- **Never copy outlets' screenshots, logos or photos.**
- **Editorial lines:**
  - no images from the handover ceremonies
  - no identifiable hostages or families caught in a private moment
  - no political signs
- **What appears:** only headlines dated before today. On phones, only those marked `phone: true` (16). There are as many slots as headlines (`DESKTOP`, `PHONE` in `montage.tsx`), so a new headline needs a new slot.

Smoothness is load-bearing:
- The count is a `MotionValue`, so React state changes only when a clipping lands.
- Clippings are memoized, and their depth is capped at 6.
- No filters.
- Motion animates `x`/`scale`/`rotate` from JavaScript, so anything it moves must be on its own layer (`will-change-transform`), or every frame repaints it. That's why each clipping has **one** moving layer (the rise is the paper's own entrance). A whole-screen shake on each landing cost frames too.
- Position gets a layer only when it moves (behind the words and in the fall).
- The drift behind the words is a CSS animation (`.clip-float`).
- Adding wrappers or shadow layers per clipping brought back 33 ms frames on desktop.
- `e2e/montage.spec.ts` compares frame times under a 4× CPU throttle against the quiet clock scene in the same run.
- The montage is lazy-loaded, and its photos are preloaded while the clock ticks, but not in data-saving mode or on 2G.

### Code splitting (`App.tsx`)
The opening paints from a small first bundle. `MapCanvas`, `Shell`, `Search`, `About` and `AddPlace` are `lazy()`. `Shell` is prefetched 2.5 seconds into the intro. The About and AddPlace dialogs mount on first open and then stay mounted, so they can animate closed. Keep heavy imports out of `intro.tsx`, `celebration.tsx` and `store.ts`.

### Data pipeline (`scripts/build-data.mjs`)
`data-src/` (research files) → `src/data/places.json`, `context.json`, `landscapes.json`. **Those three outputs are generated, so never edit them by hand.** The pipeline works like this:
- Inputs are `oct7.json` and `extra.json`, which share one schema. Only records with `scope` of `oct7` or `mixed` pass. `war-later` records stay in the source file but never reach the map.
- `exclude.txt` drops records by id.
- An id prefix of `community-` makes the record `kind: "community"`, and the build strips `קיבוץ`/`מושב` from its name. `revival.json` is merged in by id without the prefix.
- Photos are attached through `photo-map.json` (place id → files listed in `photos.json`, with TASL credits).
- `region` (`envelope` or `country`) is computed from a bounding box. Coordinates must fall inside Israel's bounding box, and summaries must be at least 20 characters.
- Rejected records are printed with the reason. They are never silently fixed.
- The script reads `data-src/` by relative path, so run it from this directory.

The journey along Route 232 (`journeyStops`) and a community's "memory" section (`sitesNear`) are computed from coordinates in `store.ts`. They aren't stored data.

### Time since 7 October (`src/lib/since.ts`)
The opening, its sunrise line and the panel all say how long it has been: "שלוש שנים", "1,093 ימים", "שלושה חורפים". `since()` computes this from today's date **in Israel**, whatever the visitor's time zone. The year count turns on **15 September**, ahead of the Hebrew-calendar memorial day (24 Tishrei), so the whole memorial season names the anniversary being marked. `e2e/three-years.spec.ts` pins the clock to check this. Never hard-code the count in components. There are two deliberate exceptions:
- The About paragraph is dated text ("נכתב באוקטובר 2026"), because it states facts that will change.
- The meta and OG tags in `index.html`, plus the cover in `../launch/v2/cover.html`, are rendered into `public/og.png` by `../launch/tools/cover-v2.mjs`. Link previews can't run code, so update them each September.

## Styling and design rules

The full rules are in `../docs/design-system.md`. The ones code changes most often trip on:

- **Tokens** live in `src/index.css` in three layers: primitive scales (`--p-*`), semantic roles (`surface`, `ink-1..3`, `line`, `brand`, `hope`, `dawn`, each with a `-soft` variant), and Tailwind utilities derived from the roles (`bg-surface`, `text-ink-2`, `text-title-2`). Components use only the semantic utilities, never `--p-*`. shadcn's roles are mapped onto these, and shadcn's `accent` stays neutral because shadcn uses it as a hover background.
- **Tailwind reads classes from `src/` only** (`@import "tailwindcss" source(".")` in `src/index.css`), excluding `src/data/` (`@source not "./data"`). A class written anywhere else, such as `index.html`, generates no CSS. Without that restriction, editing any doc or research file would trigger a full reload of the dev page, and prose words would turn into CSS rules.
- **`cn`:** `vite.config.ts` aliases the `cn` package to `src/lib/cn.ts`, and `@/lib/utils` re-exports it. It knows the custom type scale and shadows. Without it, `text-title-2` merged next to `text-ink-1` is dropped as a duplicate color. Always merge classes through `cn`.
- **shadcn/ui** uses the `radix-luma` style with `rtl: true`. Add components with `npx shadcn@latest add <name>`. They land in `src/components/ui/`.
- **Shared primitives** in `src/components/kit.tsx`: `Img` (a quiet placeholder tile, then a fade-in), `StatusText` and `StatusDot` (the only way to show a return status: full dot, half dot or dashed ring), `SectionTitle` and `GroupLabel`.
- **Animate only `transform` and `opacity`.** About 70 markers re-render on every camera frame, so markers get no `filter`, `backdrop-filter` or `mix-blend-mode`.
- Every clickable surface gets the `pressable` class. The site has no colored chips or tinted boxes: metadata goes in a single `text-caption` line with dot separators, and a thin `border-line` separates sections.
- Motion comes from the presets in `src/lib/motion.ts` (`spring.soft`, `spring.snappy`, `spring.bouncy`, `ease`, `duration`). Everything honors reduced motion, through `<MotionConfig reducedMotion="user">` in `main.tsx` and `reducedMotion()` in the map controller.
- The UI is Hebrew and RTL (`DirectionProvider dir="rtl"`), and all user-facing copy is Hebrew. Hebrew text is never letter-spaced.
- **Font:** Heebo. Map labels use the same font through MapLibre `font-faces` (`src/lib/fonts.ts`). Swapping the typeface means changing `fonts.ts` and the `@theme` fonts in `index.css`.

## Code conventions

- Comments explain *why*, in plain prose, in the same voice as the existing code (for example, "Back closes the card and returns to the list"). Match that density and tone.
- The import alias is `@/` → `src/`. TypeScript is strict, with `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax` (use `import type`).

## Dev aids

- `/?specimen` (dev only) renders a sheet of the anemone at every size and state.
- `window.__map` exposes the MapLibre instance in dev.

## Before going live

`CONTACT_EMAIL` in `src/config.ts` is a placeholder. See `../docs/go-live-checklist.md` and `../docs/legal-brief.md` for the rest.
