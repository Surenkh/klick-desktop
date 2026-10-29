#!/usr/bin/env python3
"""Import Klick art into the app.

    python3 scripts/import-visuals.py incoming/visuals/Klick_App_Assets

- maps Klick's state names to the states the buddy window drives
- downscales the 1254 px PNGs to 512 px (displayed at 138 px @3x)
- copies the animated WebP loops for idle/happy
- rebuilds assets/icon.png from the idle pose
- writes a contact sheet to assets/buddy/_preview.png so the result can be
  eyeballed on dark and light backgrounds
"""

import json
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "assets", "buddy")
ANIM = os.path.join(DEST, "anim")

# Klick state -> app state
MAP = {
    "idle": "idle",
    "working": "press",
    "success": "party",
    "attention": "sweat",
    "error": "error",
    "sleeping": "sleep",
    "happy": "happy",
    "blink": "blink",
}

SIZE = 512


def trim_to_square(img, pad=0.06):
    """Keep a square canvas but crop dead transparent space, then re-pad."""
    bbox = img.getbbox()
    if not bbox:
        return img
    img = img.crop(bbox)
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    inner = int(side * (1 - 2 * pad))
    canvas = canvas.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(canvas, ((side - inner) // 2, (side - inner) // 2), canvas)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "incoming", "visuals", "Klick_App_Assets")
    png_dir = os.path.join(src, "png")
    anim_dir = os.path.join(src, "animations")
    if not os.path.isdir(png_dir):
        raise SystemExit("no png/ folder in %s" % src)

    os.makedirs(DEST, exist_ok=True)
    os.makedirs(ANIM, exist_ok=True)

    manifest = json.load(open(os.path.join(src, "manifest.json"))) if os.path.exists(
        os.path.join(src, "manifest.json")) else {}

    written = []
    for klick_state, app_state in MAP.items():
        path = os.path.join(png_dir, "klick-%s.png" % klick_state)
        if not os.path.exists(path):
            print("missing", path)
            continue
        img = Image.open(path).convert("RGBA")
        img = trim_to_square(img).resize((SIZE, SIZE), Image.LANCZOS)
        out = os.path.join(DEST, app_state + ".png")
        img.save(out, optimize=True)
        written.append(app_state)
        print("%-8s <- klick-%-9s %5dx%-5d %6.0f KB" % (
            app_state + ".png", klick_state, img.width, img.height,
            os.path.getsize(out) / 1024))

    for name, src_name in (("idle", "klick-idle.webp"), ("happy", "klick-happy.webp")):
        p = os.path.join(anim_dir, src_name)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(ANIM, name + ".webp"))
            print("anim/%s.webp  %6.0f KB" % (name, os.path.getsize(p) / 1024))

    # app icon: idle pose on the app's dark surface, rounded square
    idle = Image.open(os.path.join(DEST, "idle.png")).convert("RGBA")
    icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    bg = Image.new("RGBA", (1024, 1024), (22, 23, 28, 255))
    mask = Image.new("L", (1024, 1024), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 1023, 1023], radius=230, fill=255)
    icon.paste(bg, (0, 0), mask)
    art = idle.resize((860, 860), Image.LANCZOS)
    icon.paste(art, (82, 82), art)
    icon.save(os.path.join(ROOT, "assets", "icon.png"))
    print("assets/icon.png rebuilt from idle")

    # contact sheet: same art on the app's dark surface and on white
    sheet = Image.new("RGBA", (1240, 2 * 320 + 40), (14, 15, 20, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 320 + 20, 1240, 1240], fill=(245, 245, 247, 255))
    order = [s for s in ("idle", "press", "happy", "party", "sweat", "error", "sleep", "blink") if s in written]
    for i, state in enumerate(order):
        im = Image.open(os.path.join(DEST, state + ".png")).convert("RGBA").resize((140, 140), Image.LANCZOS)
        x = 20 + i * 150
        sheet.paste(im, (x, 90), im)
        sheet.paste(im, (x, 320 + 20 + 90), im)
        d.text((x + 6, 250), state, fill=(230, 232, 240, 255))
        d.text((x + 6, 320 + 20 + 250), state, fill=(60, 62, 70, 255))
    sheet.convert("RGB").save(os.path.join(DEST, "_preview.png"))
    print("preview -> assets/buddy/_preview.png")


if __name__ == "__main__":
    main()
