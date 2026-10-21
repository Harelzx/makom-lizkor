const JERUSALEM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" })

/** Today in Jerusalem by this device's clock, as YYYY-MM-DD: the day the server counts anemones on. */
export const jerusalemDay = () => JERUSALEM.format(new Date())
