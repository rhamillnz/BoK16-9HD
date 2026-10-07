from PIL import Image, ImageDraw
tiles = [Image.open(f"art/reference/Z01/slots/{i}.png").convert("RGBA") for i in range(6)]
tiles = [t.resize((t.width * 3, t.height * 3), Image.Resampling.NEAREST) for t in tiles]
W = sum(t.width for t in tiles) + 20 * 7; H = max(t.height for t in tiles) + 40
sheet = Image.new("RGBA", (W, H), (110, 140, 170, 255)); d = ImageDraw.Draw(sheet); x = 20
for i, t in enumerate(tiles):
    sheet.alpha_composite(t, (x, H - t.height - 10)); d.text((x, 5), f"slot {i}", fill=(255, 255, 255, 255)); x += t.width + 20
sheet.save("shots/tree-slots.png"); print(sheet.size)
