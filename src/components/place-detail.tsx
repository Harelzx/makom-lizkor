import { useEffect, useState } from "react"
import { motion } from "motion/react"
import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  MapIcon,
  NavigationIcon,
  Share2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { KindIcon } from "@/components/kind-icon"
import { Tribute } from "@/components/tribute"
import { CreditName, PhotoGallery } from "@/components/photo-figure"
import { Disclosure, PRESS, SafetyNote, useFocusOnOpen } from "@/components/kit"
import { ReportRequest } from "@/components/report"
import { KINDS } from "@/data/taxonomy"
import { allPlaces, useStore } from "@/store"
import { nextPlace, useVisits, visitKey } from "@/lib/visit-list"
import { LocalRemoval } from "@/components/local-removal"
import { spring } from "@/lib/motion"
import type { LocalFields, Place } from "@/types"
import { photoSrcSet, PHOTO_SIZES } from "@/lib/responsive-photo"
import { cn } from "@/lib/utils"

/** Where the visitor's own place stands with the server. An older place sent before states existed counts as sent. */
const sendState = (l: LocalFields) => l.send ?? (l.remoteId ? "sent" : "local")
const SEND_STATE: Record<ReturnType<typeof sendState>, string> = {
  sent: "נשלח לבדיקה, ויופיע לכולם אחרי אישור.",
  sending: "נשלח לבדיקה…",
  waiting: "ממתין לשליחה. ננסה שוב לבד.",
  rejected: "ההצעה לא התקבלה, ולכן לא נשלחה לבדיקה. המקום נשמר רק במכשיר הזה.",
  withdrawn: "ההצעה נמשכה ונמחקה מהשרת. העותק הזה נשמר רק במכשיר.",
  local: "נשמר רק בדפדפן הזה.",
}

const SOURCE: Record<Place["coord_source"], string> = {
  osm: "OpenStreetMap",
  wikidata: "Wikidata",
  manual: "איתור ידני",
  community: "הוספה מקומית",
  contribution: "הצעה של משפחה או חברים, שאושרה",
}

// `ref` lets AnimatePresence (popLayout) lift the leaving card out of the flow, so the list can take its place at once.
export function PlaceDetail({ place, onBack, ref }: { place: Place; onBack: () => void; ref?: React.Ref<HTMLElement> }) {
  const setTracking = useStore((s) => s.setTracking)
  const [copied, setCopied] = useState(false)
  const visits = useVisits()
  const initVisits = visits.init
  useEffect(() => {
    void initVisits()
  }, [initVisits])
  const remote = useStore((s) => s.remote)
  const places = useStore((s) => s.local)
  const next = nextPlace(place, allPlaces({ remote, local: places }))
  const isSaved = visits.ids.includes(visitKey(place))
  const photos = place.photos ?? []
  // The public card uses only approved content. This device's separate receipt still owns its tracking/removal
  // controls; never attach that capability to the public feed or remove the copy by the server's different id.
  const ownCopy = place.local ? place : places.find((p) => p.local?.remoteId === place.id)
  const ownReceipt = ownCopy?.local
  const local = place.local
  // Contributions (a visitor's own or approved ones) are where private property comes up; curated places are public sites.
  const inPrivate = !!local || place.coord_source === "contribution"
  const titleRef = useFocusOnOpen<HTMLHeadingElement>()

  const share = async () => {
    // The share page's address, whose preview names the place; a place kept only on this device has none to show.
    const url = local
      ? `${location.origin}/#/place/${encodeURIComponent(place.id)}`
      : `${location.origin}/place/${encodeURIComponent(place.id)}`
    try {
      if (local) {
        await navigator.clipboard.writeText(url)
        toast("הקישור המקומי הועתק", { description: "הוא פותח את העותק במכשיר הזה בלבד. יהיה אפשר לשתף עם אחרים אחרי שהמקום יפורסם." })
        return
      }
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: place.name_he, url })
      else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        toast("הקישור הועתק")
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      /* the share sheet was closed */
    }
  }

  return (
    <motion.article
      ref={ref}
      key={place.id}
      initial={{ opacity: 0, x: -32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32, transition: { duration: 0.2 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      // the card's parts settle in one short sequence; the photo is already flying in from the list
      className="cascade flex flex-col gap-6"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="-ms-2 -mb-2 self-start text-label text-ink-2">
        <ArrowRightIcon data-icon="inline-start" />
        כל המקומות
      </Button>

      {photos.length ? (
        <motion.div
          layoutId={`ph-${place.id}`}
          transition={spring.soft}
          data-no-cascade
          // The radius lives in style so Motion keeps the corners round mid-flight; the extra bottom room keeps the caption clear of the clipped corner.
          style={{ borderRadius: 24 }}
          className="-mx-1 -mb-6 overflow-hidden pb-6"
        >
          <PhotoGallery photos={photos} />
        </motion.div>
      ) : local?.photo || place.contributedPhoto ? (
        // The visitor's own photo on this device, or a contributed one approved with its place.
        <figure className="-mx-1">
          <img
            src={local?.photo ?? place.contributedPhoto!.url}
            srcSet={local?.photo ? undefined : photoSrcSet(place.contributedPhoto!.url)}
            sizes={PHOTO_SIZES}
            decoding="async"
            alt={(local ? local.photoAlt : place.contributedPhoto?.alt) || place.name_he}
            className="aspect-[4/3] w-full rounded-3xl object-cover"
          />
          {(local ? local.photoCredit : place.contributedPhoto?.credit) && (
            <figcaption className="px-1 pt-2 text-caption text-ink-2">
              צילום: <CreditName name={(local ? local.photoCredit : place.contributedPhoto?.credit)!} />
            </figcaption>
          )}
        </figure>
      ) : (
        <div className="relative -mx-1 h-40 overflow-hidden rounded-3xl bg-[radial-gradient(120%_110%_at_75%_0%,var(--p-sun-100)_0%,var(--p-field-50)_55%,var(--surface-2)_100%)] dark:bg-[radial-gradient(120%_110%_at_75%_0%,var(--p-dusk)_0%,var(--p-ink-800)_60%,var(--surface-2)_100%)]">
          <motion.img
            src="/art/anemone-watercolor.webp"
            alt=""
            className="absolute start-6 -bottom-12 w-44 drop-shadow-[0_18px_24px_color-mix(in_oklab,var(--p-anemone-700)_25%,transparent)]"
            initial={{ y: 30, rotate: -14, opacity: 0 }}
            animate={{ y: 0, rotate: -6, opacity: 1 }}
            transition={{ type: "spring", stiffness: 90, damping: 16, delay: 0.1 }}
          />
          <div className="absolute end-5 top-5 grid size-11 place-items-center rounded-2xl bg-surface text-brand shadow-chip">
            <KindIcon kind={place.kind} className="size-5" />
          </div>
        </div>
      )}

      <header className="flex flex-col gap-2">
        <p className="text-caption text-ink-3">
          {[KINDS[place.kind].label, place.established && `הוקם ב־${place.established}`, local && "נוסף במכשיר הזה"]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h2 ref={titleRef} tabIndex={-1} className="text-title-2 text-balance text-ink-1 outline-none">
          {place.name_he}
        </h2>
        <p className="text-body font-normal text-ink-2">{place.place_he}</p>
      </header>

      {(place.inMemoryOf ?? local?.inMemoryOf) && (
        <p className="text-title-3 text-ink-1">
          לזכר <span className="text-brand">{place.inMemoryOf ?? local?.inMemoryOf}</span>
        </p>
      )}

      {/* What a visitor does with a place, in one row under its name, as in the system's map cards: going there, sending
          it, keeping it. Each the same size, an icon over a short word; the full name is the accessible one. */}
      <div className="flex gap-2" role="group" aria-label="פעולות למקום">
        {/* A family's place on private property shown approximately leads nobody to it: no navigation (spec 4). */}
        {!(inPrivate && place.precision === "approx") && (
          <>
            <a
              href={`https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes`}
              target="_blank"
              rel="noopener"
              aria-label="ניווט ב־Waze"
              className={ACTION}
            >
              <NavigationIcon className="size-5" aria-hidden="true" />
              Waze
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
              target="_blank"
              rel="noopener"
              aria-label="Google Maps"
              className={ACTION}
            >
              <MapIcon className="size-5" aria-hidden="true" />
              גוגל מפות
            </a>
          </>
        )}
        <button type="button" aria-label={local ? "העתקת קישור מקומי" : "שיתוף"} className={ACTION} onClick={share}>
          {copied ? <CheckIcon className="size-5" aria-hidden="true" /> : <Share2Icon className="size-5" aria-hidden="true" />}
          {copied ? "הועתק" : "שיתוף"}
        </button>
        {!local && (
          <button
            type="button"
            aria-label={isSaved ? "שמור לביקור" : "שמירה לביקור"}
            aria-pressed={isSaved}
            disabled={!visits.ready || visits.busy}
            className={cn(ACTION, "disabled:opacity-50 aria-pressed:bg-fill-2")}
            onClick={async () => {
              const ok = await visits.toggle(visitKey(place))
              toast(
                ok ? (useVisits.getState().ids.includes(visitKey(place)) ? "נשמר לביקור" : "הוסר מהשמורים") : "לא הצלחנו לשמור במכשיר",
                {
                  description: ok ? "רשימת הביקורים נשמרת במכשיר הזה בלבד." : "הרשימה לא השתנתה. אפשר לנסות שוב או לשתף את הקישור.",
                },
              )
            }}
          >
            <BookmarkIcon className="size-5" fill={isSaved ? "currentColor" : "none"} aria-hidden="true" />
            {isSaved ? "נשמר" : "שמירה"}
          </button>
        )}
      </div>

      <p className="reading-copy text-body-lg whitespace-pre-line text-ink-1">{local?.story || place.summary_he}</p>

      {place.precision === "approx" && (
        <p className="rounded-xl bg-fill p-3 text-body text-ink-2">המיקום משוער: הוא מצביע על האזור, לא על הנקודה המדויקת.</p>
      )}
      {place.accessNote && (
        <p className="text-body text-ink-1">
          <span className="text-ink-2">איך מגיעים: </span>
          {place.accessNote}
        </p>
      )}

      {place.region === "envelope" && <SafetyNote lead="המקום קרוב לגבול עזה." />}

      <Tribute placeId={place.id} />
      {/* The rest, quietly: one list of rows under a hairline, not a pile of cards. */}
      <section aria-label="עוד על המקום" className="flex flex-col divide-y divide-line border-y border-line text-ink-1">
        {next && (
          <button className={cn(ROW, "justify-between")} onClick={() => useStore.getState().select(next.id)}>
            <span className="flex min-w-0 flex-col">
              <span className="text-caption text-ink-2">מקום נוסף לגלות</span>
              <span className="text-body font-semibold">{next.name_he}</span>
              <span className="text-caption text-ink-2">
                {KINDS[next.kind].label} · {next.place_he}
              </span>
            </span>
            <ChevronLeftIcon className="size-4 shrink-0 text-ink-2" aria-hidden="true" />
          </button>
        )}
        {place.links.map((l, i) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener" className={cn(ROW, "justify-between")}>
            <span className="flex min-w-0 flex-col">
              {i === 0 && <span className="text-caption text-ink-2">לקריאה נוספת</span>}
              <span className="text-body font-medium">{l.label_he}</span>
            </span>
            <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
          </a>
        ))}
        <Disclosure
          summary="פרטי המיקום והמקורות"
          className="rounded-none border-0"
          summaryClassName="px-1"
          bodyClassName="px-1 text-caption text-ink-3"
        >
          <p className="pb-2 tabular-nums" dir="ltr" style={{ textAlign: "right" }}>
            {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
          </p>
          <p className="pb-2">
            מקור המיקום:{" "}
            {place.coord_source_url ? (
              <a className="underline underline-offset-2" href={place.coord_source_url} target="_blank" rel="noopener">
                {SOURCE[place.coord_source]}
              </a>
            ) : (
              SOURCE[place.coord_source]
            )}
          </p>
        </Disclosure>
        {/* A removal or a correction goes to a person through the request form (spec 6); places on this device only are the visitor's own. */}
        {!local && <ReportRequest key={place.id} place={place} />}
      </section>
      <footer className="flex flex-col gap-3 text-caption text-ink-3">
        {ownReceipt && ownCopy ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* A place sent for review is on the server too; deleting this copy doesn't withdraw it, the tracking view does. */}
            <span>{local ? SEND_STATE[sendState(local)] : "המקום מופיע במפה"}</span>
            {/* A withdrawn place keeps its link only while its files wait to be erased: the view can finish them. */}
            {ownReceipt.remoteId && ownReceipt.trackingToken && (
              <Button
                variant="ghost"
                className="min-h-11 rounded-full"
                onClick={() => setTracking({ id: ownReceipt.remoteId!, token: ownReceipt.trackingToken! })}
              >
                מעקב אחרי ההצעה
              </Button>
            )}
            <LocalRemoval place={ownCopy} />
          </div>
        ) : null}
      </footer>
    </motion.article>
  )
}

/** One of the card's actions: an icon over a short word, all four the same width. */
const ACTION =
  "pressable flex min-h-16 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-2xl bg-fill px-1 py-2 text-caption font-medium whitespace-nowrap text-ink-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30 active:bg-fill-2 [@media(hover:hover)]:hover:bg-fill-2"
/** A row of the list at the card's end. */
const ROW = cn("pressable flex min-h-14 w-full items-center gap-3 px-1 py-3 text-start", PRESS)
