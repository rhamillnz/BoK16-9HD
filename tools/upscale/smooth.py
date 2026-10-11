"""Smooth 4x enlargement of whole cutscene frames (the chosen cutscene style, "B"): Lanczos plus light sharpening,
no AI, so nothing is invented and nothing looks waxy.

  tools/upscale/.venv/Scripts/python tools/upscale/smooth.py art/derived/cutscene-frames art/reference/cutscene-frames-4x
"""
import os
import sys

from PIL import Image, ImageFilter

SCALE = 4


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(src)):
        if not name.endswith(".png"):
            continue
        img = Image.open(os.path.join(src, name)).convert("RGB")
        big = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
        big.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2)).save(os.path.join(out, name))
        n += 1
    print(f"{n} frames -> {out}")


main()
