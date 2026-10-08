import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityIcon, MoonIcon, PlusIcon, RouteIcon, SunIcon } from "lucide-react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useCommandState } from "cmdk"
import { Anemone } from "@/components/anemone"
import { Button } from "@/components/ui/button"
import { KINDS } from "@/data/taxonomy"
import { allPlaces, matches, normalize, useStore } from "@/store"

/** A line between the groups, for the eye only: inside a list box ARIA allows options and groups, not separators. */
function Rule() {
  const searching = useCommandState((s) => !!s.search)
  return searching ? null : <div aria-hidden="true" className="my-1.5 h-px bg-border/50" />
}

function EmptyActions({ clear, add }: { clear: () => void; add: () => void }) {
  const empty = useCommandState((s) => !!s.search && s.filtered.count === 0)
  if (!empty) return null
  return (
    <div className="flex flex-wrap justify-center gap-2 border-t border-line p-3">
      <Button variant="outline" className="min-h-11 rounded-full" onClick={clear}>
        ניקוי החיפוש
      </Button>
      <Button variant="ghost" className="min-h-11 rounded-full whitespace-normal" onClick={add}>
        מכירים מקום שחסר? הוסיפו אותו
      </Button>
    </div>
  )
}

/** ⌘K: every place and community, plus the few things you can do. */
export function Search() {
  const [query, setQuery] = useState("")
  const open = useStore((s) => s.searchOpen)
  const setOpen = useStore((s) => s.setSearchOpen)
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const light = useStore((s) => s.light)
  const places = useMemo(() => allPlaces({ remote, local }), [remote, local])
  const communities = places.filter((p) => p.kind === "community")
  const sites = places.filter((p) => p.kind !== "community")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable
      if (e.key === "/" && !typing) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useStore.getState().searchOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  // Choosing a result opens its card, and the card takes the focus; closing the dialog mustn't take it back to where
  // the search began. Closing it any other way (Esc) still returns the focus there.
  const chose = useRef(false)
  const go = (id: string) => {
    chose.current = true
    setOpen(false)
    const s = useStore.getState()
    if (s.tab === "journey") s.setTab("places")
    s.select(id)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="חיפוש"
      description="חיפוש מקום, קהילה או פעולה"
      onCloseAutoFocus={(e) => {
        if (chose.current) e.preventDefault()
        chose.current = false
      }}
    >
      {/* Plain substring matching: cmdk's fuzzy score lets "בארי" match places in Ashdod and Ness Ziona. */}
      <Command
        label="חיפוש מקום, יישוב או פעולה"
        filter={(value, search) => {
          const place = places.find((p) => `place:${p.id}` === value)
          return (
            place
              ? matches(place, search)
              : normalize(search)
                  .split(/\s+/)
                  .every((t) => value.includes(t))
          )
            ? 1
            : 0
        }}
      >
        <CommandInput placeholder="מקום, יישוב, שם…" value={query} onValueChange={setQuery} />
        <CommandList label="תוצאות" className="max-h-[min(60vh,440px)]">
          <CommandEmpty>
            <p role="option" aria-disabled="true">
              לא מצאנו מקום. נסו יישוב או שם האדם שהוא מנציח.
            </p>
          </CommandEmpty>
          <CommandGroup heading="מקומות">
            {sites.map((p) => (
              <CommandItem key={p.id} className="py-2" value={`place:${p.id}`} onSelect={() => go(p.id)}>
                <Anemone size={18} variant={p.local ? "pale" : "crimson"} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{p.name_he}</span>
                  <span className="truncate text-caption text-ink-3">
                    {KINDS[p.kind].label} · {p.place_he}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <Rule />
          <CommandGroup heading="קהילות · מידע נוסף">
            {communities.map((c) => (
              <CommandItem key={c.id} value={`place:${c.id}`} onSelect={() => go(c.id)}>
                <span className="size-2 rounded-full border-2 border-foreground" aria-hidden="true" />
                {c.name_he}
              </CommandItem>
            ))}
          </CommandGroup>
          <Rule />
          <CommandGroup heading="פעולות">
            <CommandItem
              value="מסע 232 journey"
              onSelect={() => {
                setOpen(false)
                useStore.getState().setTab("journey")
              }}
            >
              <RouteIcon />
              מסע לאורך כביש 232
            </CommandItem>
            <CommandItem
              value="הוספת מקום add"
              onSelect={() => {
                setOpen(false)
                useStore.getState().setAddOpen(true)
              }}
            >
              <PlusIcon />
              הוספת מקום
            </CommandItem>
            <CommandItem
              value="הצהרת נגישות פרטיות תנאי שימוש accessibility"
              onSelect={() => useStore.getState().openAbout("accessibility")}
            >
              <AccessibilityIcon />
              הצהרת נגישות
            </CommandItem>
            <CommandItem
              value="לילה בוקר theme"
              onSelect={() => {
                setOpen(false)
                useStore.getState().setLight(light === "night" ? "morning" : "night")
              }}
            >
              {light === "night" ? <SunIcon /> : <MoonIcon />}
              {light === "night" ? "אור בוקר" : "מצב לילה"}
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <EmptyActions
          clear={() => setQuery("")}
          add={() => {
            setOpen(false)
            useStore.getState().setQuery("")
            useStore.getState().setAddOpen(true)
          }}
        />
      </Command>
    </CommandDialog>
  )
}
