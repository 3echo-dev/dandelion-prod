#!/usr/bin/env python
"""shot: the tools of a shot task, one clip or one still at a time. No AI, no credits (matte's
rembg route aside, which runs on this machine).

Usage:
    python shot.py paste-back --original O --generated G --alpha A --out F [--invert] [--grow PX]
                              [--feather 1] [--previews DIR] [--min-kept 97]
    python shot.py matte      --source S --out F [--method auto|diffkey|chromakey|rembg]
                              [--model u2net] [--lo 0.18] [--hi 0.62] [--invert] [--cutout F.mov]
    python shot.py clip       --source S --start 12 --end 14 --out F [--for-model]
    python shot.py frame      --source S --at first|mid|last|SECONDS --out F.png
    python shot.py compare    --a A --b B [--alpha M] [--a-at T] [--b-at T] [--frames 5]
                              [--min-structure 50] [--max-shift 1.0]

Every command prints one JSON object on its last line (what it wrote and what it measured), and
lines starting FLAG: for anything a person has to look at.

  paste-back  The original's own pixels go back over a generated picture wherever the matte says
              keep (white = keep, black = take the generated; --invert for the opposite). An image
              model has no mask input: a matte sent to it is a request, and it redraws what it was
              asked to leave. This makes the matte hold. --grow widens the kept area by PX pixels
              (negative shrinks it), --feather softens its edge. Still or clip; a matte still over a
              clip is held for every frame. The generated picture is fitted to the original's size
              and, for a clip, its rate and length. Reports the share of the kept area that is the
              original's pixels in the written file (keptPct), how much of the kept area the model
              had redrawn before the paste (modelRedrewKeptPct), and writes a before/after still
              and a sheet of close-ups along the matte's edge, where a ghost would show.
  matte       A black and white matte of the subject across a clip or a still (white = subject):
              a colour-difference key on a green or blue screen, AI segmentation otherwise (the
              main subject; u2net_human_seg for people only). --cutout also keeps the subject on
              transparency. The key and the segmentation are cutout.py's own.
  clip        A frame-accurate extract. The video model takes 4 to 15 seconds: --for-model widens a
              shorter extract to 4 seconds inside the source and reports the trim that cuts the
              result back to what was asked.
  frame       One frame as a PNG.
  compare     Did the picture stay put? Compares the structure (edges, so a change of light is
              allowed) of A and B over up to five frames, inside the matte when one is given, and
              measures how far the picture slid. For "change the light only" and "keep the pack and
              the camera". Images or clips; --a-at / --b-at pick one frame of a clip (first, mid,
              last, seconds), for checking a clip's first frame against a start frame.
Exit 0 ok · 1 fault · 2 usage · 3 not ready (a file missing, rembg missing)
"""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, shutil
from pathlib import Path

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp")
MODEL_MIN, MODEL_MAX = 4.0, 15.0   # seconds the video model accepts


def die(msg, code=1):
    print(msg, file=sys.stderr); sys.exit(code)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(" ".join(str(c) for c in cmd[:3]) + ": " + (r.stderr or "")[-600:])
    return r.stdout

def is_image(p):
    return str(p).lower().endswith(IMAGE_EXT)

def need(p, what):
    if not p: die("missing " + what, 2)
    if not Path(p).exists(): die("%s not found: %s" % (what, p), 3)
    return Path(p)

def probe(path):
    """Size, rate, length and frame count. A still is one frame."""
    if is_image(path):
        from PIL import Image
        with Image.open(path) as im: w, h = im.size
        return {"width": w, "height": h, "fps": 25.0, "duration": 0.0, "frames": 1, "audio": False, "image": True}
    j = json.loads(run(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_read_frames:format=duration", "-of", "json", str(path)]))
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v: die("no picture in " + str(path), 3)
    num, den = (v.get("r_frame_rate") or "25/1").split("/")
    fps = float(num) / float(den or 1)
    dur = float((j.get("format") or {}).get("duration") or 0)
    n = int(v.get("nb_read_frames") or 0) or max(1, round(dur * fps))
    return {"width": int(v["width"]), "height": int(v["height"]), "fps": fps, "duration": dur, "frames": n,
            "audio": any(s.get("codec_type") == "audio" for s in j.get("streams", [])), "image": False}

def fit_filter(src_w, src_h, w, h):
    """Scale to w x h. A picture of another shape covers the frame and is cropped at the centre."""
    if abs((src_w / max(1, src_h)) - (w / max(1, h))) <= 0.01 * (w / max(1, h)): return "scale=%d:%d:flags=lanczos" % (w, h), False
    return "scale=%d:%d:force_original_aspect_ratio=increase:flags=lanczos,crop=%d:%d" % (w, h, w, h), True

def frames(path, w, h, fps, count, gray=False):
    """`count` frames of `path` as numpy arrays, fitted to w x h at `fps`. A still repeats; a clip
    that runs short holds its last frame."""
    import numpy as np
    info = probe(path)
    vf, _ = fit_filter(info["width"], info["height"], w, h)
    ch = 1 if gray else 3
    if not info["image"]: vf = "fps=%.6f,%s" % (fps, vf)
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-an", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if gray else "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * ch; last = None; n = 0
    try:
        while n < count:
            buf = p.stdout.read(size)
            if len(buf) < size: break
            last = np.frombuffer(buf, np.uint8).reshape((h, w) if gray else (h, w, 3))
            yield last; n += 1
    finally:
        p.stdout.close(); p.wait()
    if last is None: die("no frame could be read from " + str(path), 1)
    while n < count:
        yield last; n += 1

def frame_time(info, at):
    if info["image"]: return 0.0
    if at in (None, "mid"): return max(0.0, info["duration"] / 2)
    if at == "first": return 0.0
    if at == "last": return max(0.0, (info["frames"] - 1) / info["fps"])
    try: return max(0.0, min(float(at), max(0.0, info["duration"] - 0.5 / info["fps"])))
    except ValueError: die("--at takes first, mid, last or a number of seconds, not " + str(at), 2)

def grab(path, t, w=None, h=None):
    """One frame as an RGB numpy array, fitted to w x h when given."""
    import numpy as np
    from PIL import Image
    info = probe(path)
    tmp = Path(tempfile.mkdtemp(prefix="shot-")); f = tmp / "f.png"
    try:
        if info["image"]: im = Image.open(path).convert("RGB")
        else:
            run(["ffmpeg", "-v", "error", "-y", "-ss", "%.4f" % t, "-i", str(path), "-frames:v", "1", str(f)])
            if not f.exists():   # a seek onto the very last frame can come back empty
                run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.5", "-i", str(path), "-update", "1", "-frames:v", "1", str(f)])
            im = Image.open(f).convert("RGB")
        if w and h and im.size != (w, h):
            from PIL import ImageOps
            im = ImageOps.fit(im, (w, h), Image.LANCZOS) if abs(im.size[0] / im.size[1] - w / h) > 0.01 * w / h else im.resize((w, h), Image.LANCZOS)
        return np.asarray(im).copy()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def shape_matte(a, invert, grow, feather):
    """The keep matte as floats 0..1 from a grey frame: inverted, grown or shrunk, softened."""
    import numpy as np
    from PIL import Image, ImageFilter
    m = Image.fromarray(a if not invert else 255 - a)
    if grow:
        k = 2 * int(abs(grow)) + 1
        m = m.filter(ImageFilter.MaxFilter(k) if grow > 0 else ImageFilter.MinFilter(k))
    if feather > 0: m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m, np.float32) / 255.0

def edge_sheet(orig, gen, res, keep, out_jpg):
    """Close-ups along the matte's edge: original | the model's frame | the result. Where the model
    moved or reshaped something it was asked to keep, the leftover shows here as a second outline."""
    import numpy as np
    from PIL import Image
    h, w = keep.shape
    solid = keep > 0.5
    edge = np.zeros_like(solid)
    edge[1:, :] |= solid[1:, :] != solid[:-1, :]; edge[:, 1:] |= solid[:, 1:] != solid[:, :-1]
    ys, xs = np.nonzero(edge)
    if not len(xs): return None
    order = np.argsort(xs, kind="stable")
    win = int(max(64, min(w, h) // 5)); rows = []
    for q in (0.125, 0.375, 0.625, 0.875):
        i = order[int(q * (len(order) - 1))]; cx, cy = int(xs[i]), int(ys[i])
        x0 = max(0, min(w - win, cx - win // 2)); y0 = max(0, min(h - win, cy - win // 2))
        cells = [Image.fromarray(a[y0:y0 + win, x0:x0 + win]).resize((240, 240), Image.LANCZOS) for a in (orig, gen, res)]
        row = Image.new("RGB", (240 * 3 + 16, 240), (20, 20, 20))
        for k, c in enumerate(cells): row.paste(c, (k * 248, 0))
        rows.append(row)
    sheet = Image.new("RGB", (rows[0].size[0], 248 * len(rows) - 8), (20, 20, 20))
    for k, r in enumerate(rows): sheet.paste(r, (0, k * 248))
    sheet.save(out_jpg, quality=90)
    return str(out_jpg).replace("\\", "/")

def cmd_paste_back(o):
    import numpy as np
    from PIL import Image
    original = need(o.get("--original"), "--original"); generated = need(o.get("--generated"), "--generated"); alpha = need(o.get("--alpha"), "--alpha")
    out = Path(o.get("--out") or die("missing --out", 2)); out.parent.mkdir(parents=True, exist_ok=True)
    invert = "--invert" in o; grow = int(float(o.get("--grow", 0))); feather = float(o.get("--feather", 1.0)); min_kept = float(o.get("--min-kept", 97))
    info = probe(original); ginfo = probe(generated); ainfo = probe(alpha)
    w, h, fps, n = info["width"], info["height"], info["fps"], info["frames"]
    still = info["image"]
    if still and out.suffix.lower() not in IMAGE_EXT: die("the original is a still, so --out must be a picture (png)", 2)
    if not still and is_image(out): die("the original is a clip, so --out must be a video (mp4 or mov)", 2)
    _, cropped = fit_filter(ginfo["width"], ginfo["height"], w, h)
    _, acropped = fit_filter(ainfo["width"], ainfo["height"], w, h)
    notes = []
    if cropped: notes.append("the generated picture is %dx%d, another shape than the original's %dx%d: it was scaled to cover and cropped at the centre" % (ginfo["width"], ginfo["height"], w, h))
    if acropped: notes.append("the matte is %dx%d, another shape than the original's %dx%d: check it lines up" % (ainfo["width"], ainfo["height"], w, h))
    if not still and not ginfo["image"] and abs(ginfo["duration"] - info["duration"]) > 0.25: notes.append("the generated clip runs %.2f s against the original's %.2f s: it was retimed to the original's rate and its last frame held or cut" % (ginfo["duration"], info["duration"]))
    picks = sorted(set([0] if n == 1 else [int(round(k * (n - 1) / 4.0)) for k in range(5)]))
    kept_frames = {}; enc = None
    if not still:
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (w, h), "-framerate", "%.6f" % fps, "-i", "-"]
        if info["audio"]: cmd += ["-i", str(original), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "256k", "-shortest"]
        if out.suffix.lower() == ".mov": cmd += ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]
        else: cmd += ["-c:v", "libx264", "-crf", "12", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        enc = subprocess.Popen(cmd + [str(out)], stdin=subprocess.PIPE)
    redrew = []; changed = []; cover = []; mid = None
    try:
        gen_o = frames(original, w, h, fps, n); gen_g = frames(generated, w, h, fps, n); gen_a = frames(alpha, w, h, fps, n, gray=True)
        for i in range(n):
            of = next(gen_o); gf = next(gen_g); keep = shape_matte(next(gen_a), invert, grow, feather)
            k3 = keep[..., None]
            res = (of.astype(np.float32) * k3 + gf.astype(np.float32) * (1.0 - k3) + 0.5).clip(0, 255).astype(np.uint8)
            if enc: enc.stdin.write(res.tobytes())
            if i in picks:
                solid = keep > 0.98; free = keep < 0.02
                diff = np.abs(gf.astype(np.int16) - of.astype(np.int16)).max(axis=2)
                cover.append(100.0 * (keep > 0.5).mean())
                if solid.any(): redrew.append(100.0 * (diff[solid] > 24).mean())
                if free.any(): changed.append(100.0 * (diff[free] > 12).mean())
                kept_frames[i] = (of.copy(), solid)
                if i == picks[len(picks) // 2]: mid = (of.copy(), gf.copy(), res.copy(), keep.copy())
    finally:
        if enc: enc.stdin.close(); enc.wait()
    if enc and enc.returncode != 0: die("the result could not be written: " + str(out), 1)
    if still: Image.fromarray(mid[2]).save(out)
    # What the written file kept: the original's pixels inside the solid part of the matte, read
    # back from the file. Brightness is compared (a clip's colour is stored at half resolution, so
    # a fine coloured pattern shifts a little on its own).
    luma = lambda x: x.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    kept = []
    if still:
        res = np.asarray(Image.open(out).convert("RGB")); of, solid = kept_frames[0]
        if solid.any(): kept.append(100.0 * (np.abs(luma(res) - luma(of))[solid] <= 12).mean())
    else:
        for i, rf in enumerate(frames(out, w, h, fps, n)):
            if i in kept_frames:
                of, solid = kept_frames[i]
                if solid.any(): kept.append(100.0 * (np.abs(luma(rf) - luma(of))[solid] <= 12).mean())
    r1 = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    result = {"tool": "paste-back", "file": str(out).replace("\\", "/"), "width": w, "height": h, "frames": n, "still": still,
              "keptAreaPct": r1(cover), "keptPct": round(min(kept), 1) if kept else None, "modelRedrewKeptPct": r1(redrew),
              "regeneratedAreaChangedPct": r1(changed), "invert": invert, "grow": grow, "feather": feather, "notes": notes, "flags": []}
    prev = Path(o.get("--previews") or out.parent); prev.mkdir(parents=True, exist_ok=True)
    if mid:
        of, gf, res, keep = mid
        ba = Image.new("RGB", (w * 2 + 8, h), (20, 20, 20)); ba.paste(Image.fromarray(of), (0, 0)); ba.paste(Image.fromarray(res), (w + 8, 0))
        if ba.size[0] > 2400: ba = ba.resize((2400, int(ba.size[1] * 2400 / ba.size[0])), Image.LANCZOS)
        p = prev / (out.stem + "-before-after.jpg"); ba.save(p, quality=90); result["beforeAfter"] = str(p).replace("\\", "/")
        result["edges"] = edge_sheet(of, gf, res, keep, prev / (out.stem + "-edges.jpg"))
    if not cover or max(cover) < 0.05: result["flags"].append("the matte keeps nothing: the result is the generated picture as it came (white = keep; try --invert)")
    elif min(cover) > 99.9: result["flags"].append("the matte keeps everything: the result is the original, unchanged (white = keep; try --invert)")
    if result["keptPct"] is not None and result["keptPct"] < min_kept: result["flags"].append("only %s%% of the kept area is the original's pixels (under %s%%)" % (result["keptPct"], min_kept))
    if result["modelRedrewKeptPct"] is not None and result["modelRedrewKeptPct"] > 40 and result["edges"]:
        result["notes"].append("the model had redrawn %s%% of the area it was asked to keep; the paste puts the original back, so look at the edge close-ups for a second outline (a clean plate first avoids it)" % result["modelRedrewKeptPct"])
    return result

def cmd_matte(o):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import cutout as C
    source = need(o.get("--source"), "--source")
    out = Path(o.get("--out") or die("missing --out", 2)); out.parent.mkdir(parents=True, exist_ok=True)
    info = probe(source); still = info["image"]
    if still != is_image(out): die("--out must be a %s for this source" % ("picture (png)" if still else "video (mp4 or mov)"), 2)
    method = o.get("--method", "auto"); model = o.get("--model", "u2net")
    if model not in C.REMBG_MODELS: die("unknown rembg model %s (one of %s)" % (model, ", ".join(C.REMBG_MODELS)), 2)
    lo = float(o.get("--lo", 0.18)); hi = float(o.get("--hi", 0.62))
    cinfo = {"width": info["width"], "height": info["height"], "fps": info["fps"], "duration": info["duration"]}
    area = None if still else C.picture_area(source, cinfo)
    how = "asked"
    if method == "auto": method, how = C.detect_method(source, cinfo, area)
    tmp = Path(tempfile.mkdtemp(prefix="matte-")); cut = tmp / "cut.mov"
    try:
        colour = None
        if method in ("diffkey", "chromakey"):
            colour = C.key_colour(source, cinfo, area)
            if not colour: die("no green or blue screen found in the corners of the picture; use --method rembg", 3)
            if method == "diffkey": C.cut_diffkey(source, cut, colour, cinfo, lo, hi)
            else: C.cut_chromakey(source, cut, colour, float(o.get("--similarity", 0.12)), float(o.get("--blend", 0.08)))
        elif method == "rembg": C.cut_rembg(source, cut, cinfo, model)
        else: die("unknown method " + method, 2)
        vf = "alphaextract,format=gray" + (",negate" if "--invert" in o else "")
        if still: run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-vf", vf, "-frames:v", "1", str(out)])
        elif out.suffix.lower() == ".mov": run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-vf", vf, "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", str(out)])
        else: run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-vf", vf + ",format=yuv420p", "-c:v", "libx264", "-crf", "8", "-color_range", "tv", "-movflags", "+faststart", str(out)])
        prev = Path(o.get("--previews") or out.parent); prev.mkdir(parents=True, exist_ok=True)
        mask_png = prev / (out.stem + "-mid.png")
        cover = C.coverage_and_mask(cut, cinfo, mask_png, None)
        keep_cut = o.get("--cutout")
        if keep_cut: Path(keep_cut).parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(cut, keep_cut)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    result = {"tool": "matte", "file": str(out).replace("\\", "/"), "method": method, "decidedBy": how, "model": model if method == "rembg" else None,
              "keyColour": colour, "width": info["width"], "height": info["height"], "frames": info["frames"], "still": still, "subjectCoveragePct": cover,
              "midFrame": str(mask_png).replace("\\", "/"), "cutout": str(keep_cut).replace("\\", "/") if keep_cut else None, "inverted": "--invert" in o, "notes": [], "flags": []}
    if method == "rembg":
        result["notes"].append("AI segmentation takes the main subject of each frame on its own: it cannot be told which object to pick, and its edge can shimmer between frames. Look at the matte.")
    if not (1 <= cover <= 90): result["flags"].append("the subject covers %s%% of the middle frame: look at the matte before using it" % cover)
    return result

def cmd_clip(o):
    source = need(o.get("--source"), "--source")
    out = Path(o.get("--out") or die("missing --out", 2)); out.parent.mkdir(parents=True, exist_ok=True)
    info = probe(source)
    if info["image"]: die("--source is a still; clip takes a video", 2)
    try:
        start = float(o.get("--start", 0)); end = float(o["--end"]) if "--end" in o else start + float(o.get("--seconds", 0))
    except ValueError: die("--start, --end and --seconds take seconds", 2)
    end = min(end, info["duration"])
    if end - start <= 0: die("nothing to extract: --start %.2f, --end %.2f, source %.2f s" % (start, end, info["duration"]), 2)
    asked = {"start": round(start, 3), "seconds": round(end - start, 3)}; trim = None; notes = []
    if "--for-model" in o:
        if end - start > MODEL_MAX: die("the video model takes at most %d s; this extract is %.2f s. Cut it into shorter pieces." % (MODEL_MAX, end - start), 2)
        if info["duration"] < MODEL_MIN: die("the source is %.2f s; the video model needs at least %d s of reference" % (info["duration"], MODEL_MIN), 3)
        if end - start < MODEL_MIN:
            pad = (MODEL_MIN - (end - start)) / 2.0
            s2 = max(0.0, start - pad); e2 = s2 + MODEL_MIN
            if e2 > info["duration"]: e2 = info["duration"]; s2 = e2 - MODEL_MIN
            trim = {"start": round(start - s2, 3), "seconds": asked["seconds"]}
            notes.append("the video model takes 4 to 15 s, so %.2f to %.2f s was extracted; cut the generated clip back with: clip --start %s --seconds %s" % (s2, e2, trim["start"], trim["seconds"]))
            start, end = s2, e2
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "%.4f" % start, "-i", str(source), "-t", "%.4f" % (end - start),
           "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    cmd += ["-c:a", "aac", "-b:a", "256k"] if info["audio"] else ["-an"]
    run(cmd + [str(out)])
    got = probe(out)
    return {"tool": "clip", "file": str(out).replace("\\", "/"), "from": round(start, 3), "seconds": round(got["duration"], 3), "frames": got["frames"], "fps": round(got["fps"], 3),
            "asked": asked, "trimBack": trim, "fitsVideoModel": MODEL_MIN <= round(got["duration"], 2) <= MODEL_MAX, "notes": notes, "flags": []}

def cmd_frame(o):
    from PIL import Image
    source = need(o.get("--source"), "--source")
    out = Path(o.get("--out") or die("missing --out", 2)); out.parent.mkdir(parents=True, exist_ok=True)
    if not is_image(out): die("--out must be a picture (png)", 2)
    info = probe(source); t = frame_time(info, o.get("--at", "mid"))
    Image.fromarray(grab(source, t)).save(out)
    return {"tool": "frame", "file": str(out).replace("\\", "/"), "at": round(t, 3), "width": info["width"], "height": info["height"], "notes": [], "flags": []}

def structure(a, b, mask=None):
    """How alike two frames are in structure, and how far one slid against the other. Both are
    reduced to edge strength (so brightness, colour and a change of light direction count for
    little), correlated, and the slide is read off the peak of their cross-correlation."""
    import numpy as np
    def edges(x):
        g = x.astype(np.float32).mean(axis=2)
        g = (g - g.mean()) / (g.std() + 1e-6)
        gy, gx = np.gradient(g)
        return np.hypot(gx, gy)
    ea, eb = edges(a), edges(b)
    m = np.ones(ea.shape, bool) if mask is None else mask
    if m.sum() < 64: return None, (0, 0)
    xa, xb = ea[m] - ea[m].mean(), eb[m] - eb[m].mean()
    corr = float((xa * xb).sum() / (np.sqrt((xa * xa).sum() * (xb * xb).sum()) + 1e-9))
    wa = np.where(m, ea - ea[m].mean(), 0.0); wb = np.where(m, eb - eb[m].mean(), 0.0)
    f = np.fft.irfft2(np.fft.rfft2(wb) * np.conj(np.fft.rfft2(wa)), s=wa.shape)
    py, px = np.unravel_index(int(np.argmax(f)), f.shape)
    h, w = wa.shape
    dy = py - h if py > h // 2 else py; dx = px - w if px > w // 2 else px
    return corr, (int(dx), int(dy))

def cmd_compare(o):
    import numpy as np
    a = need(o.get("--a"), "--a"); b = need(o.get("--b"), "--b")
    ia, ib = probe(a), probe(b)
    w = 480; h = max(2, int(round(w * ia["height"] / ia["width"] / 2.0)) * 2)
    k = max(1, int(o.get("--frames", 5)))
    def times(info, at):
        if at is not None or info["image"]: return [frame_time(info, at)]
        return [info["duration"] * (i + 0.5) / k for i in range(k)]
    ta, tb = times(ia, o.get("--a-at")), times(ib, o.get("--b-at"))
    if len(ta) != len(tb): ta, tb = (ta * len(tb))[:max(len(ta), len(tb))], (tb * len(ta))[:max(len(ta), len(tb))]
    alpha = o.get("--alpha"); mi = probe(need(alpha, "--alpha")) if alpha else None
    rows = []
    for t1, t2 in zip(ta, tb):
        fa, fb = grab(a, t1, w, h), grab(b, t2, w, h)
        mask = None
        if alpha: mask = grab(alpha, frame_time(mi, None) if mi["image"] else min(t1, mi["duration"]), w, h).mean(axis=2) > 127
        corr, (dx, dy) = structure(fa, fb, mask)
        if corr is None: continue
        rows.append({"a": round(t1, 3), "b": round(t2, 3), "structurePct": round(max(0.0, corr) * 100, 1), "shiftPctOfWidth": round(100.0 * float(np.hypot(dx, dy)) / w, 2)})
    if not rows: die("nothing to compare: the matte leaves no picture", 3)
    min_s = float(o.get("--min-structure", 50)); max_shift = float(o.get("--max-shift", 1.0))
    worst = min(r["structurePct"] for r in rows); shift = max(r["shiftPctOfWidth"] for r in rows)
    result = {"tool": "compare", "a": str(a).replace("\\", "/"), "b": str(b).replace("\\", "/"), "insideMatte": bool(alpha), "frames": rows,
              "structurePct": worst, "shiftPctOfWidth": shift, "minStructure": min_s, "maxShift": max_shift, "notes": [], "flags": []}
    if abs(ia["width"] / ia["height"] - ib["width"] / ib["height"]) > 0.01 * ia["width"] / ia["height"]: result["notes"].append("A is %dx%d and B is %dx%d: B was scaled to cover A and cropped" % (ia["width"], ia["height"], ib["width"], ib["height"]))
    if worst < min_s: result["flags"].append("the structure matches %s%% on the worst frame (under %s%%): something other than the light changed, look at both" % (worst, min_s))
    elif shift > max_shift: result["flags"].append("the picture slid by %s%% of its width (over %s%%): the framing or the camera move changed" % (shift, max_shift))
    return result

COMMANDS = {"paste-back": cmd_paste_back, "matte": cmd_matte, "clip": cmd_clip, "frame": cmd_frame, "compare": cmd_compare}
BOOLS = ("--invert", "--for-model")

def main(argv):
    if len(argv) < 2 or argv[1] not in COMMANDS: die("usage: shot.py %s ... (see the head of this file)" % "|".join(COMMANDS), 2)
    o = {}; i = 2
    while i < len(argv):
        k = argv[i]
        if not k.startswith("--"): die("unexpected argument " + k, 2)
        if k in BOOLS: o[k] = True; i += 1
        else:
            if i + 1 >= len(argv): die(k + " needs a value", 2)
            o[k] = argv[i + 1]; i += 2
    try:
        result = COMMANDS[argv[1]](o)
    except RuntimeError as e:
        die(str(e), 1)
    for f in result.get("flags", []): print("FLAG: " + f)
    for n in result.get("notes", []): print("NOTE: " + n)
    print(json.dumps(result))

if __name__ == "__main__":
    main(sys.argv)
