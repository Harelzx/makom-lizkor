import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Img } from "@/components/kit"
import type { Photo } from "@/types"
import { photoSrcSet, PHOTO_SIZES } from "@/lib/responsive-photo"
import { nameParts } from "@/lib/display-text"

/** A credited name, each of its spellings in its own direction. */
export function CreditName({ name }: { name: string }) {
  const [first, second] = nameParts(name)
  return second ? (
    <>
      <bdi>{first}</bdi> (<bdi>{second}</bdi>)
    </>
  ) : (
    <bdi>{first}</bdi>
  )
}

function Credit({ photo }: { photo: Photo }) {
  return (
    <figcaption className="px-1 text-caption text-ink-2">
      {photo.subject_he}.{" "}
      <a href={photo.commons_url} target="_blank" rel="noopener" className="underline underline-offset-2">
        צילום
      </a>
      {/* Latin names and the license sit in their own direction, so parentheses and "4.0" don't flip in the Hebrew line. */}:{" "}
      <CreditName name={photo.author} />,{" "}
      <a href={photo.license_url} target="_blank" rel="noopener" className="underline underline-offset-2">
        <bdi dir="ltr">{photo.license}</bdi>
      </a>
      , דרך <bdi dir="ltr">Wikimedia Commons</bdi> (הוקטן)
    </figcaption>
  )
}

/** A Commons photograph, always with title, author, source and license (TASL). */
export function PhotoFigure({ photo, className, ratio = "aspect-[4/3]" }: { photo: Photo; className?: string; ratio?: string }) {
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="overflow-hidden rounded-3xl bg-surface-3">
        <Img
          src={photo.url}
          srcSet={photoSrcSet(photo.url)}
          sizes={PHOTO_SIZES}
          loading="eager"
          placeholder={photo.thumb_url}
          alt={photo.subject_he}
          className={cn("w-full", ratio)}
        />
      </div>
      <Credit photo={photo} />
    </figure>
  )
}

/** Several photos: a swipeable strip that snaps, with dots and the current photo's credit. */
export function PhotoGallery({ photos, className, ratio = "aspect-[4/3]" }: { photos: Photo[]; className?: string; ratio?: string }) {
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  if (photos.length === 1) return <PhotoFigure photo={photos[0]} className={className} ratio={ratio} />

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        {/* The strip takes focus, so a keyboard can scroll it with the arrows; a screen reader hears how many photos it holds. */}
        <div
          ref={strip}
          tabIndex={0}
          role="group"
          aria-label={`${photos.length} תמונות. אפשר לעבור ביניהן בחיצים`}
          className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain rounded-3xl bg-surface-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          onScroll={(e) => {
            const el = e.currentTarget
            setIndex(Math.round(Math.abs(el.scrollLeft) / el.clientWidth))
          }}
        >
          {photos.map((p, i) => (
            <Img
              key={p.url}
              src={Math.abs(i - index) <= 1 ? p.url : undefined}
              srcSet={Math.abs(i - index) <= 1 ? photoSrcSet(p.url) : undefined}
              sizes={PHOTO_SIZES}
              loading={i === 0 ? "eager" : "lazy"}
              placeholder={p.thumb_url}
              alt={p.subject_he}
              className={cn("w-full shrink-0 snap-center", ratio)}
            />
          ))}
        </div>
        {/* Each dot is a real button with a name, so the photos can also be chosen one by one. The hit area is larger than the dot. */}
        <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              aria-label={`תמונה ${i + 1} מתוך ${photos.length}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => strip.current?.children[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })}
              className="group grid h-6 place-items-center rounded-full px-1 outline-none focus-visible:ring-3 focus-visible:ring-white/70"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full bg-white/70 shadow transition-all group-hover:bg-white",
                  i === index ? "w-5 bg-white" : "w-1.5",
                )}
              />
            </button>
          ))}
        </div>
      </div>
      <Credit photo={photos[Math.min(index, photos.length - 1)]} />
    </figure>
  )
}
