#!/usr/bin/env python
"""cutout: the plate-director's tool. Cuts the actor out of each plate as a transparent layer.

Usage:
    python cutout.py <client> <job-id> [--panel P03] [--method auto|chromakey|rembg]
                     [--similarity 0.12] [--blend 0.08] [--model u2net]

Run from the workspace root. Reads hybrid-brief.json (hybrid.js brief) and, per panel with a plate,
writes footage/cutout/<panel>.mov: the plate's own pixels with an alpha channel (PNG codec in MOV),
so the actor is never redrawn, only separated.

  auto       the screen colour sampled from the corners of the plate's picture (inside any letterbox
             bars) decides: chromakey on any green or blue screen, otherwise rembg.
  chromakey  ffmpeg chromakey on the screen colour sampled from the plate's corners, then despill.
             Fast, no GPU, no AI.
  rembg      AI segmentation per frame. The model is job.hybrid.rembgModel or --model, default
             u2net: the main subject, so what the actor holds (a product) is kept with them.
             u2net_human_seg keeps only the person and drops a held product; birefnet-general-lite
             keeps fine hair best but is 20-35x slower on a CPU. Needs `pip install "rembg[cpu]"`
             (rembg[gpu] with CUDA for speed); refused with a plain message when it is not installed.

Records method, key colour, frames and alpha coverage in the brief, and a mask still for the board.
Exit 0 ok · 1 fault · 2 usage · 3 not ready (no brief, no plate, rembg missing)
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
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", str(path)])
    j = json.loads(out); s = (j.get("streams") or [{}])[0]
    num, den = (s.get("r_frame_rate") or "25/1").split("/")
    return {"width": int(s.get("width") or 0), "height": int(s.get("height") or 0), "fps": float(num) / float(den or 1), "duration": float((j.get("format") or {}).get("duration") or 0)}

def detect_method(plate, info, area=None):
    """The plate's own screen colour, sampled from its picture's corners (inside any bars): any
    shade of green or blue means chroma key; otherwise AI segmentation."""
    if key_colour(plate, info, area): return "chromakey", "corner-sample"
    return "rembg", "no-screen"

def frame_at(plate, t, out):
    run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", str(plate), "-frames:v", "1", str(out)])

BAR_LUMA = 16  # a row or column darker than this on average, at the frame's edge, is a bar

def picture_area(plate, info):
    """The picture inside letterbox or pillarbox bars: {x, y, w, h}, or None when the frame is full.
    Measured on the pixels of three frames (ffmpeg's cropdetect misses bars on 12-bit ProRes); a bar
    must be dark on all three, so a dark scene edge is not taken for one."""
    from PIL import Image
    tmp = Path(tempfile.mkdtemp(prefix="bars-"))
    try:
        sides = []
        for i, t in enumerate([0.25, 0.5, 0.75]):
            f = tmp / ("f%d.png" % i); frame_at(plate, max(0.0, info["duration"] * t), f)
            im = Image.open(f).convert("L"); w, h = im.size
            row = lambda y: sum(im.getpixel((x, y)) for x in range(0, w, 8)) / len(range(0, w, 8))
            col = lambda x: sum(im.getpixel((x, y)) for y in range(0, h, 8)) / len(range(0, h, 8))
            def run_len(fn, rng):
                n = 0
                for k in rng:
                    if fn(k) >= BAR_LUMA: break
                    n += 1
                return n
            sides.append((run_len(row, range(h)), run_len(row, range(h - 1, -1, -1)), run_len(col, range(w)), run_len(col, range(w - 1, -1, -1)), w, h))
        top, bot, left, right = (min(s[k] for s in sides) for k in range(4)); w, h = sides[0][4], sides[0][5]
        top, bot, left, right = (v - v % 2 for v in (top, bot, left, right))
        if max(top, bot) < h * 0.01 and max(left, right) < w * 0.01: return None
        if h - top - bot < h * 0.5 or w - left - right < w * 0.5: return None
        return {"x": left, "y": top, "w": w - left - right, "h": h - top - bot}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def key_colour(plate, info, area=None):
    """The screen colour: the average of the four corners of the middle frame's picture (inside any
    bars), when it is a saturated green or blue. None when the corners are not a screen."""
    from PIL import Image
    tmp = Path(tempfile.mkdtemp(prefix="key-")); f = tmp / "mid.png"
    try:
        frame_at(plate, max(0.0, info["duration"] / 2), f)
        im = Image.open(f).convert("RGB")
        if area: im = im.crop((area["x"], area["y"], area["x"] + area["w"], area["y"] + area["h"]))
        w, h = im.size; s = max(8, min(w, h) // 12)
        px = []
        for (x, y) in [(0, 0), (w - s, 0), (0, h - s), (w - s, h - s)]:
            c = im.crop((x, y, x + s, y + s)); px += list(c.get_flattened_data() if hasattr(c, "get_flattened_data") else c.getdata())
        r = sum(p[0] for p in px) / len(px); g = sum(p[1] for p in px) / len(px); b = sum(p[2] for p in px) / len(px)
        if g > 90 and g > r * 1.35 and g > b * 1.2: kind = "green"
        elif b > 90 and b > r * 1.35 and b > g * 1.2: kind = "blue"
        else: return None
        return {"hex": "0x%02X%02X%02X" % (int(r), int(g), int(b)), "kind": kind}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def cut_chromakey(plate, out, colour, similarity, blend):
    despill = ",despill=type=%s" % colour["kind"]
    run(["ffmpeg", "-v", "error", "-y", "-i", str(plate), "-an",
         "-vf", "format=rgba,chromakey=%s:%s:%s%s,format=rgba" % (colour["hex"], similarity, blend, despill),
         "-c:v", "png", "-pix_fmt", "rgba", str(out)])

REMBG_MODELS = ("u2net", "isnet-general-use", "birefnet-general-lite", "birefnet-general", "u2net_human_seg")

def cut_rembg(plate, out, info, model="u2net"):
    try:
        from rembg import remove, new_session
    except Exception:
        die("rembg is not installed, so a plate without a green or blue screen cannot be cut out yet. "
            "Green-screen plates work without it. Install it in the pipeline environment: pip install 'rembg[cpu]' (or 'rembg[gpu]' with CUDA for speed); check-deps.js --setup lists it.", 3)
    from PIL import Image
    tmp = Path(tempfile.mkdtemp(prefix="rembg-"))
    try:
        run(["ffmpeg", "-v", "error", "-y", "-i", str(plate), "-fps_mode", "passthrough", str(tmp / "f%06d.png")])
        session = new_session(model)
        frames = sorted(tmp.glob("f*.png"))
        for f in frames:
            remove(Image.open(f), session=session).save(tmp / ("a" + f.name[1:]))
        run(["ffmpeg", "-v", "error", "-y", "-framerate", "%.4f" % info["fps"], "-i", str(tmp / "a%06d.png"),
             "-c:v", "png", "-pix_fmt", "rgba", str(out)])
        return len(frames)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def coverage_and_mask(cut, info, mask_png, area=None):
    """How much of the middle frame is the actor (alpha > 50%), and a black/white mask still for the board."""
    from PIL import Image
    tmp = Path(tempfile.mkdtemp(prefix="mask-")); f = tmp / "mid.png"
    try:
        run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % max(0.0, info["duration"] / 2), "-i", str(cut), "-frames:v", "1", "-pix_fmt", "rgba", str(f)])
        a = Image.open(f).convert("RGBA").getchannel("A")
        if area: a = a.crop((area["x"], area["y"], area["x"] + area["w"], area["y"] + area["h"]))
        a.save(mask_png)
        hist = a.histogram()
        return round(100.0 * sum(hist[128:]) / max(1, sum(hist)), 1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def clean_frame(plate, cut, info, out_png):
    """The plate's middle frame with the actor (anything the cut-out keeps) filled flat grey: the
    camera angle, horizon and light of the shot without a person for an image model to copy."""
    from PIL import Image, ImageFilter
    tmp = Path(tempfile.mkdtemp(prefix="clean-"))
    try:
        t = max(0.0, info["duration"] / 2)
        frame_at(plate, t, tmp / "p.png")
        run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", str(cut), "-frames:v", "1", "-pix_fmt", "rgba", str(tmp / "a.png")])
        im = Image.open(tmp / "p.png").convert("RGB")
        a = Image.open(tmp / "a.png").convert("RGBA").getchannel("A").resize(im.size).point(lambda v: 255 if v > 3 else 0).filter(ImageFilter.MaxFilter(21))
        im.paste((128, 128, 128), (0, 0), a)
        im.save(out_png)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def main(argv):
    if len(argv) < 3: die("usage: cutout.py <client> <job-id> [--panel P03] [--method auto|chromakey|rembg] [--similarity 0.12] [--blend 0.08]", 2)
    client, job_id = argv[1], argv[2]
    opt = lambda k, d: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
    job_dir = (Path(os.environ.get("PROD_LITE_ROOT") or ".") / "workspaces" / client / "jobs" / job_id).resolve()
    brief_p = job_dir / "hybrid-brief.json"
    if not brief_p.exists(): die("no hybrid-brief.json; run hybrid.js brief first", 3)
    brief = json.loads(brief_p.read_text(encoding="utf-8"))
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    hyb = job.get("hybrid") or {}
    method_opt = opt("--method", hyb.get("cutout") or brief.get("cutoutMethod") or "auto")
    model = opt("--model", hyb.get("rembgModel") or "u2net")
    if model not in REMBG_MODELS: die("unknown rembg model %s (one of %s)" % (model, ", ".join(REMBG_MODELS)), 2)
    similarity = float(opt("--similarity", str(hyb.get("similarity", 0.12))))
    blend = float(opt("--blend", str(hyb.get("blend", 0.08))))
    only = opt("--panel", None)
    out_dir = Path(job["driveFolder"]) / "footage" / "cutout"; out_dir.mkdir(parents=True, exist_ok=True)
    prev_dir = job_dir / "previews" / "hybrid"; prev_dir.mkdir(parents=True, exist_ok=True)
    todo = [p for p in brief["panels"] if p.get("plate") and (only is None or p["id"].upper() == only.upper())]
    if not todo: die("no panel with a plate%s" % ((" matching " + only) if only else ""), 3)
    for p in todo:
        plate = Path(p["plate"]); info = probe(plate); area = picture_area(plate, info)
        method, how = (method_opt, "asked") if method_opt != "auto" else detect_method(plate, info, area)
        out = out_dir / (p["id"] + ".mov"); frames = None; colour = None
        if method == "chromakey":
            colour = key_colour(plate, info, area)
            if not colour: die("%s: no green or blue screen found in the plate's corners; use --method rembg" % p["id"], 3)
            cut_chromakey(plate, out, colour, similarity, blend)
        elif method == "rembg":
            frames = cut_rembg(plate, out, info, model)
        else:
            die("unknown method " + method, 2)
        mask_png = prev_dir / (p["id"] + "-mask.png")
        cover = coverage_and_mask(out, info, mask_png, area)
        p["cutout"] = {"method": method, "decidedBy": how, "file": str(out).replace("\\", "/"), "sha256": sha256(out), "keyColour": colour, "similarity": similarity if method == "chromakey" else None,
                       "blend": blend if method == "chromakey" else None, "frames": frames, "model": model if method == "rembg" else None, "actorCoveragePct": cover, "mask": str(mask_png).replace("\\", "/"), "pictureArea": area}
        clean_png = prev_dir / (p["id"] + "-clean.png")
        clean_frame(plate, out, info, clean_png)
        p["cutout"]["cleanFrame"] = str(clean_png).replace("\\", "/")
        # The background this panel opens takes the clean frame as its framing reference.
        bg = brief.get("backgrounds", {}).get(p.get("background") or "")
        if bg and bg.get("source") == "generate" and bg.get("status") != "delivered" and (bg.get("panels") or [None])[0] == p["id"]:
            bg["referenceFrame"] = p["cutout"]["cleanFrame"]
        p["composite"] = None; p["status"] = "cut-out"
        warn = "" if 2 <= cover <= 85 else ("  WARNING: the cut-out keeps %s%% of the frame; check the mask before compositing" % cover)
        bars = (" inside %dx%d bars-free picture" % (area["w"], area["h"])) if area else ""
        print("%s cut out by %s%s (%s): actor covers %s%% of the frame%s%s" % (p["id"], method, (" " + model) if method == "rembg" else "", how, cover, bars, warn))
    brief_p.write_text(json.dumps(brief, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main(sys.argv)
