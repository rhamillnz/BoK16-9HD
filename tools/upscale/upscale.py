"""4x upscale RGBA sprites with Real-ESRGAN (via spandrel), preserving transparency.

Usage:
  tools/upscale/.venv/Scripts/python tools/upscale/upscale.py <in_dir> <out_dir> [--model path.pth] [--scenes] [--only 1,2,3]

Colour goes through the network. Alpha (the original palette-index-0 cut-out) is
upscaled with a smooth filter and re-thresholded so edges stay crisp. Transparent
pixels are first filled with nearby colour so dark halos don't bleed into edges.
"""
import argparse
import os

import numpy as np
import torch
from PIL import Image, ImageFilter
from spandrel import ModelLoader

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.path.join(HERE, "models", "RealESRGAN_x4plus_anime_6B.pth")
# Town/shop/inn/temple pictures (art/derived/scenes): the general model keeps the paint texture better (chosen by Reuben).
SCENE_MODEL = os.path.join(HERE, "models", "RealESRGAN_x4plus.pth")


def bleed_colour(rgba: Image.Image, passes: int = 4) -> Image.Image:
    """Fill transparent pixels with the average of nearby opaque ones (avoids dark fringes)."""
    rgb = np.asarray(rgba.convert("RGB"), dtype=np.float32)
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
    mask = alpha > 0.5
    for _ in range(passes):
        if mask.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(mask.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                m = np.roll(np.roll(mask, dy, 0), dx, 1)
                acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * m[..., None]
                cnt += m
        grow = (~mask) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        mask = mask | grow
    return Image.fromarray(rgb.clip(0, 255).astype(np.uint8), "RGB")


def upscale(model, img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    rgb = bleed_colour(rgba)
    x = torch.from_numpy(np.asarray(rgb, dtype=np.float32) / 255.0).permute(2, 0, 1)[None]
    with torch.no_grad():
        y = model(x).clamp(0, 1)[0].permute(1, 2, 0).numpy()
    out = Image.fromarray((y * 255).round().astype(np.uint8), "RGB")
    scale = out.width // rgba.width
    alpha = rgba.getchannel("A").resize(out.size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(scale * 0.25))
    alpha = alpha.point(lambda a: 255 if a >= 128 else 0)
    out.putalpha(alpha)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("in_dir")
    p.add_argument("out_dir")
    p.add_argument("--model", default=None, help="default: anime_6B for sprites, x4plus for scenes")
    p.add_argument("--scenes", action="store_true", help="town scene pictures: use the x4plus model")
    p.add_argument("--only", default=None, help="comma-separated file stems")
    args = p.parse_args()

    torch.set_grad_enabled(False)
    if args.model is None:
        args.model = SCENE_MODEL if args.scenes or os.path.normpath(args.in_dir).endswith(os.path.join("derived", "scenes")) else DEFAULT_MODEL
    model = ModelLoader().load_from_file(args.model).eval()
    os.makedirs(args.out_dir, exist_ok=True)
    names = sorted(f for f in os.listdir(args.in_dir) if f.lower().endswith(".png"))
    if args.only:
        wanted = set(args.only.split(","))
        names = [n for n in names if n[:-4] in wanted]
    for name in names:
        img = Image.open(os.path.join(args.in_dir, name))
        out = upscale(model, img)
        out.save(os.path.join(args.out_dir, name))
        print(f"{name}: {img.width}x{img.height} -> {out.width}x{out.height}")


if __name__ == "__main__":
    main()
