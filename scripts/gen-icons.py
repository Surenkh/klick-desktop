#!/usr/bin/env python3
"""Draw Klick's tray/app icons as PNGs with no image-library dependency."""

import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

BG = (0x2B, 0x2D, 0x36)
FG = (0xF5, 0xF3, 0xEC)
FACE = (0x1B, 0x1C, 0x22)


def rounded_alpha(x, y, size, radius):
    # signed distance to a rounded square, used as coverage
    cx = cy = (size - 1) / 2.0
    dx = abs(x - cx) - (size / 2.0 - radius)
    dy = abs(y - cy) - (size / 2.0 - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    d = outside + inside - radius
    return max(0.0, min(1.0, 0.5 - d))


def draw(size, cap_ratio=0.86, with_face=True):
    px = []
    top = (size - size * cap_ratio) / 2.0
    for y in range(size):
        row = []
        for x in range(size):
            a = rounded_alpha(x, y, size, size * 0.22)
            # keycap body occupies the lower 70% of the rounded square
            body_top = top + size * cap_ratio * 0.22
            if y < body_top:
                a *= 0.0
            col = BG
            if with_face and a > 0.01:
                # two eyes + a smile, drawn in the face colour
                ex = size * 0.17
                ey = size * 0.50
                er = size * 0.045
                if (math.hypot(x - (size / 2 - ex), y - ey) < er or
                        math.hypot(x - (size / 2 + ex), y - ey) < er):
                    col = FACE
                # smile: lower half of a circle
                sm_r = size * 0.13
                d = math.hypot(x - size / 2, y - (size * 0.56))
                if sm_r * 0.75 < d < sm_r and y > size * 0.58:
                    col = FACE
            if a <= 0:
                rgb = (0, 0, 0)
            else:
                rgb = tuple(int(col[i] * a + FG[i] * (1 - a)) for i in range(3))
            row.append((rgb, int(a * 255)))
        px.append(row)
    return px


def write_png(path, px):
    size = len(px)
    raw = b""
    for row in px:
        raw += b"\x00"
        for rgb, a in row:
            raw += bytes((rgb[0], rgb[1], rgb[2], a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, "tray.png"), draw(32, 0.78))
    write_png(os.path.join(OUT, "trayTemplate.png"), draw(32, 0.78))
    write_png(os.path.join(OUT, "icon.png"), draw(256, 0.84))
    print("wrote assets/tray.png, assets/trayTemplate.png, assets/icon.png")
