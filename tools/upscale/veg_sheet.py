from PIL import Image, ImageDraw
import os
names = ['tree4','tree5','tree6','tree6a','tree7','tree7a','tree8','tree8a','tree9','tree9a','grove','fern','bush1','bush2','bush4','stump']
tiles = []
for n in names:
    p = f"art/reference/sprites/{n}.png"
    if os.path.exists(p):
        t = Image.open(p).convert("RGBA"); tiles.append((n, t.resize((t.width * 2, t.height * 2), Image.Resampling.NEAREST)))
W = sum(t.width for _, t in tiles) + 15 * (len(tiles) + 1); H = max(t.height for _, t in tiles) + 30
sheet = Image.new("RGBA", (W, H), (110, 140, 170, 255)); d = ImageDraw.Draw(sheet); x = 15
for n, t in tiles:
    sheet.alpha_composite(t, (x, H - t.height - 5)); d.text((x, 3), n, fill=(255, 255, 255, 255)); x += t.width + 15
sheet.save("shots/veg-sprites.png"); print(sheet.size)
