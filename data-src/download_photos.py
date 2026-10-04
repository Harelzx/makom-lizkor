# Downloads the vetted Commons photos (1600px thumbnails) one at a time, politely.
import json, time, urllib.request, urllib.error, subprocess, os
OUT = "/Users/harel/Desktop/remember_07102026/web/public/photos/"
UA = {"User-Agent": "makom-lizkor/0.2 (memorial project; non-commercial)"}
items = json.load(open("photos_vetted.json"))
done = []
for it in items:
    dst = OUT + it["file"]
    if not os.path.exists(dst):
        for attempt in range(6):
            try:
                req = urllib.request.Request(it["thumburl_1600"], headers=UA)
                data = urllib.request.urlopen(req, timeout=60).read()
                open(dst, "wb").write(data)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(15 * (attempt + 1)); continue
                print("fail", it["file"], e); break
        time.sleep(1.5)
    if os.path.exists(dst):
        subprocess.run(["magick", dst, "-resize", "1600x1600>", "-strip", "-quality", "80", dst], check=False)
        done.append({k: it[k] for k in ["file", "title", "commons_url", "author", "license", "license_url", "lat", "lng", "subject_he", "category", "place_hint", "modified"]})
        print("ok", it["file"], flush=True)
json.dump(done, open("photos.json", "w"), ensure_ascii=False, indent=1)
print("total", len(done))
