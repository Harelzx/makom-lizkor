# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Talk to Harel in Hebrew**, every line he sees, short status lines between tool calls included. Code, comments, commits and PR descriptions stay in English, as the repository does. Open sessions on this directory (`web/`), never on its parent: only here do the hooks, the deny list and this file load at the start.

## What this is

"מקום לזכור" (Makom Lizkor) is a static, Hebrew, RTL memorial map for the people murdered and killed on 7 October 2023. It shows monuments, lookouts, benches, groves and gardens, plus a page for each of the 22 attacked communities with its return status. The site opens at 06:29 on a dark map, and a sunrise turns it to morning. Every place, the site's own included, comes from the server's database (D1) through a versioned feed; the site's own places are imported from `fixtures/curated.json` through the moderators' route (phase 7). All seven backend phases are implemented and merged; the protected Cloudflare staging environment uses synthetic data. Production launched publicly on 11 October 2026 at `https://makom-lizkor.makom-staging.workers.dev` with 90 curated records (68 memorials and 22 communities); since 18 October 2026 its address is `https://makomlizkor.org` (a Custom Domain, a second public destination of the same Access app), and the old address sends visitors on to it. Administration and operations remain owner-protected. In the deployed UX, a proposal is stored in IndexedDB only after a confirmed server receipt; unsuccessful sends stay only in the open form's memory and require a manual retry. Closing the form discards them. Approved places reach other browsers through the versioned feed. Current deployed commit, evidence and verification limits are in `docs/agent-handoff.md`; historical phase plans are not a current status report.

## Repository layout

This directory (`web/`) is v2, the current site, and the git repository. It's the only place that gets development. In it, besides the app: `docs/` (written in Hebrew; `docs/design-system.md` is the source of truth for design and motion rules, and `docs/data-notes.md` records the data scope decisions) and `tools/` (scripts for films, covers, captures and the sound master; not part of the test suite). Its parent folder is not under git and holds the assets those tools read and write. **In a parallel worktree (`.claude/worktrees/<name>/`), `..` is not that folder:** reach it as `/Users/harel/Desktop/remember_07102026/` (or `$(git rev-parse --git-common-dir)/../..`).

- `../app/`: v1, a frozen archive that covers memorials across all of Israel's wars. Don't change it.
- `../launch/`: launch assets (LinkedIn post, cover, demo video, stills), and v1's two capture scripts in `../launch/tools/`. The tools in `tools/` find it, and `../assets-src/`, through `tools/paths.mjs`, so they work from a worktree too.
  - `tools/render-film.mjs` renders the opening as a film frame by frame (needs the dev server): Playwright's clock moves the page one frame at a time, CSS and motion's animations are held to that clock, randomness is seeded, and the sound is the site's own engine rendered offline, so the film is exact however slow the capture. A screen recording drops frames and lags; use this for any film that will be posted. `--from` renders one scene quickly; `--date` sets the day counted to.
- `../assets-src/`: source art and the chosen sound takes (out of git, like the other source art).
- `../.claude/launch.json`: the preview server entries for sessions opened on the parent folder (`makom-lizkor-v2` runs this app on :5190). Sessions opened on `web/` get `.claude/launch.json` written by the SessionStart hook, on this checkout's own port.

## Commands

Run every command from this directory.

```bash
npm install            # postinstall runs the hash-checked scripts/patch-vaul.mjs; re-check its modal-context fix before bumping vaul
npm run dev            # http://localhost:5174 (strictPort)
npm run build          # tsc -b && vite build → dist/client (the site and /admin/) and dist/makom_lizkor (the Worker)
npm run typecheck      # tsc -b: src (tsconfig.app), vite.config (tsconfig.node), e2e + playwright.config (tsconfig.e2e)
npm run lint           # eslint
npm run format         # prettier --write over all ts/tsx/js/mjs
npm run format:check   # what to run before calling a change done
npm run e2e            # Playwright against the dev server on :5190
npm run e2e:prod       # builds, then runs the same specs against vite preview on :4174
npx playwright test e2e/routing.spec.ts          # one file
npx playwright test -g "shared link to a place"  # one test by name
node scripts/build-data.mjs                      # regenerate src/data/*.json from data-src/
npm test                   # the Worker's tests (Vitest inside workerd, fresh local D1 per run); heavy: scripts/heavy npm test
npm run test:client        # the browser code's own logic (the store) in Node, storage stood in for; heavy: scripts/heavy npm run test:client
npm run test:scripts       # node:test for scripts/ (the release check's mail rules)
npm run db:migrate:local   # apply migrations/ to the local D1 the dev server uses (e2e runs migrate their own fresh copy)
npm run db:seed:local      # import the site's own places into the running dev server's D1 (insert-only)
npm run cf-typegen         # regenerate worker-configuration.d.ts after changing wrangler.jsonc or .dev.vars
```

- Two kinds of tests: Playwright e2e specs in `e2e/`, and the Worker's tests in `worker/test/` (`npm test`). The e2e specs find elements by their **Hebrew accessible names** (`getByRole("button", { name: "כל המקומות" })`), so renaming a Hebrew label can break a test.
- `panel.spec.ts` samples real animation frames through `e2e/frames.ts` to check motion quality: no squared corners mid-spring, no single-frame jumps. Specs run serially (`workers: 1`).
- Ports are deliberately different: 5174 for `npm run dev`, 5190 for Playwright and the `makom-lizkor-v2` preview entry, and 4174 for prod e2e. Each e2e run starts its own server on a fresh local D1 and R2 (`.wrangler/e2e-state-{dev,prod}`, wiped and migrated first; `reuseExistingServer` is off), so stop a preview server on the e2e port before running e2e. Don't "unify" them. Those are the main checkout's; each parallel worktree gets its own trio from `scripts/parallel/ports.mjs` (54xx/55xx/56xx), so e2e never reuses another worktree's server.
- **Prettier is enforced**: no semicolons, double quotes, trailing commas, `printWidth` 140, with Tailwind classes sorted by `prettier-plugin-tailwindcss` (including inside `cn()` and `cva()`). An override keeps `src/components/ui/**` at shadcn's own format (80 columns, `es5` commas), so output from `shadcn add` drops in without churn. After editing, run `npm run format` and make sure `format:check` passes.
- `vite build` warns that some chunks exceed 500 kB. Those chunks are MapLibre's own library (the lazy `controller` chunk) and its worker, which already load after the opening. The warning is expected and can't be fixed by splitting.

## CI and test scope

Use `docs/ci-delivery.md` for the test/deployment policy approved on 9 October 2026. It supersedes historical instructions to run full dev AND production browser suites for every checkpoint. Run affected checks while implementing; retain the full same-SHA release gate. All local browser runs, including `node scripts/ci-browser.mjs run ...`, use `scripts/heavy`. Read `docs/agent-handoff.md` for current verification and deployment evidence.

## Parallel sessions

Several Claude Code sessions may work on this repo at once, each in its own worktree. Hooks in `.claude/settings.json` enforce the rules below; `docs/parallel-sessions.md` explains the machinery.

- Heavy commands (`.claude/heavy-commands.txt`: e2e, Playwright, build, `npm ci`/`install`, film renders) run only as `scripts/heavy <command>`. The hook blocks them otherwise.
- `scripts/heavy` exits 75 when another session holds the lock or the machine stays overloaded. Never retry in a loop: do light work meanwhile, or ask the holding session to tell you when it is idle.
- The Desktop app copies `node_modules` into a new worktree. If it is missing (a worktree made with `git worktree add`), run `scripts/heavy npm ci` first; the SessionStart hook says so.
- After finishing a feature, run `scripts/milestone "<what changed and who it affects>"`. Merges into `main` are logged on their own; merge with `--no-ff` so a feature is one entry.
- New milestones from other sessions arrive in your context. Act on one only if it affects your current work; otherwise ignore it silently.
- For an urgent breaking change, message the affected session directly instead of waiting for the log.


## Architecture

### State and phases (`src/store.ts`)

A single Zustand store holds everything: the places from the feed, the visitor's local places, tributes, the selection, the tab, open dialogs and the journey index. The `phase` field is the app's main state machine:

- `intro` (the 06:29 opening) → `dawn` (the sunrise is playing) → `day` (the site itself). `components/intro.tsx` drives this sequence: it sets `dawn`, awaits `shiftLight("first")` and then `shiftLight("morning")` (7 s in all, `SUNRISE`), fades the place names in near its end (`fadeInLabels`), then sets `day`.
- `App.tsx` toggles `.dark` on `<html>`, and the `theme-color` meta, from `phase` and `light`. The interface is dark during the intro and in night mode. On iPhone Safari (26+) what shows under the status bar and toolbar comes from fixed layers at the screen's edges, so `main` has no background and nothing fixed and full-width touches the top: the map runs under the clock. The only edge layer is a thin bottom strip in the sheet's color, remounted per color (`docs/design-system.md`, «הטלפון»).
- `INTRO_SEEN` in localStorage makes return visits start in the day (`introSeen()` in the store), the map already on the envelope's overview; About's «replay» plays the opening again. A `#/place/<id>` link skips the intro entirely: `linkedPlaceId()` resolves the place before the first render.

### Routing (`useHashRoute` in `App.tsx`)

The only route is `#/place/<id>`, kept in sync with `selectedId`. The share button gives `/place/<id>` instead: the Worker (`worker/routes/share.ts`) serves the site's page with that place's preview tags (and the place's public fields in `#place-data`, so the card opens before the feed), 404 for a place never public and 410 for one taken back; `store.ts` turns the path into `#/place/<id>` before anything reads it, or into `#/` for a 404 or 410. Absolute addresses there come from `PUBLIC_ORIGIN` (the request's origin only in development), and `release:check` refuses it unset. Opening a card from the list pushes a history entry, so the browser Back button (or a swipe back on a phone) closes the card. Moving from one place to another replaces the entry instead. Every place loads after the first render, so the router trusts an id of a place's shape (`placeIdShape`: `local-…`, `p_…` or a slug) until the server's own feed has answered; a feed that answered without it sends the link to `#/` and the envelope view, and one that failed or hasn't come yet drops nothing. Ids that start with `local-` are visitor-added places and are never dropped. When the day starts, the router reads the hash as an entrance (`apply(true)`), so a place opened during the sunrise stays open instead of being read as Back.

### Backend (`worker/`, `migrations/`, `src/shared/`)

- One Hono Worker runs inside `npm run dev` through `@cloudflare/vite-plugin`. Only `/api/*`, `/__dev/*`, `/media/*`, `/place/*` and `/assets/*.pbf` (map tiles) reach it (`run_worker_first` in `wrangler.jsonc`); everything else is the static site. The dev server's local D1 and R2 live in `.wrangler/state` (git-ignored); each e2e run uses its own fresh copy (`.wrangler/e2e-state-*`), so demo places never accumulate in the dev server's.
- **The vars in `wrangler.jsonc` are what a deploy ships, and they are production.** Development (the stand-in Access sign-in at `/__dev/login`, the `X-Test-Now` clock) is switched on only by `.dev.vars`: untracked, created from the committed template `.dev.vars.example` (synthetic values only) by `npm run dev` and the e2e servers when missing, and never deployed. The Worker tests read the template itself, not a local `.dev.vars`. A test fails if the deploy vars stop being production.
- `src/shared/contract.ts` holds the Zod schemas both sides use; `src/shared/text.ts` strips bidi controls from anything stored. The client reads every published place through `src/lib/feed.ts` into `remote` in the store. It loads from the start of the opening, in the background and in its own chunk (nothing in the opening waits for it: the count line shows a number only once there is one, and the fall lands on the sites there are). `allPlaces()` takes `remote` and `local`, and hides a local copy once its `remoteId` is published. Ids that start with `p_` are contributions; the site's own places keep their slugs. Anemones at any published place reach the shared count (`shared()` in `src/lib/tributes.ts`).
- The moderators' queue is `/admin/` (`admin/index.html`, outside `src/`, with its code in `src/admin/`). Locally, sign in with `POST /__dev/login {"email":"dev@example.test"}`.

### Persistence (`src/lib/storage.ts`)

Persistence uses an `idb-keyval` store named `makom-lizkor-v2`/`v1`, with the keys `local` (the visitor's places) and `tributes` (anemones left at each place). Uploaded photos are downscaled and re-encoded, which strips EXIF data, then stored as data URLs. Only a confirmed submission gets a local tracking copy; unsuccessful or interrupted sends are not persisted or retried automatically. The accepted proposal's photo is uploaded separately after the submission is accepted (`src/lib/api.ts:uploadPhoto`); the server strips its metadata (every segment, between scans too), re-encodes the sizes it serves (640, 960) and controls publication. Optional email, tracking, corrections, withdrawal and moderation are implemented. Do not describe uploaded contributions as browser-only.

### Map (`src/map/`)

- `controller.ts` is an **imperative module-level singleton** around the MapLibre instance. It exposes `getMap`, `flyToPlace`, `flyToEnvelope`, `shiftLight`, `startOrbit`, `returnToDawn` and `setLabels`. React code reaches it with `await import("@/map/controller")` so MapLibre stays out of the first bundle. Keep that pattern.
- `palette.ts` defines the `NIGHT`, `FIRST_LIGHT` (the warm golden-rose step the sunrise passes through, so it never goes grey) and `MORNING` palettes. The `BINDINGS` table in `style.ts` maps each palette key to a layer paint property, and the sunrise tween walks that table. **A new colored layer needs a palette key in all three palettes and a row in `BINDINGS`.** `shiftLight` waits for the style to load before it paints (a skip right after the page opens used to leave the map at night).
- `map-canvas.tsx` renders one DOM `maplibregl.Marker` per place and portals a React flower into each one. Marker scale comes from a `--mk` CSS variable on the container, written only when the coarse zoom step changes. The flowers use a shared SVG sprite (`flower-sprite.tsx`, `<use>`), and their bloom is a CSS transition.
- These settings are load-bearing for MapLibre v6: `optimizeDeps.exclude: ["maplibre-gl"]` and `worker.format: "es"` in `vite.config.ts`, and the explicit `setWorkerUrl(workerUrl)` in `controller.ts`.
- Tiles and terrain are the site's own (`src/shared/tiles.ts`): the basemap is one PMTiles archive of Israel in the `TILES` R2 bucket, served a tile at a time by `worker/routes/tiles.ts` as `/assets/<archive>.<z>.<x>.<y>.pbf` (immutable, so a new extract gets a new name; build and upload it with `tools/tiles-basemap.mjs`, before the deploy that names it), and the terrain is static files `public/assets/terrain-<version>.…png` (`tools/tiles-terrain.py`). Both sit under `/assets/` with flat names because production's Access lets through only listed paths, its 25 overrides are all used, and `/assets/*` is one of them. The dev server's bucket starts empty, so in development the Worker relays the public site's tiles (`TILES_UPSTREAM` in `.dev.vars`): the map still needs network access there. The camera is clamped to Israel (`maxBounds`), and so are the archives.
- Basemap labels for community names are suppressed (`OWN_LABELS` in `style.ts`) because the app draws its own. Those names wait for the sunrise's place names too (`.is-named`, set by `fadeInLabels`): on a phone they sat right under the sunrise's line.

### The opening's headlines (`src/data/headlines.ts`, `src/components/montage.tsx`)

The opening's count is a montage:

- **Rising:** as the count reaches a headline's date, its clipping rises from the depth behind the number out to its place, slowing in without passing it, and it shows only once it is clear of the number. Nothing hits or shakes: the build-up comes from the pace and the pile. A slam with a screen shake was tried and rejected as angry, not fitting a memorial. Layers go by arrival (`layerOf`), so the newest clippings are on top. Headlines are right-aligned, as in a Hebrew paper.
- **Rushing in:** once the count lands, the camera rushes through the pile toward the words (`rush` in `lib/motion.ts`, 1.5 s). The number flies past the camera first, each layer's zoom jumps to `RUSH_ZOOM` (up to 2.5×) so the clippings sweep past to the edges and off the screen, darkening as they go, and the words come out of the depth from half their size. In the next scene the words only drift in (`push`). Words always end at exactly their own size and get no `will-change`: a promoted layer keeps text rasterized at its starting size, and it would end blurred.
- **Floating:** the pile drifts, dimmed, behind the words.
- **Falling:** once «ולא נשכח» is typed, one thing moves at a time: the words leave (`WORDS_LEAVE`, 0.3 s), then the clippings fall (`FALL_AFTER`, 0.9 s), each onto a memorial site, 20 ms apart, 1.2 s each. Halfway down, each paper catches at its heart (a round amber-to-red glow, never a fill to its edges: that read as small red rectangles) and fades as its ember comes up, and the ember is the light that lands. The site's screen position comes from `screenPoints` in the controller; at most two clippings share a site. A clipping mostly out of the frame (under 30% in view) never crosses back over the screen: it fades where it is and only its light appears on its site, so every headline still becomes a light (32 on desktop, 16 on a phone). The lights stay 2.8 s and fade into the sites' glow. The layers' zoom stops where it is when the fall begins (it's a motion value per layer), and the fall is aimed through that zoom, so it lands on the site even when someone skips mid-rush. The ember and its light undo that zoom (`lens`), so they're the same size whatever it was. Then a breath (`BREATH`, 1.2 s) with only the lights, before the name. The camera is held (`setTimeHeld`) and drifts again 5.4 s after the words are typed (`ORBIT_AFTER`), once the lights have faded.

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

### The opening's sound (`src/lib/sound.ts`, `public/sound/`)

The film waits at 06:28:57 for one click: «עם צליל» or «בלי צליל». Browsers play nothing before a click, and the first sounds matter most (the last ticks, then silence at 06:29). The choice is remembered (`makom-lizkor:sound` in localStorage) and is the one in focus next time. A speaker button stays in the corner during the film. Nothing is fetched until sound is on; a file that fails to load is left out silently.

Two layers only, so it sounds like one film (a patchwork of separately prompted sounds was tried and rejected):

- **The score** (`score.mp3`): one piece for felt piano and string quartet, composed with Eleven Music as a composition plan whose sections are cut to the scenes in milliseconds: opening (3 s, from the line of what happened) · gathering (9.4 s, the count) · arrival (the count landing, the rush, «מאז עברו» typed) · remembrance («אנחנו זוכרים…» and «ולא נשכח…» typed, the fall and the breath) · dawn (the name and the sunrise, ending on a long held chord). Later sections were recomposed with inpainting when the typing lengthened those scenes, and the opening was rebuilt the same way so the piano plays from the first beat (it began with 3.5 s of silence); inpainting re-synthesizes, so check a rebuilt part by loudness curve and chroma against the original, not by waveform. The light crossing the name is in the music itself: a harp arpeggio over a swell of high violins, composed apart in the score's key (B major, 60 BPM) and mixed in at 28.9 s (the name begins 27.6 s into the score). The chosen takes are in `../assets-src/sound/` (outside this repo, like the other source art), and `python3 tools/sound-master.py` rebuilds every file in `public/sound/` byte for byte. The score as composed holds B major throughout, not the minor-to-major asked for; check any new tonal sound against the score at its moment. Each scene knows where it begins in the music (`SCORE_AT` in `intro.tsx`, built from `HOLD_MS`); the engine moves the music there with a crossfade only when it has drifted more than 0.4 s (Enter, or sound turned on midway). **Change a scene's timing and the score must be composed again to match.**
- **Real sound** under it: `night` air and `tick`s until 06:29 (cut dead at the freeze), a paper `rise` per clipping (three variants, pitch varied), pages fluttering for the `rush`, a typewriter `key` for every typed letter and a duller `space` for every space (five strokes cut from one continuous recording of one machine, so they all sound like it; pitch varied a hair), `dawn` birds from «ולא נשכח» through the sunrise, and a harp shimmer (`sweep`) on exactly the notes the score holds there, as the light crosses the name: it rings from its first note, so it starts as the band enters the letters, 1.27 s into the name. Its timing is tied to `.title-shine` in `index.css` (a 2.2 s pass on an even ease, 0.7 s in: the band is in the letters from 1.27 s to 2.33 s). A whoosh was tried first and read as a blade being drawn.
- **The mix is in the files:** score -23 LUFS; night and dawn -28 (each bed two takes high-passed at 90 Hz, levelled and joined, about 9.4 s; below 90 Hz the takes were mostly rumble no speaker plays); tick peaking around -6 dBFS; rustles -32; rush -24; keys peaking around -19 dBFS (a typed line sits around -30 LUFS, under the score); the harp sweep -23. A limiter on the output keeps stacked rustles from clipping.
- **Beds are not looped by the browser.** MP3 pads both ends with silence, so `loop = true` would gap; each pass overlaps the next by 0.8 s with equal-power fades instead.
- **What is never heard:** sounds of the attack, sirens, voices, synthetic tones, or anything that breathes or gasps (breathy air sounds read as a horror film).
- **Making sounds:** follow ElevenLabs' guidance: short, concrete sound-effect prompts; for music, a composition plan with at least 6–7 styles in the first section (it sets the tone for all), liberal negative styles, and high context adherence for continuity. Check the result's key and loudness by analysis, not by assumption.
- The e2e tests click «בלי צליל» to start the film; `e2e/sound.spec.ts` checks that the clock waits and that nothing is fetched without sound. ElevenLabs is on a paid plan (commercial license) and credited as elevenlabs.io in About.

### The typed words (`Typed` in `intro.tsx`)

From the count to the name, the lines are typed: `TYPE_RATE` letters a second (16, a fast typist: each key is heard as a stroke; 28 was tried and merged into a rattle), each letter coming into focus over `LETTER_TIME` as its key lands (`.type-letter` in `index.css`), a thin caret before the next letter that blinks twice at the line's end and goes. Words are kept whole (a `whitespace-nowrap` span per word), and screen readers get the line whole (`sr-only`), not letter by letter. A line's length sets its scene's length (`typed()` feeds `HOLD_MS`, which feeds `SCORE_AT`), so changing the wording moves the score's sections: past the 0.4 s the engine tolerates, the score has to be cut again. The line before the count («בבוקר שמחת תורה…») keeps the word-by-word reveal.

The words and the name sit above the montage (`relative z-10`): its dark pool is a positioned layer, and in-flow text under it turns grey. Old text escaped that only through a leftover `blur(0px)`.

### The opening, beat by beat

The designed timeline, from the click on «עם צליל» / «בלי צליל» (score time is seconds into `score.mp3`). It is built from the constants in `intro.tsx` and `montage.tsx`; this table only records it, so change the constants and update it. A recorded run is checked against it: frames at each beat on desktop and phone, and the sound by its loudness curve, for silences and for its shape.

| s                | score     | on screen                                                                                                                                                                             | heard                                                                                               |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0                |           | 06:28:57, the clock's last seconds (1.1 s each)                                                                                                                                       | night air, a tick a second                                                                          |
| 3.5              |           | 06:29:00, the clock stops                                                                                                                                                             | everything cut: silence                                                                             |
| 5.0              | 0         | the date, then «בבוקר שמחת תורה…» word by word                                                                                                                                        | the score's opening, felt piano                                                                     |
| 8.0              | 3.0       | the clock steps back                                                                                                                                                                  | the piano breathes out (0.9 s, near silence)                                                        |
| 8.9              | 3.9       | the count starts; clippings rise from the depth                                                                                                                                       | the gathering; a paper rise per clipping                                                            |
| 16.9             | 11.9      | the count lands on today (measured 16.87) and holds 1.9 s                                                                                                                             | the arrival                                                                                         |
| 18.8             | 13.8      | the rush through the pile to the words                                                                                                                                                | pages fluttering                                                                                    |
| 19.3             | 14.3      | «מאז עברו שלוש שנים…» typed                                                                                                                                                           | a key a letter                                                                                      |
| 23.7             | 18.7      | «אנחנו זוכרים…», then «ולא נשכח…» typed                                                                                                                                               | the remembrance; keys                                                                               |
| 29.7             | 24.7      | typed: time comes back                                                                                                                                                                | dawn birds                                                                                          |
| 30.0–32.6        | 25.0–27.6 | the words leave, the clippings fall and light the sites, the breath                                                                                                                   |                                                                                                     |
| 32.6             | 27.6      | the name: the bud rises softly and waits for the light                                                                                                                                | the dawn section                                                                                    |
| 33.9             | 28.9      | the light enters the letters (mid-name 34.4, out 34.9) and the anemone unfurls with it (from 33.8, open as the light leaves; a spring snapped it open in 0.2 s, which read as a jump) | the harp shimmer (measured 0.56–0.58 s into the pass, designed 0.57) over the score's own harp line |
| 35.5             | 30.5      | «שלוש שנים», the line, «אל הבוקר»                                                                                                                                                     |                                                                                                     |
| «אל הבוקר» + 0–7 |           | the sunrise: first light by 2.2 s, its line from 1.0 s to 6.6 s, names from 5.5 s                                                                                                     | dawn birds; the score plays on, and fades over 8 s once it is day                                   |

### Code splitting (`App.tsx`)

The opening paints from a small first bundle. `MapCanvas`, `Shell`, `Search`, `About` and `AddPlace` are `lazy()`. `Shell` is prefetched 2.5 seconds into the intro. The About and AddPlace dialogs mount on first open and then stay mounted, so they can animate closed. Keep heavy imports out of `intro.tsx`, `celebration.tsx` and `store.ts`.

### Data pipeline (`scripts/build-data.mjs`)

`data-src/` (research files) → `src/data/places.json`, `context.json`, `landscapes.json`, and `fixtures/curated.json` (each place as the record a moderator would send, with its sources). **Those outputs are generated, so never edit them by hand.** `places.json` is a development file only: no production bundle may carry a curated record or photo (`scripts/bundle-check.mjs`, run after every build in CI, staging and release). The site's own places reach D1 through `scripts/curated-import.mjs`, a client of `POST /api/admin/places` that only inserts (a place already there, hidden or edited, stays as it is): the e2e `seed` project runs it before every spec, `npm run db:seed:local` runs it against the dev server, and production runs it only with Harel's approval of the selection. Their photos are in `fixtures/photos/` (uploaded through the media gate by the importer, never served as files); About's landscapes, the site's own pictures, are in `public/landscapes/`. The pipeline works like this:

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
- The meta and OG tags in `index.html`, plus the cover in `../launch/v2/cover.html`, are rendered into `public/og.png` by `tools/cover-v2.mjs`. Link previews can't run code, so update them each September.

## Styling and design rules

The full rules are in `docs/design-system.md`. The ones code changes most often trip on:

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

- Comments explain _why_, in plain prose, in the same voice as the existing code (for example, "Back closes the card and returns to the list"). Match that density and tone.
- The import alias is `@/` → `src/`. TypeScript is strict, with `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax` (use `import type`).

## Dev aids

- `/?specimen` (dev only) renders a sheet of the anemone at every size and state.
- `window.__map` exposes the MapLibre instance in dev.

## Mail

`CONTACT_EMAIL` in `src/config.ts` is the project's Gmail address (makomlizkor@gmail.com), which also sends every mail. The contact form and the technical alerts (server and browser errors, failed jobs, the operations check) go to it; moderation, drill and deletion-check alerts go to `MODERATORS`. Current deployment and evidence: `docs/agent-handoff.md`.
