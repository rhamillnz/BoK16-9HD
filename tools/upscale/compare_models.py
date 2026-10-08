"""Side-by-side model comparison for scene pictures: nearest-neighbour 4x | anime_6B | x4plus.

Usage: tools/upscale/.venv/Scripts/python tools/upscale/compare_models.py <name=hash> ...
Reads art/derived/scenes/<hash>.png and the 4x anime_6B result in art/reference/scenes-4x/<hash>.png,
upscales the original again with models/RealESRGAN_x4plus.pth, and writes
art/reference/compare/<name>.png (three 1280x800 panels, labelled).
"""
import os
import sys

import torch
from PIL import Image, ImageDraw
from spandrel import ModelLoader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upscale import upscale  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
torch.set_grad_enabled(False)
plus = ModelLoader().load_from_file(os.path.join(HERE, "models", "RealESRGAN_x4plus.pth")).eval()
os.makedirs("art/reference/compare", exist_ok=True)
for arg in sys.argv[1:]:
    name, h = arg.split("=")
    src = Image.open(f"art/derived/scenes/{h}.png").convert("RGB")
    nearest = src.resize((src.width * 4, src.height * 4), Image.Resampling.NEAREST)
    anime = Image.open(f"art/reference/scenes-4x/{h}.png").convert("RGB")
    general = upscale(plus, src).convert("RGB")
    panels = [("original, nearest 4x", nearest), ("anime_6B (current)", anime), ("x4plus", general)]
    w, hh = nearest.size
    sheet = Image.new("RGB", (w * 3 + 40, hh + 50), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, (label, img) in enumerate(panels):
        sheet.paste(img, (10 + i * (w + 10), 40))
        d.text((14 + i * (w + 10), 14), label, fill=(240, 220, 140))
    sheet.save(f"art/reference/compare/{name}.png")
    general.save(f"art/reference/compare/{name}-x4plus.png")
    print(name, sheet.size)
