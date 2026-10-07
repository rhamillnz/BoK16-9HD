from PIL import Image
import colorsys
src = Image.open("art/incoming/stylized-nature-megakit/Textures/Leaves_TwistedTree_C.png").convert("RGBA")
r, g, b, a = src.split()
hsv = src.convert("RGB").convert("HSV")
h, s, v = hsv.split()
# Red (~0) -> leafy green (~0.24 of the hue circle); keep saturation/value so the painting survives.
h = h.point(lambda x: (x + int(0.24 * 255)) % 256)
s = s.point(lambda x: int(x * 0.85))
out = Image.merge("HSV", (h, s, v)).convert("RGB"); out.putalpha(a)
out.save("art/derived/Leaves_TwistedTree_Green.png")
px = [p for p in out.resize((64, 64)).get_flattened_data() if p[3] > 128]
print("avg", tuple(sum(c[i] for c in px) // len(px) for i in range(3)))
