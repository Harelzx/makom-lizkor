import { useEffect, useState } from "react"
import { motion } from "motion/react"
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, NavigationIcon, Share2Icon, BookmarkIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { KindIcon } from "@/components/kind-icon"
import { Tribute } from "@/components/tribute"
import { PhotoGallery } from "@/components/photo-figure"
import { SafetyNote, useFocusOnOpen } from "@/components/kit"
import { ReportRequest } from "@/components/report"
import { KINDS } from "@/data/taxonomy"
import { allPlaces, useStore } from "@/store"
import { nextPlace, useVisits, visitKey } from "@/lib/visit-list"
import { LocalRemoval } from "@/components/local-removal"
import { spring } from "@/lib/motion"
import type { LocalFields, Place } from "@/types"

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
            alt={(local ? local.photoAlt : place.contributedPhoto?.alt) || place.name_he}
            className="aspect-[4/3] w-full rounded-3xl object-cover"
          />
          {(local ? local.photoCredit : place.contributedPhoto?.credit) && (
            <figcaption className="px-1 pt-2 text-caption text-ink-2">
              צילום: <bdi>{local ? local.photoCredit : place.contributedPhoto?.credit}</bdi>
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

      <p className="reading-copy text-body-lg whitespace-pre-line text-ink-1">{local?.story || place.summary_he}</p>

      {place.precision === "approx" && (
        <p className="rounded-xl bg-surface-2 p-3 text-body text-ink-2">המיקום משוער: הוא מצביע על האזור, לא על הנקודה המדויקת.</p>
      )}
      {place.accessNote && (
        <p className="text-body text-ink-1">
          <span className="text-ink-2">איך מגיעים: </span>
          {place.accessNote}
        </p>
      )}

      <section className="action-section" aria-label="פעולות למקום">
        {/* A family's place on private property shown approximately leads nobody to it: no navigation (spec 4). */}
        {!(inPrivate && place.precision === "approx") && (
          <div className="flex flex-wrap gap-2" aria-label="ניווט למקום">
            <Button variant="ghost" className="min-h-11 rounded-full px-3 text-label text-ink-1 hover:bg-surface-2" asChild>
              <a href={`https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes`} target="_blank" rel="noopener">
                <NavigationIcon data-icon="inline-start" />
                ניווט ב־Waze
              </a>
            </Button>
            <Button variant="ghost" className="min-h-11 rounded-full px-3 text-label text-ink-1 hover:bg-surface-2" asChild>
              <a href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`} target="_blank" rel="noopener">
                Google Maps
              </a>
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2" aria-label="שיתוף ושמירה">
          <Button variant="outline" className="min-h-11 rounded-full px-4" onClick={share}>
            {copied ? <CheckIcon data-icon="inline-start" /> : <Share2Icon data-icon="inline-start" />}
            {local ? "העתקת קישור מקומי" : "שיתוף"}
          </Button>
          {!local && (
            <Button
              variant={isSaved ? "secondary" : "outline"}
              className="min-h-11 self-start rounded-full px-4"
              aria-pressed={isSaved}
              disabled={!visits.ready || visits.busy}
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
              <BookmarkIcon className="size-4" fill={isSaved ? "currentColor" : "none"} />
              {isSaved ? "שמור לביקור" : "שמירה לביקור"}
            </Button>
          )}
        </div>
      </section>
      {place.region === "envelope" && <SafetyNote lead="המקום קרוב לגבול עזה." />}

      <Tribute placeId={place.id} />
      {next && (
        <section className="rounded-2xl bg-surface-2 p-4" aria-label="מקום נוסף לגלות">
          <p className="text-caption text-ink-2">מקום נוסף לגלות</p>
          <button
            className="pressable mt-1 flex min-h-11 w-full items-center justify-between gap-3 text-start text-body font-semibold text-ink-1"
            onClick={() => useStore.getState().select(next.id)}
          >
            <span>
              {next.name_he}
              <span className="block text-caption font-normal text-ink-2">
                {KINDS[next.kind].label} · {next.place_he}
              </span>
            </span>
            <ArrowRightIcon className="size-4 rotate-180" />
          </button>
        </section>
      )}
      {place.links.length > 0 && (
        <section className="flex flex-col gap-1" aria-labelledby={`links-${place.id}`}>
          <h3 id={`links-${place.id}`} className="px-2 text-label text-ink-2">
            לקריאה נוספת
          </h3>
          <ul className="flex flex-col">
            {place.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener"
                  className="pressable flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-body font-medium text-ink-1 hover:bg-surface-2"
                >
                  {l.label_he}
                  <ExternalLinkIcon className="size-3.5 shrink-0 text-ink-3" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Separator />

      <footer className="flex flex-col gap-1 text-caption text-ink-3">
        <details className="rounded-xl border border-line px-3 py-1">
          <summary className="pressable min-h-11 cursor-pointer py-3 text-label text-ink-2">פרטי המיקום והמקורות</summary>
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
        </details>
        {local ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* A place sent for review is on the server too; deleting this copy doesn't withdraw it, the tracking view does. */}
            <span>{SEND_STATE[sendState(local)]}</span>
            {/* A withdrawn place keeps its link only while its files wait to be erased: the view can finish them. */}
            {local.remoteId && local.trackingToken && (
              <Button
                variant="ghost"
                className="min-h-11 rounded-full"
                onClick={() => setTracking({ id: local.remoteId!, token: local.trackingToken! })}
              >
                מעקב אחרי ההצעה
              </Button>
            )}
            <LocalRemoval place={place} />
          </div>
        ) : null}

        {/* A removal or a correction goes to a person through the request form (spec 6); places on this device only are the visitor's own. */}
        {!local && <ReportRequest key={place.id} place={place} />}
      </footer>
    </motion.article>
  )
}
