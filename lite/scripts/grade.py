#!/usr/bin/env python
"""grade: the renderer's colour tool. One look over every shot, so the cut reads as one world.

Usage:
    python grade.py <client> <job-id> [--shot S03] [--stills] [--strength 1.0]

Run from the workspace root after the hybrid step (or straight after cataloguing when nothing is
replaced). Per shot it takes the composite when there is one, else the shot as cut, applies
look.json's grade, and writes media/graded/<shot>.mp4 (CRF 14) with a before | after still in
previews/grade/. --stills makes only the stills (seconds, not minutes): use it to show the look at
a glance before grading the whole cut.

look.json "grade" (every field optional; {} means no grade, the shot is copied through):
  exposure     stops, -2..2                       ffmpeg exposure
  temperature  Kelvin, 2000..12000 (6500 neutral) colortemperature
  shadows / midtones / highlights  [r, g, b], each -1..1   colorbalance (lift / gamma / gain tint)
  contrast 0.5..2, saturation 0..3, gamma 0.5..2           eq
  vibrance     -2..2                              vibrance
  curves       an ffmpeg curves preset (vintage, darker, lighter, increase_contrast, ...)
  lut          a .cube file (path relative to the job folder), applied last
--strength (or job.json grade.strength) scales every setting towards neutral: 0.5 is half the look.
Exit 0 ok · 1 fault · 2 usage · 3 not ready
"""
from __future__ import annotations
import json, os, subprocess, sys, hashlib, shutil, tempfile
from pathlib import Path


def die(msg, code=1):
    print(msg, file=sys.stderr); sys.exit(code)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(" ".join(cmd[:3]) + ": " + (r.stderr or "")[-800:])
    return r.stdout


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def lerp(neutral, v, k): return neutral + (v - neutral) * k


def filter_for(g, k, job_dir):
    """The ffmpeg filter chain for a grade at strength k, or None for no grade."""
    parts = []
    if g.get("exposure") is not None: parts.append("exposure=exposure=%.4f" % lerp(0, g["exposure"], k))
    if g.get("temperature") is not None: parts.append("colortemperature=temperature=%d" % round(lerp(6500, g["temperature"], k)))
    bands = {"shadows": "s", "midtones": "m", "highlights": "h"}
    cb = []
    for band, c in bands.items():
        if g.get(band):
            r, gg, b = [lerp(0, x, k) for x in g[band]]
            cb += ["r%s=%.4f" % (c, r), "g%s=%.4f" % (c, gg), "b%s=%.4f" % (c, b)]
    if cb: parts.append("colorbalance=" + ":".join(cb))
    eq = []
    for f, n in (("contrast", 1.0), ("saturation", 1.0), ("gamma", 1.0)):
        if g.get(f) is not None: eq.append("%s=%.4f" % (f, lerp(n, g[f], k)))
    if eq: parts.append("eq=" + ":".join(eq))
    if g.get("vibrance") is not None: parts.append("vibrance=intensity=%.4f" % lerp(0, g["vibrance"], k))
    if g.get("curves"): parts.append("curves=preset=%s" % g["curves"])
    if g.get("lut"):
        lut = Path(g["lut"]) if Path(g["lut"]).is_absolute() else (job_dir / g["lut"])
        if not lut.exists(): die("grade.lut not found: " + str(lut), 3)
        p = str(lut.resolve()).replace("\\", "/").replace(":", "\\:")
        parts.append("lut3d=file='%s'" % p)
    return ",".join(parts) if parts else None


def still(src, t, out, vf=None):
    run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", str(src), "-frames:v", "1"] + (["-vf", vf] if vf else []) + [str(out)])


def main(argv):
    if len(argv) < 3: die("usage: grade.py <client> <job-id> [--shot S03] [--stills] [--strength 1.0]", 2)
    from PIL import Image
    client, job_id = argv[1], argv[2]
    opt = lambda k, d: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
    job_dir = (Path(os.environ.get("PROD_LITE_ROOT") or ".") / "workspaces" / client / "jobs" / job_id).resolve()
    if not (job_dir / "shots.json").exists(): die("no shots.json; run catalogue.py", 3)
    if not (job_dir / "look.json").exists(): die("no look.json; the researcher writes the look first", 3)
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    shots = json.loads((job_dir / "shots.json").read_text(encoding="utf-8"))["shots"]
    look = json.loads((job_dir / "look.json").read_text(encoding="utf-8"))
    brief_p = job_dir / "hybrid-brief.json"
    brief = json.loads(brief_p.read_text(encoding="utf-8")) if brief_p.exists() else {"panels": []}
    panels = {p["id"]: p for p in brief.get("panels", [])}
    k = float(opt("--strength", str((job.get("grade") or {}).get("strength", 1.0))))
    vf = filter_for(look.get("grade") or {}, k, job_dir)
    only = opt("--shot", None); stills_only = "--stills" in argv
    out_dir = Path(job["driveFolder"]) / "graded"; out_dir.mkdir(parents=True, exist_ok=True)
    prev = job_dir / "previews" / "grade"; prev.mkdir(parents=True, exist_ok=True)
    rec_p = job_dir / "grade.json"
    rec = json.loads(rec_p.read_text(encoding="utf-8")) if rec_p.exists() else {"shots": {}}
    rec.update({"filter": vf, "strength": k, "lookRecordedAt": look.get("recordedAt")})
    waiting = []
    for s in shots:
        if only and s["id"].upper() != only.upper(): continue
        p = panels.get(s["id"])
        if p and p.get("plate") and not (p.get("composite") or {}).get("file"):
            waiting.append(s["id"]); continue
        src = Path((p.get("composite") or {}).get("file")) if p and p.get("composite") else Path(s["file"])
        tmp = Path(tempfile.mkdtemp(prefix="grade-"))
        try:
            mid = s["duration"] / 2
            still(src, mid, tmp / "a.png"); still(src, mid, tmp / "b.png", vf)
            a = Image.open(tmp / "a.png").convert("RGB"); b = Image.open(tmp / "b.png").convert("RGB").resize(a.size)
            sc = 480.0 / a.width if a.width > 480 else 1.0
            a = a.resize((int(a.width * sc), int(a.height * sc))); b = b.resize(a.size)
            ba = Image.new("RGB", (a.width * 2 + 8, a.height), (7, 26, 58)); ba.paste(a, (0, 0)); ba.paste(b, (a.width + 8, 0))
            ba_p = prev / (s["id"] + ".jpg"); ba.save(ba_p, quality=84)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        entry = {"input": str(src).replace("\\", "/"), "inputSha": sha256(src), "preview": str(ba_p).replace("\\", "/"), "filter": vf}
        if not stills_only:
            out = out_dir / (s["id"] + ".mp4")
            has_audio = bool(json.loads(run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "json", str(src)])).get("streams"))
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)] + (["-vf", vf] if vf else []) + ["-frames:v", str(s["frames"]), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p"]
            cmd += (["-c:a", "aac", "-b:a", "192k"] if has_audio else ["-an"]) + [str(out)]
            run(cmd)
            entry.update({"file": str(out).replace("\\", "/"), "sha256": sha256(out)})
        else:
            old = rec["shots"].get(s["id"]) or {}
            if old.get("file") and old.get("filter") == vf and old.get("inputSha") == entry["inputSha"]: entry.update({"file": old["file"], "sha256": old.get("sha256")})
        rec["shots"][s["id"]] = entry
        print("%s %s from %s" % (s["id"], "still" if stills_only else "graded", "composite" if p and p.get("composite") else "the cut"))
    rec_p.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print("grade: " + (vf or "none (copied through)"))
    if waiting: print("waiting for the composite: " + ", ".join(waiting))


if __name__ == "__main__":
    main(sys.argv)
