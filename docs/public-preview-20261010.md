# Public staging preview and uniform sharing, 10 October 2026

## User authorization and scope

Harel explicitly requested deployment of all typography/feedback changes and viewing without a password from anywhere. This supersedes the earlier local-only hold for `codex/typography-system-refinement`. This is public **viewing of staging**, not a production release. No extra Worker, account, database, purchase or plan upgrade is needed. Administrative, owner and synthetic write routes remain protected. `RETENTION.verified` and `MAILBOX.verified` remain false.

## What changed

- Removed the visible “איור למיזם” caption. The illustration disclosure remains in About's credits.
- Share template 5 uses a fixed small watercolor sprig of blood-red everlasting (דם המכבים), a date and the site identity. Each place retains its public name/location. No place photo is fetched or embedded. The root `og.png` uses the same layout. Its file size is about 77KB instead of the previous 3MB.
- Public-state hashes still include photo/credit state so existing suppression/invalidation behavior is retained. Whole-place hiding/withdrawal and checks before/after rendering remain unchanged; template bump retires old photographs in OG URLs. External platforms may retain their own older cached previews; an HTTP check cannot prove their caches were cleared.
- Staging builds display an explanation before personal-data submission: viewing/sharing are open; synthetic sending requires the existing tester sign-in. The sign-in path remains protected by Access. Staging HTML has `noindex, nofollow`; production builds do not acquire that tag.

## Access plan

The existing application ID and audience remain unchanged, as do its human/service-token policies. Public path overrides expose only the site/assets, `/place/*`, `/media/*`, `/api/v1/version`, `/api/v1/feed` and the unavailable contact capability. All unspecified paths stay protected, including `/api/v1/health` (the existing nine-check isolation probe), `/admin`, `/api/admin`, `/api/ops`, `/__dev`, synthetic submissions/reports/tributes/email and `/preview-login`.

The same staging CI workflow and all nine edge checks are retained. Public paths are verified separately without a cookie/service token; private paths must still refuse an unauthenticated caller. Readback/rollback snapshots and exact path patterns are in `../agent-evidence/public-preview-20261010/access-plan.json` and `account-readback.json`. The Access change is applied after deployment/receipt succeeds, then both viewing and private refusals are checked.

## Mail investigation

Live account inventory: no domain zone, no send-email binding, no destination initially. Added only `makomlizkor@gmail.com` as an Email Routing destination. After Harel completed verification, fresh Cloudflare readback confirms `verified` at 2026-10-10T12:33:52.157651Z. No repeat recipient action is needed; this alone does not enable sending. Fresh evidence and the finite provisioning plan are in `../agent-evidence/mail-production-followup-20261010/cloudflare-readback.json` and `mail-production-followup-20261010.md`. Cloudflare's current send-binding documentation requires an onboarded sender domain even when the destination is Gmail. No Gmail credentials or fabricated sender identity are used. No contact message has been sent, and the form stays truthfully unavailable until a domain/verified sender/binding exists. Gmail API or a third-party relay is technically another route but needs separate credentials/configuration; it is unnecessary temporary infrastructure for this project's imminent domain.

Source: https://developers.cloudflare.com/email-service/configuration/send-bindings/

## Account versus environment

The connected account was created on 2026-10-05T14:33:01Z. Its current inventory holds one Worker. The seven-day rule is real: Cloudflare users must be at least seven days old to create an **additional Free account**. That is not a one-environment-per-account rule. Wrangler supports staging and production environments with distinct resources within one account. We did not create another account merely to test eligibility, and account creation date is not proof of the user's exact eligibility timestamp.

Sources:
- https://developers.cloudflare.com/fundamentals/account/create-account/
- https://developers.cloudflare.com/workers/wrangler/environments/

## Regional grouping recommendation

This request was feasibility research; regional grouping is not yet implemented. Existing places already have coordinates, and a new place can be classified after location selection without asking a visitor to classify it. Use broad primary areas (North, Center, Jerusalem/surroundings, South), with optional subregions (Golan, Galilee, Gush Dan, Arava, Western Negev). A place belongs to one primary area and may have a subregion. Keep “saved for a visit” and “added on this device” as filters, not competing geographical regions.

OpenMapTiles contains administrative boundary lines/labels with `admin_level`. It is not a ready-made complete “North/Center/Arava” place-classification API. Reading rendered map tiles would depend on viewport/zoom and cannot reliably classify all records. A small licensed boundary dataset and local point-in-polygon lookup, with explicit fallback for boundary/approximate coordinates and moderator correction, is preferable. No paid geocoding call for every visit, and no arbitrary latitude cutoffs pretending to be official regions. This is a bounded next UI/data feature rather than a need to replace the map service or build another backend.

Sources:
- https://openmaptiles.org/docs/schema/#boundary
- https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#querysourcefeatures

## Illustration

Generated with built-in OpenAI image generation, then PNG resizing preserving alpha. Original is preserved in the evidence directory; application asset is `public/art/dam-hamaccabim-share.png`, embedded identical bytes in `worker/lib/og-art.ts`. The date/site identity are typeset by code, not generated text. The full prompt is saved in `asset-generation.json`.

Botanical reference: https://flora.org.il/plants/HELSAG/

## Verification

Evidence directory: `../agent-evidence/public-preview-20261010/`.

- Completed cloud verification: CI `38032352314` and automatic staging `38033943183` passed at `57de613614f6944cef0ee96b3870f267ecb0d921`. Readiness/full receipts bind attempt 1 to the same SHA. Chromium covered 135 unique functional scenarios across the two shards plus seed in both; WebKit 6/6 and development 3/3 including seed. No actual test skipped, failed or flaky. The same-SHA staging receipt has all nine checks `pass` and tag `staging-57de613614f6`.
- Access applied on the existing application after that receipt, with the 14 exact authorized viewing overrides. Fresh before/after snapshots and the exact PUT body are preserved; audience, identities and existing human/service policies are unchanged. Anonymous root/assets/feed/version/place/OG image reads succeed; protected administrative, operational, synthetic-writing and tester-login paths redirect to Access. The original observer required a direct 200 from `/index.html`; its intentional canonical 307 to the separately verified root is recorded in the final observation without repeating deployment.
- Actual browser review used a separate tab at desktop 1280×900 and narrow 390×844. Manual pin selection traversed all three steps, with the three art images loaded in a fixed header rectangle and footer buttons reachable while the form body scrolls. Mobile collapsed actions, expandable groups, About and the unavailable contact form were reviewed. No submission or permission grant occurred. Temporary viewport override was reset and the temporary tab closed. Screenshots and `live-phone-layout.json` are saved. This does not prove behavior on Harel's physical iPhone or the external WhatsApp preview cache.
- Completion documentation is local only; no documentation push or duplicate CI/deployment was triggered. The deployed source remains `57de6136`. Mail and production remain separate pending work; verification flags stay false.
- Worker sharing/removal/contact: 34/34 passed before the final subtitle-only adjustment; final focused render checks are recorded separately.
- Final production build feedback/keyboard/a11y/mobile/map/contact: 9/9 passed. Sending tests use synthetic responses; no real email is sent.
- Staging build, lint/typecheck, CI, exact SHA, receipt, public/private live reads and screenshots: see `deployment-progress.json` and their original logs. A stage not yet completed is never labelled verified here.
- First cloud run `38029725008` stopped on generated-data consistency: presentation punctuation had been edited in `src/data/places.json` while its generated import fixture stayed original. Restored exactly the original JSON after proving the only differences were dash characters. Display normalization remains in the existing read-only UI adapter. The generator check is retained and passes 4/4; no cloud deploy occurred on that failed run. `ci-failed.log` preserves the diagnosis.
- Corrected run `38030128446` passed static/client/Worker/dev/WebKit and the second Chromium shard, but the first shard failed three times in the feedback spec's setup before its feature checks. Its helper's default five-second expectation preceded the asynchronous Shell commit. The traces show successful Shell responses, day state and no page errors; the stalled-script failure's DOM shows the expected header 384ms after the assertion expired. Preserved traces and timelines are under `cloud-failed-64518/`, with `ci-corrected-failed.log` and `ci-corrected-run.json`. Staging `38031484546` was skipped; Access has not been opened.
- `CI-FEEDBACK-READINESS-1` changes only that helper to the existing bounded functional-spec day-readiness budget, with unchanged feature assertions/deadlines and zero retries. A new regression delays the real Shell response by six seconds and verifies interception plus an actionable contact form afterward. Final-build affected tests passed 11/11 and the development delay sample passed 2/2. After refining the guard that proves interception, the new regression passed 2/2 (including seed) in each build mode again. The exact candidate/CI are in the progress file. Cloud success remains required; no product, workflow or release-gate code changed.
