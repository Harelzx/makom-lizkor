import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { LEGAL_SECTIONS } from "@/data/legal"
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
  const sites = useStore((s) => s.seed.filter((p) => p.kind !== "community").length)
  const communities = useStore((s) => s.seed.filter((p) => p.kind === "community").length)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        dir="rtl"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-[520px]"
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

          <Accordion type="single" collapsible className="mt-4">
            {LEGAL_SECTIONS.map((s) => (
              <AccordionItem key={s.id} value={s.id} id={s.id}>
                <AccordionTrigger className="text-headline text-ink-1">{s.title}</AccordionTrigger>
                <AccordionContent>
                  <div
                    className="flex flex-col gap-3 text-body text-ink-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2 [&_li]:ms-4 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2"
                    dangerouslySetInnerHTML={{ __html: s.html.replaceAll("{{EMAIL}}", CONTACT_EMAIL).replaceAll("{{FONTS}}", FONT_CREDIT) }}
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
