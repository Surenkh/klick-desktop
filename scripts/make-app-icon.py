#!/usr/bin/env python3
"""Build the macOS app icon from the supplied Kiki artwork.

    python3 scripts/make-app-icon.py <art.jpg|png>

Produces assets/icon.png (1024, macOS style rounded square) and
assets/icon.icns via iconutil, which electron-builder picks up for packaging.
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

CANVAS = 1024
BODY = 824          # macOS Big Sur icon grid: content sits inside 824 of 1024
RADIUS = 185


def rounded(img, size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    src = Image.open(sys.argv[1]).convert("RGB")
    side = min(src.size)
    src = src.crop(((src.width - side) // 2, (src.height - side) // 2,
                    (src.width + side) // 2, (src.height + side) // 2))
    body = src.resize((BODY, BODY), Image.LANCZOS)
    tile = rounded(body, BODY, RADIUS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - BODY) // 2

    # soft contact shadow, like the system icons have
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sh = Image.new("RGBA", (BODY, BODY), (0, 0, 0, 90))
    shadow.paste(sh, (offset, offset + 12), tile.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(tile, (offset, offset))
    canvas.save(os.path.join(ASSETS, "icon.png"))
    print("assets/icon.png 1024x1024")

    iconset = os.path.join(ASSETS, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        canvas.resize((size, size), Image.LANCZOS).save(
            os.path.join(iconset, "icon_%dx%d.png" % (size, size)))
        canvas.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(iconset, "icon_%dx%d@2x.png" % (size, size)))
    if subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(ASSETS, "icon.icns")],
                      capture_output=True).returncode == 0:
        print("assets/icon.icns (iconutil)")
    else:
        print("iconutil failed; icon.png is still usable")


if __name__ == "__main__":
    main()
