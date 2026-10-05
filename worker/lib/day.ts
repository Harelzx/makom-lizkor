const JERUSALEM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" })

/** The date in Jerusalem at this moment, YYYY-MM-DD, summer time included: the day an anemone is counted on (spec 4). */
export const jerusalemDay = (at: Date) => JERUSALEM.format(at)
