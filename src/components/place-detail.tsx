import { useState } from "react"
import { motion } from "motion/react"
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, NavigationIcon, Share2Icon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { KindIcon } from "@/components/kind-icon"
import { Tribute } from "@/components/tribute"
import { PhotoGallery } from "@/components/photo-figure"
import { KINDS } from "@/data/taxonomy"
import { CONTACT_EMAIL } from "@/config"
import { useStore } from "@/store"
import { spring } from "@/lib/motion"
import type { Place } from "@/types"

const SOURCE: Record<Place["coord_source"], string> = {
  osm: "OpenStreetMap",
  wikidata: "Wikidata",
  manual: "איתור ידני",
  community: "הוספה מקומית",
}

// `ref` lets AnimatePresence (popLayout) lift the leaving card out of the flow, so the list can take its place at once.
export function PlaceDetail({ place, onBack, ref }: { place: Place; onBack: () => void; ref?: React.Ref<HTMLElement> }) {
  const removeLocal = useStore((s) => s.removeLocal)
  const [copied, setCopied] = useState(false)
  const photos = place.photos ?? []
  const local = place.local

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/place/${place.id}`
    try {
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
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
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
      ) : local?.photo ? (
        <figure className="-mx-1">
          <img src={local.photo} alt={local.photoAlt || place.name_he} className="aspect-[4/3] w-full rounded-3xl object-cover" />
          {local.photoCredit && (
            <figcaption className="px-1 pt-2 text-micro text-ink-3">
              צילום: <bdi>{local.photoCredit}</bdi>
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
        <h2 className="text-title-2 text-balance text-ink-1">{place.name_he}</h2>
        <p className="text-label font-normal text-ink-2">{place.place_he}</p>
      </header>

      {local?.inMemoryOf && (
        <p className="text-title-3 text-ink-1">
          לזכר <span className="text-brand">{local.inMemoryOf}</span>
        </p>
      )}

      <p className="text-body-lg text-pretty text-ink-1">{local?.story || place.summary_he}</p>

      <Tribute placeId={place.id} />

      <div className="-mx-2.5 flex flex-wrap gap-x-1 gap-y-1">
        <Button variant="ghost" className="h-9 rounded-full px-2.5 text-label text-ink-1 hover:bg-surface-2" asChild>
          <a href={`https://waze.com/ul?ll=${place.lat},${place.lng}&navigate=yes`} target="_blank" rel="noopener">
            <NavigationIcon data-icon="inline-start" />
            ניווט ב־Waze
          </a>
        </Button>
        <Button variant="ghost" className="h-9 rounded-full px-2.5 text-label text-ink-1 hover:bg-surface-2" asChild>
          <a href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`} target="_blank" rel="noopener">
            Google Maps
          </a>
        </Button>
        <Button variant="ghost" className="h-9 rounded-full px-2.5 text-label text-ink-1 hover:bg-surface-2" onClick={share}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <Share2Icon data-icon="inline-start" />}
          שיתוף
        </Button>
      </div>

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
        <p className="tabular-nums" dir="ltr" style={{ textAlign: "right" }}>
          {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
        </p>
        {place.precision === "approx" && <p>המיקום משוער: הוא מצביע על האזור, לא על הנקודה המדויקת.</p>}
        {local ? (
          <div className="flex items-center justify-between gap-2">
            <span>נשמר רק בדפדפן הזה.</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                void removeLocal(place.id)
                toast("המקום נמחק מהמכשיר")
              }}
            >
              <Trash2Icon data-icon="inline-start" />
              מחיקה
            </Button>
          </div>
        ) : (
          <p>
            מקור המיקום:{" "}
            {place.coord_source_url ? (
              <a className="underline underline-offset-2" href={place.coord_source_url} target="_blank" rel="noopener">
                {SOURCE[place.coord_source]}
              </a>
            ) : (
              SOURCE[place.coord_source]
            )}
            {" · "}
            <a
              className="underline underline-offset-2"
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("תיקון: " + place.name_he)}&body=${encodeURIComponent(`מזהה: ${place.id}\n`)}`}
            >
              מצאתם טעות?
            </a>
          </p>
        )}
      </footer>
    </motion.article>
  )
}
