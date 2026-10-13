#!/usr/bin/env python
"""catalogue: the cataloguer's tool. Splits the first cut into shots and indexes them.

Usage:
    python catalogue.py <client> <job-id> [--threshold 0.30] [--min-shot 0.5] [--cuts 2.40,5.12]

Run from the workspace root after new-job.js. Finds the cuts in the first cut with ffmpeg's scene
score (or takes them from --cuts, in seconds, when the person knows them), snaps every cut to the
frame grid, and writes per shot:

  media/footage/shots/S01.mp4      the shot, frame-exact, re-encoded near-lossless (CRF 14), own sound
  previews/shots/S01.jpg           first | middle | last frame strip, for the board and the interrogator
  previews/shots/S01-mid.png       the middle frame at full size, for the interrogator to look at
  previews/contact-sheet.jpg       every shot's middle frame on one sheet, labelled
  media/audio/first-cut.wav        the cut's own sound, laid back under the final render untouched

and shots.json (the index every later stage reads). The shots' frame counts add up to the cut's,
which is what lets render.py put the cut back together without drift. Re-running replaces the
index; a later stage notices through the shot hashes.
Exit 0 ok · 1 fault · 2 usage · 3 not ready
"""
from __future__ import annotations
import json, os, re, subprocess, sys, hashlib, shutil, tempfile
from pathlib import Path


def die(msg, code=1):
    print(msg, file=sys.stderr); sys.exit(code)


def run(cmd, check=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0: raise RuntimeError(" ".join(cmd[:3]) + ": " + (r.stderr or "")[-600:])
    return r


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def frame_count(path, fps, duration):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)], check=False)
    try: return int(r.stdout.strip().split(",")[0])
    except Exception: return int(round(duration * fps))


def scene_cuts(src, threshold):
    r = run(["ffmpeg", "-hide_banner", "-i", str(src), "-an", "-vf", "select='gt(scene,%s)',showinfo" % threshold, "-f", "null", "-"], check=False)
    return [float(m.group(1)) for m in re.finditer(r"pts_time:([0-9.]+)", r.stderr or "")]


def grab(src, t, out, width=None):
    # A seek onto a shot's very last frame can come back empty (ffmpeg rounds past the end);
    # step back a little until a frame is written.
    vf = ["-vf", "scale=%d:-2" % width] if width else []
    for back in (0.0, 0.1, 0.25, 0.5):
        Path(out).unlink(missing_ok=True)
        run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % max(0.0, t - back), "-i", str(src), "-frames:v", "1"] + vf + [str(out)])
        if Path(out).exists() and Path(out).stat().st_size: return
    die("could not read a frame of %s near %.2f s" % (src, t), 1)


def main(argv):
    if len(argv) < 3: die(__doc__.split("\n\n")[1], 2)
    from PIL import Image, ImageDraw
    client, job_id = argv[1], argv[2]
    opt = lambda k, d: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
    root = Path(os.environ.get("PROD_LITE_ROOT") or ".")
    job_dir = (root / "workspaces" / client / "jobs" / job_id).resolve()
    job_p = job_dir / "job.json"
    if not job_p.exists(): die("no job.json; run new-job.js first", 3)
    job = json.loads(job_p.read_text(encoding="utf-8"))
    src = Path(job["source"]["file"])
    if not src.exists(): die("the first cut is missing: " + str(src), 3)
    fps = float(job["source"]["fps"]); duration = float(job["source"]["duration"])
    total = frame_count(src, fps, duration)
    threshold = float(opt("--threshold", "0.30")); min_shot = float(opt("--min-shot", "0.5"))
    given = opt("--cuts", None)
    raw = [float(x) for x in given.split(",") if x.strip()] if given else scene_cuts(src, threshold)
    # Snap to frames; drop cuts that would leave a shot shorter than --min-shot.
    min_frames = max(1, int(round(min_shot * fps)))
    cuts = []
    for t in sorted(raw):
        f = int(round(t * fps))
        if f < min_frames or total - f < min_frames: continue
        if cuts and f - cuts[-1] < min_frames: continue
        cuts.append(f)
    bounds = [0] + cuts + [total]
    shots_dir = Path(job["driveFolder"]) / "footage" / "shots"
    if shots_dir.exists(): shutil.rmtree(shots_dir)
    shots_dir.mkdir(parents=True, exist_ok=True)
    prev = job_dir / "previews" / "shots"; prev.mkdir(parents=True, exist_ok=True)
    audio = job["source"].get("audio")
    shots = []
    for i in range(len(bounds) - 1):
        f0, f1 = bounds[i], bounds[i + 1]
        sid = "S%02d" % (i + 1)
        start, n = f0 / fps, f1 - f0
        out = shots_dir / (sid + ".mp4")
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "%.6f" % start, "-i", str(src), "-frames:v", str(n), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", "%.6f" % fps]
        cmd += (["-c:a", "aac", "-b:a", "192k", "-t", "%.6f" % (n / fps)] if audio else ["-an"])
        run(cmd + [str(out)])
        dur = n / fps
        tmp = Path(tempfile.mkdtemp(prefix="cat-"))
        try:
            frames = []
            for j, t in enumerate([0.0, dur / 2, max(0.0, dur - 1.0 / fps)]):
                grab(out, t, tmp / ("%d.png" % j), 320); frames.append(Image.open(tmp / ("%d.png" % j)).convert("RGB"))
            strip = Image.new("RGB", (sum(f.width for f in frames) + 8 * 2, frames[0].height), (7, 26, 58))
            x = 0
            for f in frames: strip.paste(f, (x, 0)); x += f.width + 8
            strip.save(prev / (sid + ".jpg"), quality=82)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        grab(out, dur / 2, prev / (sid + "-mid.png"))
        shots.append({"id": sid, "n": i + 1, "start": round(start, 4), "end": round(f1 / fps, 4), "duration": round(dur, 4),
                      "startFrame": f0, "frames": n, "file": str(out).replace("\\", "/"), "sha256": sha256(out),
                      "strip": str(prev / (sid + ".jpg")).replace("\\", "/"), "mid": str(prev / (sid + "-mid.png")).replace("\\", "/")})
    # Contact sheet: every middle frame, labelled.
    thumbs = [Image.open(s["mid"]).convert("RGB") for s in shots]
    tw = 320; th = int(round(thumbs[0].height * tw / thumbs[0].width)) if thumbs else 180
    cols = min(4, max(1, len(thumbs))); rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 30) + 8), (7, 26, 58)); d = ImageDraw.Draw(sheet)
    for k, (s, im) in enumerate(zip(shots, thumbs)):
        x, y = 8 + (k % cols) * (tw + 8), 8 + (k // cols) * (th + 30)
        sheet.paste(im.resize((tw, th)), (x, y))
        d.text((x, y + th + 6), "%s  %.2f-%.2fs" % (s["id"], s["start"], s["end"]), fill=(230, 236, 245))
    sheet_p = job_dir / "previews" / "contact-sheet.jpg"; sheet.save(sheet_p, quality=84)
    audio_p = None
    if audio:
        audio_p = Path(job["driveFolder"]) / "audio" / "first-cut.wav"; audio_p.parent.mkdir(parents=True, exist_ok=True)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-c:a", "pcm_s24le", str(audio_p)])
    index = {"schemaVersion": "1.0", "jobId": job_id, "source": job["source"]["file"], "sourceSha": job["source"]["sha256"], "fps": fps,
             "frames": total, "method": "given" if given else "scene>%s" % threshold, "contactSheet": str(sheet_p).replace("\\", "/"),
             "audio": str(audio_p).replace("\\", "/") if audio_p else None, "shots": shots}
    (job_dir / "shots.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    assert sum(s["frames"] for s in shots) == total
    print("%d shot(s) from %d frames (%s): %s" % (len(shots), total, index["method"], ", ".join("%s %.2fs" % (s["id"], s["duration"]) for s in shots)))
    print("contact sheet: " + index["contactSheet"])


if __name__ == "__main__":
    main(sys.argv)
