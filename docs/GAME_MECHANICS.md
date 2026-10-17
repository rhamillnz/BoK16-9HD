# Game mechanics (from the original manual)

Notes taken from the original *Betrayal at Krondor* manual (Dynamix, 1993; 88 pages). The manual is
copyrighted, so this is a paraphrased reference, not a copy: every rule, number and description is
here, in our own words, with page numbers so the source can be checked. Use it with the code and the
data files as the guide to how the game should play and tell its story.

Numbers quoted from the manual's screenshots are illustrative. They show what the original UI
displayed at one moment, not constants to copy; the game data is the authority when the two differ.

The last two sections compare the manual with this remake. **What the manual told us that we did not
know** lists the new facts. **Manual vs the remake** gives a status for each rule (audited against
`src/` on 2026-10-15).

---

## The book structure (pp. 8–10, 14)

- The game is told as a book in **nine chapters**, each with a short-term goal. A non-interactive
  cinematic opens and closes each chapter. Play inside a chapter is non-linear and has no time limit.
- The cast changes by chapter: party members leave, join and come back. Each chapter has its own set
  of characters and monsters. Returning to a region in a later chapter (the manual's example is the
  Dimwood in Chapter Two) finds **different monsters** there.
- Early on, the designers expect the player to roam, fight and loot to prepare for the harder
  opponents further south towards Krondor.
- The Contents page (Options) replays the chapter cinematics. It offers only the chapters finished in
  the saves in the current directory. Chapter titles, from the Contents screenshot:
  1. Into a Dark Night
  2. Shadow of the Nighthawks
  3. The Spyglass and the Spider
  4. Marked for Death
  5. When Rivers Run Blood
  6. Betrayal
  7. The Long Ride
  8. Of Lands Afar
  9. Mad Gods Rage
  10. Epilogue
- The designers' aims: characters with several sides who stir the player's emotions; a carefully
  plotted story with surprises, humour and pathos, mystery and foreshadowing; an on-screen map at all
  times for a sense of place.

## Controls and menus (pp. 11–14, 22)

- Point and click. Left button: act, use, take. Right button: examine or read, and online help on
  most controls. Space or either button skips an animation or turns a dialogue "page".
- Main menu: Start New Game, Restore Game, Preferences, Contents, Quit.
- Saves live in **directories**: games are listed under the highlighted directory. Typing a new
  directory name creates one (DOS 8.3 rules). There are buttons to remove a directory with all its
  games, or a single game.
- **Bookmark** is a one-click quick save, always to the slot named "Bookmark" in the current
  directory, overwriting the last one. It shows only once a directory has been chosen.
- Preferences:
  - Step size (small, medium or large). It changes only how smooth movement looks: the same journey
    takes the same game time.
  - Turn size.
  - Text speed: Wait (pages wait for a key), Medium, Fast.
  - Toggles for sound, music, combat music, CD music and the intro.
  - Detail level: Minimum, Low, High, Maximum. It controls the number and size of trees, the horizon,
    textured mountains, floor and ceiling textures, and object filtering.

## Travel screen (pp. 15–22)

- Layout: the 3D view on top; below it up to **three character globes**, the movement icon (with a
  compass) and six action buttons: Follow Road, Cast, Encamp, Map, Bookmark, Options. Spell glyphs
  along the top of the view show which spells are active.
- **Movement:** hold forward or back to keep moving. Close-set hills and mountains can block a gap
  that looks passable; bumping into a mountain's foot turns the party aside. The overhead map is the
  easier way through tight spots.
- **Follow Road:**
  - Available only when standing in the **centre** of a road; the button shows a road receding into
    the distance.
  - While it is on, holding forward follows the road, and the party turns itself to stay on it.
  - It stops at forks and T junctions; turn, then carry on.
  - The party cannot leave the road while it is on.
- **Cast (outside combat):**
  - Opens the spell screen: a circle split by up to four magical symbols into segments, with one
    glyph per known spell, and spell groups chosen by buttons along the bottom.
  - Hovering a glyph shows its description.
  - For a variable-strength spell, the gemstones round the circle light up: the number lit is the
    Health/Stamina the caster will spend. Click a gem to set the power and cast. Stronger casting
    weakens the caster more.
  - With several magicians in the party, clicking a globe picks the caster (outside combat only).
- **Encamp:**
  - A sundial of gemstones: the upper half is day, the lower half night, and the shadow marks the
    hour. Click a stone to sleep until that hour; Stop interrupts.
  - **Camp Until Healed** rests until everyone is whole or Stop is pressed. A panel lists each
    character's Health+Stamina and rations, with injured values in red.
  - **Sleeping in the wild restores only about 80%** of potential Health/Stamina. The number turns
    from red to black when that ceiling is reached.
  - Names of characters with a condition (sick, drunk, plagued, poisoned...) show in red.
  - **Camping is impossible with enemies nearby.**
  - Travelling at night needs a torch or a light spell; the advice is to camp at night.
  - Example from the screenshot: Locklear 39 of 100, Owyn 75 of 85, Gorath 125 of 125, rations 6, 11
    and 5.
- **Map:**
  - Shows the party's surroundings with the party as a triangle in the centre. Buttons: Follow Road,
    Full Map, Zoom In, Zoom Out, Encamp, Main.
  - The party can move on the map view. It is fast, especially zoomed in, but the party then misses
    things beside the road and walks into enemies without seeing them.
  - **N** toggles between north-up and a map that turns with the party.
  - **Underground (dungeons, mines, sewers) the map starts dark** and is revealed as the party
    explores.
  - **Full Map:** the kingdom's main roads, cities and towns. Cities are white points and towns are
    brown points; hovering a point shows its name. A flashing marker shows the party's position and
    heading. Exit returns to the local map.

## Talking (p. 23)

- Some conversations start by themselves. Otherwise the cursor becomes "TALK" over a person.
- After an opening exchange, some people offer **keyword buttons**. Asking about keywords opens new
  keywords, with that person or with others: the more the party knows, the more it can learn.

## Ratings and skills (pp. 24–31)

- Right-click a globe for the character sheet: ratings at the top, skills as sword bars at the bottom
  with the number above each bar. A skill shown in red has changed since the sheet was last viewed.
- The portrait cycles through the party on a left click. A right click shows the character's
  background.
- **Practice focus:** clicking a skill's sword handle selects it. Skills improve only through use;
  selected skills improve faster, and the **fewer selected, the bigger the boost**. With none
  selected, skills still improve slowly.
- Every rating and skill has a **potential** value and a **current** value. Rest brings the current
  value back up to the potential.
- Potions and items can raise current values above potential **for one combat only**.
- Potential ratings are very hard to raise: they have no upper limit and grow very slowly. Skills run
  from 0 to 100, rise by a fraction with each successful use, and rise more slowly as they near 100.
- Example sheet (Locklear):

  | Rating or skill | Value |
  |---|---|
  | Health | 55 of 55 |
  | Stamina | 45 of 45 |
  | Speed | 4 |
  | Strength | 17 |
  | Defense | 48% |
  | Crossbow accuracy | 58% |
  | Melee accuracy | 53% |
  | Casting accuracy | N/A |
  | Assessment | 44% |
  | Armorcraft | 45% |
  | Weaponcraft | 45% |
  | Barding | 33% |
  | Haggling | 37% |
  | Lockpick | 25% |
  | Scouting | 33% |
  | Stealth | 23% |

  The in-combat panel for Owyn shows Health 25, "Endurance" 20, Speed 5, Strength 12. "Endurance" is
  the combat panel's word for Stamina.

### Ratings (pp. 26–27)

- **Health and Stamina** together make up physical condition.
  - **Damage comes off Stamina first.** Once Stamina reaches 0, it comes off Health. At Health 0 the
    character is critically injured (down).
  - **Current Health as a share of potential Health scales every other rating and skill by the same
    share.** The manual's example:
    - A character has Health 35 and Stamina 10.
    - A 10-point hit leaves Health 35 and Stamina 0, and nothing else changes.
    - A second 10-point hit leaves Health 25, which is 71% of potential.
    - Every other current value drops to 71%: Speed 5 becomes 4.
  - Healing (rest or a restorative) **refills Health first, then Stamina**.
- **Strength** sets melee damage and falls when Health falls. It improves slowly with each
  successful sword or staff strike. "Strength boosters" raise it for one combat only. A sidebar hints
  that legends tell of faster ways to raise potential Strength.
- **Speed** is the number of grid steps a character can take in a combat turn. **Potential Speed
  never changes.**

### Skills (pp. 27–31)

- **Defense (%):**
  - Part of the calculation of how much Health/Stamina a successful enemy hit removes. It stands for
    ducking and dodging the full force of a blow.
  - A high Defense also makes enemies miss more often.
- **Crossbow accuracy (%):**
  - The chance to hit a target **two steps away** with a normal quarrel.
  - Accuracy falls further off and varies with the load (some quarrels are more accurate).
- **Melee accuracy:** the hit chance with sword or staff, modified by the weapon's weight and class.
- **Casting accuracy:** used only by spells that need line of sight, so it is affected by distance.
- **Assessment:** how much the Assess combat option reveals: speed, a limp, favouring one side. It is
  shown through the opponent's ratings, and more skill reveals more.
- **Weaponcraft:**
  - Dragging a whetstone onto a sword repairs it.
  - A sword's condition (shown beside it in the inventory) drops slightly with each use in combat.
  - Repair works only **if the sword has not been repaired recently**, and higher skill restores
    more. A neglected blade becomes "a worthless piece of metal".
- **Armorcraft:**
  - Dragging an armorer's hammer onto armour repairs it.
  - Armour condition (100% is perfect) drops slightly **each time the wearer is hit**.
  - A repair restores **a percentage of the lost condition equal to the Armorcraft skill**, and only
    if the armour has not been repaired recently.
- **Barding:**
  - Earns gold in taverns: click the lute ("BARD").
  - The reward and the skill needed vary by tavern. Bigger cities pay more but are more discerning and
    **may throw a poor player out**.
  - A **practice lute** (Use from the inventory) raises the skill.
- **Haggling:**
  - Prices differ from shop to shop at the shopkeeper's whim, and are generally better in larger
    towns.
  - When buying: Accept, Decline or Haggle. **Not all shopkeepers haggle.** Success depends on the
    buyer's Haggling skill.
  - A failed haggle **may anger the shopkeeper into refusing to sell that item at all**.
- **Lockpicking:** picks locks and also **disarms traps**.
- **Scouting:**
  - The party member with the highest Scouting is automatically the scout. They detect ambushes ahead
    and warn the party.
  - The player can then go on regardless, or turn back and go round.
- **Stealth:**
  - Sneaking past a detected ambush depends on the **worst** party member's Stealth.
  - The same worst-member Stealth decides whether the party can catch an enemy off guard for the
    initiative.

### Conditions (p. 25)

- Sick, drunk, poisoned and plagued (among others).
- Some wear off with long rest; others need a temple.
- **Sickness is cured only by resting for an extended period.**
- **Poison hurts much more in combat than while travelling** (p. 51).
- A drunk character shoots a crossbow much worse (p. 50).

## Fairy chests (pp. 32–33)

- Locked "fairy chests" turn up in fields. Folk belief says they hold things lost by people who
  displeased Banath (the god of thieves). In truth they are **Moredhel message drops**, because
  kingdom couriers will not go past Inclindel Pass or Cutter's Gap. In peacetime they hold only
  messages and mercenaries' scribbles; in war they carry weapons, dispatches, poisons and the like.
- **Wordlocks:** rings of cylinders with letters of the Moredhel alphabet. Click a letter to turn its
  ring; spelling the right word springs the catches.
- Most have a **clue plate**: a riddle in Moredhel for forgetful couriers.
  - The manual's example riddle has Prince Arutha finding the Moredhel troops, his men falling, and
    his castle falling too. It asks what Arutha will then do; the answer is DIE.
  - **Someone in the party must read Moredhel to read the plate.**
- A few scholars can point travellers to where the chests are.

## Inventory (pp. 34–38)

- Click a globe to open the inventory: carried items on the right, equipped on the left.
- Right-click an item to describe it. **More Info** on weapons and armour shows:
  - **Base Dmg:** swing and thrust for swords, including the character's Strength. A crossbow's
    damage is the quarrel's damage plus or minus the crossbow's.
  - **Accuracy:** each melee weapon modifies Melee accuracy, for swing and thrust separately. A
    crossbow's accuracy is the crossbow's value plus or minus the quarrel's.
  - **Armor Mod:** the percentage of base damage the armour deflects.
  - **Active Mods:** current combat modifiers on the weapon. They are not included in the base damage
    shown.
  - **Resistances:** armour can be made resistant to any active mod (for example Flame) by
    substances found or bought.
  - **Bless Type:** shown if the item is blessed.
  - **Racial Mod:** gear made for one race works less well for another. It shows the race the item
    was made for.
- A crossbow and armour sit in frames that stay empty until something is equipped.
- **Fighters must always have a sword and magicians a staff.**
- Items are traded by dragging onto another character's globe.
- **Keys:**
  - Kept on a shared key ring with a count for each. Like money, they take no inventory space.
  - They **cannot be dropped**, and **can break in the wrong lock**.
- **Bags:**
  - Drag an item onto the bag icon (it replaces the key ring while an item is held) to **drop it in a
    bag on the ground** and come back for it later.
  - A bag left **in an open field or near a town will probably be emptied** by passers-by. The safe
    stash is inside a locked box or chest.
- **Picking up:**
  - Bodies, holes in the ground and bags open at a click. Boxes and chests do too, unless locked.
  - Drag items from the container's view onto a globe.
- **Transfer:**
  - Click a globe to view or swap equipment, or to give items.
  - In combat, the giver must **stand next to** the receiver.
  - **Opening the inventory in combat uses that character's turn**, even if nothing is used.
  - Splitting a stack opens a count picker with "share with party".
- **Use:** select an item and click Use, or double-click it. Some items are dragged onto others: a
  whetstone onto a sword, naphtha onto a blade, a bowstring onto a crossbow.
- **Locks:**
  - The Lock screen shows the lock and the party's pooled keys and picklocks. The best lockpicker is
    preselected, and another can be chosen.
  - Right-click the lock or a key for a description.
  - The wrong key may break. Picks can break too, especially with low skill on a hard lock.
- **Scent of Sarig** lets magicians detect **booby-trapped boxes and chests**. Choosing to disarm one
  automatically picks the best lockpicker (sidebar, p. 38).
- **Eating:**
  - Each character eats **one ration a day, at the end of the day**.
  - Seven rations last a week; after that, hunger costs Health/Stamina.
  - **Rations given to a starving character are eaten at once.**

### Item notes (pp. 39–41)

- **Broadsword:** a heavy hacking blade. It hurts but is not very accurate, and is poor at thrusts.
- **Medium crossbow:** the standard archer's weapon; fairly accurate and powerful.
- **Bowstring:** replaces a broken string on a light or medium crossbow (not the heavy). Drop it onto
  the crossbow.
- **Silverthorn:** silver thorns on a rose-like stem with fat red berries. A deadly but detectable
  poison, good for coating weapons; each berry treats a weapon once.
- **Naphtha:** applied to a blade, it causes heavy flame damage.
- **Lightning Staff:** an ancient tool that casts a bolt of lightning **without costing the caster
  Health or Stamina**.
- **Glory Hand:**
  - The dried hand of a thief hanged at midnight.
  - With the **Nightfingers** spell it steals almost any item from a combat opponent, then crumbles
    to dust.
- **Infinity Pool:** looks like a pendant on a leather cord (a small glass globe full of scarlet
  points of light). It **magnifies combat spells**.
- **Bessy Mauler:** the heaviest and strongest crossbow, able to dent the toughest armour, but less
  accurate.
- **Elven quarrel:** very accurate and long-ranged, best of all with an Elven crossbow.
- **Moredhel Lamprey:** the Moredhel raiders' favourite blade. Its edge is a row of small blades for
  sawing and slicing.
- **Galon Griefmaker:** an elven blade balanced between weight and accuracy. Very accurate, good for
  hacking or stabbing but best swung, with small sawing teeth (the Lamprey's ancestor).
- **Torch:** works indoors and out.
- **Picklocks:** fine silver tools; they open nearly any lock, depending on skill.
- **Herbal pack:** alum and healer's alcohol against infection; it **doubles a character's healing
  rate**.
- **Whetstone** and **Armorer's hammer:** the repair tools for Weaponcraft and Armorcraft.
- **Weedwalkers:** green magic slippers worn in the shoes. They greatly raise Stealth.
- **Rations:** wrapped packages of food, one a day. A pack lasts 1 to 14 days.
- **Restoratives:** small vials of green liquid that restore Health/Stamina to the injured or ill.

## Combat (pp. 42–51)

- **How fights start:**
  - Most come while exploring.
  - **Digging up a grave can start a fight with "shades"** (deadly spirits).
- **Initiative:**
  - Clicking an enemy when it is first spotted tries for the initiative, with odds from the **worst
    Stealth** in the party. The party must then rush straight in to keep it.
  - **Enemies can ambush the party** and take the initiative themselves.
  - With no initiative either way, **turn order follows Speed**.
- **The grid:**
  - The field is a grid of one step per square; **G** shows or hides it.
  - Speed is the number of steps per turn. A green highlight marks a reachable free square.
- **Turns:**
  - Turn-based with no time limit. Only the active character's globe shows, and a square highlight
    marks their feet.
- **Thrust:**
  - Allowed on any enemy the character can reach this turn, and the attacker moves into place. The
    cursor turns yellow.
  - A box shows the hit chance and base damage.
- **Swing (right click):**
  - Only when **already lined up horizontally or vertically and no more than one step away**.
  - Swinging **costs Stamina** (not Health).
  - The box compares swing and thrust accuracy and damage.
  - **A successful swing generally does more damage than a thrust.**
- **Strategy tip:** an enemy can swing only when close enough. Moving next to one, including by
  thrusting, exposes the character to a swing next turn, so it is better to wait a step away and let
  the enemy come.
- **Traps:**
  - Magical traps are always built with a way out.
  - Lore speaks of dangerous crystals, "lines that must not be broken", and floating keys (crystal or
    solid) that allow escape.
  - Often one character only has to pass through or past the trap.
  - Movement is in straight lines; going round an obstacle can pick the wrong side.
  - **R** rests the current character and cycles to the next.
  - **No retreat and no auto-combat while trapped.**
- **Fire crossbow:**
  - Needs a crossbow and quarrels, and the shooter must be **at least one step from the nearest
    enemy**.
  - The last load used stays selected; a More button cycles the quarrel types.
  - Aim at the target's feet. **The shooter needs a clear line of sight**: a character or object in
    between blocks the shot.
  - **Wild shots can hit nearby party members.**
  - Damage depends on the crossbow's type and condition and on the quarrel.
  - Example box: an Elven quarrel at 55% accuracy for 30 damage.
- **Spellcasting in combat:**
  - The caster must be **at least one step from the nearest enemy**.
  - The marble spell screen shows a circle of **30 gemstones**.
  - After choosing a spell, the player picks a target on the field. Cast, then Exit, cancels.
  - Some spells need line of sight.
  - Right-click a caster and choose Spells to list what they know.
  - Some spells need an item (Nightfingers needs a Glory Hand).
- **Retreat:**
  - **Not always successful.** It is impossible in some magic traps.
  - **The party refuses to leave if anyone is down.**
  - A successful retreat falls back some distance.
  - Win or fail, the attempt uses the turn.
  - Enemies who flee take their loot with them, which matters early when loot pays the bills.
- **Defend:**
  - A defensive stance for one turn that raises the chance to parry.
  - **A successful parry can leave the attacker open, and the character's next attack is a little
    stronger** (p. 50).
- **Assess:** uses a turn and reveals information in proportion to Assessment.
- **Rest (in combat):** regains Health/Stamina, but **the character is more likely to be hurt if
  attacked**.
- **Auto-combat:** the party fights on its own; Exit takes back control.
- **Death and dying:**
  - Fallen characters can be **revived after the fight by the survivors**. They come back very weak
    and recover much more slowly than from ordinary wounds; a temple **Cure** helps.
  - **If everyone falls, the game ends** and returns to the Options page.
- **Weapon factors (p. 48):** accuracy and damage depend on:
  - the character's condition (injury and sickness reduce coordination)
  - the weapon's condition (as a percentage)
  - the weapon's class (a human fights worse with a Moredhel sword, and the reverse)
  - temple blessing
  - Strength combined with the weapon's damage.

  The damage shown is base damage, before the target's Defense and armour.
- **Enhancements (p. 49):**

  | Enhancement | Icon on the sword | Effect on the target |
  |---|---|---|
  | Poisoned | green drop | green flash |
  | Flaming | flame | red sparks |
  | Frosted | snowflake | blue sparkle |
  | Clerical 1 | cross | white glow |
  | Clerical 2 | cross | blue glow |

  Items and potions can make armour resist these.
- **Enemy behaviour (p. 51):**
  - Some enemies attack recklessly. Others are cautious and **stop to rest** before rejoining.
  - **Patrols retreat once hurt**, but guards of a strategic pass hold.
  - **Killing or routing the leader makes the rest likelier to retreat.**
  - Parties mix a leader, archers and spellcasters. **Enemy casters heal their allies.**
  - Almost every enemy has a weakness to find and exploit. Many have resistances, for example **giant
    spiders resist some poisons**, since they make poison themselves.

## Magic (pp. 52–55)

- **Lesser Path:** the old native human magic of shamans, medicine men, witches and warlocks. It is a
  talent, practised ritually. Its users are often distrusted and solitary, except at the Academy.
- **Greater Path:** brought from Kelewan and associated with scholarship.
- **Pug proved the two can be combined** and teaches both at Stardock.
- A magician needs a **focus**. Priests focus through prayer; magicians use their bodies, devices,
  books or scrolls.
- **Spells are learned from other characters or from scrolls** (Use a scroll and it is consumed).

| Spell | Effect (paraphrased) |
|---|---|
| Flamecast | Combat only. A ball of flame from caster to target that **damages everyone within two steps of the target** if it hits. |
| Skyfire | Lightning from above, **only on a target with metal on them** (armour, helmet, sword...). |
| Hocho's Haven | A wall of energy that **blocks all damage until its limit is used up**. |
| Gift of Sung | **On any party member except the caster**: transfers health one-for-one from the caster; the target **cannot go above full health**. |
| Grief of a Thousand Nights | **Sentient targets only**: the target sinks into sorrow and **stays in place** until it breaks or wears off. |
| Stardusk | Night vision: the scene looks like day. **Outdoors only.** |
| River Song | **Summons a Rusalki** who fights for the party and returns to her element afterwards. |
| Invitation | **Draws enemies into close range**, good against archers and casters. |
| The Unfortunate Flux | The target sweats an amber liquid; **elemental sprites appear and devour it and the target**. |
| Final Rest | **Cast on a dead Nighthawk or Black Slayer**: Lims-Kragma's blessing lets the dead pass on. Otherwise, **with Black Slayers near, dead Nighthawks rise as Black Slayers**. |
| Nightfingers | **Needs a Glory Hand**: steals an item from a combat opponent. |
| Scent of Sarig | Detects booby-trapped boxes and chests. |

## Places (pp. 56–63)

- **Entering:**
  - Click a house to try to enter.
  - Nearing a large city asks whether to enter. Entering follows the nearest road in on the map, then
    shows the town as a picture with hotspots: TAVERN, BUY/SELL, EXIT, REPAIR, and a magnifier to
    examine things.
  - Some shops have a **repair counter** that mends weapons or armour for a fee.
- **Money:** gold sovereigns and silver royals, **10 royals to the sovereign**.
- **Selling:**
  - Drag an item to the shop icon to get an offer. **Damaged items fetch less.**
  - **Fancy shells and gems sell well in shops that deal in them**; note where those shops are.
- **Shop screenshot prices** (illustrative):

  | Item | Price |
  |---|---|
  | Broadsword (100%) | 13 gold 2 silver |
  | Light crossbow | 55 gold |
  | Tsurani light crossbow | 330 gold |
  | Elven crossbow | 797 gold 5 silver |
  | 25 quarrels | 13 gold 2 silver |
  | 25 Elven quarrels | 192 gold 5 silver |

  A haggle prompt quotes "55 sovereigns".
- **Temples:**
  - **Teleport:** most temples have a pattern on one wall that the party memorises on entering. Click
    it to see the map with the known temples, each with a name and a fee. Example: Temple of Sung to
    Temple of Ishap, 56 sovereigns.
  - **Enter** the cloisters to Talk, to **Bless** armour and bladed weapons, or for a **Cure**.
  - A Cure removes conditions (poison, plague) but **does not restore Health/Stamina**. A character
    who is only injured cannot be cured.
- **Krondor:** capital of the Western Realm on the Bitter Sea, once a Keshian trading post in
  Bosania. Seized by Guy du Bas-Tyra for mad King Rodric during the Riftwar, it is now ruled by Prince
  Arutha and Princess Anita.
  - **The palace** was built as a fortress against attack by land and sea, yet welcomes foreign
    visitors. It holds the royal quarters, a throne room, a banquet hall, a newly redone gymnasium,
    and a small shrine to each of Midkemia's gods.
  - **The sewers** ("Thieves' Highway") run for miles and belong to the Mockers under the Upright
    Man.
- **Sarth:**
  - A former fortress behind tall iron-banded gates and a wall about twelve feet high: an ancient
    tower with a later one-storey keep and two outbuildings.
  - Kept by the Brothers of Ishap, who serve the god of Knowledge; people come with questions nothing
    else can answer. A Keshian robber-baron held it once until the peasants killed him.
  - **The vaults** lie below: over a thousand chambers of shelved books, from the hilltop down, tended
    by Brother Anthony and Brother Marc.
- **Romney:**
  - A meeting place more than a town: hawkers, carts and tents, a carnival air.
  - **The Black Sheep Tavern** is a two-storey, L-shaped inn (an extension added to the original
    building).
  - **Fletcher's Post** has a sly elven owner who sells exotic archery goods, especially elven
    arrows, and **teaches a few elven spells for gold**.
  - **The Stardock Annex** is a tiny shop for visiting magicians in former sleeping quarters. It sells
    Rings of Prandur, healing salves and scrolls.
- **Highcastle:** overrun by the Moredhel in the Great Rising and since strengthened by Arutha. A
  frontier fort town guarding **Cutter's Gap**.
- **Sar-Isbandia (Armengar):**
  - Burnt during Murmandamus' march. The Moredhel have only lately come back to claim it.
  - Scavengers camp in tents and in the burnt ruins, and **smoke still drifts from a hole where the
    keep stood**.
- **Temple of Eortis:** on an island off Silden, from when it was a fishing village.
  - White marble columns about thirty feet tall carry a heavy ornamented roof with **dolphin heads**
    jutting from it.
  - A High Priestess of Eortis keeps it.
- **Sethanon:** a former minor barony, never well defended, ruined in the battle. Weed-grown, a ghost
  town with signs of the fighting. **King Lyam ordered it abandoned as a memorial.**
- **Lifestone Crater:** left by the Lifestone's eruption at the end of the Great Rising. It looks
  like a huge lava flow, and **its mouth glows**.

## People and creatures (pp. 64–74)

Appearance notes are kept in detail because they drive the 3D models. The manual shows each one in a
staged costume photograph.

- **Seigneur James:**
  - Once Jimmy the Hand. Son of the Upright Man, though he does not know it.
  - Raised to the nobility by Arutha. He took the rank reluctantly and still prowls his old haunts in
    disguise. Utterly loyal to Arutha.
  - A cynical look crosses his face before anything new; a mischievous rogue's air.
  - Photo: dark hair, a dark tunic with a strap over the shoulder.
- **Seigneur Locklear:**
  - Youngest son of the Baron of Land's End and Jimmy's friend since boyhood.
  - Razor-sharp mind; slower than Jimmy, yet usually beats him in **rapier** duels through shrewd
    tactics. One of the finest swordsmen in Midkemia.
  - A year-round tan from holidays at Land's End.
  - Photo: shoulder-length hair, moustache, plain steel breastplate over dark sleeves, rapier.
- **Owyn Beleforte:**
  - Son of a minor noble of the Eastern Kingdom, spared most court intrigue. His father pushed him
    into court duties despite his early magic. Older brothers Neville and Robert.
  - **Extremely thin**, with innocent blue eyes that make him look younger than he is. A formidable
    magician who looks like his idol, Pug.
  - Photo: fair hair, a pale tunic with a dark V-shaped collar band.
- **Gorath:**
  - Looks as menacing as Owyn looks innocent: haunted, **wolfish eyes**.
  - **A long scar, mostly hidden by his hairline, runs down the left side of his face from temple to
    cheek.**
  - **Son of a Moredhel father and a human mother**: hence a beard, which pure elves and Moredhel
    cannot grow, but with **lobeless pointed ears**.
  - Photo: ornate plate armour.
- **Makala:**
  - A Tsurani Great One of the Assembly who studies the Riftwar and spends long hours with Pug.
  - Intense and clever. He always wears a **voluminous black robe** that hides his frail frame.
  - Photo: an old man with a large white beard and wild white hair, holding a staff.
- **Pug:**
  - Orphan kitchen boy of Crydee and apprentice to Kulgan; a Tsurani slave who became a Great One.
  - Helped end the Riftwar with Macros. Adopted into the royal family, he founded the Academy at
    Stardock.
  - Friendly, and the unchallenged master of magic.
  - Children: Gamina (adopted, telepathic) and William.
- **Patrus:**
  - Taught apprentices before Stardock existed and now has none, which bothers him. Too proud to ask
    for a post at the Academy, he studies books borrowed from Sarth in the towers of **Northwarden**.
  - Seems scatterbrained but is among the most capable magicians.
  - **Wrinkled face, very expressive; balding with white wisps at the sides; a haze of beard on a
    pointed chin.** A slight hunch, yet spry and keeps up.
- **Delekhan:**
  - Leader of the Northern Nations, once one of Murmandamus' field generals.
  - Rose by bullying the clans after their defeat. Claims Murmandamus is held captive by the Kingdom.
  - Hired a band of mercenary magicians his advisers call **"The Six"**.
  - Always in battle gear; legendary temper; **hates Gorath of the Ardanien**, his chief rival for the
    throne in Sar-Sargoth.
  - Photo: scale armour with a high collar and a horned headpiece.
- **Brother Marc:**
  - An Ishapian researcher at Sarth with a knack for obscure facts, from Kelewan birds to old Keshian
    chess. Friendly smile, gentle eyes.
  - Photo: young, with a light tabard over a dark robe, holding a book.
- **Dubal An Loch:**
  - A cantankerous dwarf, a fixture at the **Blue Wheel Inn in LaMut**. Smokes a herbal pipe for hours
    while telling war stories.
  - His **left eye is scarred above and below and clouded white**; he claims he still sees with it.
  - **Close-trimmed beard and white braided hair**, unlike most dwarves.
- **Duke Martin:**
  - Few words and awkward with people. Narrow, exotic eyes that seem to see through things.
  - Elegant archer's hands, with **his magnificent elven bow always at his side**.
  - **Black hair in a short ponytail.** A former ranger, sought out for his scouting knowledge.
- **Sumani:**
  - Trained in the LaMutian corps but still a Tsurani raider at heart, with an enigmatic smile.
  - **Black hair streaked with silver, shaved at the back of the neck except for one rat's tail hung
    with silver bells.**
  - **Wears fur and many layers of wool**, because Midkemia is cold to him.
- **Tomas:**
  - Raised in Crydee's kitchens. A blue-eyed man with sandy hair, changed by Valheru magic: **pointed
    elven ears** and eyes with a faint glaze of old battle-madness.
  - In his mid-thirties; consort of Queen Aglaranna. Nobody contradicts him to his face.
- **Aglaranna:** Queen of the Elves, well over two hundred but looking about twenty.
  - Pale, nearly luminous blue eyes; chiselled face, high cheekbones, strong jaw, full smile.
  - **A simple gold circlet**; lobeless upswept ears.
  - Proud, fiery and much loved; married to the Warleader Tomas.
- **Katala:**
  - Pug's wife, from Kelewan, and calm leader of Stardock's community.
  - In her mid-thirties, with **dark hair and large dark eyes**.
- **Moredhel (dark elves):**
  - Darker skin, hair and eyes than elves, and more violent. Born warriors.
  - Ordinary warrior dress: **furred robes of bear or deerskin, brown trousers, open vests and
    knee-length boots**.
  - Photo: a bare-armed warrior in studded leather with a big axe.
- **Nighthawks:**
  - A guild of assassins, centuries old but organised only in the last hundred years.
  - **Dress all in black.** They can become **Black Slayers**: undead that keep rising until Final
    Rest is cast.
- **Rusalki:**
  - The spirit of a drowned girl haunting the water where she died. She lures people close, young men
    especially, and kills them.
  - **Semi-transparent, a young girl with seaweed trailing from her arms.**
- **Quegian pirates/mercenaries:**
  - Mostly pirates, though some hire out anywhere. Usually young, dressed in the showy Eastern
    fashion: **polished boots, a red sash from the left shoulder to the right hip, black pantaloons**.
- **Giants:**
  - About **ten feet tall**; throw **very large rocks**.
  - Little more than animals, with minimal clothing; ferocious when their land is invaded.
- **Trolls:**
  - Short, broad and human-like, with **long thick arms nearly reaching the ground**. They walk on two
    legs but often run on all fours.
  - **Thick grey hide, curled-back lips and long fangs.**
  - They rarely trouble big groups but attack lone travellers or **parties of fewer than four**.
  - Easily manipulated; the Moredhel use them in raids.
- **Brak-Nurr:**
  - Live deep in caves and mines and prey mostly on the dwarves of the Grey Towers.
  - **Skin like crumbled blocks of stone with flecks of gold** that lure miners. They lie still in
    culverts unnoticed.
  - **Broad, with no visible eyes.** They attack nearly anything unprovoked.

## Background: the Riftwar saga (pp. 75–82)

A summary of the novels up to the game:

1. **The Riftwar.** Pug and Tomas find a wrecked Tsurani ship near Crydee. Tomas gets a dying golden
   dragon's armour (Ashen-Shugar's). Pug is captured, becomes a Great One on Kelewan, wrecks the
   Imperial Games, and comes home with Katala and William. Lyam becomes king and Arutha Prince of
   Krondor. Macros closes the rift.
2. **Silverthorn.** The Nighthawks try to kill Arutha, and Jimmy saves him and becomes a squire, where
   he meets Locklear. Anita is poisoned with Silverthorn at the wedding. The Moredhel follow a
   prophecy about the "Lord of the West". Pug learns the Enemy is Tsurani in origin.
3. **A Darkness at Sethanon.** Armengar burns. Pug, Tomas and Macros learn the Enemy is the combined
   will of the Valheru, and that the Lifestone lies under Sethanon. Arutha kills Murmandamus, who is
   revealed as a Pantathian snake priest. Tomas, as Ashen-Shugar, kills Draken-Korin and drives his
   sword into the Lifestone. Ryath dies, and the Oracle of Aal is placed in her body to guard the
   Lifestone.
4. **Ten years on (the game's starting point).**
   - Arutha's twin sons Borric and Erland are teenagers. James is a respected Seigneur. Pug exchanges
     knowledge with the Assembly, but nothing about Sethanon.
   - Locklear served under **Baron Moyiet**, who watches the Moredhel closely.
   - The Moredhel blame a Kingdom trick for Murmandamus' "imprisonment" and fight among their clans.
     The Green Heart exiles want to return home.
   - **Delekhan takes Sar-Sargoth and raises Murmandamus' battle standard again.** War is coming.

---

## What the manual told us that we did not know

These facts were not in our notes, the backlog or the code before this pass:

1. **Locklear and James duel with rapiers** (p. 65). The party models now carry rapiers.
2. **Gorath's details:**
   - The scar from temple to cheek on the left side.
   - The beard comes from his human mother.
   - Lobeless pointed ears.
   - Delekhan calls him "of the Ardanien", his chief rival for Sar-Sargoth.
3. **Moredhel warrior dress:** furred bear or deerskin robes, brown trousers, open vests and
   knee-length boots. This guides the Moredhel enemy models.
4. **Combat rules missing in the remake:**
   - Initiative by clicking an enemy, and enemy ambushes.
   - Swings cost Stamina.
   - At least one step from enemies to shoot or cast.
   - Line of sight for crossbows.
   - Wild shots can hit allies.
   - Retreat is refused when anyone is down.
   - Parry and riposte.
   - Assess, Rest (heal with extra risk), auto-combat.
   - Opening the inventory in combat costs the turn.
   - Shades from dug-up graves.
   - Enemy morale: patrols flee, a dead leader routs the rest.
5. **Camp restrictions:** no camping with enemies nearby, and night travel needs light.
6. **Rations:** handing rations to a starving character makes them eat at once.
7. **Dropped bags** get looted in open fields and near towns. A locked chest is a safe stash.
8. **Wordlock clue plates need someone who reads Moredhel.**
9. **The map:** N for north-up; underground maps start dark; cities white and towns brown, with
   names on hover.
10. **Repair rules:**
    - Armour regains a share of its *lost* condition equal to Armorcraft.
    - Neither repair works if the item was repaired recently.
11. **Spell limits:**
    - Flamecast's two-step splash.
    - Gift of Sung can't target the caster, and the target can't go over full.
    - Grief only on sentient targets.
    - Stardusk only outdoors.
    - Lightning Staff casts for free.
    - Infinity Pool magnifies combat spells.
    - Final Rest stops Nighthawks rising as Black Slayers.
12. **Enhancement hit effects:** green flash, red sparks, blue sparkle, white or blue glow.
13. **Fletcher's Post in Romney teaches elven spells for gold.**
14. **The chapter titles**, including a tenth "Epilogue".

## Manual vs the remake

Status of each manual rule in `src/` (audit of 2026-10-15). YES = implemented; PARTIAL = part of it;
DIFF = implemented differently; NO = missing.

| Rule | Status | Where / gap |
|---|---|---|
| Damage hits Stamina first, then Health | YES | `combat/rules.ts` `applyDamage` |
| Health ratio scales other skills | YES/PARTIAL | `formats/gam.ts` `effectiveSkill`; combat takes skills at the start of the fight, so they don't drop mid-fight |
| Heal Health first, then Stamina | YES | `game/rest.ts` |
| Camping heals to 80%, inns 100% | YES | `game/rest.ts`, `game/state.ts` |
| No camping with enemies near | YES | refused within two cells of a combat encounter that can still fire |
| Daily ration, hunger | YES | eaten at the day boundary while walking too; rations handed to a starving character are eaten at once |
| Practice focus (selected skills) | YES | maths in `game/practice.ts`; click a skill on the character sheet (or Up/Down + Enter) to toggle |
| Strength grows on hits; Speed fixed | YES | `combat/rewards.ts` |
| Conditions; long rest cures sickness | YES | `game/rest.ts`, `game/temple.ts` |
| Poison worse in combat | YES | a poisoned fighter loses 2 at the end of each of its turns |
| Weaponcraft repair, sword wear | YES | whetstone; restores Weaponcraft% of the lost condition; not again until used (the save's repairable bit) |
| Armorcraft repairs a share of the loss | YES | armourer's hammer; restores Armorcraft% of the lost condition |
| Barding | YES | `game/bard.ts` |
| Haggling, angry shopkeeper | YES | `game/shops.ts` |
| Scout warns; worst Stealth sneaks past | YES | `game/combatApproach.ts` |
| Initiative; enemy ambush | YES | `initiativeFor` (combatEncounter.ts): creeping up = party, an unscouted ambush = enemy, else Speed order |
| Grid / G / R keys | PARTIAL | grid always shown; G and R mean other things |
| Thrust in reach, swing adjacent | YES | `combat/grid.ts`, `battle.ts` |
| Swing costs Stamina | YES | 1 Stamina |
| Crossbow: one step away, line of sight, quarrels, wild shots | PARTIAL | one step, line of sight and wild shots done (battle.ts); quarrels still not modelled |
| Spells: one step away, gem power, casting accuracy | PARTIAL | one step and Casting Accuracy for bolts done; power still always maxed |
| Retreat refused if anyone is down | YES | refused while anyone is down; otherwise a chance that falls with enemies pressing; the attempt uses the turn |
| Defend, parry and riposte | YES | a parried blow gives the defender +10 to hit and 25% more damage on that attacker |
| Assess | YES | `assess` (E): one fact per 20 Assessment points |
| Rest in combat heals | YES | 10% of Health+Stamina, Health first; 15 easier to hit until the next turn |
| Auto-combat | YES | A key: the party's turns use the enemy tactics |
| Inventory in combat costs the turn | YES | I opens on the fighter whose turn it is (refused otherwise); closing it spends the turn; item effects carry into the fight |
| Revive the fallen; all down = game over | DIFF | auto-revive at 1 Health and retreat |
| Enemy AI (reckless, cautious, morale) | YES | morale from the save's retreat factor (0-9, x7%), +30% once the leader is down; cautious rest when spent |
| Enhancements and resistances | YES | maths done; monster resistances from the original table (docs/formats/combat-audit.md); poisoned blades poison; hit effects (green flash, red sparks, blue sparkle, white/blue glow) |
| Racial weapon penalty | PARTIAL | party treated as race-less |
| Keys, picks, best picker, disarm | YES | `game/locks.ts`, `containerControls.ts` |
| Scent of Sarig detects traps | YES | only Scent of Sarig warns of a trapped chest |
| Drop items in bags | YES | inventory D drops into a bag on the ground (a sack in the world, saved); bags in the open are probably emptied after an hour away |
| Wordlocks | YES | the clue plate reads only with Gorath in the party |
| Temples: teleport, bless, cure | YES | `game/temple.ts` |
| Follow Road | YES | H: from the middle of a road; steers along it, stops at forks and road ends, keeps the party on it (src/world/followRoad.ts) |
| Map: N, dark dungeons, town colours | YES | Tab: local map centred on the party, +/- zoom, N north-up, roads drawn, dungeons dark until explored (saved); F: the full kingdom map (FULLMAP.SCX) with cities white, towns brown, names on hover, the party flashing. The city/town split is ours. Walking with the map open works |
| Bookmark quick save | YES | F5 |
| Shades from graves | YES | digging a grave needs a shovel and may raise shades (DEF_COMB 389-393) |
| Spell details (table above) | YES | Flamecast burns all within two steps; Gift of Sung (not the caster, one-for-one); Grief only on minds (`MINDLESS_MONSTERS`); Stardusk outdoors only; Lightning Staff casts Skyfire free; Infinity Pool x1.5; Black Slayers and Nighthawks rise again without Final Rest |
| 10 royals = 1 sovereign | YES | `game/party.ts` |
| Damaged items sell for less | YES | `game/shops.ts` |
