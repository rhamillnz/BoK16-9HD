from PIL import Image
pairs = [("16", 4), ("1", 4), ("3", 4)]
tiles = []
for stem, s in pairs:
    o = Image.open(f"art/reference/Z01/slots/{stem}.png").convert("RGBA")
    o = o.resize((o.width * s, o.height * s), Image.Resampling.NEAREST)
    u = Image.open(f"art/reference/Z01/slots-4x/{stem}.png").convert("RGBA")
    tiles += [o, u]
W = sum(t.width for t in tiles) + 20 * len(tiles); H = max(t.height for t in tiles) + 20
sheet = Image.new("RGBA", (W, H), (110, 140, 170, 255)); x = 10
for t in tiles:
    sheet.alpha_composite(t, (x, H - t.height - 10)); x += t.width + 20
sheet.save("shots/upscale-compare.png"); print(sheet.size)
