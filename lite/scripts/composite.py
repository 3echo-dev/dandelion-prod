#!/usr/bin/env python
"""composite: the composite-director's tool. Lays each cut-out actor over its location's background.

Usage:
    python composite.py <client> <job-id> [--panel P03] [--match 0.5] [--min-preserved 97] [--min-regen 75]

Run from the workspace root after cutout.py. Per panel with a cut-out and a ready background
(library or delivered in hybrid-brief.json) it writes footage/composite/<panel>.mp4: the background
scaled to cover the plate's picture (inside any letterbox bars, which stay black), its brightness nudged towards the actor's (--match, 0 = off),
the cut-out laid on top, the plate's own sound kept. It then checks the performance was not touched:
on five frames it compares the actor's pixels in the composite with the plate's (inside the fully
opaque part of the cut-out) and records the share kept. Below --min-preserved the panel is flagged,
never passed silently. A before/after still (plate | composite) goes to previews/hybrid/ for the board.

A motion-transfer panel (motion-transfer.js, hybrid-brief panel.motion delivered) has no still
background: its generated clip is the background, already camera-tracked and relit by the model, so
no brightness nudge. With motion.keepActor (default) the plate's own cut-out goes back on top; the
model's redrawn person is measured against the plate as regenActorPct: under --min-regen the model
moved or reshaped the person, and a ghost of it can show around the pasted actor, so it is flagged.
With keepActor false the model's person is the one in the cut and actorPreservedPct says how far it
drifted from the plate (it is flagged below --min-preserved, which it nearly always is: a person looks).
Exit 0 ok · 1 fault · 2 usage · 3 not ready (no brief, no cut-out, no background)
"""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, hashlib, shutil
from pathlib import Path

def die(msg, code=1):
    print(msg, file=sys.stderr); sys.exit(code)

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(" ".join(cmd[:3]) + ": " + (r.stderr or "")[-600:])
    return r.stdout

def probe(path):
    j = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", str(path)]))
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    num, den = (v.get("r_frame_rate") or "25/1").split("/")
    return {"width": int(v.get("width") or 0), "height": int(v.get("height") or 0), "fps": float(num) / float(den or 1),
            "duration": float((j.get("format") or {}).get("duration") or 0), "audio": any(s.get("codec_type") == "audio" for s in j.get("streams", []))}

def grab(src, t, out, rgba=False):
    run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", str(src), "-frames:v", "1"] + (["-pix_fmt", "rgba"] if rgba else []) + [str(out)])

def luma(im, mask=None):
    from PIL import ImageStat
    g = im.convert("L")
    return ImageStat.Stat(g, mask).mean[0] if mask is not None else ImageStat.Stat(g).mean[0]

def main(argv):
    if len(argv) < 3: die("usage: composite.py <client> <job-id> [--panel P03] [--match 0.5] [--min-preserved 97]", 2)
    from PIL import Image, ImageChops
    client, job_id = argv[1], argv[2]
    opt = lambda k, d: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
    job_dir = (Path(os.environ.get("PROD_LITE_ROOT") or ".") / "workspaces" / client / "jobs" / job_id).resolve()
    brief_p = job_dir / "hybrid-brief.json"
    if not brief_p.exists(): die("no hybrid-brief.json; run hybrid.js brief first", 3)
    brief = json.loads(brief_p.read_text(encoding="utf-8"))
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    match = float(opt("--match", str((job.get("hybrid") or {}).get("match", 0.5))))
    min_kept = float(opt("--min-preserved", "97"))
    min_regen = float(opt("--min-regen", "75"))
    only = opt("--panel", None)
    out_dir = Path(job["driveFolder"]) / "footage" / "composite"; out_dir.mkdir(parents=True, exist_ok=True)
    prev_dir = job_dir / "previews" / "hybrid"; prev_dir.mkdir(parents=True, exist_ok=True)
    todo = [p for p in brief["panels"] if p.get("plate") and (only is None or p["id"].upper() == only.upper())]
    if not todo: die("no panel with a plate%s" % ((" matching " + only) if only else ""), 3)
    waiting, flagged = [], []
    for p in todo:
        cut = (p.get("cutout") or {}).get("file")
        bg = brief["backgrounds"].get(p["background"]) or {}
        motion = p.get("motion")
        if not cut or not Path(cut).exists(): waiting.append(p["id"] + " (no cut-out yet)"); continue
        if motion:
            if motion.get("status") != "delivered" or not motion.get("file") or not Path(motion["file"]).exists():
                waiting.append(p["id"] + " (motion-transfer clip not generated yet)"); continue
            bg = {"file": motion["file"], "sha256": motion.get("sha256"), "status": "delivered", "name": "motion transfer over " + (bg.get("name") or p["background"])}
        elif bg.get("status") not in ("provided", "delivered") or not bg.get("file") or not Path(bg["file"]).exists():
            waiting.append(p["id"] + " (background " + (bg.get("name") or p["background"]) + " not ready)"); continue
        keep_actor = not motion or motion.get("keepActor", True)
        plate = Path(p["plate"]); info = probe(plate)
        W, H, dur, fps = info["width"], info["height"], info["duration"], info["fps"]
        if motion:
            # The generated clip covers the reference's length only (at most 15 s from the plate's start).
            dur = min(dur, float(motion.get("refSec") or dur), float(motion.get("durationOut") or dur))
        area = (p.get("cutout") or {}).get("pictureArea") or {"x": 0, "y": 0, "w": W, "h": H}
        AX, AY, AW, AH = area["x"], area["y"], area["w"], area["h"]
        is_video = Path(bg["file"]).suffix.lower() in (".mp4", ".mov", ".m4v", ".webm")
        tmp = Path(tempfile.mkdtemp(prefix="comp-"))
        try:
            # Brightness: nudge the background towards the actor's level, by `match` of the gap, capped.
            mid = max(0.0, dur / 2)
            grab(cut, mid, tmp / "cut.png", rgba=True)
            ca = Image.open(tmp / "cut.png").convert("RGBA"); alpha = ca.getchannel("A")
            if is_video: grab(bg["file"], 0.5, tmp / "bg.png")
            bgi = Image.open(tmp / "bg.png" if is_video else bg["file"]).convert("RGB").resize((AW, AH))
            a_l = luma(ca.convert("RGB"), alpha.point(lambda v: 255 if v > 200 else 0)); b_l = luma(bgi)
            shift = max(-0.15, min(0.15, (a_l - b_l) / 255.0 * match)) if match and not motion else 0.0
            out = out_dir / (p["id"] + ".mp4")
            bg_in = (["-t", "%.3f" % dur, "-i", bg["file"]] if motion else ["-stream_loop", "-1", "-t", "%.3f" % dur, "-i", bg["file"]] if is_video else ["-loop", "1", "-t", "%.3f" % dur, "-i", bg["file"]])
            # The background covers the picture area only; letterbox or pillarbox bars stay black.
            fc = ("[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%.4f,eq=brightness=%.4f,pad=%d:%d:%d:%d:black[bg];"
                  "[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[v]") % (AW, AH, AW, AH, fps, shift, W, H, AX, AY)
            if not keep_actor:
                fc = fc.split("[bg];")[0] + ",format=yuv420p[v]"
            cmd = ["ffmpeg", "-v", "error", "-y"] + bg_in + ["-i", str(cut), "-i", str(plate), "-filter_complex", fc, "-map", "[v]"]
            if info["audio"]: cmd += ["-map", "2:a", "-c:a", "aac", "-b:a", "192k"]
            cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-t", "%.3f" % dur, str(out)]
            run(cmd)
            # Performance check: the actor's pixels in the composite against the plate's, on five frames.
            from PIL import ImageStat
            def framed(im):
                # The generated frame placed the way the filter graph places it: cover the picture area, centred crop.
                sc = max(AW / im.width, AH / im.height); im = im.resize((max(AW, round(im.width * sc)), max(AH, round(im.height * sc))))
                l, t2 = (im.width - AW) // 2, (im.height - AH) // 2
                canvas = Image.new("RGB", (W, H)); canvas.paste(im.crop((l, t2, l + AW, t2 + AH)), (AX, AY)); return canvas
            kept, regen = [], []
            for i in range(5):
                t = dur * (i + 0.5) / 5
                grab(plate, t, tmp / "p.png"); grab(out, t, tmp / "c.png"); grab(cut, t, tmp / "a.png", rgba=True)
                pl = Image.open(tmp / "p.png").convert("RGB"); co = Image.open(tmp / "c.png").convert("RGB").resize(pl.size)
                m = Image.open(tmp / "a.png").convert("RGBA").getchannel("A").resize(pl.size).point(lambda v: 255 if v >= 250 else 0)
                if not m.getbbox(): continue
                diff = ImageChops.difference(pl, co).convert("L")
                mean = ImageStat.Stat(diff, m).mean[0]
                kept.append(round(100.0 - mean / 255.0 * 100.0, 2))
                if motion:
                    grab(bg["file"], t, tmp / "g.png")
                    gi = framed(Image.open(tmp / "g.png").convert("RGB")).resize(pl.size)
                    regen.append(round(100.0 - ImageStat.Stat(ImageChops.difference(pl, gi).convert("L"), m).mean[0] / 255.0 * 100.0, 2))
            pct = round(sum(kept) / len(kept), 2) if kept else None
            worst = min(kept) if kept else None
            regen_pct = round(sum(regen) / len(regen), 2) if regen else None
            # Before / after still for the board.
            grab(plate, mid, tmp / "pm.png"); grab(out, mid, tmp / "cm.png")
            a_img = Image.open(tmp / "pm.png").convert("RGB"); b_img = Image.open(tmp / "cm.png").convert("RGB").resize(a_img.size)
            sc = 640.0 / a_img.width if a_img.width > 640 else 1.0
            a_img = a_img.resize((int(a_img.width * sc), int(a_img.height * sc))); b_img = b_img.resize(a_img.size)
            ba = Image.new("RGB", (a_img.width * 2 + 12, a_img.height), (7, 26, 58)); ba.paste(a_img, (0, 0)); ba.paste(b_img, (a_img.width + 12, 0))
            ba_p = prev_dir / (p["id"] + "-before-after.jpg"); ba.save(ba_p, quality=86)
            p["composite"] = {"file": str(out).replace("\\", "/"), "sha256": sha256(out), "backgroundKey": p["background"], "backgroundSha": bg.get("sha256"),
                              "cutoutSha": (p.get("cutout") or {}).get("sha256"), "brightnessShift": round(shift, 4), "actorPreservedPct": pct, "worstFramePct": worst,
                              "preview": str(ba_p).replace("\\", "/")}
            if motion:
                p["composite"].update({"motionSha": motion.get("sha256"), "keepActor": keep_actor, "regenActorPct": regen_pct, "brightnessShift": 0.0})
            ok = pct is not None and worst is not None and worst >= min_kept and (not motion or not keep_actor or (regen_pct is not None and regen_pct >= min_regen))
            p["status"] = "composited" if ok else "needs-review"
            if not ok: flagged.append(p["id"])
            why = ("the model's person drifted from the plate (%s%% < %s%%): check for a ghost around the actor" % (regen_pct, min_regen)) if motion and keep_actor and pct is not None and worst >= min_kept else "below %s%%, check the before/after" % min_kept
            print("%s composited over %s: actor kept %s%% (worst frame %s%%)%s%s" % (p["id"], bg.get("name"), pct, worst, (", model drift %s%%" % regen_pct) if motion else "", "" if ok else "  FLAGGED: " + why))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    brief_p.write_text(json.dumps(brief, indent=2) + "\n", encoding="utf-8")
    if waiting: print("waiting: " + "; ".join(waiting))
    if flagged: print("flagged for review: " + ", ".join(flagged))

if __name__ == "__main__":
    main(sys.argv)
