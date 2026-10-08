let prevX = party.x;
let prevY = party.y;

// Encounters: dialogue and other triggers fire as the party walks into their rectangles.
// A finished dialogue applies its actions to the world and party, and may send the party elsewhere.
const objectItems = parseObjInfo(archive.get('OBJINFO.DAT')).items;
let partyState = partyFromSave(save);
let teleports: Destination[] = [];
let travelling = false;

const showView: ShowDialog = (view, done) =>
  screens.showDialog(
    view.snippet,
    view.options.map((o) => o.label),
    (r) => r.kind !== 'none' && done(r),
  );

// A finished dialogue (from the world or a town scene): apply its effects and move the party if it asks.
const applyDialog = (session: DialogSession, transition: ZoneTransition | undefined, cancelled: boolean) => {
  const out = resolveDialogOutcome({
    session,
    transition,
    cancelled,
    teleports,
    items: objectItems,
    party: partyState,
    world: encounters.runner.world,
  });
  partyState = out.party;
  clock.state = out.world;
  encounters.runner.setWorld(out.world);
  screens.setParty(partyState);
  if (out.ticksElapsed > 0) sky.update(clock.minutes);
  if (out.unhandled.length)
    console.log(
      'dialogue actions with no effect yet:',
      out.unhandled.map((a) => a.name ?? a.type),
    );
  if (out.warnings.length) console.warn(out.warnings);
  if (out.destination) {
    town.dismiss();
    void travelTo(out.destination);
  }
  void chapters.afterDialog();
};

// Shops: buy, sell and haggle at shop hotspots of town scenes.
const shops = createShops({
  items: objectItems,
  scrollValues: parseObjInfo(archive.get('OBJINFO.DAT')).scrollValues,
  saveBytes: save.bytes,
  hud: screens,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  zone: () => zoneHost.current.zone,
  playDialog: (key, done) => town.playDialog(key, done),
});

// Inns: the innkeeper's offer, then nights of rest (see docs/formats/inns.md).
const gdsContainers = parseShopContainers(save.bytes);
const inns = createInnHost({
  stats: (ref) => findShop(gdsContainers, ref)?.stats,
  chapter: () => start.chapter,
  world: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
    sky.update(clock.minutes);
  },
  party: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  playDialog: (key, done) => town.playDialog(key, done),
  itemRule: (i) => ruleFor(objectItems, i),
  notify: createNotice(),
});

// Town and temple scenes: a 2D screen on the HUD whose hotspots open dialogues.
const town = createTownHost({
  shop: (ref) => shops.open(ref),
  fetch: (names) => prefetchResources(archive, names),
  hud: screens,
  get chapter() {
    return start.chapter;
  },
  world: () => clock.state,
  playDialog: (key, done) => {
    encounters.runner.setWorld(clock.state);
    const session = encounters.runner.startDialog(key);
    runDialogSession(session, showView, (cancelled) => {
      encounters.runner.finish(session);
      applyDialog(session, undefined, cancelled);
      done({ cancelled, endState: session.endOfDialogState, choice: session.lastChoice });
    });
  },
  inn: (ref) => inns.enter(ref),
});

// Entering a town: the party stands at the entry's exit position outside the door, then the scene opens.
const enterTown = async (e: PlacedEncounter, t: TownEntry) => {
  await town.enter(t.ref, t.exitDialog);
  if (!town.active) return;
  const exit = townExit(t, e.tileX, e.tileY);
  party.setPosition(exit.x, exit.y, exit.heading);
  prevX = exit.x;
  prevY = exit.y;
  encounters.runner.enterAt(exit.x, exit.y);
};

const spellDefs = archive.has('SPELLS.DAT') ? parseSpells(archive.get('SPELLS.DAT')) : [];

// Combat encounters: a fight on the combat grid, then wounds applied and the encounter marked done (or a retreat).
const combat = new CombatEncounters({
  scene,
  camera,
  canvas: renderer.domElement,
  getHeight: zoneHost.getHeight,
  support: await loadCombatSupport(archive, save.bytes),
  items: objectItems,
  spells: spellDefs,
  position: () => ({ x: party.x, y: party.y, heading: party.heading8 }),
  placeParty: (x, y, h) => {
    party.setPosition(x, y, h);
    prevX = x;
    prevY = y;
    encounters.runner.enterAt(x, y);
  },
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  markDone: (e) => {
    encounters.runner.setWorld(clock.state);
    encounters.runner.complete(e);
    clock.state = encounters.runner.world;
  },
});

const makeEncounters = async (zoneNumber: number, tiles: readonly (readonly [number, number])[], world: WorldState) => {
  const read = await prefetchResources(archive, encounterResourceNames(zoneNumber, tiles));
  const table = read('TELEPORT.DAT');
  teleports = table ? parseTeleports(table) : [];
  return new EncounterDriver(
    loadEncounterRunner({
      read,
      zone: zoneNumber,
      tiles,
      chapter: start.chapter,
      world,
      env: makeDialogEnv({
        getParty: () => partyState,
        zone: zoneNumber,
        chapter: start.chapter,
        extras: shops.textExtras,
        castSpell: (n) => justCast(n, clock.state.ticks),
      }),
    }),
    showView,
    {
      other: (e) => {
        if (e.encounter.record.typeId === EncounterType.Combat) void combat.start(e.encounter);
        else console.log('encounter (not run yet):', e.encounter.record.action, e.encounter.record);
      },
      zone: (e) => void travelTo(e.transition),
      town: (e) => void enterTown(e.encounter, e.town),
      blocked: () => party.setPosition(prevX, prevY),
      finished: (ev, cancelled) => {
        applyDialog(ev.session, ev.transition, cancelled);
        if (!ev.town) return;
        if (!cancelled && ev.session.lastChoice === QUERY_YES) void enterTown(ev.encounter, ev.town);
        else party.setPosition(prevX, prevY);
      },
    },
  );
};

// Zone transitions and teleports: reload the zone scene when the zone changes, then place the party.
async function travelTo(d: Destination): Promise<void> {
  if (travelling) return;
  travelling = true;
  try {
    const plan = planTransition(zoneHost.current.zone, d);
    if (plan.reload) {
      splash.style.display = 'flex';
        setSplash(`Loading Zone ${plan.zone}...`);
        // Wait a frame so the UI updates
        await new Promise(r => setTimeout(r, 10));
        const next = await zoneHost.switchTo(plan.zone);
        splash.style.display = 'none';
      party.polygons = next.scene.collision;
      next.grass.setQuality(post.quality);
      screens.setMap(loadZoneMap(archive, plan.zone, next.data.tiles), plan.zone);
      encounters = await makeEncounters(plan.zone, next.data.tiles, clock.state);
      void music.play(songForZone(plan.zone)).catch((err) => console.warn('Music unavailable:', err));
    }
    party.setPosition(plan.x, plan.y, plan.heading);
    prevX = plan.x;
    prevY = plan.y;
    encounters.runner.enterAt(plan.x, plan.y);
    if (plan.hotspot !== undefined) void town.enter({ number: plan.hotspot, letter: gdsLetter(plan.hotspotChar ?? 0) });
  } finally {
    travelling = false;
  }
}

let encounters = await makeEncounters(start.zone, zoneHost.current.data.tiles, clock.state);

