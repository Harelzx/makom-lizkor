import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Img } from "@/components/kit"
import type { Photo } from "@/types"

function Credit({ photo }: { photo: Photo }) {
  return (
    <figcaption className="px-1 text-micro text-ink-3">
      {photo.subject_he}.{" "}
      <a href={photo.commons_url} target="_blank" rel="noopener" className="underline underline-offset-2">
        צילום
      </a>
      {/* Latin names and the license sit in their own direction, so parentheses and "4.0" don't flip in the Hebrew line. */}:{" "}
      <bdi>{photo.author}</bdi>,{" "}
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
          src={`/photos/${photo.file}`}
          placeholder={`/photos/thumb/${photo.file}`}
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
        <div
          ref={strip}
          className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain rounded-3xl bg-surface-3"
          onScroll={(e) => {
            const el = e.currentTarget
            setIndex(Math.round(Math.abs(el.scrollLeft) / el.clientWidth))
          }}
        >
          {photos.map((p) => (
            <Img
              key={p.file}
              src={`/photos/${p.file}`}
              placeholder={`/photos/thumb/${p.file}`}
              alt={p.subject_he}
              className={cn("w-full shrink-0 snap-center", ratio)}
            />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
          {photos.map((p, i) => (
            <button
              key={p.file}
              tabIndex={-1}
              onClick={() => strip.current?.children[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })}
              className={cn("h-1.5 rounded-full bg-white/70 shadow transition-all", i === index ? "w-5 bg-white" : "w-1.5")}
            />
          ))}
        </div>
      </div>
      <Credit photo={photos[Math.min(index, photos.length - 1)]} />
    </figure>
  )
}
