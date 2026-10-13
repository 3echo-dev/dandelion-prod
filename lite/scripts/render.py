#!/usr/bin/env python
"""render: the renderer's last step. The graded shots back into one master, overlays burned in.

Usage:
    python render.py <client> <job-id> [--prores] [--no-mograph] [--allow-ungraded]

Run from the workspace root after grade.py (and mograph.js run, when the look has overlays).
Puts every shot back in cut order at exactly its frame count (a shot that came back a frame short
holds its last frame; one that came back long is trimmed), at the first cut's size and rate, lays
each rendered overlay from mograph.json at its start time, and puts the first cut's own sound under
it untouched. Writes:

  deliver/<title>_master.mp4        H.264 CRF from job.json render.crf (16), AAC 320k
  deliver/<title>_master.mov        ProRes 422 HQ, with --prores
  deliver/<title>_preview.mp4       720p, for the board
  deliver/<title>_poster.jpg        one frame of the preview, under 140 KB, the board player's poster
  previews/final-sheet.jpg          every shot's middle frame from the master, for the interrogator

and render.json. It then checks the master: frame count equal to the first cut's, duration within
one frame, sound present when the cut had sound. A failed check is reported, never passed.
Exit 0 rendered and checked · 1 fault or failed check · 2 usage · 3 not ready
"""
from __future__ import annotations
import json, os, re, subprocess, sys, hashlib
from pathlib import Path


def die(msg, code=1):
    print(msg, file=sys.stderr); sys.exit(code)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(" ".join(cmd[:3]) + ": " + (r.stderr or "")[-1200:])
    return r.stdout


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def info(p):
    j = json.loads(run(["ffprobe", "-v", "error", "-count_packets", "-show_entries", "stream=codec_type,nb_read_packets,width,height:format=duration", "-of", "json", str(p)]))
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    return {"frames": int(v.get("nb_read_packets") or 0), "width": v.get("width"), "height": v.get("height"),
            "duration": float(j["format"]["duration"]), "audio": any(s["codec_type"] == "audio" for s in j["streams"])}


def main(argv):
    if len(argv) < 3: die("usage: render.py <client> <job-id> [--prores] [--no-mograph] [--allow-ungraded]", 2)
    from PIL import Image
    client, job_id = argv[1], argv[2]
    job_dir = (Path(os.environ.get("PROD_LITE_ROOT") or ".") / "workspaces" / client / "jobs" / job_id).resolve()
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    idx_p = job_dir / "shots.json"
    if not idx_p.exists(): die("no shots.json", 3)
    idx = json.loads(idx_p.read_text(encoding="utf-8"))
    grade_p = job_dir / "grade.json"
    graded = (json.loads(grade_p.read_text(encoding="utf-8")) if grade_p.exists() else {"shots": {}})["shots"]
    W, H, fps = job["source"]["width"], job["source"]["height"], float(job["source"]["fps"])
    inputs, missing = [], []
    for s in idx["shots"]:
        g = graded.get(s["id"]) or {}
        f = g.get("file")
        if not f or not Path(f).exists():
            if "--allow-ungraded" in argv: f = s["file"]
            else: missing.append(s["id"]); continue
        inputs.append((s, f))
    if missing: die("not graded yet: " + ", ".join(missing) + " (run grade.py, or --allow-ungraded to render the cut as it is)", 3)
    overlays = []
    mg_p = job_dir / "mograph.json"
    if mg_p.exists() and "--no-mograph" not in argv:
        for it in json.loads(mg_p.read_text(encoding="utf-8")).get("items", []):
            if it.get("status") == "rendered" and it.get("file") and Path(it["file"]).exists(): overlays.append(it)
            elif it.get("status") != "rendered": print("NOTE overlay %s is %s; rendered without it" % (it["n"], it.get("status")))
    audio = idx.get("audio")
    total = idx["frames"]
    cmd = ["ffmpeg", "-v", "error", "-y"]
    for _, f in inputs: cmd += ["-i", f]
    for o in overlays: cmd += ["-itsoffset", "%.4f" % float(o["start"]), "-i", o["file"]]
    if audio: cmd += ["-i", audio]
    fc = []
    for i, (s, _) in enumerate(inputs):
        n = s["frames"]
        fc.append("[%d:v]fps=%.6f,scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop=%d,trim=end_frame=%d,setpts=PTS-STARTPTS[v%d]" % (i, fps, W, H, W, H, n, n, i))
    fc.append("".join("[v%d]" % i for i in range(len(inputs))) + "concat=n=%d:v=1:a=0[base]" % len(inputs))
    last = "base"
    for k, o in enumerate(overlays):
        j = len(inputs) + k; st = float(o["start"]); en = st + float(o["durationSec"])
        fc.append("[%d:v]scale=%d:%d,format=yuva420p[o%d]" % (j, W, H, k))
        # offsetY moves the overlay up (negative) or down (positive) by that share of the frame height:
        # the templates centre their text, which on a vertical cut can land on a face.
        dy = int(round(max(-0.45, min(0.45, float(o.get("offsetY") or 0))) * H))
        fc.append("[%s][o%d]overlay=0:%d:eof_action=pass:enable='between(t,%.4f,%.4f)'[m%d]" % (last, k, dy, st, en, k))
        last = "m%d" % k
    fc.append("[%s]format=yuv420p[vout]" % last)
    out_dir = job_dir / "deliver"; out_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", job.get("title", job_id).lower()).strip("-") or job_id
    master = out_dir / (slug + "_master.mp4")
    a_idx = len(inputs) + len(overlays)
    common = ["-filter_complex", ";".join(fc), "-map", "[vout]"] + (["-map", "%d:a" % a_idx] if audio else []) + ["-frames:v", str(total), "-r", "%.6f" % fps]
    crf = str((job.get("render") or {}).get("crf", 16))
    run(cmd + common + ["-c:v", "libx264", "-preset", "slow", "-crf", crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart"] + (["-c:a", "aac", "-b:a", "320k", "-t", "%.6f" % (total / fps)] if audio else []) + [str(master)])
    outs = {"master": master}
    if "--prores" in argv:
        mov = out_dir / (slug + "_master.mov")
        run(cmd + common + ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"] + (["-c:a", "pcm_s24le", "-t", "%.6f" % (total / fps)] if audio else []) + [str(mov)])
        outs["prores"] = mov
    preview = out_dir / (slug + "_preview.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(preview)])
    # Poster for the board's player: one frame of the preview at its own shape, small enough for the card.
    poster = out_dir / (slug + "_poster.jpg")
    pt = (inputs[0][0]["frames"] / 2) / fps if inputs else 0
    for q in (4, 7, 11, 16):
        run(["ffmpeg", "-v", "error", "-y", "-ss", "%.4f" % pt, "-i", str(preview), "-frames:v", "1", "-vf", "scale=-2:'min(640,ih)'", "-q:v", str(q), str(poster)])
        if poster.stat().st_size <= 140 * 1024: break
    # Checks.
    m = info(master); problems = []
    if m["frames"] != total: problems.append("master has %d frames, the first cut %d" % (m["frames"], total))
    if abs(m["duration"] - total / fps) > 1.5 / fps: problems.append("master runs %.3f s, the first cut %.3f s" % (m["duration"], total / fps))
    if audio and not m["audio"]: problems.append("the first cut had sound; the master has none")
    if (m["width"], m["height"]) != (W, H): problems.append("master is %sx%s, the first cut %dx%d" % (m["width"], m["height"], W, H))
    # Final sheet: each shot's middle frame from the master.
    thumbs = []
    for s, _ in inputs:
        t = (s["startFrame"] + s["frames"] / 2) / fps; p = job_dir / "previews" / ("final-%s.png" % s["id"])
        run(["ffmpeg", "-v", "error", "-y", "-ss", "%.4f" % t, "-i", str(master), "-frames:v", "1", "-vf", "scale=320:-2", str(p)]); thumbs.append(p)
    ims = [Image.open(p).convert("RGB") for p in thumbs]
    cols = min(4, len(ims)); rows = (len(ims) + cols - 1) // cols; tw, th = ims[0].size
    sheet = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 8) + 8), (7, 26, 58))
    for k, im in enumerate(ims): sheet.paste(im, (8 + (k % cols) * (tw + 8), 8 + (k // cols) * (th + 8)))
    sheet_p = job_dir / "previews" / "final-sheet.jpg"; sheet.save(sheet_p, quality=84)
    for p in thumbs: p.unlink()
    rec = {"renderedAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
           "files": {k: {"file": str(v).replace("\\", "/"), "sha256": sha256(v), "bytes": v.stat().st_size} for k, v in outs.items()},
           "preview": str(preview).replace("\\", "/"), "poster": str(poster).replace("\\", "/"), "sheet": str(sheet_p).replace("\\", "/"), "frames": m["frames"], "duration": m["duration"],
           "overlays": [o["n"] for o in overlays], "shots": {s["id"]: (graded.get(s["id"]) or {}).get("sha256") for s, _ in inputs}, "checks": problems or "ok"}
    (job_dir / "render.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print("master: %s (%d frames, %.2f s, %d overlay(s))" % (master.name, m["frames"], m["duration"], len(overlays)))
    print("preview: " + preview.name + "; poster: " + poster.name + "; sheet: previews/final-sheet.jpg")
    if problems: print("CHECK FAILED: " + "; ".join(problems)); sys.exit(1)
    print("checks: ok")


if __name__ == "__main__":
    main(sys.argv)
