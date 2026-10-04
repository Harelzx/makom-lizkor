# Fetch freely licensed Commons photos of Oct 7 memorial sites and western Negev anemone fields.
# Strict: CC0 / PD / CC BY / CC BY-SA only; no images of the attack itself, no portraits of victims.
import json, re, sys, time, urllib.error, urllib.parse, urllib.request, html

UA = {"User-Agent": "makom-lizkor/0.2 (memorial project; non-commercial)"}
API = "https://commons.wikimedia.org/w/api.php"
OUT = "/Users/harel/Desktop/remember_07102026/web/public/photos/"

def api(**p):
    p["format"] = "json"
    p["maxlag"] = 5
    for attempt in range(8):
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers=UA)
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            time.sleep(2)
            return r
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print("429, waiting", wait, file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("rate limited")

def members(cat, kind="file", limit=60):
    d = api(action="query", list="categorymembers", cmtitle="Category:" + cat, cmtype=kind, cmlimit=limit)
    return [m["title"] for m in d.get("query", {}).get("categorymembers", [])]

def search(q, limit=25):
    d = api(action="query", list="search", srsearch=q, srnamespace=6, srlimit=limit)
    return [m["title"] for m in d.get("query", {}).get("search", [])]

BAD = re.compile(r"hamas|shooting|terrorist|body|bodies|corpse|blood|weapon|rifle|rocket|funeral|burned|burnt|destroy|damage|ruin|captive|hostage poster|kidnapped poster|portrait|interview|herzog|netanyahu|minister|president|GPO", re.I)
OK_LIC = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? ?\d(\.\d)?|cc-by(-sa)?-\d(\.\d)?)", re.I)

def info(titles):
    d = api(action="query", titles="|".join(titles), prop="imageinfo", iiprop="url|extmetadata|size", iiurlwidth=1600)
    return list(d.get("query", {}).get("pages", {}).values())

def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()

sets = {
    "memorial": ["Nova Festival Victims Memorial", "6:29 exhibit", "Amit lookout", "Re'im music festival massacre migunit", "We will dance again"],
}
titles = []
for cat in sets["memorial"]:
    try:
        titles += [(t, "memorial", cat) for t in members(cat)]
    except Exception as e:
        print("cat fail", cat, e)
    time.sleep(0.5)
for q, cat in [
    ("nova memorial site PikiWiki", "memorial"), ("flowers and greenery in nova", "memorial"),
    ("kfar aza memorial", "memorial"), ("sderot police station memorial", "memorial"),
    ("hostages square tel aviv", "memorial"), ("Anemone coronaria Negev field", "landscape"),
    ("Darom Adom anemones", "landscape"), ("anemones Re'im forest", "landscape"), ("Be'eri forest anemone", "landscape"),
    ("Shokeda anemones", "landscape"), ("kalaniyot Negev", "landscape"),
]:
    try:
        titles += [(t, cat, q) for t in search(q)]
    except Exception as e:
        print("search fail", q, e)
    time.sleep(0.5)

seen, out = set(), []
for i in range(0, len(titles), 40):
    chunk = [t for t in titles[i:i + 40] if t[0] not in seen]
    for t in chunk: seen.add(t[0])
    if not chunk: continue
    meta = {t[0]: t for t in chunk}
    for p in info([t[0] for t in chunk]):
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {})
        title = p.get("title", "")
        lic = strip(em.get("LicenseShortName", {}).get("value"))
        desc = strip(em.get("ImageDescription", {}).get("value"))[:300]
        cats = strip(em.get("Categories", {}).get("value"))
        if not title.lower().endswith((".jpg", ".jpeg", ".png")): continue
        if not OK_LIC.match(lic): continue
        if BAD.search(title + " " + desc + " " + cats): continue
        if ii.get("width", 0) < 1000: continue
        out.append({
            "title": title, "category": meta[title][1], "hint": meta[title][2],
            "thumb": ii.get("thumburl"), "commons_url": ii.get("descriptionurl"),
            "author": strip(em.get("Artist", {}).get("value"))[:120] or "לא צוין",
            "license": lic, "license_url": em.get("LicenseUrl", {}).get("value", ""),
            "desc": desc, "lat": em.get("GPSLatitude", {}).get("value"), "lng": em.get("GPSLongitude", {}).get("value"),
        })
    time.sleep(0.5)
json.dump(out, open("photos_candidates.json", "w"), ensure_ascii=False, indent=1)
print(len(out))
for o in out: print(o["category"], "|", o["title"][:80], "|", o["license"], "|", o["author"][:30])
