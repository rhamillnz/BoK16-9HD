from PIL import Image
base = "art/incoming/stylized-nature-megakit/Textures/"
names = ["Leaves_TwistedTree_C.png", "Leaves_TwistedTree.png", "Leaves_NormalTree_C.png", "Leaves_NormalTree.png"]
tiles = [Image.open(base + n).convert("RGBA").resize((256, 256)) for n in names]
sheet = Image.new("RGBA", (256 * 4 + 50, 276), (110, 140, 170, 255))
for i, t in enumerate(tiles): sheet.alpha_composite(t, (10 + i * 266, 10))
sheet.save("shots/leaf-variants.png")
for n in names:
    im = Image.open(base + n).convert("RGBA"); px = [p for p in im.resize((64, 64)).getdata() if p[3] > 128]
    avg = tuple(sum(c[i] for c in px) // max(1, len(px)) for i in range(3)); print(n, im.size, "avg opaque rgb", avg)
