# Side by side: the same moments from several films of the opening, one row per moment.
#   python3 compare-films.py out.png beats.json  film.mp4:offset:label  film.mp4:offset:label ...
# offset is where the film's t = 0 (the click) falls in the file, in seconds. Frames are cropped to 16:9.
import io, json, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

out, beats = sys.argv[1], json.load(open(sys.argv[2]))
films = [a.rsplit(":", 2) for a in sys.argv[3:]]
W, H = 560, 315
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)


def frame(path, t):
    png = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
         "-vf", f"crop=iw:min(ih\\,iw*9/16),scale={W}:{H}", "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGB")


head = 26
sheet = Image.new("RGB", (len(films) * (W + 6) - 6 + 120, head + len(beats) * (H + 6)), (32, 32, 32))
d = ImageDraw.Draw(sheet)
for j, (_, _, label) in enumerate(films):
    d.text((120 + j * (W + 6) + 6, 4), label, fill=(255, 220, 120), font=font)
for i, (t, label) in enumerate(beats):
    y = head + i * (H + 6)
    d.text((6, y + 6), f"{t:.2f} s", fill=(255, 220, 120), font=font)
    d.text((6, y + 28), label, fill=(220, 220, 220), font=font)
    for j, (path, offset, _) in enumerate(films):
        sheet.paste(frame(path, float(offset) + t), (120 + j * (W + 6), y))
sheet.save(out)
print(out, sheet.size)
