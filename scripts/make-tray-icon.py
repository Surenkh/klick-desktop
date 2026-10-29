#!/usr/bin/env python3
"""Turn the Klick silhouette into a macOS menu-bar template icon.

    python3 scripts/make-tray-icon.py <silhouette.jpg|png>

macOS template images are pure black with an alpha channel: the system tints
them for light/dark menu bars, so a black shape on white is exactly right.
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def main():
    src_path = sys.argv[1]
    img = Image.open(src_path).convert("RGB")
    lum = img.convert("L")

    # white -> transparent, dark -> opaque, with a soft ramp for anti-aliasing
    alpha = lum.point(lambda v: 0 if v > 210 else min(255, int((210 - v) * 255 / 150)))
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit("no dark pixels found")
    alpha = alpha.crop(bbox)

    # macOS status bar icons are 16-18 pt and optically square; contain the
    # silhouette in that box with the same padding a system glyph gets
    def build(canvas_side):
        box = canvas_side - max(2, round(canvas_side * 0.12))
        scale = min(box / alpha.width, box / alpha.height)
        w = max(1, int(round(alpha.width * scale)))
        h = max(1, int(round(alpha.height * scale)))
        a = alpha.resize((w, h), Image.LANCZOS)
        canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
        black = Image.new("RGBA", (w, h), (0, 0, 0, 255))
        canvas.paste(black, ((canvas_side - w) // 2, (canvas_side - h) // 2), a)
        return canvas

    one = build(18)
    one.save(os.path.join(ASSETS, "trayTemplate.png"))
    build(36).save(os.path.join(ASSETS, "trayTemplate@2x.png"))
    print("assets/trayTemplate.png    %dx%d (1x)" % one.size)
    print("assets/trayTemplate@2x.png 36x36 (2x retina)")

    # Windows: the coloured character, since the taskbar does not tint icons
    char = Image.open(os.path.join(ASSETS, "buddy", "idle.png")).convert("RGBA")
    bbox = char.getbbox()
    char = char.crop(bbox)
    sq = max(char.size)
    canvas = Image.new("RGBA", (sq, sq), (0, 0, 0, 0))
    canvas.paste(char, ((sq - char.width) // 2, (sq - char.height) // 2), char)
    canvas.resize((32, 32), Image.LANCZOS).save(os.path.join(ASSETS, "tray-win.png"))
    print("assets/tray-win.png      32x32 (colour)")


if __name__ == "__main__":
    main()
