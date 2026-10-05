import { useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { fillLegal, LEGAL_SECTIONS } from "@/data/legal"
import { HEADLINES } from "@/data/headlines"
import { CONTACT_EMAIL, LAST_UPDATED } from "@/config"
import { FONT_CREDIT } from "@/lib/fonts"
import { PhotoGallery } from "@/components/photo-figure"
import landscapes from "@/data/landscapes.json"
import type { Photo } from "@/types"
import { useStore } from "@/store"

export function About() {
  const open = useStore((s) => s.aboutOpen)
  const setOpen = useStore((s) => s.setAboutOpen)
  const setAddOpen = useStore((s) => s.setAddOpen)
  const section = useStore((s) => s.aboutSection)
  // Opened at a section (from the links under the list, or search), that section is open and takes the focus.
  // Otherwise it opens with every section folded, as it always has.
  // About loads the first time it opens, so its first render may already be an opening at a section.
  const [item, setItem] = useState(() => (open ? (section ?? "") : ""))
  const [seen, setSeen] = useState({ open, section })
  if (seen.open !== open || seen.section !== section) {
    setSeen({ open, section })
    if (open) setItem(section ?? "")
  }
  const sites = useStore((s) => s.seed.filter((p) => p.kind !== "community").length)
  const communities = useStore((s) => s.seed.filter((p) => p.kind === "community").length)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        dir="rtl"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-[520px]"
        onOpenAutoFocus={(e) => {
          const target = section && document.getElementById(section)
          if (!target) return
          e.preventDefault()
          target.scrollIntoView({ block: "start" })
          target.querySelector<HTMLElement>('[data-slot="accordion-trigger"]')?.focus()
        }}
      >
        <div className="relative h-64 shrink-0 overflow-hidden">
          <img
            src="/art/dawn-field.webp"
            alt=""
            className="size-full object-cover object-[50%_70%] dark:brightness-[0.55] dark:saturate-[0.8]"
          />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-popover to-transparent" />
        </div>
        <SheetHeader className="gap-3 px-7 pt-6">
          <SheetTitle className="text-title-1 font-black text-ink-1">על המקום הזה</SheetTitle>
          <SheetDescription className="text-body-lg text-pretty text-ink-1">
            ב־7 באוקטובר 2023 נרצחו ונפלו בדרום אנשים שיצאו מהבית, מהמסיבה, מהמשמרת. מאז הוקמו לזכרם מקומות רבים: אנדרטאות, מצפורים על
            גבעות, ספסלים מול הנוף, עצים וגינות. רובם לא מופיעים בשום מפה.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-7 pt-4 pb-8 text-body-lg text-pretty text-ink-1">
          {/* Written for the third anniversary and dated, because some of it will stop being true. */}
          <div className="flex flex-col gap-1.5">
            <p>
              עברו שלוש שנים. בתים נבנו מחדש, ורוב המפונים כבר חזרו הביתה. אבל הבוקר ההוא עדיין לא נגמר: המלחמה נמשכת, ועדיין לא ידוע לנו כל
              מה שקרה בו. לזכור זה גם לרצות לדעת. ככל שהזמן עובר, החדשות עוברות הלאה. המקומות נשארים, והם הדרך שלנו להגיד: אנחנו זוכרים, ולא
              נשכח.
            </p>
            <p className="text-caption text-ink-3">נכתב באוקטובר 2026</p>
          </div>
          <p>
            מקום לזכור מרכז אותם במפה אחת: כרגע {sites} אתרי זיכרון ו־{communities} קהילות. לכל קהילה יש כאן שני סיפורים: מי שהיא איבדה,
            ואיך היא חוזרת לחיים. בחרנו בכלנית, הפרח של הנגב המערבי, כי היא חוזרת לפרוח בכל חורף.
          </p>
          {landscapes.length > 0 && (
            <PhotoGallery
              photos={(landscapes as Photo[]).filter((p) => /שוקדה|בארי|דרום אדום/.test(p.subject_he)).slice(0, 6)}
              ratio="aspect-[16/10]"
            />
          )}
          <p>
            המשפחות והחברים יודעים על המקומות הקטנים יותר מכולם. לכן כל אחד יכול להוסיף מקום. בגרסה הזו המקום נשמר במכשיר שלכם, ואפשר לשלוח
            אותו אלינו כדי שיופיע אצל כולם.
          </p>
          <p className="text-caption text-ink-2">
            זו יוזמה פרטית והתנדבותית, ללא מטרות רווח. היא אינה אתר רשמי ואינה קשורה לגוף ממשלתי. את הנצחת הנופלים והנרצחים מנהלים האתרים{" "}
            <a className="underline underline-offset-2" href="https://www.izkor.gov.il" target="_blank" rel="noopener">
              יזכור
            </a>{" "}
            ו
            <a className="underline underline-offset-2" href="https://laad.btl.gov.il" target="_blank" rel="noopener">
              לעד
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="brand"
              className="rounded-full px-5"
              onClick={() => {
                setOpen(false)
                setAddOpen(true)
              }}
            >
              הוספת מקום
            </Button>
            <Button variant="outline" className="rounded-full" asChild>
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("מקום לזכור")}`}>כתבו לנו</a>
            </Button>
            <Button variant="ghost" className="rounded-full text-ink-2" onClick={() => useStore.getState().replayIntro()}>
              <RotateCcwIcon data-icon="inline-start" />
              צפייה בפתיחה שוב
            </Button>
          </div>

          <Accordion type="single" collapsible value={item} onValueChange={setItem} className="mt-4">
            {/* The opening's headlines, readable here in full: with the source of each and the credit for each photo. */}
            <AccordionItem value="headlines" id="headlines">
              <AccordionTrigger className="text-headline text-ink-1">שלוש השנים בכותרות</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-3 text-body text-ink-2">
                  <p>
                    בפתיחה, הספירה עוברת על אירועי שלוש השנים. הכותרות נכתבו כאן במילים שלנו, על סמך הדיווח שמקושר לכל אחת. התמונות
                    מוויקישיתוף, ברישיון חופשי, חתוכות ומוקטנות.
                  </p>
                  <ol className="flex flex-col">
                    {HEADLINES.map((h) => (
                      <li key={h.text} className="flex flex-col gap-0.5 border-t border-line py-3 first:border-t-0 first:pt-0">
                        <span className="text-caption text-ink-3 tabular-nums">{h.when ?? h.date.split("-").reverse().join(".")}</span>
                        <span className="text-ink-1">{h.text}</span>
                        <span className="text-caption [&_a]:underline [&_a]:underline-offset-2">
                          <a href={h.source.url} target="_blank" rel="noopener">
                            {h.source.label}
                          </a>
                          {h.photo && (
                            <>
                              {" · צילום: "}
                              <a href={h.photo.url} target="_blank" rel="noopener">
                                {h.photo.author}
                              </a>
                              {", "}
                              <a href={h.photo.license_url} target="_blank" rel="noopener">
                                {h.photo.license}
                              </a>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </AccordionContent>
            </AccordionItem>
            {LEGAL_SECTIONS.map((s) => (
              <AccordionItem key={s.id} value={s.id} id={s.id}>
                <AccordionTrigger className="text-headline text-ink-1">{s.title}</AccordionTrigger>
                <AccordionContent>
                  <div
                    className="flex flex-col gap-3 text-body text-ink-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2 [&_li]:ms-4 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2"
                    dangerouslySetInnerHTML={{ __html: fillLegal(s.html).replaceAll("{{FONTS}}", FONT_CREDIT) }}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="text-caption text-ink-3">עודכן לאחרונה ב־{new Date(LAST_UPDATED).toLocaleDateString("he-IL")}</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
