# Builds every sound file in public/sound/ from the chosen takes (ElevenLabs), byte for byte. Re-runnable:
#   python3 tools/sound-master.py   (needs ffmpeg)
# The takes stay out of git, in assets-src/sound/ of the project folder; the output goes to this checkout's public/sound/.
import glob, os, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
REPO = git("rev-parse", "--show-toplevel")
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(os.path.join(HERE, git("rev-parse", "--git-common-dir")))))
os.chdir(os.path.join(PROJECT, "assets-src", "sound"))
OUT = os.path.join(REPO, "public", "sound")
ENC = ["-c:a", "libmp3lame", "-b:a", "96k", "-ar", "44100"]
src = lambda take: glob.glob(f"raw/{take}/*.mp3")[0]
def run(*a):
    r = subprocess.run(a, capture_output=True, text=True); assert r.returncode == 0, r.stderr[-300:]; return r
def lufs(f, af="anull"):
    e = subprocess.run(["ffmpeg","-hide_banner","-i",f,"-af",f"{af},ebur128=peak=true","-f","null","-"],capture_output=True,text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", e)[-1]), float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", e)[-1])
def gain(f, *, target=None, peak=None, af="anull"):
    i, p = lufs(f, af); g = (target - i) if target is not None else (peak - p); return min(g, -0.5 - p)

def bed(name, takes, target):
    parts = []
    for k, t in enumerate(takes):
        # the rumble below 90 Hz is most of these takes' energy and no speaker plays it: cut it, then level and set by
        # what is heard
        even = f"/tmp/bed-{name}-{k}-even.wav"
        run("ffmpeg", "-y", "-i", src(t), "-af", "highpass=f=90:poles=2,highpass=f=90:poles=2,dynaudnorm=f=400:g=15:p=0.7:m=30", even)
        tmp = f"/tmp/bed-{name}-{k}.wav"
        run("ffmpeg", "-y", "-i", even, "-af", f"volume={gain(even, target=target):.2f}dB", tmp)
        parts.append(tmp)
    run("ffmpeg", "-y", "-i", parts[0], "-i", parts[1], "-filter_complex", "[0][1]acrossfade=d=0.6:c1=qsin:c2=qsin", *ENC, f"{OUT}/{name}.mp3")

def beat(name, take, *, target=None, peak=None, swap=False):
    g = gain(src(take), target=target, peak=peak)
    af = f"silenceremove=start_periods=1:start_threshold=-60dB,volume={g:.2f}dB,areverse,afade=t=in:d=0.012,areverse"
    if swap: af += ",pan=stereo|c0=c1|c1=c0"
    run("ffmpeg", "-y", "-i", src(take), "-af", af, *ENC, f"{OUT}/{name}.mp3")

bed("night", ["night-b", "night-a"], -27)
bed("dawn", ["dawn-a", "dawn-c"], -27)
beat("tick", "tick-a", peak=-5)
# the light over the name: a harp shimmer on exactly the notes the score holds there
beat("sweep", "sparkle-harp-b", target=-23)

# keys and space bar, 2 dB down (a typed line about -30 LUFS)
for k in range(1, 6):
    run("ffmpeg", "-y", "-i", f"keys/key-{k}.wav", "-af", "volume=-5dB", *ENC, f"{OUT}/key-{k}.mp3")
run("ffmpeg", "-y", "-i", "keys/space.wav", "-af", "volume=-5dB", *ENC, f"{OUT}/space.mp3")

# the score: the natural cut with its opening rebuilt (piano from the first beat), and the light line placed so its
# harp starts as the light starts across the name: the name begins 27.6 s into the score, after the breath
score = glob.glob("score-open-b/*.mp3")[0]; light = glob.glob("light-a/*.mp3")[0]
for name, name_at in [("score", 27.6)]:
    at = int((name_at + 1.3 - 2.58) * 1000)
    run("ffmpeg","-y","-i",score,"-i",light,"-filter_complex",f"[1]adelay={at}|{at}[l];[0][l]amix=inputs=2:duration=first:normalize=0","/tmp/score-v.wav")
    run("ffmpeg","-y","-i","/tmp/score-v.wav","-af",f"volume={gain('/tmp/score-v.wav', target=-23):.2f}dB","-c:a","libmp3lame","-b:a","128k","-ar","44100",f"{OUT}/{name}.mp3")

for f in sorted(glob.glob(f"{OUT}/*.mp3")):
    i, p = lufs(f); print(f"{os.path.basename(f):17} {i:6.1f} LUFS  peak {p:5.1f}")
