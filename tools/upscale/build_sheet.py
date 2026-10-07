from PIL import Image
names = ["house", "house1", "blcksmth"]
tiles = [Image.open(f"shots/build-{n}.png").convert("RGBA") for n in names]
sheet = Image.new("RGBA", (sum(t.width for t in tiles), max(t.height for t in tiles)), (110, 140, 170, 255)); x = 0
for t in tiles: sheet.alpha_composite(t, (x, 0)); x += t.width
sheet.save("shots/build-sheet.png")
