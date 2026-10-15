"""Writes art/jobs/creatures.json: the humanoid monsters, one job per combat sprite set (BNAMES prefix).

Run with plain Python (python tools/blender/make_creature_jobs.py), then build with build_party.py and the jobs file."""
import json
import os

OUT = 'public/models/creatures/'
SHOT = 'shots/creatures/'
LONG_DARK = [[0, 30], [38, 22], [62, -6], [72, -999], [180, -999]]
HOOD_OPEN = [[0, 22], [40, 12], [62, -30], [74, -999], [180, -999]]
UNARMED = {"idle": "Idle_Loop", "attack": "Punch_Cross", "block": "Hit_Chest"}


def job(name, **kw):
    j = {"name": name, "out": OUT + name + '.glb', "preview": SHOT + name, "tex": 256}
    j.update(kw)
    return j


def hood(color, length=1.42):
    return {"type": "hair", "cloth": True, "color": color, "volume": 0.035, "length": length, "flare": 0.05,
            "hairline": HOOD_OPEN}


jobs = [
    # Moredhel warrior: dark-skinned, long black hair, pointed ears; open leather vest, brown trousers, knee
    # boots (manual p. 72), the sprite's purple cloak and iron shoulder plate; a war axe.
    job("mor", outfit="Male_Ranger", drop=["Head_Hood"], elf_ears=0.035, skin=[0.72, 0.6, 0.58],
        brow_color=[0.05, 0.04, 0.04], brow_scale=0.5,
        tints={"Body": {"color": [0.2, 0.12, 0.06], "target": 0.7}, "Arms": {"color": [0.3, 0.2, 0.12], "target": 0.7},
               "Legs": {"color": [0.26, 0.16, 0.08]}, "Feet": {"color": [0.1, 0.07, 0.05]},
               "Pauldron": {"color": [0.2, 0.2, 0.22]}},
        garments=[{"type": "hair", "color": [0.03, 0.03, 0.04], "tip": [0.06, 0.05, 0.06], "length": 1.42, "volume": 0.016,
                   "hairline": LONG_DARK},
                  {"type": "belt", "color": [0.1, 0.07, 0.05]},
                  {"type": "cape", "color": [0.24, 0.1, 0.3], "hem": 0.45, "ragged": 0.06}],
        weapon={"type": "axe"}),
    # Moredhel spellcaster: the same people in a long purple robe; a staff.
    job("mor_caster", outfit="Male_Peasant", elf_ears=0.035, skin=[0.72, 0.6, 0.58], brow_color=[0.05, 0.04, 0.04],
        brow_scale=0.5, drop=["Legs"],
        tints={"Body": {"color": [0.13, 0.05, 0.17]}, "Arms": {"color": [0.13, 0.05, 0.17]}, "Feet": {"color": [0.1, 0.07, 0.05]}},
        garments=[{"type": "hair", "color": [0.03, 0.03, 0.04], "tip": [0.06, 0.05, 0.06], "length": 1.42, "volume": 0.016,
                   "hairline": LONG_DARK},
                  {"type": "robe", "color": [0.13, 0.05, 0.17], "trim": [0.55, 0.42, 0.15], "hem": 0.03, "flare": [0.3, 0.26], "follow": 0.85},
                  {"type": "belt", "color": [0.1, 0.07, 0.05], "buckle": [0.55, 0.42, 0.15]}],
        weapon={"type": "staff", "wood": [0.25, 0.17, 0.1]}),
    # Nighthawk: assassin, entirely in black (manual p. 72): hood up and a mask to the eyes.
    job("nhk", outfit="Male_Ranger", drop=["Head_Hood", "Pauldron"], brow_color=[0.04, 0.03, 0.03],
        tints={"Body": {"color": [0.03, 0.03, 0.035]}, "Arms": {"color": [0.035, 0.035, 0.04]}, "Legs": {"color": [0.03, 0.03, 0.035]},
               "Feet": {"color": [0.02, 0.02, 0.02]}},
        garments=[hood([0.03, 0.03, 0.035]), {"type": "mask", "color": [0.03, 0.03, 0.035]},
                  {"type": "belt", "color": [0.03, 0.03, 0.03], "scabbard": True, "scabbard_color": [0.02, 0.02, 0.02]}],
        weapon={"type": "sword", "length": 0.72, "blade": [0.35, 0.36, 0.4], "guard": [0.1, 0.1, 0.1]}),
    # Black Slayer: a Nighthawk raised undead: grey dead skin, tattered black, no mask.
    job("bsy", outfit="Male_Ranger", drop=["Head_Hood", "Pauldron"], skin=[0.62, 0.7, 0.62], brow_color=[0.1, 0.1, 0.1],
        tints={"Body": {"color": [0.05, 0.05, 0.05]}, "Arms": {"color": [0.06, 0.06, 0.06]}, "Legs": {"color": [0.05, 0.05, 0.05]},
               "Feet": {"color": [0.03, 0.03, 0.03]}},
        garments=[hood([0.05, 0.05, 0.055]), {"type": "belt", "color": [0.04, 0.04, 0.04]},
                  {"type": "cape", "color": [0.05, 0.05, 0.055], "hem": 0.4, "ragged": 0.12}],
        weapon={"type": "sword", "blade": [0.3, 0.31, 0.33], "guard": [0.12, 0.12, 0.12]}),
    # Rogue: brown coat, pale breeches, black boots; a sword.
    job("rog", outfit="Male_Peasant", brow_color=[0.15, 0.08, 0.04], beard="Hair_Beard", trim="close", beard_color=[0.15, 0.08, 0.04],
        beard_depth=0.35,
        tints={"Body": {"color": [0.2, 0.11, 0.05], "target": 0.45}, "Arms": {"color": [0.2, 0.11, 0.05], "target": 0.45},
               "Legs": {"color": [0.55, 0.52, 0.45]}, "Feet": {"color": [0.03, 0.03, 0.03]}},
        garments=[{"type": "hair", "color": [0.15, 0.08, 0.04], "length": 1.6, "volume": 0.014,
                   "hairline": [[0, 34], [40, 26], [70, 6], [110, 0], [180, -22]]},
                  {"type": "belt", "scabbard": True}],
        weapon={"type": "sword"}),
    # Rogue mage: a rogue in a blue coat with a staff.
    job("rog_mage", outfit="Male_Peasant", brow_color=[0.08, 0.06, 0.05],
        tints={"Body": {"color": [0.07, 0.09, 0.2], "target": 0.45}, "Arms": {"color": [0.07, 0.09, 0.2], "target": 0.45},
               "Legs": {"color": [0.25, 0.22, 0.2]}, "Feet": {"color": [0.03, 0.03, 0.03]}},
        garments=[{"type": "hair", "color": [0.08, 0.06, 0.05], "length": 1.5, "volume": 0.015, "hairline": LONG_DARK},
                  {"type": "belt", "pouch": True}],
        weapon={"type": "staff"}),
    # Quegian pirate: white shirt, red sash from the left shoulder to the right hip, black pantaloons, polished
    # boots (manual p. 73); the sprite's red head scarf; a cutlass-length sword.
    job("que", outfit="Male_Peasant", beard="Hair_Beard", trim="moustache", beard_color=[0.04, 0.03, 0.03], brow_color=[0.04, 0.03, 0.03],
        tints={"Body": {"color": [0.86, 0.84, 0.78]}, "Arms": {"color": [0.86, 0.84, 0.78]}, "Legs": {"color": [0.03, 0.03, 0.035]},
               "Feet": {"color": [0.02, 0.02, 0.02]}},
        garments=[{"type": "hair", "color": [0.04, 0.03, 0.03], "length": 1.52, "volume": 0.013, "hairline": LONG_DARK},
                  {"type": "hair", "cloth": True, "color": [0.6, 0.06, 0.05], "volume": 0.03, "length": 1.8,
                   "hairline": [[0, 18], [60, 8], [100, 0], [180, -6]]},
                  {"type": "baldric", "color": [0.6, 0.06, 0.05], "width": 0.09},
                  {"type": "belt", "color": [0.05, 0.04, 0.03], "scabbard": True}],
        weapon={"type": "sword", "length": 0.72}),
    # Spellweaver: a grey-green hooded robe and a staff.
    job("spl", outfit="Male_Peasant", drop=["Legs"], brow_color=[0.2, 0.18, 0.15],
        tints={"Body": {"color": [0.3, 0.38, 0.34]}, "Arms": {"color": [0.3, 0.38, 0.34]}, "Feet": {"color": [0.1, 0.08, 0.06]}},
        garments=[hood([0.3, 0.38, 0.34]),
                  {"type": "robe", "color": [0.3, 0.38, 0.34], "hem": 0.03, "flare": [0.3, 0.26], "follow": 0.85},
                  {"type": "belt", "color": [0.2, 0.15, 0.1]}],
        weapon={"type": "staff", "wood": [0.3, 0.22, 0.14]}),
    # Pantathian: a snake priest under a black hooded robe, scaled green skin; a staff.
    job("pan", outfit="Male_Peasant", drop=["Legs", "Eyebrows"], skin_texture={"kind": "scales", "color": [0.32, 0.48, 0.26]},
        tints={"Body": {"color": [0.03, 0.03, 0.03]}, "Arms": {"color": [0.03, 0.03, 0.03]}, "Feet": {"color": [0.05, 0.05, 0.04]}},
        garments=[hood([0.03, 0.03, 0.035]),
                  {"type": "robe", "color": [0.03, 0.03, 0.035], "hem": 0.03, "flare": [0.3, 0.26], "follow": 0.85},
                  {"type": "belt", "color": [0.08, 0.06, 0.04]}],
        weapon={"type": "staff", "wood": [0.2, 0.14, 0.08]}),
    # Panth Tiandn: a Pantathian in a dark red robe with a dagger.
    job("pai", outfit="Male_Peasant", drop=["Legs", "Eyebrows"], skin_texture={"kind": "scales", "color": [0.28, 0.42, 0.24]},
        tints={"Body": {"color": [0.14, 0.025, 0.025]}, "Arms": {"color": [0.14, 0.025, 0.025]}, "Feet": {"color": [0.05, 0.05, 0.04]}},
        garments=[hood([0.03, 0.03, 0.035]),
                  {"type": "robe", "color": [0.14, 0.025, 0.025], "hem": 0.03, "flare": [0.3, 0.26], "follow": 0.85},
                  {"type": "belt", "color": [0.08, 0.06, 0.04]}],
        weapon={"type": "dagger"}),
    # Great One (Makala): voluminous black robe over a frail frame, wild white hair and beard (manual p. 66).
    job("mak", outfit="Male_Peasant", drop=["Legs"], hair=["Hair_Long", "Hair_Buzzed"], hair_color=[0.88, 0.88, 0.86],
        beard="Hair_Beard", beard_color=[0.9, 0.9, 0.88], beard_target=1.1, brow_color=[0.85, 0.85, 0.82], skin=[0.95, 0.85, 0.8],
        tints={"Body": {"color": [0.03, 0.03, 0.03]}, "Arms": {"color": [0.03, 0.03, 0.03]}, "Feet": {"color": [0.05, 0.05, 0.05]}},
        garments=[{"type": "robe", "color": [0.03, 0.03, 0.035], "hem": 0.02, "flare": [0.34, 0.3], "follow": 0.85},
                  {"type": "belt", "color": [0.05, 0.05, 0.05], "buckle": [0.4, 0.4, 0.42]}],
        weapon={"type": "staff", "wood": [0.45, 0.32, 0.18]}),
    # Witch Hag: a crone in a deep blue robe with wild dark hair; a mace.
    job("wit", base="Superhero_Female_FullBody", outfit="Female_Peasant", drop=["Legs"], skin=[0.85, 0.82, 0.8],
        brow_color=[0.05, 0.05, 0.06],
        tints={"Body": {"color": [0.04, 0.06, 0.2]}, "Arms": {"color": [0.04, 0.06, 0.2]}, "Feet": {"color": [0.05, 0.04, 0.04]}},
        garments=[{"type": "hair", "color": [0.22, 0.22, 0.24], "tip": [0.55, 0.55, 0.56], "length": 1.3, "volume": 0.024,
                   "flare": 0.08, "wave": 0.02, "hairline": LONG_DARK},
                  {"type": "robe", "color": [0.04, 0.06, 0.2], "hem": 0.03, "flare": [0.3, 0.26], "follow": 0.85},
                  {"type": "belt", "color": [0.1, 0.07, 0.05]}],
        weapon={"type": "mace"}),
    # Rusalki: the ghost of a drowned girl, semi-transparent, weed trailing from her arms (manual p. 73).
    job("rus", base="Superhero_Female_FullBody", outfit="Female_Peasant", drop=["Legs"], alpha=0.55, skin=[0.75, 0.85, 0.95],
        brow_color=[0.1, 0.15, 0.18], clips=UNARMED,
        tints={"Body": {"color": [0.45, 0.62, 0.78]}, "Arms": {"color": [0.6, 0.72, 0.82]}, "Feet": {"color": [0.5, 0.6, 0.7]}},
        garments=[{"type": "hair", "color": [0.1, 0.16, 0.2], "tip": [0.2, 0.3, 0.32], "length": 1.15, "volume": 0.02,
                   "flare": 0.05, "wave": 0.015, "hairline": LONG_DARK},
                  {"type": "robe", "color": [0.45, 0.62, 0.78], "hem": 0.0, "flare": [0.28, 0.24], "follow": 0.85, "ragged": 0.04},
                  {"type": "seaweed"}]),
    # Shade: a grey, ragged, half-seen spirit from a dug-up grave.
    job("sha", outfit="Male_Peasant", drop=["Legs"], alpha=0.6, skin=[0.6, 0.65, 0.65], brow_color=[0.3, 0.3, 0.3], clips=UNARMED,
        tints={"Body": {"color": [0.32, 0.34, 0.33]}, "Arms": {"color": [0.32, 0.34, 0.33]}, "Feet": {"color": [0.2, 0.2, 0.2]}},
        garments=[hood([0.3, 0.32, 0.31]),
                  {"type": "robe", "color": [0.32, 0.34, 0.33], "hem": 0.05, "flare": [0.3, 0.26], "follow": 0.85, "ragged": 0.1}]),
    # Goblin: a stocky, shorter human-like warrior in green with a flail (the sprite).
    job("gob", outfit="Male_Peasant", scale=0.88, skin=[0.85, 0.82, 0.7], brow_color=[0.05, 0.04, 0.03],
        tints={"Body": {"color": [0.09, 0.18, 0.07], "target": 0.45}, "Arms": {"color": [0.09, 0.18, 0.07], "target": 0.45},
               "Legs": {"color": [0.24, 0.06, 0.05]}, "Feet": {"color": [0.08, 0.06, 0.04]}},
        garments=[{"type": "hair", "color": [0.05, 0.04, 0.03], "length": 1.55, "volume": 0.016, "hairline": LONG_DARK},
                  {"type": "belt"}],
        weapon={"type": "flail"}),
    # Ogre: tall and gaunt, bald, in a ragged loincloth; a club.
    job("ogr", outfit=None, scale=1.15, skin=[0.85, 0.78, 0.72], brow_color=[0.2, 0.15, 0.1],
        proportions={"upperarm_l": [1, 1.08, 1], "upperarm_r": [1, 1.08, 1], "spine_03": [0.95, 1, 0.95]},
        garments=[{"type": "loincloth", "color": [0.3, 0.22, 0.13], "ragged": 0.06}, {"type": "belt", "color": [0.12, 0.08, 0.05]}],
        weapon={"type": "club", "length": 0.75}),
    # Troll: short and broad with arms to the ground, thick grey hide and long fangs (manual p. 74); a spear.
    job("tro", outfit=None, skin_texture={"kind": "hide", "color": [0.42, 0.45, 0.43]}, brow_color=[0.15, 0.15, 0.15],
        proportions={"upperarm_l": [1.15, 1.25, 1.15], "upperarm_r": [1.15, 1.25, 1.15], "thigh_l": [1.1, 0.88, 1.1],
                     "thigh_r": [1.1, 0.88, 1.1], "spine_02": [1.15, 1, 1.15], "spine_03": [1.12, 1, 1.12]},
        garments=[{"type": "hair", "color": [0.2, 0.2, 0.2], "tip": [0.32, 0.32, 0.3], "length": 1.45, "volume": 0.02,
                   "wave": 0.015, "hairline": LONG_DARK},
                  {"type": "fangs"}, {"type": "loincloth", "color": [0.25, 0.2, 0.15], "ragged": 0.06}],
        weapon={"type": "spear"}),
    # Tor Giant: about ten feet tall, bearded and long-haired, in a fur loincloth (manual p. 74); a club.
    job("gnt", outfit=None, scale=1.8, skin=[1.0, 0.88, 0.78], hair=["Hair_Long", "Hair_Buzzed"], hair_color=[0.12, 0.07, 0.04],
        beard="Hair_Beard", beard_color=[0.12, 0.07, 0.04], brow_color=[0.12, 0.07, 0.04],
        proportions={"spine_03": [1.08, 1, 1.08], "upperarm_l": [1.1, 1, 1.1], "upperarm_r": [1.1, 1, 1.1]},
        garments=[{"type": "loincloth", "color": [0.42, 0.32, 0.2], "ragged": 0.07}, {"type": "belt", "color": [0.15, 0.1, 0.06]}],
        weapon={"type": "club"}),
    # Brak-Nurr: a broad eyeless hulk of crumbled stone flecked with gold (manual p. 74); unarmed.
    job("brk", outfit=None, scale=1.08, drop=["Eyes", "Eyebrows"], clips=UNARMED,
        skin_texture={"kind": "stone", "color": [0.5, 0.47, 0.42], "roughness": 0.95},
        proportions={"spine_02": [1.25, 1, 1.2], "spine_03": [1.3, 1, 1.2], "upperarm_l": [1.3, 1.05, 1.3], "upperarm_r": [1.3, 1.05, 1.3],
                     "thigh_l": [1.25, 0.95, 1.25], "thigh_r": [1.25, 0.95, 1.25], "neck_01": [1.3, 0.8, 1.3]}),
]
# Floor-length robes hide the feet: drop them so boots never poke through the hem.
for j in jobs:
    if any(g.get("type") == "robe" for g in j.get("garments", [])):
        j["drop"] = sorted(set(j.get("drop", []) + ["Feet"]))
json.dump(jobs, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art', 'jobs', 'creatures.json'), 'w'), indent=1)
print(len(jobs), [j['name'] for j in jobs])
