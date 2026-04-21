// =============================================================================
// HOENN BATTLE FRONTIER — Gen 3 Emerald overlay for Pokechill
// =============================================================================
//
// Single-file overlay adding 7 Hoenn Battle Frontier facilities:
//
//   ┌──────────────────┬─────────┬──────────────────────────┐
//   │ Facility         │ Brain   │ Rule summary             │
//   ├──────────────────┼─────────┼──────────────────────────┤
//   │ Battle Tower     │ Anabel  │ 7-battle streak          │
//   │ Battle Palace    │ Spenser │ Nature picks moves       │
//   │ Battle Arena     │ Greta   │ 3-turn judge, no switch  │
//   │ Battle Dome      │ Tucker  │ 4-trainer bracket, pick 2│
//   │ Battle Factory   │ Noland  │ Rental pool + swap       │
//   │ Battle Pike      │ Lucy    │ 14 rooms, 3-door picker  │
//   │ Battle Pyramid   │ Brandon │ Grid dungeon + Combat Bag│
//   └──────────────────┴─────────┴──────────────────────────┘
//
// Milestones per facility:
//   • Silver Symbol  → specific round per facility (see silverRound field)
//   • Gold   Symbol  → specific round per facility (see goldRound  field)
//   • Post-Gold rematches keep looping with a rising difficulty multiplier.
//
// Integration principles (non-negotiable):
//   • No vanilla source file is modified — every piece of game-engine
//     integration is a runtime wrap installed from the bootstrap pass
//     (`install*Hook` functions, section 7). Each wrap is idempotent.
//   • All persistent state lives under `saved.frontierExt.*`. Nothing
//     else in the save is mutated without a paired restore path.
//   • Facility defs are data-driven (FACILITIES array). Adding a new one
//     is an append + a rule-branch or two.
//
// The `...Secret` suffix on internal facility ids is a namespacing
// choice to keep this overlay's save keys distinct from any future
// upstream frontier additions.
//
// Full architecture, data model, install-hook reference, mutation contract,
// extension guide, and testing notes:  scripts/features/FRONTIER_EXT.md
//
// =============================================================================
(function () {
  "use strict";

  // ─── 1. FACILITY DATA ─────────────────────────────────────────────────────
  // Each facility is a self-contained spec. `rules.apply(ctx)` is called by the
  // combat wrapper at the right phase (move-select, judge, reward, etc.).
  // Sprites live in img/trainers/ with canonical Gen 3 Emerald filenames.
  // Icons are SVG strings in the same style as the original frontier-flair
  // icons (single-colour filled paths, 32x32 viewBox-ish).
  // SVG icons in the same style + size as the vanilla frontier-flair icons
  // (Battle Tower Eiffel, Factory gears). class="frontier-flair" must sit on
  // the <svg> element itself — styles.css line 5461 sizes it to 7rem × 7rem
  // absolute-positioned.
  //
  // Each SVG is hand-composed with rects / simple paths to avoid pixel drift
  // when the 32px viewBox is scaled up to 7rem.
  const ICON_TOWER = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M14 2h4v2h-4zm-1 3h6v3h-6zm-2 4h10v2h-10zm1 3h8v4h-8zm-1 5h10v3h-10zm-1 4h12v3h-12zm-1 4h14v3h-14zm-1 4h16v4h-16z"/></svg>`;

  const ICON_PALACE = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M16 3 4 9h24zM3 10h26v2H3zm3 3h2v12H6zm6 0h2v12h-2zm6 0h2v12h-2zm6 0h2v12h-2zM4 26h24v2H4zm-1 3h26v2H3z"/></svg>`;

  const ICON_ARENA = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M2 5c4 2 8 3 14 3s10-1 14-3v4c-4 2-8 3-14 3S6 11 2 9zm4 8h3v6h14v-6h3v17h-3V22H9v8H6zm3 6h14v-3H9z"/></svg>`;

  const ICON_DOME = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M16 3a12 12 0 0 0-12 12v2h24v-2A12 12 0 0 0 16 3m-6 6 1-3 1 3zm5-1 1-3 1 3zm5 1 1-3 1 3zM3 18h26v3H3zm1 4h24v3H4zm-1 4h26v3H3z"/></svg>`;

  const ICON_FACTORY = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M3 13v16h10v-5l5 3v-6l5 3v-6l6 3V11zm14 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6m-2 3h4v5h-4zm1-2v-1h2v1z"/></svg>`;

  const ICON_PIKE = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M16 3 2 29h28zm0 5 10 18H6zm-2 10 2 3 2-3-2 2zm-5 8h14v2H9z"/></svg>`;

  const ICON_PYRAMID = `<svg class="frontier-flair" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="currentColor" d="M16 3 3 29h26zm0 5-9 16h18zm0 3-6 11h12zm0 3-3 6h6z"/></svg>`;

  // 7 secret variants that mirror the 7 canonical Gen 3 Emerald facilities.
  // Suffixed "(Hoenn)" / "(Hoenn)" so they read as bonus-content companions
  // to whatever vanilla Pokechill ships (Tour, Usine, Arène — different rules).
  //
  // All use backgrounds that already exist in img/bg/ so we don't have to ship
  // new art with this feature.
  const FACILITIES = [
    {
      id: "frontierTowerSecret",
      name: "Battle Tower (Hoenn)",
      desc: "Trainer gauntlet — unlike the vanilla Tower's wild waves, this is a streak of fights against trainers. Pick your team and survive as long as you can.",
      brain: {
        id: "anabel",
        sprite: "salon_maiden_anabel",
        name: "Salon Maiden Anabel",
        teamSilver: ["alakazam", "entei", "snorlax"],
        teamGold: ["raikou", "snorlax", "latios"] },
      iconSvg: ICON_TOWER,
      background: "tower",
      hueRotate: 200,
      // Plain trainer gauntlet — the "baseline" facility. Gen 3 canon:
      // Pokémon are fully healed between each of the 7 battles of a set,
      // only the end-of-set hostess modal breaks the streak (Continuer /
      // Abandonner, auto-save happens in background).
      rules: { streak: true },
      battlesPerRound: 7,
      // Bulbapedia: Silver at 35 battles (round 5), Gold at 70 battles (round 10)
      silverRound: 5,
      goldRound: 10 },
    {
      id: "frontierPalaceSecret",
      name: "Battle Palace (Hoenn)",
      desc: "Your Pokémon pick moves on their own, guided by their nature. No player input during attacks.",
      brain: {
        id: "spenser",
        sprite: "palace_maven_spenser",
        name: "Palace Maven Spenser",
        teamSilver: ["crobat", "slaking", "lapras"],
        teamGold: ["arcanine", "slaking", "suicune"] },
      iconSvg: ICON_PALACE,
      background: "gym",
      hueRotate: 60,
      rules: { autoMoveByNature: true },
      battlesPerRound: 7,
      // Bulbapedia: Silver at 21 wins (round 3), Gold at 42 wins (round 6)
      silverRound: 3,
      goldRound: 6 },
    {
      id: "frontierArenaSecret",
      name: "Battle Arena (Hoenn)",
      desc: "3-turn maximum per fight, no switching allowed. If no KO, the judge rules based on Mental / Technique / Physique.",
      brain: {
        id: "greta",
        sprite: "arena_tycoon_greta",
        name: "Arena Tycoon Greta",
        teamSilver: ["heracross", "umbreon", "shedinja"],
        teamGold: ["umbreon", "gengar", "breloom"] },
      iconSvg: ICON_ARENA,
      background: "lab",
      hueRotate: 0,
      rules: { threeTurnJudge: true },
      battlesPerRound: 7,
      // Bulbapedia: Silver at 28 battles (round 4), Gold at 56 battles (round 8)
      silverRound: 4,
      goldRound: 8 },
    {
      id: "frontierDomeSecret",
      name: "Battle Dome (Hoenn)",
      desc: "Single-elimination tournament — beat 4 trainers in a bracket per tour. You see each opponent's team ahead of time and pick 2 of your Pokémon.",
      brain: {
        id: "tucker",
        sprite: "dome_ace_tucker",
        name: "Dome Ace Tucker",
        teamSilver: ["swampert", "salamence", "charizard"],
        teamGold: ["swampert", "latias", "metagross"] },
      iconSvg: ICON_DOME,
      background: "town",
      hueRotate: 320,
      rules: { bracketTournament: true, bracketSize: 4, previewEnemy: true, pickSubset: 2 },
      // Bulbapedia: Silver at 20 battles, Gold at 40 battles. Our bracket
      // is 3 battles per round → round 7 (21 battles ≈ 20) = Silver,
      // round 14 (42 battles ≈ 40) = Gold. Closest integer match.
      battlesPerRound: 3,      // bracket size (QF + SF + Final)
      silverRound: 7,
      goldRound: 14 },
    {
      id: "frontierFactorySecret",
      name: "Battle Factory (Hoenn)",
      desc: "Get 3 rental Pokémon from a random pool. After each win, you can swap one of yours with the defeated opponent's. Pure Gen 3 Factory rules.",
      brain: {
        id: "noland",
        sprite: "factory_head_noland",
        name: "Factory Head Noland",
        teamSilver: null, // Noland uses random rentals himself, like the player
        teamGold: null },
      iconSvg: ICON_FACTORY,
      background: "cave",
      hueRotate: 160,
      rules: { rentalPool: true, swapAfterWin: true },
      battlesPerRound: 7,
      // Bulbapedia: Silver at 21 battles (round 3), Gold at 42 battles (round 6)
      silverRound: 3,
      goldRound: 6 },
    {
      id: "frontierPikeSecret",
      name: "Battle Pike (Hoenn)",
      desc: "14 rooms. Pick one of three doors per room: battle, wild, heal, trap, or mystery. HP and status persist.",
      brain: {
        id: "lucy",
        sprite: "pike_queen_lucy",
        name: "Pike Queen Lucy",
        teamSilver: ["seviper", "shuckle", "milotic"],
        teamGold: ["seviper", "gyarados", "steelix"] },
      iconSvg: ICON_PIKE,
      background: "mountain",
      hueRotate: -40,
      rules: { chooseDoor: true, persistHpStatus: true, roomCount: 14 },
      // Bulbapedia: Silver at 14 rooms (round 1, the very first challenge),
      // Gold at 70 rooms (round 5). 14 rooms = 1 round in our system.
      roomsPerRound: 14,
      battlesPerRound: 14, // alias so generic helper returns a usable count
      silverRound: 1,
      goldRound: 5 },
    {
      id: "frontierPyramidSecret",
      name: "Battle Pyramid (Hoenn)",
      desc: "Navigate a 7x7 grid. Hidden trainers, wild waves, items, and traps. HP and status persist. Find the stairs to advance.",
      brain: {
        id: "brandon",
        sprite: "pyramid_king_brandon",
        name: "Pyramid King Brandon",
        teamSilver: ["regirock", "regice", "registeel"],
        teamGold: ["articuno", "zapdos", "moltres"] },
      iconSvg: ICON_PYRAMID,
      background: "desert",
      hueRotate: 30,
      rules: { gridNav: true, persistHpStatus: true, gridSize: 7 },
      // Bulbapedia: Silver at 21 floors (round 3), Gold at 70 floors (round 10)
      floorsPerRound: 7,
      battlesPerRound: 7, // alias for generic round counter
      silverRound: 3,
      goldRound: 10 },
  ];
// ─── BRAIN ROLE LABEL ────────────────────────────────────────────────
  const SILVER_ROUND = 7;
  const GOLD_ROUND = 49;
  const POST_GOLD_BOSS_EVERY = 7;

  // Per-facility accessors. Bulbapedia thresholds live on each facility
  // definition (silverRound / goldRound). `postGoldRematchEvery` is our
  // custom extension — defaults to (gold - silver) so each facility keeps
  // the same natural cadence it used between Silver and Gold. E.g. Tour
  // (silver 5, gold 10) → bosses reappear every 5 rounds (15/20/25).
  function silverRoundFor(facility) {
    return (facility && facility.silverRound) || SILVER_ROUND;
  }
  function goldRoundFor(facility) {
    return (facility && facility.goldRound) || GOLD_ROUND;
  }
  function postGoldEveryFor(facility) {
    if (facility && facility.postGoldRematchEvery) return facility.postGoldRematchEvery;
    const silver = silverRoundFor(facility);
    const gold = goldRoundFor(facility);
    const gap = gold - silver;
    return gap > 0 ? gap : POST_GOLD_BOSS_EVERY;
  }

  // "Next meaningful round" for a given currentRound — i.e. the closest
  // upcoming boss round >= currentRound. Drives the "Round X / Y" badge
  // denominator (previously frozen at silverRound, which became nonsense
  // once the player passed Silver — e.g. Tour at round 16 was showing
  // "16/5" because silver=5 never changed). Values:
  //   • currentRound <= silver  → returns silver
  //   • currentRound <= gold    → returns gold
  //   • currentRound > gold     → next rematch round (gold + k·every)
  function nextGoalRoundFor(currentRound, facility) {
    const silver = silverRoundFor(facility);
    const gold = goldRoundFor(facility);
    const every = postGoldEveryFor(facility);
    if (currentRound <= silver) return silver;
    if (currentRound <= gold) return gold;
    const past = currentRound - gold;
    const cycles = Math.max(1, Math.ceil(past / every));
    return gold + cycles * every;
  }

  // Difficulty multiplier — 1 up to Gold, then +1 per post-Gold cycle.
  function difficultyMultiplier(round, facility) {
    const gold = goldRoundFor(facility);
    const every = postGoldEveryFor(facility);
    if (round <= gold) return 1;
    return 1 + Math.floor((round - gold) / every);
  }

  // Returns a descriptor { kind, multiplier } for boss rounds, or null.
  // Thresholds are read from the facility when supplied (Bulbapedia-
  // accurate), else fall back to the legacy 7/49 constants.
  function getBossRoundInfo(round, facility) {
    const silver = silverRoundFor(facility);
    const gold = goldRoundFor(facility);
    const every = postGoldEveryFor(facility);
    if (round === silver) return { kind: "silver", multiplier: 1 };
    if (round === gold) return { kind: "gold", multiplier: 1 };
    if (round > gold && (round - gold) % every === 0) {
      return { kind: "rematch", multiplier: difficultyMultiplier(round, facility) };
    }
    return null;
  }

  // ─── 2a. UNIFIED DIFFICULTY COMPUTATION ───────────────────────────────────
  // Single source of truth for "how hard is round N in facility F?". Replaces
  // the tier curves previously duplicated in generateTrainer and
  // generateFactoryRentalPool, and feeds the new per-round crescendo for IVs,
  // abilities, and move quality (Emerald-style progressive Frontier feel).
  //
  // Returns: {
  //   tier,              // 1..5 pool bracket (pure BST percentile)
  //   mult,              // post-Gold rematch multiplier (1, 2, 3, ...)
  //   hpMult,            // area.difficulty (enemy HP pool multiplier)
  //   ivRating,          // 0..6 enemy IV for every stat
  //   abilityChance,     // 0..1 probability of overriding with a random ability
  //   forceHiddenAbility,// bool — enemies always use hidden ability if present
  //   useEggMove,        // bool — enemies include their eggMove in the pool
  //   forceSignature,    // bool — force signature move in slot 1 if species has one
  //   useSeededRng,      // bool — call learnPkmnMoveSeeded for reproducibility
  // }
  //
  // IV curve: 0 → 6 linear from round 1 to goldRound, then 6 forever.
  //   • Tour (gold 10): IV ≈ round * 0.6
  //   • Pic  (gold 5) : IV ≈ round * 1.2
  // Hidden ability kicks in from silverRound+1, forced from goldRound.
  // Egg moves / signature start at silverRound.
  function computeRunDifficulty(round, facility) {
    const silver = silverRoundFor(facility);
    const gold = goldRoundFor(facility);
    const mult = difficultyMultiplier(round, facility);
    const tier = tierForRound(round, facility);

    // IV ramps from 0 (round 1) to 6 (round gold), caps at 6 post-Gold.
    const progress = Math.min(1, Math.max(0, (round - 1) / Math.max(1, gold - 1)));
    let ivRating = Math.round(progress * 6);
    if (round >= gold) ivRating = 6;

    // Ability override chance grows with round; forced at gold+, always
    // hidden ability post-Gold rematches (mult >= 2).
    let abilityChance = 0;
    if (round >= 3) abilityChance = 0.25;
    if (round >= silver) abilityChance = 0.55;
    if (round >= gold) abilityChance = 1;
    const forceHiddenAbility = mult >= 2 || round >= gold;

    // Move quality knobs — egg moves & signature kick in at Silver, always
    // forced at Gold+ so boss mons feel unique.
    const useEggMove = round >= silver;
    const forceSignature = round >= gold;
    // Use seeded RNG for enemies from Silver onwards so the same round
    // replays with a consistent (but varied-between-rounds) feel. Before
    // Silver we stay fully random for early-round variety.
    const useSeededRng = round >= silver;

    // HP multiplier: base tier curve (4/6/8/10/12) + 2 per post-Gold level.
    const hpMult = tier * 2 + 2 + (mult - 1) * 2;

    return {
      round,
      tier,
      mult,
      hpMult,
      ivRating,
      abilityChance,
      forceHiddenAbility,
      useEggMove,
      forceSignature,
      useSeededRng };
  }

  // True when the upcoming battle is the LAST battle of a non-boss
  // round-set (battle 7/7 for Tower/Palace/Arena/Factory). Used by
  // buildEphemeralRunArea to apply the mini-boss stat bump and by
  // openSimulatedFight to surface a visible "mini-boss" label in the
  // trainer preview. Centralised so the UI and the stat layer stay in
  // sync — if we change the criteria in one place, we change both.
  function isMiniBossBattle(run, facility) {
    if (!run || !facility) return false;
    if (isDomeFacility(facility) || isPikeFacility(facility) || isPyramidFacility(facility)) return false;
    const perRound = battlesPerRound(facility);
    if (perRound <= 1) return false;
    const boss = getBossRoundInfo(run.round + 1, facility);
    if (boss) return false;
    return (run.battleInRound || 1) === perRound;
  }

  // Shared tier-from-round calculator. Previously duplicated in
  // generateTrainer (1070) and generateFactoryRentalPool (4018). Consolidated
  // here so the BST pool used by trainers, rentals, brain fallback teams,
  // and any future path always reads the same curve.
  function tierForRound(round, facility) {
    const gold = goldRoundFor(facility);
    const mult = difficultyMultiplier(round, facility);
    let tier = 1;
    if (round >= 3) tier = 2;
    if (round >= 6) tier = 3;
    if (round > gold) tier = 4;
    if (mult >= 3) tier = 5;
    return tier;
  }

  // ─── 2b1. PIKE CONSTANTS ──────────────────────────────────────────────────
  // Battle Pike (Gen 3 Emerald): each round is a dungeon of 14 rooms. Player
  // picks 1 of 3 curtain-doors per room — the outcome is only revealed after
  // clicking. HP and status persist across every room so punishing door
  // sequences (trap → trap → combat) actually hurt. Room 14 is always a
  // fight — Brain on boss rounds (7 / 49 / post-Gold rematches), otherwise a
  // tier-bumped elite trainer.
  const PIKE_ROOM_COUNT = 14;
  const PIKE_DOOR_COUNT = 3;
  // Status effects that a status_species door can inflict. Names must
  // match EXACTLY the buff keys Pokechill reads in combat: `team[slot].buffs`
  // has numeric-turn entries for `poisoned` / `burn` / `paralysis` /
  // `sleep` / `freeze` (explore.js:2566 / 2590 / 2345 etc.). `poisoned`
  // is the canonical form — NOT "poison".
  const PIKE_PYRAMID_STATUSES = ["poisoned", "burn", "paralysis", "sleep", "freeze"];
  // Large turn count so a Pike-applied buff persists across an entire
  // battle without wearing off. The game decrements the counter per turn
  // but never refills it — 99 turns is effectively infinite for a round.
  const PIKE_PYRAMID_STATUS_TURNS = 99;

  // Canonical Gen 3 Pike species-status inflictors. Each species in a
  // status_species door rolls one of its configured statuses and applies
  // it to N of the player's Pokémon, where N scales with room progression
  // (see pikeStatusCountByRoom below). Type-based immunities are honoured.
  //
  // Examples surfaced in-game per Bulbapedia:
  //   • Kirlia / Gardevoir — Hypnosis + Thunder Wave + Toxic + Will-O-Wisp
  //   • Dusclops           — Ice Beam (freeze) + Will-O-Wisp (burn)
  //   • Gloom / Vileplume  — Sleep Powder + Stun Spore + Poison Powder
  //   • Parasect           — Spore (sleep)
  //   • Seviper            — Glare (paralysis) + Poison Fang
  const PIKE_STATUS_SPECIES = {
    kirlia:    ["poisoned", "paralysis", "sleep", "burn"],
    gardevoir: ["poisoned", "paralysis", "sleep", "burn"],
    dusclops:  ["freeze", "burn"],
    gloom:     ["sleep", "paralysis", "poisoned"],
    vileplume: ["sleep", "paralysis", "poisoned"],
    parasect:  ["sleep"],
    seviper:   ["poisoned", "paralysis"] };

  // Room-progression count of Pokémon affected by a status_species door.
  // Canonical thresholds: salle 1-5 → 1 mon, 6-10 → 2 mons, 11-14 → 3 mons.
  function pikeStatusCountByRoom(room) {
    if (room <= 5) return 1;
    if (room <= 10) return 2;
    return 3;
  }

  // Type-based immunity check. Keeps it to the basics the player expects:
  //   • burn     — Fire types immune
  //   • freeze   — Ice types immune
  //   • paralysis — Electric types immune (Gen 6+ ruling, intuitive)
  //   • poisoned  — Poison + Steel types immune
  //   • sleep    — no type immunity (ability-only in vanilla)
  function pikePkmnImmuneToStatus(pkmnId, status) {
    if (typeof pkmn === "undefined" || !pkmn[pkmnId]) return false;
    const types = [pkmn[pkmnId].type1, pkmn[pkmnId].type2].filter(Boolean);
    if (status === "burn"      && types.includes("fire"))     return true;
    if (status === "freeze"    && types.includes("ice"))      return true;
    if (status === "paralysis" && types.includes("electric")) return true;
    if (status === "poisoned"  && (types.includes("poison") || types.includes("steel"))) return true;
    return false;
  }

  // Categories used by the receptionist hint. Each door type is bucketed
  // so the hint text narrows the player's guess without fully revealing
  // the outcome — mirrors the vague Gen 3 Pike hostess lines.
  const PIKE_HINT_CATEGORY = {
    combat_solo:    "presence",
    heal_full:      "presence",
    empty:          "conversation",
    combat_tough:   "smell",
    wild:           "smell",
    status_species: "nostalgia",
    heal_partial:   "nostalgia",
    brain:          "dread",
    // Legacy fallbacks for saves from before the rework:
    combat:         "presence",
    heal_half:      "nostalgia",
    trap:           "nostalgia",
    tough:          "smell" };

  function isPikeFacility(facility) {
    return facility && facility.rules && facility.rules.chooseDoor;
  }

  function isPalaceFacility(facility) {
    return !!(facility && facility.rules && facility.rules.autoMoveByNature);
  }

  // Any facility whose rules opt into `persistHpStatus` reuses the Pike
  // HP/status machinery — same runTeam snapshot, same apply hook on
  // initialiseArea, same post-leaveCombat snapshot, same slot pills.
  //   • Pike    : rooms 1..14 share HP/status state.
  //   • Pyramid : floors 1..7 share HP/status state.
  //   • Tower   : battles 1..7 of a set share HP/status state —
  //               canonical Gen 3 "no free heal between battles" feel.
  //   • Future facilities can opt in by flagging the same rule.
  //
  // NAMING CONVENTION (adopted during the Pike/Pyramid split cleanup):
  //   • `runTeam` / `persistHpStatus` concept : shared machinery
  //   • Functions touching this shared state are prefixed
  //     `pikePyramid…` (e.g. snapshotPikePyramidHp) so PR reviewers
  //     can tell at a glance what's dual-use vs facility-specific.
  //   • Pike-only helpers keep the `pike` prefix.
  //   • Pyramid-only helpers keep the `pyramid` prefix.
  //   • The storage field `run.pikeTeam` intentionally retains its
  //     original name for save back-compat.
  function hasRunTeamState(facility) {
    return !!(facility && facility.rules && facility.rules.persistHpStatus);
  }

  // Number of individual encounters that make up one "round" for this
  // facility — matches the canonical Gen 3 "set" structure. Each facility
  // def declares its own value explicitly so the boss placement + streak
  // counter use precise Bulbapedia numbers, no guessing:
  //   • Tower / Palace / Arena / Factory : 7 battles per round
  //   • Dome                              : 3 battles (bracket QF+SF+Final)
  //   • Pike                              : 14 rooms per round (roomsPerRound)
  //   • Pyramid                           : 7 floors per round (floorsPerRound)
  //
  // The function prefers `battlesPerRound`, then falls back to the
  // specialised fields (roomsPerRound / floorsPerRound) for legacy defs
  // that only declared one. Returns 1 if the def is malformed.
  function battlesPerRound(facility) {
    if (!facility) return 1;
    return facility.battlesPerRound
        || facility.roomsPerRound
        || facility.floorsPerRound
        || (isDomeFacility(facility) ? DOME_BRACKET_SIZE : 1);
  }

  // Rename legacy buff keys to the game's canonical ones. First release
  // used "poison" which isn't a valid Pokechill buff key (the engine reads
  // `team[sl].buffs.poisoned`). Any save made before that fix still has
  // "poison" stuck in its cached doors and run.pikeStatus, so we migrate
  // at boot and in a defensive inline normalizer.
  function normalizePikePyramidStatus(st) {
    if (st === "poison") return "poisoned";
    return st;
  }
  function migratePikeState() {
    if (typeof saved !== "object" || !saved || !saved.frontierExt) return;
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    if (run.pikeStatus) {
      for (const sl of Object.keys(run.pikeStatus)) {
        run.pikeStatus[sl] = normalizePikePyramidStatus(run.pikeStatus[sl]);
      }
    }
    if (Array.isArray(run.pikeDoors)) {
      for (const d of run.pikeDoors) {
        if (d && d.data && typeof d.data.status === "string") {
          d.data.status = normalizePikePyramidStatus(d.data.status);
        }
      }
    }
    // Upgrade split pikeHpState / pikeStatus → unified run.pikeTeam.
    migratePikePyramidTeam();
  }

  // Classic red-velvet curtain, hand-built SVG (no raster dependency). Shape
  // inspired by the Gen 3 Battle Pike interior tileset the user referenced:
  // gold rod at the top, five vertical pleats with light/shadow gradients,
  // scalloped bottom fringe, gold tassel at centre. Safe to hue-rotate at the
  // parent level because every colour is defined via inline stops — the
  // cascade picks up any wrapping filter.
  const CURTAIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="pikeGoldRod" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f6dc8a"/>
      <stop offset="45%" stop-color="#d5a22b"/>
      <stop offset="100%" stop-color="#6a3d08"/>
    </linearGradient>
    <linearGradient id="pikeVelvet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b61a1a"/>
      <stop offset="50%" stop-color="#8a0808"/>
      <stop offset="100%" stop-color="#4c0202"/>
    </linearGradient>
    <linearGradient id="pikePleatHi" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(255,200,200,0)"/>
      <stop offset="50%" stop-color="rgba(255,190,190,0.45)"/>
      <stop offset="100%" stop-color="rgba(255,200,200,0)"/>
    </linearGradient>
  </defs>
  <!-- Gold rod -->
  <rect x="0" y="0" width="100" height="10" fill="url(#pikeGoldRod)"/>
  <rect x="0" y="0" width="100" height="2" fill="rgba(255,230,160,0.75)"/>
  <rect x="0" y="8" width="100" height="2" fill="rgba(0,0,0,0.35)"/>
  <!-- Curtain body -->
  <rect x="0" y="10" width="100" height="140" fill="url(#pikeVelvet)"/>
  <!-- Pleat shadows -->
  <rect x="13" y="10" width="3" height="140" fill="rgba(0,0,0,0.40)"/>
  <rect x="31" y="10" width="3" height="140" fill="rgba(0,0,0,0.40)"/>
  <rect x="49" y="10" width="3" height="140" fill="rgba(0,0,0,0.40)"/>
  <rect x="67" y="10" width="3" height="140" fill="rgba(0,0,0,0.40)"/>
  <rect x="85" y="10" width="3" height="140" fill="rgba(0,0,0,0.40)"/>
  <!-- Pleat highlights -->
  <rect x="3"  y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <rect x="21" y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <rect x="39" y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <rect x="57" y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <rect x="75" y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <rect x="93" y="10" width="6" height="140" fill="url(#pikePleatHi)"/>
  <!-- Scalloped fringe -->
  <path d="M0 148 L10 160 L20 148 L30 160 L40 148 L50 160 L60 148 L70 160 L80 148 L90 160 L100 148 L100 160 L0 160 Z" fill="#2b0000"/>
  <!-- Gold tassel -->
  <circle cx="50" cy="150" r="4" fill="url(#pikeGoldRod)" stroke="#4a2a08" stroke-width="0.6"/>
  <line x1="50" y1="154" x2="50" y2="158" stroke="#8a5a1a" stroke-width="1.2"/>
</svg>
`.trim();

  // ─── 2c. DOME BRACKET LOGIC ──────────────────────────────────────────────
  // In the Dome, one "round" = a full 3-fight bracket (QF → SF → Final).
  // The last slot of each bracket is the Brain when round === 7 / 49 / post-
  // gold rematches, otherwise a standard pool trainer. Teams for all 3
  // opponents are pre-generated when a new bracket opens so the player can
  // preview the whole bracket before any battle starts.
  const DOME_BRACKET_SIZE = 3;

  function isDomeFacility(facility) {
    return facility && facility.rules && facility.rules.bracketTournament;
  }

  // Build (or return cached) the 3-trainer bracket for the current round.
  // Stored on run.bracketTrainers so the preview UI can reuse without
  // regenerating each screen refresh. Regenerates whenever the stored
  // round doesn't match the current one.
  function ensureBracketForDome(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return [];
    const currentRound = run.round + 1; // round about to be attempted
    if (run.bracketRound === currentRound && Array.isArray(run.bracketTrainers)
        && run.bracketTrainers.length === DOME_BRACKET_SIZE) {
      return run.bracketTrainers;
    }
    const lang = "en";
    const bossInfo = getBossRoundInfo(currentRound, facility);
    const brainDiff = computeRunDifficulty(currentRound, facility);
    const trainers = [];
    for (let i = 1; i <= DOME_BRACKET_SIZE; i++) {
      if (i === DOME_BRACKET_SIZE && bossInfo) {
        // Final slot = Brain fight on boss rounds. Brain brings his
        // canonical 3-mon team; active-pick happens at launch time.
        const brainTeam = bossInfo.kind === "silver"
          ? facility.brain.teamSilver
          : facility.brain.teamGold;
        trainers.push({
          name: facility.brain.name,
          sprite: facility.brain.sprite,
          team: brainTeam
            ? brainTeam.slice(0, 3).map((id) => ({
                id,
                moves: pickMovesetFor(id, brainDiff),
                nature: simulateNatureFor(id) }))
            : [1, 2, 3].map(() => {
                const id = pickFromPool(5);
                return { id, moves: pickMovesetFor(id, brainDiff), nature: simulateNatureFor(id) };
              }),
          tier: 3,
          multiplier: bossInfo.multiplier,
          bossKind: bossInfo.kind,
          isBoss: true });
      } else {
        // Regular bracket trainer — tier scales with round
        trainers.push(generateTrainer(currentRound, facility));
      }
    }
    run.bracketTrainers = trainers;
    run.bracketRound = currentRound;
    if (run.bracketBattle === undefined) run.bracketBattle = 1;
    return trainers;
  }

  // ─── 2b. ACCESS GATE ──────────────────────────────────────────────────────
  // All 7 secret facilities are locked until the player defeats Pokemon
  // Professor Oak in VS. Matches the Shop / VS-trainer pattern
  // (areas.vsXxx.defeated === true after the fight).
  const UNLOCK_KEY = "vsPokemonProfessorOak";
  // Reuse the existing GAME_UI key so FR/other-locale translation applies.
  const UNLOCK_TEXT_KEY = "defeatPokemonProfessorOakToUnlock";
  const UNLOCK_TEXT_FALLBACK = "Defeat Pokemon Professor Oak in VS to unlock";

  function isUnlocked() {
    try {
      return !!(typeof areas !== "undefined" && areas[UNLOCK_KEY] && areas[UNLOCK_KEY].defeated);
    } catch (e) {
      return false;
    }
  }

  function unlockText() {
    if (typeof t_ui === "function") {
      const t = t_ui(UNLOCK_TEXT_KEY);
      if (t && t !== UNLOCK_TEXT_KEY) return t;
    }
    return UNLOCK_TEXT_FALLBACK;
  }

  // ─── 3. SAVE STATE ────────────────────────────────────────────────────────
  // Namespaced under saved.frontierExt so we never collide with vanilla game.
  //   streaks    : current-run round counter (advances on each win)
  //   maxStreaks : best round reached ever, per facility
  //   symbols    : { silver, gold } flags per facility (round 7 / round 49)
  //   activeRun  : in-progress run state (or null if idle):
  //                { facilityId, round, upcomingTrainer }
  function ensureSaveSlot() {
    if (typeof saved !== "object" || !saved) return;
    if (!saved.frontierExt) {
      saved.frontierExt = {
        streaks: {},
        maxStreaks: {},
        symbols: {},
        activeRun: null,
        pausedRuns: {} };
    }
    if (saved.frontierExt.activeRun === undefined) saved.frontierExt.activeRun = null;
    // `pausedRuns` dict keyed by facilityId — stores runs the player
    // paused via the "Repos" button after a cleared round. Unlike
    // `activeRun` (which locks the team + blocks other facilities),
    // paused runs carry zero locks. Resuming one makes it the new
    // activeRun. Multiple paused runs can coexist (one per facility);
    // at most one activeRun at a time.
    if (!saved.frontierExt.pausedRuns) saved.frontierExt.pausedRuns = {};
    for (const f of FACILITIES) {
      if (saved.frontierExt.streaks[f.id] === undefined) saved.frontierExt.streaks[f.id] = 0;
      if (saved.frontierExt.maxStreaks[f.id] === undefined) saved.frontierExt.maxStreaks[f.id] = 0;
      if (!saved.frontierExt.symbols[f.id]) saved.frontierExt.symbols[f.id] = { silver: false, gold: false };
    }
    // Upgrade any legacy Pike state in-place (poison → poisoned etc.).
    migratePikeState();
  }

  // Helper — returns the effective "run for this facility" whether
  // active (currently locked in combat mode) or paused (saved for later
  // resume). Callers that need to distinguish can still read activeRun /
  // pausedRuns directly.
  function getRunForFacility(facilityId) {
    if (!saved || !saved.frontierExt) return null;
    const active = saved.frontierExt.activeRun;
    if (active && active.facilityId === facilityId) return active;
    return (saved.frontierExt.pausedRuns && saved.frontierExt.pausedRuns[facilityId]) || null;
  }

  function isPausedRun(facilityId) {
    return !!(saved && saved.frontierExt
              && saved.frontierExt.pausedRuns
              && saved.frontierExt.pausedRuns[facilityId]);
  }

  // ─── 3b. TRAINER GENERATOR ────────────────────────────────────────────────
  // Builds a random trainer for non-boss rounds (1-6, 8-48, 50+). Bosses are
  // round 7 / 49 — those use the facility's canonical brain team.
  //
  // Design goals:
  //   • Every trainer has a diverse, functional team (STAB attacks + at least
  //     one utility move per Pokémon).
  //   • Difficulty scales with round: round 1-2 mid-tier, 3-5 strong,
  //     6 / 8+ very strong, 49+ brutal.
  //   • Sprites drawn from the 100+ available in img/trainers/ so the pool
  //     feels populated.
  // Generic role-based sprites only — no iconic / named trainers (Cynthia,
  // Lance, Red, etc.) because their PNGs carry their own identity and pairing
  // them with random names breaks immersion. Bosses keep their canonical
  // sprite via `facility.brain.sprite`, generics are reserved for rounds 1-6.
  // Every filename below verified present in img/trainers/ (tree listed
  // against ls(img/trainers/)).
  const GENERIC_SPRITES_M = [
    "aceTrainerSnowM","artist","blackBelt","bugCatcher","channeler","clown",
    "firebreather","gentleman","hiker","hiker2","janitor","pokemaniac",
    "rocketGruntM","sailor","schoolKid","scientist","swimmer","veteran",
    "worker","youngster",
  ];
  const GENERIC_SPRITES_F = [
    "aceTrainerSnowF","aromaLady","battlegirl","beauty","birdkeeper",
    "hexmaniac","madame","psychic","rocketGruntF",
  ];
  const TRAINER_NAMES_EN_M = [
    "Jake","Hugh","Max","Alex","Trent","Cam","Rafe","Nick","Arthur","Luke",
    "Gabe","Noah","Eli","Mark","Jason","Sam","Victor","Leo","Theo","Paul",
  ];
  const TRAINER_NAMES_EN_F = [
    "Lilly","Olivia","Zoe","Emma","Chloe","Sarah","Julie","Mandy","Ines",
    "Luna","Jade","Alice","Lucy","Ellie","Mary","Noemi","Clara","Sophie",
    "Anna","Ivy",
  ];

  // Pokémon pool built dynamically from the full dictionary. Instead of
  // hard-coded BST ranges (fragile — depends on how the game distributes
  // stats), we sort every mon by BST at runtime and slice by percentile.
  // Guarantees each tier always has a sizeable pool no matter the data:
  //   tier 1 : bottom 50% of BSTs     (Rounds 1-2)   no unobtainable
  //   tier 2 : 30-75%                 (Rounds 3-5)   no unobtainable
  //   tier 3 : 60-95%                 (Rounds 6-48)  no unobtainable
  //   tier 4 : 60-100%                (post-Gold)    incl. unobtainable
  //   tier 5 : top 15%                (mult ≥ 3)     incl. unobtainable
  const TIER_PERCENTILE = {
    1: { minPct: 0.00, maxPct: 0.50, unobtainable: false },
    2: { minPct: 0.30, maxPct: 0.75, unobtainable: false },
    3: { minPct: 0.60, maxPct: 0.95, unobtainable: false },
    4: { minPct: 0.60, maxPct: 1.00, unobtainable: true },
    5: { minPct: 0.85, maxPct: 1.00, unobtainable: true } };

  // Kept for debug / compat with earlier tooling.
  const TIER_BST = TIER_PERCENTILE;

  function bstTotal(p) {
    if (!p || !p.bst) return 0;
    const b = p.bst;
    // Pokechill uses short keys (hp/atk/def/satk/sdef/spe) per
    // pkmnDictionary.js line 12+. Guard each in case a mon ships without
    // one of them (should never happen but defensive).
    return (b.hp || 0) + (b.atk || 0) + (b.def || 0)
         + (b.satk || 0) + (b.sdef || 0) + (b.spe || 0);
  }

  // Build a sorted list of all eligible {id, bst} for percentile slicing.
  // Excludes special forms and entries without BST. Unobtainable entries
  // are kept here — the tier config decides whether to include them at
  // pick time. MEMOISED because the pkmn dictionary never mutates after
  // boot — the full sort (1408 entries) only runs once per session.
  let _sortedBstCache = null;
  function buildSortedBstList() {
    if (_sortedBstCache) return _sortedBstCache;
    if (typeof pkmn === "undefined") return [];
    const out = [];
    for (const id of Object.keys(pkmn)) {
      const p = pkmn[id];
      if (!p || !p.bst) continue;
      if (/Mega|Gmax|Primal/.test(id)) continue;
      const total = bstTotal(p);
      if (total <= 0) continue;
      out.push({ id, bst: total, unobtainable: p.tagObtainedIn === "unobtainable" });
    }
    out.sort((a, b) => a.bst - b.bst);
    _sortedBstCache = out;
    return out;
  }

  // Tier-sliced pool cache. Same key (tier → pool ids) hits thousands
  // of times per run — generate once, reuse.
  const _poolCache = {};
  function getPool(tier) {
    if (_poolCache[tier]) return _poolCache[tier];
    if (typeof pkmn === "undefined") return ["tauros"];
    const cfg = TIER_PERCENTILE[tier] || TIER_PERCENTILE[1];
    const sorted = buildSortedBstList();
    if (!sorted.length) return ["tauros"];
    const lo = Math.floor(sorted.length * cfg.minPct);
    const hi = Math.ceil(sorted.length * cfg.maxPct);
    const ids = [];
    for (let i = lo; i < hi; i++) {
      const e = sorted[i];
      if (!cfg.unobtainable && e.unobtainable) continue;
      ids.push(e.id);
    }
    const pool = ids.length ? ids : ["tauros"];
    _poolCache[tier] = pool;
    return pool;
  }

  // Invalidate pool / sorted caches — rarely needed (only if the pkmn
  // dict is mutated externally). Kept for the debug API.
  function resetPoolCache() {
    _sortedBstCache = null;
    for (const k of Object.keys(_poolCache)) delete _poolCache[k];
  }

  // Diagnostic: inspect the actual BST distribution + per-tier pool sizes.
  // Run from DevTools: __frontierExt.debugPool() (no args = full summary)
  // or __frontierExt.debugPool(2) for a specific tier's slice + sample.
  function debugPool(tier) {
    const sorted = buildSortedBstList();
    const summary = {
      totalEligible: sorted.length,
      minBst: sorted[0] ? sorted[0].bst : null,
      maxBst: sorted[sorted.length - 1] ? sorted[sorted.length - 1].bst : null,
      unobtainableCount: sorted.filter((e) => e.unobtainable).length,
      tiers: {} };
    for (const t of [1, 2, 3, 4, 5]) {
      const pool = getPool(t);
      summary.tiers[t] = {
        size: pool.length,
        bstRange: pool.length
          ? [
              Math.min(...pool.map((id) => bstTotal(pkmn[id]))),
              Math.max(...pool.map((id) => bstTotal(pkmn[id]))),
            ]
          : null,
        sample: pool.slice(0, 6) };
    }
    if (tier !== undefined) {
      summary.detail = summary.tiers[tier];
    }
    return summary;
  }

  // Debug helper: wipe the active run (including the cached bracket
  // trainers) so the next click re-generates everything from scratch with
  // the current code. Useful after fixing a trainer-gen bug while a run
  // was mid-flight.
  function resetActiveRun() {
    if (typeof saved === "object" && saved && saved.frontierExt) {
      saved.frontierExt.activeRun = null;
    }
    refreshActiveFrontierView();
  }

  function pickFromPool(tier) {
    const list = getPool(tier);
    return list[Math.floor(Math.random() * list.length)] || "tauros";
  }

  // Facility-aware pool. Starts from the raw tier pool, then applies
  // per-facility rebalances:
  //   • Arena   : bias toward high-Speed mons (top 60% of tier by Speed)
  //   • Factory : crescendo — rounds 1-3 only see the lowest X% of the
  //               tier's BST range, so the very first fights feel like
  //               a tutorial instead of a wall. Opens up to the full
  //               tier from round 4 onward, with the tier itself bumping
  //               naturally at rounds 3 / 6 / gold (see generateTrainer).
  //   • Pike    : 70% mons with Poison/Ghost/Psychic typing — matches the
  //               "status-heavy traps" identity of Emerald's Pike (Seviper,
  //               Shuckle, Milotic roster + poison/burn door effects).
  //   • Pyramid : 70% mons with Ghost/Rock/Ground/Dark typing — matches
  //               Brandon's regi+legendary bird roster and the dungeon's
  //               cramped-cave feel.
  //   • Palace  : bias toward Pokémon with strong offensive bias (large
  //               atk/satk gap) so simulateNatureFor yields decisive
  //               natures → Palace's nature-gated move selection feels
  //               meaningfully different from a random pool.
  //
  // Returns the raw tier pool as fallback if narrowing would empty it.
  function getPoolForFacility(facility, tier, round) {
    let pool = getPool(tier);
    if (isArenaFacility(facility)) pool = arenaBiasPoolBySpeed(pool);
    if (isFactoryFacility(facility) && round <= 3) {
      if (typeof pkmn !== "undefined" && pool.length > 6) {
        const pct = round === 1 ? 0.30 : round === 2 ? 0.55 : 0.80;
        const sorted = pool
          .map((id) => ({ id, bst: bstTotal(pkmn[id]) || 0 }))
          .sort((a, b) => a.bst - b.bst);
        pool = sorted.slice(0, Math.max(FACTORY_POOL_SIZE, Math.ceil(sorted.length * pct)))
                     .map((e) => e.id);
      }
    }
    if (isPikeFacility(facility)) pool = themeBiasPool(pool, ["poison", "ghost", "psychic"], 0.7);
    else if (isPyramidFacility(facility)) pool = themeBiasPool(pool, ["ghost", "rock", "ground", "dark"], 0.7);
    else if (isPalaceFacility(facility)) pool = palaceBiasPool(pool);
    return pool.length ? pool : getPool(tier);
  }

  // 70/30 type-themed pool: returns a list that is ~`ratio` themed IDs +
  // the rest from the general pool. Uses concatenation so Math.random()
  // natively hits the themed side ~ratio of the time. If not enough
  // themed mons exist, falls back to the raw pool (caller's `|| getPool`
  // safety net guarantees we never return empty).
  function themeBiasPool(ids, themeTypes, ratio) {
    if (typeof pkmn === "undefined" || !Array.isArray(ids) || ids.length < 8) return ids;
    const set = new Set(themeTypes);
    const themed = [];
    const rest = [];
    for (const id of ids) {
      const p = pkmn[id];
      if (!p) continue;
      const types = Array.isArray(p.type) ? p.type : [p.type];
      if (types.some((t) => set.has(t))) themed.push(id);
      else rest.push(id);
    }
    if (themed.length < 4) return ids; // not enough themed mons; skip bias
    // Duplicate themed IDs to bias random picks toward the theme without
    // excluding the rest of the tier entirely.
    const themedWeight = Math.ceil((themed.length / (1 - ratio)) - themed.length);
    const biased = [];
    for (let i = 0; i < themedWeight; i++) biased.push(...themed);
    biased.push(...rest);
    return biased.length ? biased : ids;
  }

  // Palace bias: Emerald's Palace rule picks an opponent's move based on
  // nature (cool/beauty/tough/etc.). The Pokechill overlay proxies that
  // via simulateNatureFor which returns a NON-neutral nature only when a
  // mon has a clear offensive/defensive lean. A pool of stat-ambiguous
  // mons would all default to "" (neutral) → the rule stops mattering.
  // Keep the ~60% of the pool with a large atk/satk gap or obvious bulk
  // → the Palace fight always has a dominant playstyle on the NPC side.
  function palaceBiasPool(ids) {
    if (typeof pkmn === "undefined" || !Array.isArray(ids) || ids.length < 8) return ids;
    const expressive = ids.filter((id) => {
      const p = pkmn[id];
      if (!p || !p.bst) return false;
      const { atk, satk, def, sdef, hp } = p.bst;
      const offGap = Math.abs((atk || 0) - (satk || 0));
      const defGap = Math.abs((def || 0) - (sdef || 0));
      return offGap >= 25 || defGap >= 25 || hp + def + sdef >= 260;
    });
    return expressive.length >= 6 ? expressive : ids;
  }

  // Build a strategic 4-move set for a Pokémon. Goals:
  //   • Always 1 strong STAB attack for primary type (ex: Venusaur gets
  //     Giga Drain / Sludge Bomb, never tackle).
  //   • If dual-type: 1 STAB attack for secondary type; else 1 coverage.
  //   • 1 utility move (buff, status, heal, weather — whatever fits).
  //   • Signature move used if power ≥ 65 AND hasn't already been covered.
  //
  // Curated "genetic" move pool that A-division and S-division Pokémon
  // can also learn — beyond their natural type-restricted pool. These
  // are moves that, in canonical Pokémon, are widely distributed across
  // species via egg-moves / TMs / tutors. Every key is verified to exist
  // in Pokechill's moveDictionary so lookups don't no-op.
  //
  // B / C / D division Pokémon keep their current full-access privilege
  // (they can learn ANY move). This set is additive on top of the
  // natural moveset for A / S division only.
  const GENETIC_MOVES_FOR_ALL = new Set([
    // Status / utility
    "thunderWave", "willOWisp", "toxic", "swagger", "confuseRay",
    "safeguard", "reflect", "lightScreen",
    // Weather
    "sunnyDay", "sandstorm", "rainDance",
    // Stat buffs (classic egg-move territory)
    "swordsDance", "nastyPlot", "calmMind", "bulkUp",
    "agility", "dragonDance", "rockPolish", "quiverDance", "shiftGear",
    // Healing
    "morningSun",
    // Priority attacks (speed-leveraging)
    "quickAttack", "extremeSpeed", "bulletPunch", "iceShard",
    "aquaJet", "vacuumWave", "shadowSneak", "machPunk",
    // Universal coverage (most species can learn at least one of these)
    "flamethrower", "thunderbolt", "iceBeam", "earthquake", "stoneEdge",
    "psychic", "energyBall", "sludgeBomb", "shadowBall",
    "facade",
  ]);

  // GENETICS + ITEM RULE: in the game, B-division Pokémon (and below) can
  // learn ANY move via genetics + a specific item. NPC trainers exploit
  // this — B-or-lower mons get the full pool, making weaker species
  // potentially monstrous. A-division and S-division Pokémon get their
  // natural moveset PLUS the curated GENETIC_MOVES_FOR_ALL set above —
  // they can still have common egg moves like Dragon Dance, Ice Beam,
  // Extreme Speed etc., even when their type doesn't natively cover it.
  //
  // `diff` (optional) = computeRunDifficulty result. When present it unlocks:
  //   • eggMove inclusion (useEggMove)       → wider coverage at Silver+
  //   • forced signature in slot 1            → boss mons keep their identity
  //   • (future) level-dependent move quality floor
  // When omitted, the function behaves exactly like before — keeps backward
  // compatibility with callers in the bracket/Pike preview paths.
  // ─── MOVE CATEGORY CACHE ──────────────────────────────────────────────
  // Built once per session (move dict is immutable post-boot) by scanning
  // `move[k].hitEffect.toString()` for the game's real effect patterns.
  // The old pickMovesetFor used broad regexes like /atkup[12]/ that missed
  // most setup / weather / terrain / screen moves because the actual
  // hitEffect format is `moveBuff(target, 'atkup2', 'self')` with quotes
  // and `changeWeather('sunny')` for weather. We key off those instead.
  let _moveCatsCache = null;
  function buildMoveCategories() {
    if (_moveCatsCache) return _moveCatsCache;
    if (typeof move === "undefined") return { cats: {}, buffKind: {} };
    const cats = {
      setupAtk: [],       // Swords Dance / Howl / Hone Claws (atkup1|2)
      setupSatk: [],      // Nasty Plot / Tail Glow (satkup1|2)
      setupSpe: [],       // Agility / Rock Polish / Autotomize (speup2)
      setupMixOff: [],    // Dragon Dance / Shift Gear / Quiver Dance (atk+spe, satk+spe)
      setupExtreme: [],   // Belly Drum / Shell Smash / Clangorous Soul (huge or +3)
      setupDef: [],       // Iron Defense / Amnesia / Calm Mind / Bulk Up (def/sdef up)
      weatherSun: [],
      weatherRain: [],
      weatherSand: [],
      weatherHail: [],
      terrainElec: [],
      terrainGrass: [],
      terrainMisty: [],
      screenReflect: [],  // Reflect / Light Screen / Safeguard
      screenLight: [],
      roomField: [],      // Trick Room / Wonder Room / Magic Room
      debuff: [],         // Status-inflicting or stat-down
      healing: [],        // Recover / Roost / Morning Sun
    };
    const buffKind = {}; // moveKey → string category (for quick lookup)
    const markCat = (bucket, id) => {
      cats[bucket].push(id);
      buffKind[id] = bucket;
    };

    for (const [k, mv] of Object.entries(move)) {
      if (!mv || typeof mv.hitEffect !== "function") continue;
      const src = mv.hitEffect.toString();
      const isStatus = mv.split === "status" || !mv.power;

      // Weather / terrain / screens — exclusive detection via changeWeather("X")
      const weatherMatch = src.match(/changeWeather\(\s*['"]([a-zA-Z]+)['"]/);
      if (weatherMatch) {
        const w = weatherMatch[1];
        if (w === "sunny")           markCat("weatherSun", k);
        else if (w === "rainy")      markCat("weatherRain", k);
        else if (w === "sandstorm")  markCat("weatherSand", k);
        else if (w === "hail")       markCat("weatherHail", k);
        else if (w === "electricTerrain") markCat("terrainElec", k);
        else if (w === "grassyTerrain")   markCat("terrainGrass", k);
        else if (w === "mistyTerrain")    markCat("terrainMisty", k);
        else if (w === "reflect")         markCat("screenReflect", k);
        else if (w === "lightScreen")     markCat("screenLight", k);
        else if (/(trickRoom|weirdRoom|crossRoom|foggy|safeguard)/.test(w)) markCat("roomField", k);
        continue;
      }

      if (!isStatus) {
        // Attack with a secondary buff/debuff — don't categorise as pure
        // setup/debuff (we don't want Volt Tackle in "setupAtk" just because
        // it includes a side-effect). Only status-split moves get indexed.
        continue;
      }

      // Count self-target stat-up instances by stat + magnitude
      let selfAtk = 0, selfSatk = 0, selfSpe = 0, selfDef = 0, selfSdef = 0;
      const buffRe = /moveBuff\s*\([^,]+,\s*['"]([a-zA-Z]+)(up)?(down)?([0-9])['"]\s*(?:,\s*['"]self['"]\s*)?\)/g;
      // Simpler direct pattern — match each self-buff call
      const selfRe = /moveBuff\s*\([^,]+,\s*['"]([a-zA-Z]+)(up|down)([0-9])['"]\s*,\s*['"]self['"]/g;
      let m;
      while ((m = selfRe.exec(src)) !== null) {
        const stat = m[1], dir = m[2], mag = parseInt(m[3], 10);
        if (dir !== "up") continue;
        if (stat === "atk")  selfAtk  += mag;
        if (stat === "satk") selfSatk += mag;
        if (stat === "spe")  selfSpe  += mag;
        if (stat === "def")  selfDef  += mag;
        if (stat === "sdef") selfSdef += mag;
      }
      // Some moves omit the "self" arg (defaults to user) — legacy syntax.
      // Detect pure self-buff moves by checking if the move has no opponent-
      // facing damage and buffs show up at all.
      if (selfAtk + selfSatk + selfSpe + selfDef + selfSdef === 0) {
        // No self-buff detected — check for team-buff or debuff patterns.
        const teamBuffRe = /moveBuff\([^,]+,\s*['"][a-zA-Z]+up[0-9]['"]\s*,\s*['"]team['"]/;
        if (teamBuffRe.test(src)) {
          markCat("setupDef", k); // team-wide buff = support role
          continue;
        }
        const debuffRe = /moveBuff\([^,]+,\s*['"](poisoned|burn|paralysis|sleep|confused|atkdown|satkdown|defdown|sdefdown|spedown|frozen)/;
        if (debuffRe.test(src)) { markCat("debuff", k); continue; }
        const healRe = /heal\s*\(|hpHeal|recover|restoreHp/i;
        if (healRe.test(src)) { markCat("healing", k); continue; }
        continue;
      }

      const totalOff = selfAtk + selfSatk + selfSpe;
      const totalDef = selfDef + selfSdef;
      // Extreme-booster detection: any single-stat +3, or multi-stat where
      // all three offensive stats boost simultaneously (Shell Smash ++),
      // or an omni-boost (+1 to everything, Clangorous Soul / Ancient Power proc).
      const maxStat = Math.max(selfAtk, selfSatk, selfSpe, selfDef, selfSdef);
      const omniBoost = selfAtk && selfSatk && selfSpe && selfDef && selfSdef;
      if (maxStat >= 3 || omniBoost || (selfAtk >= 2 && selfSpe >= 2)) {
        markCat("setupExtreme", k);
        continue;
      }

      // Offensive+Speed combo (Dragon Dance / Quiver Dance / Shift Gear)
      if ((selfAtk && selfSpe) || (selfSatk && selfSpe)) {
        markCat("setupMixOff", k);
        continue;
      }

      // Single-stat offensive setup
      if (selfAtk  && !selfSatk && !selfSpe) { markCat("setupAtk", k); continue; }
      if (selfSatk && !selfAtk  && !selfSpe) { markCat("setupSatk", k); continue; }
      if (selfSpe  && !selfAtk  && !selfSatk) { markCat("setupSpe", k); continue; }

      // Otherwise: defensive or mixed-defense setup
      if (totalDef || totalOff) { markCat("setupDef", k); continue; }
    }

    _moveCatsCache = { cats, buffKind };
    return _moveCatsCache;
  }

  // Hidden-ability weather-setter → which weather category to feed.
  // Abilities trigger changeWeather() on switch-in (explore.js:4027+), so a
  // mon with `hiddenAbility.drought` doesn't need Sunny Day in slot 1 —
  // it needs strong fire/fire-boosted moves that benefit from the auto-sun.
  function weatherFromAbility(abilityId) {
    if (!abilityId) return null;
    if (abilityId === "drought")     return "sunny";
    if (abilityId === "drizzle")     return "rainy";
    if (abilityId === "sandStream")  return "sandstorm";
    if (abilityId === "snowWarning") return "hail";
    if (abilityId === "electricSurge") return "electricTerrain";
    if (abilityId === "grassySurge")   return "grassyTerrain";
    if (abilityId === "mistySurge")    return "mistyTerrain";
    return null;
  }

  // ─── pickMovesetFor — strategic, archetype-aware moveset builder ──────
  // Replaces the legacy "slot 1 sig, slot 2 STAB, slot 3 utility" loop
  // with a role-driven planner:
  //   1. Infer archetype from BST + hidden ability + signature BP
  //   2. Guaranteed signature slot at post-Silver (even if BP<65)
  //   3. Guaranteed egg move slot at post-Silver for B-division and below
  //      (canonical "genetics + item" rule in Pokechill lets low-div mons
  //      inherit ANY move; NPCs exploit this)
  //   4. MANDATORY setup slot matching archetype (Swords Dance for phys,
  //      Nasty Plot for spec, Dragon Dance for balanced-speed sweepers,
  //      Calm Mind for bulky special, Iron Defense for walls, Shell Smash
  //      etc. for explosive sweepers)
  //   5. STAB + coverage with proper split preference
  //   6. Priority or secondary STAB filler
  //
  // `diff` (from computeRunDifficulty) drives:
  //   • forceSignature   — slot the signature always post-Gold
  //   • useEggMove       — force egg move post-Silver
  //   • forceHiddenAbility — tells us which weather will be up, so we can
  //                         pick sun/rain-boosted STAB or skip weather setup
  function pickMovesetFor(pkmnId, diff) {
    const p = typeof pkmn !== "undefined" ? pkmn[pkmnId] : null;
    if (!p || typeof move === "undefined") return [];
    const types = Array.isArray(p.type) ? p.type : [p.type];
    const primaryType = types[0];
    const secondaryType = types[1];
    const { cats, buffKind } = buildMoveCategories();

    // Division: B/C/D get unrestricted learning (the game lets them learn
    // ANY move via genetics+item). A/S+ restricted to natural type-gated
    // pool + GENETIC_MOVES_FOR_ALL. Egg moves always go in.
    let division = "C";
    try {
      if (typeof returnPkmnDivision === "function") division = returnPkmnDivision(p);
    } catch (e) { /* keep default */ }
    const unrestrictedLearning = /^[BCD]$/.test(division);
    const isLowDivision = unrestrictedLearning;

    // Forced moves: signature (at appropriate difficulty) + egg move
    const sigKey = (p.signature && p.signature.id) || null;
    const eggKey = (p.eggMove && p.eggMove.id) || null;

    // Archetype inference — drives which setup bucket we draw from.
    const stats = p.bst || { hp: 3, atk: 3, def: 3, satk: 3, sdef: 3, spe: 3 };
    const atk = stats.atk || 0, satk = stats.satk || 0;
    const spe = stats.spe || 0, hp = stats.hp || 0;
    const def = stats.def || 0, sdef = stats.sdef || 0;
    const isPhys = atk > satk + 15;
    const isSpec = satk > atk + 15;
    const isFast = spe >= 95;
    const isBulky = (hp + def + sdef) >= 260;

    // Weather tie-in. If the mon has a weather-setter hidden ability AND
    // the diff forces hidden ability, the weather is auto-set — boosted
    // STAB becomes the main win condition instead of Sunny Day.
    const hiddenAbilityId = (p.hiddenAbility && p.hiddenAbility.id) || null;
    const autoWeather = (diff && diff.forceHiddenAbility) ? weatherFromAbility(hiddenAbilityId) : null;

    // Build learnable pool filter.
    const eggMoveActive = !!(diff && diff.useEggMove && eggKey);
    const isLearnable = (mv, key) => {
      if (!mv) return false;
      if (key && eggMoveActive && key === eggKey) return true;     // egg move always in post-Silver
      if (key && sigKey && key === sigKey) return true;            // signature always in
      if (!Array.isArray(mv.moveset)) return false;                // signature-only etc. handled above
      if (unrestrictedLearning) return true;
      if (mv.moveset.indexOf("all") !== -1) return true;
      if (mv.moveset.indexOf("normal") !== -1) return true;
      for (const t of types) { if (t && mv.moveset.indexOf(t) !== -1) return true; }
      return !!(key && GENETIC_MOVES_FOR_ALL.has(key));
    };

    const pool = [];
    for (const [k, mv] of Object.entries(move)) {
      if (mv && mv.notUsableByEnemy) continue;                     // canonical "player-only" flag
      if (!isLearnable(mv, k)) continue;
      pool.push({ id: k, mv });
    }

    const chosen = [];
    // `restricted` in Pokechill is a TEAM-level constraint (at most one
    // such move across the whole team). The battle engine enforces it —
    // we don't police it at the per-mon picker level, or signature +
    // Nasty Plot / Dragon Dance mons lose their setup slot. Signature
    // moves and strongest boosters are OFTEN both restricted; blocking
    // at pick-time yielded movesets like [kinesis, futureSight, stoneEdge,
    // meteorBeam] — sig but zero setup — exactly what the user reported.
    const push = (key) => {
      if (!key || chosen.indexOf(key) !== -1 || chosen.length >= 4) return false;
      const mv = move[key];
      if (!mv) return false;
      chosen.push(key);
      return true;
    };

    const splitMatches = (mv) => {
      if (!mv) return false;
      if (mv.split === "status") return true;
      if (isPhys) return mv.split !== "special";
      if (isSpec) return mv.split !== "physical";
      return true;
    };

    const pickTopN = (list, n) => {
      if (!list.length) return null;
      const slice = list.slice(0, Math.min(n, list.length));
      const weights = slice.map((_, i) => slice.length - i);
      const total = weights.reduce((s, w) => s + w, 0);
      let r = Math.random() * total;
      for (let i = 0; i < slice.length; i++) {
        r -= weights[i];
        if (r <= 0) return slice[i];
      }
      return slice[0];
    };

    // ── Attack shortlists (sorted by power DESC) ──
    const stabPrimary = pool
      .filter((c) => c.mv.type === primaryType && c.mv.power >= 60 && splitMatches(c.mv))
      .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0));
    const stabSecondary = secondaryType
      ? pool.filter((c) => c.mv.type === secondaryType && c.mv.power >= 60 && splitMatches(c.mv))
            .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0))
      : [];
    const coverageAttacks = pool
      .filter((c) => c.mv.power >= 70
                   && c.mv.type !== primaryType
                   && c.mv.type !== secondaryType
                   && c.mv.type !== "normal"
                   && splitMatches(c.mv))
      .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0));
    const normalAttacks = pool
      .filter((c) => c.mv.type === "normal" && c.mv.power >= 60 && splitMatches(c.mv))
      .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0));
    const priorityAttacks = pool
      .filter((c) => c.mv.power > 0 && c.mv.timer !== undefined && splitMatches(c.mv))
      .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0));

    // Learnable-only filter for setup buckets (they live as move IDs).
    const learnableCat = (bucketName) => (cats[bucketName] || [])
      .filter((k) => pool.some((c) => c.id === k));

    // Archetype-ordered setup preference. At post-Silver we REQUIRE a
    // setup slot; the order below controls which one we reach for first
    // based on the mon's stat profile.
    const setupPref = (() => {
      if (isPhys && isFast)              return ["setupMixOff", "setupAtk", "setupExtreme", "setupSpe", "setupDef"];
      if (isSpec && isFast)              return ["setupMixOff", "setupSatk", "setupExtreme", "setupSpe", "setupDef"];
      if (isPhys)                        return ["setupAtk", "setupExtreme", "setupMixOff", "setupSpe", "setupDef"];
      if (isSpec)                        return ["setupSatk", "setupExtreme", "setupMixOff", "setupSpe", "setupDef"];
      if (isBulky)                       return ["setupDef", "setupAtk", "setupSatk", "setupMixOff"];
      return ["setupMixOff", "setupExtreme", "setupAtk", "setupSatk", "setupSpe", "setupDef"];
    })();

    // ── SLOT 1: Signature ──
    // Rules:
    //   • If signature BP ≥ 80                       → always slot it
    //   • If diff.forceSignature (Gold+)             → always slot it
    //   • Else if BP ≥ 65 and split matches          → slot it
    // This guarantees mons with real signatures (Frenzy Plant 180,
    // Sacred Fire 120, Spacial Rend 120) keep their identity.
    if (sigKey) {
      const sig = move[sigKey];
      if (sig) {
        const forceSig = diff && diff.forceSignature;
        const strongSig = (sig.power || 0) >= 80;
        const okSig = (sig.power || 0) >= 65 && splitMatches(sig);
        if (forceSig || strongSig || okSig) push(sigKey);
      }
    }

    // ── SLOT 2: Egg move (post-Silver, esp. low divisions) ──
    // Low-division mons inherit egg moves as their only "spicy" coverage
    // per the game's genetics rule. For A/S+ we still honour the egg
    // move but it's less unique (they already have wide pools).
    if (eggMoveActive && eggKey && move[eggKey]) {
      if (isLowDivision || chosen.length === 0) push(eggKey);
      // high divisions still get it ~50% to keep variety
      else if (Math.random() < 0.5) push(eggKey);
    }

    // ── SLOT 3: MANDATORY SETUP at post-Silver ──
    // Skipped if we're pre-Silver (IV rating < 3) — early-round trainers
    // keep their movepool simple. At Silver+ every mon gets a setup move
    // that matches its archetype; at Gold+ extreme boosters (Shell Smash,
    // Belly Drum) start showing up.
    const allowSetup = !diff || (diff.ivRating || 0) >= 3;
    if (allowSetup && chosen.length < 4) {
      let setupKey = null;
      for (const bucket of setupPref) {
        const learnables = learnableCat(bucket);
        if (!learnables.length) continue;
        // Bias: at Gold+ prefer extreme boosters when available.
        const prefExtreme = diff && (diff.mult || 0) >= 1 && (diff.forceSignature || diff.ivRating === 6);
        if (prefExtreme && bucket !== "setupExtreme") {
          const extreme = learnableCat("setupExtreme");
          if (extreme.length && Math.random() < 0.35) { setupKey = extreme[Math.floor(Math.random() * extreme.length)]; break; }
        }
        setupKey = learnables[Math.floor(Math.random() * learnables.length)];
        if (setupKey) break;
      }
      if (setupKey) push(setupKey);
    }

    // ── SLOT 4a: Weather / terrain setter when it synergizes ──
    // If the mon doesn't auto-set weather via ability AND a STAB damage
    // move would be boosted by one of them, 20% chance to slot the
    // weather. Gives us Rain Dance + Hydro Pump / Sunny Day + Fire Blast
    // combos on support-y mons.
    if (!autoWeather && chosen.length < 4 && Math.random() < 0.20) {
      const stabs = new Set(types);
      let weatherBucket = null;
      if (stabs.has("fire"))      weatherBucket = "weatherSun";
      else if (stabs.has("water")) weatherBucket = "weatherRain";
      else if (stabs.has("rock") || stabs.has("ground") || stabs.has("steel")) weatherBucket = "weatherSand";
      else if (stabs.has("ice"))   weatherBucket = "weatherHail";
      else if (stabs.has("electric")) weatherBucket = "terrainElec";
      else if (stabs.has("grass"))    weatherBucket = "terrainGrass";
      else if (stabs.has("fairy"))    weatherBucket = "terrainMisty";
      if (weatherBucket) {
        const list = learnableCat(weatherBucket);
        if (list.length) push(list[Math.floor(Math.random() * list.length)]);
      }
    }

    // ── SLOT 4b: Primary STAB (unless signature already covered it) ──
    if (chosen.length < 4) {
      const primaryKey = pickTopN(stabPrimary, 3);
      if (primaryKey) push(primaryKey.id);
    }

    // ── SLOT 4c: Secondary STAB or coverage ──
    if (chosen.length < 4) {
      if (stabSecondary.length) {
        const s2 = pickTopN(stabSecondary, 3);
        if (s2) push(s2.id);
      } else {
        const cov = pickTopN(coverageAttacks, 4);
        if (cov) push(cov.id);
      }
    }

    // ── SLOT 4d: Priority (for sweepers) or coverage fallback ──
    if (chosen.length < 4) {
      if (isFast || isPhys) {
        const prio = pickTopN(priorityAttacks, 3);
        if (prio) push(prio.id);
      }
    }

    // ── Coverage fill ──
    if (chosen.length < 4) {
      const cov = pickTopN(coverageAttacks, 5);
      if (cov) push(cov.id);
    }
    if (chosen.length < 4) {
      const backup = pickTopN(stabPrimary.slice(1), 4);
      if (backup) push(backup.id);
    }
    if (chosen.length < 4) {
      const nrm = pickTopN(normalAttacks, 4);
      if (nrm) push(nrm.id);
    }

    // ── Emergency: anything learnable with power ──
    if (chosen.length < 4) {
      const anyAtk = pool
        .filter((c) => c.mv.power > 0 && splitMatches(c.mv))
        .sort((a, b) => (b.mv.power || 0) - (a.mv.power || 0));
      for (const c of anyAtk) {
        if (chosen.length >= 4) break;
        push(c.id);
      }
    }
    // Absolute last resort — Tackle, so we never return <4.
    while (chosen.length < 4 && move.tackle) {
      if (chosen.indexOf("tackle") !== -1) break;
      chosen.push("tackle");
    }

    return chosen.slice(0, 4);
  }

  // Pick a sprite + a gender-matching name. Neutral sprites get a random
  // pick from either name pool so we don't accidentally pair e.g. a
  // "beauty" sprite with "Gabriel" or a "blackBelt" sprite with "Lucie".
  // Pick a sprite + a gender-matching name. Probability reflects bucket size
  // roughly (22 M : 7 F), but floored at 30% F so women show up often enough.
  function pickSpriteAndName(lang) {
    const roll = Math.random();
    let gender, pool;
    if (roll < 0.7) {
      gender = "M";
      pool = GENERIC_SPRITES_M;
    } else {
      gender = "F";
      pool = GENERIC_SPRITES_F;
    }
    const sprite = pool[Math.floor(Math.random() * pool.length)];
    const nameList = gender === "M" ? TRAINER_NAMES_EN_M : TRAINER_NAMES_EN_F;
    const name = nameList[Math.floor(Math.random() * nameList.length)];
    return { sprite, name, gender };
  }

  // Simulate a nature for an NPC Pokémon based on its BST profile so the
  // Palace auto-move rule can apply to enemies too (they have no real
  // nature in vanilla). Picks from the 7 Pokechill natures + empty.
  function simulateNatureFor(pkmnId) {
    const p = typeof pkmn !== "undefined" ? pkmn[pkmnId] : null;
    if (!p || !p.bst) return "";
    const { atk, def, satk, sdef, spe, hp } = p.bst;
    const physOffense = atk > satk * 1.15;
    const specOffense = satk > atk * 1.15;
    const fast = spe >= 100;
    const bulky = hp + def + sdef >= 260;
    const wallPhys = def > sdef * 1.25;
    const wallSpec = sdef > def * 1.25;

    if (bulky && wallPhys) return "bold";
    if (bulky && wallSpec) return "quiet";
    if (bulky && hp >= 95) return "relaxed";
    if (fast && (physOffense || specOffense)) return "jolly";
    if (physOffense) return "adamant";
    if (specOffense) return "modest";
    return ""; // neutral
  }

  // ── Arena balance helpers ──────────────────────────────────────────────
  // The 3-turn-per-side judge already neutralises the speed-team
  // advantage (the fast side has to WAIT for the slow side to complete
  // its 3 moves before the verdict fires). We only keep two gentle
  // biases that shape the roster flavour without costing a moveset slot:
  //   • Pool bias  : prefer the top 60% by Speed inside the tier
  //   • Nature     : swap "relaxed" / "bold" out for "jolly" (those two
  //                  natures lower Speed, which no arena NPC would run).
  // No forced speed-manipulation move is injected — that used to waste
  // a slot and produce weaker movesets now that the judge does the work.
  function arenaBiasPoolBySpeed(ids) {
    if (typeof pkmn === "undefined") return ids;
    if (!Array.isArray(ids) || ids.length < 5) return ids;
    const scored = ids
      .map((id) => ({ id, spe: (pkmn[id] && pkmn[id].bst && pkmn[id].bst.spe) || 0 }))
      .sort((a, b) => b.spe - a.spe);
    return scored.slice(0, Math.ceil(scored.length * 0.6)).map((e) => e.id);
  }

  function arenaBiasNature(originalNature /*, pkmnData */) {
    if (originalNature === "relaxed" || originalNature === "bold") return "jolly";
    return originalNature;
  }

  function generateTrainer(round, facility) {
    const lang = "en";
    const { sprite, name } = pickSpriteAndName(lang);

    const diff = computeRunDifficulty(round, facility);
    const { tier, mult } = diff;

    // Every facility's NPC brings 3 Pokémon. Dôme picks 2 to actually
    // fight at match-time (see openDomePokemonSelection). The facility
    // pool helper unifies Arena speed-bias + Factory early-round
    // crescendo + per-facility theme bias.
    const arenaBias = isArenaFacility(facility);
    const pool = getPoolForFacility(facility, tier, round);
    const size = 3;
    const slots = [];
    const usedIds = new Set(); // no-duplicate-species guard per trainer
    for (let i = 0; i < size; i++) {
      let id;
      let safety = 0;
      do {
        id = pool[Math.floor(Math.random() * pool.length)] || pickFromPool(tier);
        safety++;
      } while (id && usedIds.has(id) && safety < 20 && pool.length > size);
      if (!id) id = pickFromPool(tier);
      usedIds.add(id);
      const moves = pickMovesetFor(id, diff);
      let nature = simulateNatureFor(id);
      if (arenaBias) nature = arenaBiasNature(nature);
      slots.push({ id, moves, nature });
    }

    return {
      name,
      sprite,
      team: slots,
      tier,
      round,
      multiplier: mult,
      facilityId: facility.id };
  }

  // ─── 4. STYLES (injected, same pattern as i18n lang-toggle) ───────────────
  function injectStyles() {
    if (document.getElementById("frontier-ext-css")) return;
    const css = `
      /* Mirror the vanilla #frontier-listing / #vs-listing layout so the
         Hoenn listing row widths match the Trainers + Battle Frontier
         tabs. Without this, the Hoenn tiles rendered at their
         intrinsic size and overflowed the viewport on narrow mobile
         screens (reports: text clipped on the left, tiles extending
         past the right edge). styles.css:2759 drives the vanilla
         containers. */
      #frontier-hoenn-listing {
        height: auto;
        margin-top: 0;
        width: 95%;
        padding: 0rem;
        display: flex;
        justify-content: start;
        align-items: center;
        flex-direction: column;
        gap: 0.3rem;
        position: relative;
      }
      /* Whole-tile hue rotation gives each facility its own colour identity. */
      .frontier-ext-tile {
        position: relative;
        filter: hue-rotate(var(--hue, 0deg));
      }
      /* Counter-rotate the brain sprite so its colours stay true despite the
         tile tint. Same trick as the original Battle Factory tile. */
      .frontier-ext-tile img.frontier-ext-brain-icon {
        filter: hue-rotate(calc(var(--hue, 0deg) * -1));
        image-rendering: pixelated;
        height: 100%;
        width: auto;
        max-height: 7rem;
      }
      /* Run-in-progress badge — pulsing red pill that appears on the
         one tile where an activeRun is bound. Players see at a glance
         which facility they're committed to, without opening any tile. */
      .frontier-ext-inprogress-tag {
        display: inline-block;
        background: linear-gradient(90deg, #c0392b, #e74c3c, #c0392b);
        color: #ffecec;
        font-size: 0.7rem;
        padding: 0.1rem 0.55rem;
        border-radius: 0.2rem;
        margin-left: 0.3rem;
        vertical-align: middle;
        letter-spacing: 0.05em;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        box-shadow:
          0 0 0 1px rgba(255, 100, 100, 0.5),
          0 0 6px rgba(231, 76, 60, 0.55);
        animation: frontierInProgressPulse 1.8s ease-in-out infinite;
      }
      .frontier-ext-inprogress-tag::before {
        /* tiny red dot already embedded in the text via "● " prefix; this
           rule just nudges the text baseline so the glyph aligns visually. */
        position: relative;
        top: -0.05rem;
      }
      @keyframes frontierInProgressPulse {
        0%, 100% {
          box-shadow:
            0 0 0 1px rgba(255, 100, 100, 0.5),
            0 0 6px rgba(231, 76, 60, 0.55);
        }
        50% {
          box-shadow:
            0 0 0 1px rgba(255, 150, 150, 0.75),
            0 0 12px rgba(231, 76, 60, 0.9);
        }
      }
      /* Paused badge — muted amber pill, static (no pulse). Sits in the
         same slot as the EN COURS tag; only one appears at a time per
         tile because the run is either active or paused, never both. */
      .frontier-ext-paused-tag {
        display: inline-block;
        background: linear-gradient(90deg, #7a5a1a, #c08a2a, #7a5a1a);
        color: #fff2d0;
        font-size: 0.7rem;
        padding: 0.1rem 0.55rem;
        border-radius: 0.2rem;
        margin-left: 0.3rem;
        vertical-align: middle;
        letter-spacing: 0.05em;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        box-shadow:
          0 0 0 1px rgba(255, 200, 100, 0.4),
          0 0 4px rgba(192, 138, 42, 0.45);
        filter: hue-rotate(calc(var(--hue, 0deg) * -1));
      }
      /* When the whole tile is darkened (locked by unlock gate), the
         in-progress badge can't sit on a locked tile anyway — but keep
         the override defensive just in case the feature ever overlaps. */
      .frontier-ext-tile.locked .frontier-ext-inprogress-tag,
      .frontier-ext-tile.locked .frontier-ext-paused-tag {
        display: none;
      }
      /* Heat sticker — orange-red flame pill that rides next to the
         in-progress badge whenever the active run's upcoming round has a
         post-Gold difficulty multiplier ≥ 2. Disappears instantly when the
         streak ends (activeRun becomes null → tile rerenders without the
         tag). Counter-rotates the facility's hue like the medals so the
         orange stays orange across every tile colour.  */
      .frontier-ext-heat-tag {
        display: inline-block;
        margin-left: 0.3rem;
        padding: 0.1rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.78rem;
        font-weight: bold;
        letter-spacing: 0.03em;
        color: #fff2c0;
        background: linear-gradient(90deg, #c23616, #e67e22 55%, #c23616);
        text-shadow: 0 0 3px rgba(255, 120, 60, 0.75);
        box-shadow:
          0 0 0 1px rgba(255, 180, 80, 0.4),
          0 0 8px rgba(231, 126, 34, 0.55);
        filter: hue-rotate(calc(var(--hue, 0deg) * -1));
        vertical-align: middle;
        animation: frontierHeatPulse 1.6s ease-in-out infinite;
      }
      @keyframes frontierHeatPulse {
        0%, 100% {
          box-shadow:
            0 0 0 1px rgba(255, 180, 80, 0.4),
            0 0 6px rgba(231, 126, 34, 0.55);
        }
        50% {
          box-shadow:
            0 0 0 1px rgba(255, 220, 120, 0.6),
            0 0 14px rgba(231, 126, 34, 0.95);
        }
      }
      .frontier-ext-tile.locked .frontier-ext-heat-tag { display: none; }
      /* Stack the heat + run-state pills vertically so narrow-screen
         tiles don't push the brain sprite off the right edge. Heat on
         top, PAUSED / IN PROGRESS below. Reads as one block both on
         PC and mobile. */
      .frontier-ext-state-pills {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
        vertical-align: middle;
        margin-left: 0.2rem;
      }
      .frontier-ext-state-pills .frontier-ext-inprogress-tag,
      .frontier-ext-state-pills .frontier-ext-paused-tag,
      .frontier-ext-state-pills .frontier-ext-heat-tag {
        margin-left: 0;
      }
      .frontier-ext-streak {
        background: #4a4a6a;
        color: white;
        padding: 0.1rem 0.5rem;
        border-radius: 0.2rem;
        font-size: 0.85rem;
        margin-right: 0.2rem;
        display: inline-block;
        line-height: 1.15;
        text-align: center;
        vertical-align: middle;
      }
      /* Medals: the tile wrapper applies filter:hue-rotate(var(--hue)) to
         tint the whole facility card. Silver/gold metallic gradients need
         their true colours preserved, so we counter-rotate here (same
         trick the brain sprite uses). The 1.25em font-size + gradient
         text clip creates a metallic "struck medal" feel, and the ::after
         pseudo-element runs a diagonal shine that loops every 3s. */
      .frontier-ext-symbol {
        display: inline-block;
        font-size: 1.25rem;
        line-height: 1;
        margin: 0 0.15rem;
        position: relative;
        filter: hue-rotate(calc(var(--hue, 0deg) * -1));
      }
      .frontier-ext-symbol.silver,
      .frontier-ext-symbol.gold {
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        text-shadow: none;
      }
      .frontier-ext-symbol.silver {
        background-image: linear-gradient(135deg,
          #fafafa 0%, #e8e8e8 20%, #bcbcbc 45%,
          #a8a8a8 60%, #d6d6d6 80%, #fafafa 100%);
        drop-shadow: 0 0 3px rgba(200,200,200,0.8);
        filter: hue-rotate(calc(var(--hue, 0deg) * -1))
                drop-shadow(0 0 2px rgba(220,220,220,0.6));
      }
      .frontier-ext-symbol.gold {
        background-image: linear-gradient(135deg,
          #fff4c0 0%, #ffd966 18%, #e8a93a 40%,
          #c78a1a 58%, #f2c94c 78%, #fff4c0 100%);
        filter: hue-rotate(calc(var(--hue, 0deg) * -1))
                drop-shadow(0 0 3px rgba(255,200,70,0.7));
      }
      .frontier-ext-symbol.locked { color: #2a2a2a; }
      /* Medal reflection — stable top-left highlight (makes the disc read
         as 3D / convex) plus a faint bottom-right shadow. Replaces the
         old diagonal sweep animation that looked like a line moving
         across. The ::after is masked to a circle so the highlight hugs
         the medal silhouette. A slow breathing opacity on the halo adds
         life without the moving-line artefact. */
      .frontier-ext-symbol.silver::after,
      .frontier-ext-symbol.gold::after {
        content: "";
        position: absolute;
        inset: 8% 10% 42% 12%;
        pointer-events: none;
        border-radius: 50%;
        background: radial-gradient(ellipse at 35% 25%,
          rgba(255,255,255,0.95) 0%,
          rgba(255,255,255,0.55) 22%,
          rgba(255,255,255,0.15) 45%,
          transparent 72%);
        mix-blend-mode: screen;
        opacity: 0.85;
      }
      .frontier-ext-symbol.silver::before,
      .frontier-ext-symbol.gold::before {
        content: "";
        position: absolute;
        inset: 55% 14% 5% 18%;
        pointer-events: none;
        border-radius: 50%;
        background: radial-gradient(ellipse at 60% 75%,
          rgba(0,0,0,0.25) 0%,
          transparent 70%);
        pointer-events: none;
      }
      .frontier-ext-symbol.silver,
      .frontier-ext-symbol.gold {
        animation: frontierMedalBreathe 3.4s ease-in-out infinite;
      }
      .frontier-ext-symbol.gold { animation-delay: 0.9s; }
      @keyframes frontierMedalBreathe {
        0%, 100% {
          filter: hue-rotate(calc(var(--hue, 0deg) * -1))
                  drop-shadow(0 0 2px rgba(255,255,255,0.35));
        }
        50% {
          filter: hue-rotate(calc(var(--hue, 0deg) * -1))
                  drop-shadow(0 0 5px rgba(255,255,255,0.75));
        }
      }
      /* Right-click help rule grid inside the tooltip. Colours picked to
         contrast with the game's beige/tan tooltipBottom background (light1)
         — bright orange on beige was unreadable, dark brown/red works. */
      .frontier-ext-help-rules {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.45rem 1rem;
        padding: 0.7rem 1rem;
        text-align: left;
        font-size: 0.95rem;
        color: var(--dark1, #2a1a0a);
      }
      .frontier-ext-help-rules .label {
        color: #7a2e1a;
        font-weight: bold;
        white-space: nowrap;
      }
      .frontier-ext-help-rules .value {
        color: var(--dark1, #2a1a0a);
      }
      .frontier-ext-help-footer {
        padding: 0.4rem 1rem 0.6rem;
        opacity: 0.75;
        font-size: 0.85rem;
        text-align: center;
        color: var(--dark1, #2a1a0a);
        font-style: italic;
      }
      /* Tooltip header — compact SVG icon. */
      .frontier-ext-tooltip-icon {
        display: inline-block;
        vertical-align: middle;
      }
      .frontier-ext-tooltip-icon svg {
        width: 3rem;
        height: 3rem;
        color: var(--light2, #fff);
        opacity: 0.9;
      }
      /* Brain sprite centred above the rules grid in tooltipBottom. */
      .frontier-ext-help-brain-wrap {
        display: flex;
        justify-content: center;
        padding: 0.6rem 0 0.3rem;
      }
      .frontier-ext-help-brain {
        max-height: 7rem;
        image-rendering: pixelated;
        filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));
      }
      /* Locked state — applied when the player hasn't beaten Pokemon
         Professor Oak in VS yet. Same dim pattern as the shop's locked
         categories (explore.js:1674). */
      .frontier-ext-tile.locked {
        filter: hue-rotate(var(--hue, 0deg)) brightness(0.35) grayscale(0.3);
        cursor: not-allowed;
      }
      .frontier-ext-tile.locked img.frontier-ext-brain-icon {
        filter: hue-rotate(calc(var(--hue, 0deg) * -1)) brightness(2.8) grayscale(-0.3);
        /* counter-rotate to keep original sprite colours but slightly
           re-brighten since the parent darkened everything. */
      }
      .frontier-ext-lock-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 3rem;
        height: 3rem;
        color: #ffd700;
        opacity: 0.9;
        z-index: 5;
        filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.8));
      }
      /* Section divider between vanilla facilities (bound by division rules
         shown in the header banner) and our secret section (Open Level,
         Gen 3 canonical rules, no division restriction). */
      .frontier-ext-divider {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        margin: 1rem 0 0.4rem;
        padding: 0.4rem 0.8rem;
        background: linear-gradient(90deg,
          rgba(157, 78, 221, 0.15),
          rgba(157, 78, 221, 0.35) 50%,
          rgba(157, 78, 221, 0.15));
        border-top: 2px dashed rgba(207, 168, 250, 0.7);
        border-bottom: 2px dashed rgba(207, 168, 250, 0.7);
        color: #fff;
        text-align: center;
        justify-content: center;
        flex-wrap: wrap;
      }
      .frontier-ext-divider-title {
        font-size: 1.1rem;
        font-weight: bold;
        letter-spacing: 0.05em;
        color: #e0c3ff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }
      .frontier-ext-divider-sub {
        font-size: 0.85rem;
        opacity: 0.85;
        font-style: italic;
      }
      /* Run-action buttons inside the modal bottom. */
      .frontier-ext-run-actions {
        display: flex;
        gap: 0.5rem;
        padding: 0.6rem 0.8rem 0.8rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .frontier-ext-action-btn {
        border: none;
        border-radius: 0.3rem;
        padding: 0.5rem 1rem;
        font-size: 0.95rem;
        cursor: pointer;
        background: var(--dark1, #2a1a0a);
        color: var(--light1, #f5e6c8);
        transition: transform 0.1s, filter 0.15s;
        font-weight: bold;
      }
      .frontier-ext-action-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
      .frontier-ext-action-btn:active { transform: translateY(0); }
      .frontier-ext-action-btn.primary {
        background: #6ab04c;
        color: white;
      }
      .frontier-ext-action-btn.danger {
        background: #c0392b;
        color: white;
      }
      /* Dôme 2-of-3 pick modal */
      .frontier-ext-dome-teams {
        display: flex;
        gap: 1rem;
        padding: 0.6rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .frontier-ext-dome-side {
        flex: 1 1 220px;
        min-width: 200px;
      }
      .frontier-ext-dome-label {
        font-weight: bold;
        font-size: 0.9rem;
        color: #ffc857;
        text-align: center;
        margin-bottom: 0.3rem;
      }
      .frontier-ext-dome-slots {
        display: flex;
        gap: 0.4rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      .frontier-ext-dome-card {
        background: rgba(0,0,0,0.25);
        border: 2px solid transparent;
        border-radius: 0.4rem;
        padding: 0.3rem;
        width: 5rem;
        text-align: center;
        font-size: 0.75rem;
        cursor: pointer;
        transition: transform 0.1s, border-color 0.15s;
        user-select: none;
      }
      .frontier-ext-dome-card img {
        width: 3.5rem;
        height: 3.5rem;
        image-rendering: pixelated;
      }
      .frontier-ext-dome-card.player:hover {
        transform: translateY(-2px);
        border-color: rgba(255,255,255,0.5);
      }
      .frontier-ext-dome-card.player.selected {
        border-color: #6ab04c;
        background: rgba(106,176,76,0.2);
      }
      .frontier-ext-dome-card.opponent {
        cursor: default;
        border-color: rgba(192,57,43,0.5);
      }
      /* ── Factory rental selection grid ───────────────────────────────── */
      .frontier-ext-factory-subtitle {
        padding: 0.55rem 1rem 0.35rem;
        text-align: center;
        font-style: italic;
        font-size: 0.9rem;
        color: #e9d4a8;
        background: rgba(255, 230, 180, 0.06);
        border-radius: 0.3rem;
        margin: 0 0.6rem 0.3rem;
        border: 1px solid rgba(255, 230, 180, 0.12);
      }
      .frontier-ext-factory-grid {
        display: grid;
        /* 2 columns → 6 cards fit in 3 rows, giving each card ~50% more
           horizontal space so IV stars and move names stop wrapping. */
        grid-template-columns: repeat(2, 1fr);
        gap: 0.55rem;
        padding: 0.4rem 0.6rem;
      }
      .frontier-ext-factory-card {
        position: relative;
        background: linear-gradient(135deg, rgba(30, 18, 8, 0.85), rgba(18, 10, 5, 0.65));
        border: 2px solid rgba(255, 230, 180, 0.12);
        border-radius: 0.55rem;
        padding: 0.6rem 0.7rem 0.65rem;
        cursor: pointer;
        transition: transform 0.12s ease-out, border-color 0.15s, box-shadow 0.15s, background 0.15s;
        user-select: none;
        color: #f5e6c8;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35);
      }
      .frontier-ext-factory-card:hover {
        transform: translateY(-2px);
        border-color: rgba(255, 230, 180, 0.3);
        background: linear-gradient(135deg, rgba(50, 30, 15, 0.9), rgba(30, 18, 8, 0.7));
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.55);
      }
      .frontier-ext-factory-card.selected {
        border-color: #6ab04c;
        background: linear-gradient(135deg, rgba(50, 80, 40, 0.55), rgba(20, 40, 18, 0.55));
        box-shadow:
          0 3px 10px rgba(0, 0, 0, 0.55),
          0 0 14px rgba(106, 176, 76, 0.4),
          inset 0 0 0 1px rgba(106, 176, 76, 0.25);
      }
      /* Card header: sprite + title block + pick badge */
      .frontier-ext-factory-card .card-header {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        padding-bottom: 0.35rem;
        border-bottom: 1px solid rgba(255, 230, 180, 0.12);
      }
      .frontier-ext-factory-card .sprite {
        width: 3.6rem;
        height: 3.6rem;
        flex-shrink: 0;
        image-rendering: pixelated;
      }
      .frontier-ext-factory-card .title-block {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .frontier-ext-factory-card .name {
        font-weight: bold;
        font-size: 1.02rem;
        color: #ffeec9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.1;
      }
      .frontier-ext-factory-card .tags {
        display: flex;
        gap: 0.3rem;
        flex-wrap: wrap;
      }
      .frontier-ext-factory-card .tag-nature {
        background: rgba(130, 180, 90, 0.22);
        color: #cfe9a0;
        padding: 0.08rem 0.45rem;
        border-radius: 0.25rem;
        font-size: 0.72rem;
        font-style: italic;
        border: 1px solid rgba(130, 180, 90, 0.3);
      }
      .frontier-ext-factory-card .tag-ability {
        background: rgba(255, 200, 90, 0.18);
        color: #ffd17a;
        padding: 0.08rem 0.45rem;
        border-radius: 0.25rem;
        font-size: 0.72rem;
        font-weight: bold;
        border: 1px solid rgba(255, 200, 90, 0.3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 8rem;
      }
      /* IV bar grid */
      .frontier-ext-factory-card .ivs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.22rem 0.55rem;
      }
      .frontier-ext-factory-card .iv-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.7rem;
      }
      .frontier-ext-factory-card .iv-label {
        min-width: 1.7rem;
        font-weight: bold;
        opacity: 0.7;
        letter-spacing: 0.02em;
      }
      .frontier-ext-factory-card .iv-bar {
        flex: 1;
        height: 0.4rem;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 0.2rem;
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.25);
      }
      .frontier-ext-factory-card .iv-bar-fill {
        height: 100%;
        border-radius: inherit;
        transition: width 0.2s;
      }
      .frontier-ext-factory-card .iv-bar-fill.low  { background: linear-gradient(90deg, #c0392b, #e57070); }
      .frontier-ext-factory-card .iv-bar-fill.mid  { background: linear-gradient(90deg, #d89040, #f1c868); }
      .frontier-ext-factory-card .iv-bar-fill.high { background: linear-gradient(90deg, #4ac060, #7ae090); }
      .frontier-ext-factory-card .iv-value {
        font-weight: bold;
        color: #ffe080;
        font-size: 0.72rem;
        min-width: 0.8rem;
        text-align: right;
      }
      /* Move chips — type-coloured left border */
      .frontier-ext-factory-card .moves {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.28rem;
      }
      .frontier-ext-factory-card .moves .move {
        font-size: 0.74rem;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        background: rgba(255, 255, 255, 0.06);
        border-left: 4px solid var(--move-type, #888);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #f0e4c6;
        font-weight: 500;
      }
      /* Selection badge — round green pill at header's right edge */
      .frontier-ext-factory-card .pick-badge {
        width: 1.6rem;
        height: 1.6rem;
        background: #6ab04c;
        border: 2px solid #2a1a0a;
        border-radius: 50%;
        color: white;
        font-weight: bold;
        font-size: 0.95rem;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        flex-shrink: 0;
      }
      .frontier-ext-factory-counter {
        text-align: center;
        padding: 0.35rem 0.6rem 0.1rem;
        font-size: 0.9rem;
        font-weight: bold;
        color: #ffd700;
      }
      /* Expand the tooltip container while the Factory rental modal is
         open so the 6-card 2×3 grid + counter + action row all fit
         without scrolling. The class is added by setFactoryModalSizing
         (true) from openFactoryRentalSelection and cleared on confirm
         / abandon / cleanup. */
      #tooltipBox.frontier-ext-factory-open {
        max-height: 94vh !important;
        max-width: min(60rem, 96vw) !important;
        width: auto !important;
      }
      #tooltipBox.frontier-ext-factory-open #tooltipMid {
        max-height: 80vh;
        overflow-y: auto;
      }
      /* Factory modals (rental selection + post-combat swap) hide the
         × entirely. With the Rest/Resume system in place there's no
         need for an escape hatch — the only valid exits are the
         in-modal actions (Confirmer / Passer / Abandonner). */
      #tooltipBackground.frontier-ext-factory-open #tooltipClose,
      #tooltipBackground:has(#tooltipBox.frontier-ext-factory-open) #tooltipClose {
        display: none !important;
      }
      /* Active-run lock: when the facility preview or combat-launch
         modal is open with an ACTIVE (locked) run, the only valid exits
         are the in-modal buttons (Continuer / Repos / Abandonner on
         preview, Lancer / Abandonner on combat launch). The default
         close × would silently dismiss the tooltip, leaving the run
         active but the UI state confused. Hide the close button so the
         player is forced to commit. Paused runs KEEP the close button
         because the run is already parked. */
      #tooltipBackground.frontier-ext-run-lock-open #tooltipClose,
      #tooltipBackground:has(#tooltipBox.frontier-ext-run-lock-open) #tooltipClose {
        display: none !important;
      }
      /* ── Battle Pyramid — dungeon map ──────────────────────────────── */
      .frontier-ext-pyr-grid {
        display: grid;
        gap: 2px;
        padding: 0.5rem;
        background: #1a0f08;
        border: 2px solid #5a3820;
        border-radius: 0.4rem;
        margin: 0.4rem auto;
        width: fit-content;
        box-shadow:
          0 3px 10px rgba(0, 0, 0, 0.6),
          inset 0 0 0 1px rgba(255, 200, 120, 0.15);
      }
      .pyr-tile {
        position: relative;
        width: 3rem;
        height: 3rem;
        box-sizing: border-box;
        overflow: visible;
      }
      .pyr-tile svg {
        width: 100%;
        height: 100%;
        display: block;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      .pyr-tile.unrevealed {
        opacity: 0.88;
      }
      .pyr-tile.clickable {
        cursor: pointer;
        outline: 2px solid rgba(255, 230, 120, 0.6);
        outline-offset: -2px;
        z-index: 2;
      }
      .pyr-tile.clickable:hover {
        outline-color: rgba(255, 230, 120, 1);
        filter: brightness(1.2);
      }
      .pyr-tile.wall {
        cursor: not-allowed;
      }
      .pyr-tile.stairs {
        /* Subtle pulsing glow on the exit tile so the player sees it. */
        animation: pyrStairsGlow 1.8s ease-in-out infinite;
      }
      @keyframes pyrStairsGlow {
        0%, 100% { filter: brightness(1); }
        50% { filter: brightness(1.25) drop-shadow(0 0 3px rgba(255, 220, 120, 0.8)); }
      }
      .pyr-tile.player-here .pyr-char-mount {
        position: absolute;
        inset: 0;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3;
      }
      .pyr-tile.player-here .pyr-char-mount svg {
        width: 80%;
        height: 80%;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
        animation: pyrCharBob 0.6s ease-in-out infinite;
      }
      @keyframes pyrCharBob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
      }
      /* Walk animation: alternating left/right legs every 250ms */
      .pyr-tile.player-here .pyr-leg-l {
        animation: pyrLegL 0.5s ease-in-out infinite;
      }
      .pyr-tile.player-here .pyr-leg-r {
        animation: pyrLegR 0.5s ease-in-out infinite;
      }
      @keyframes pyrLegL {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
      }
      @keyframes pyrLegR {
        0%, 100% { transform: translateY(-1px); }
        50% { transform: translateY(0); }
      }
      .pyr-hint {
        text-align: center;
        padding: 0.3rem 0.8rem;
        font-style: italic;
        font-size: 0.88rem;
        opacity: 0.85;
        color: var(--light2, #fff);
      }
      .pyr-hint.boss {
        color: #ffd700;
        font-weight: bold;
        font-style: normal;
        text-shadow: 0 0 4px rgba(255, 100, 100, 0.5);
      }
      /* Theme header strip at the top of the Pyramid floor map. */
      .frontier-ext-pyr-theme-bar {
        text-align: center;
        padding: 0.35rem 0.8rem;
        font-size: 0.88rem;
        color: #ffd98a;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 0.3rem;
        margin: 0 0.5rem 0.35rem;
        letter-spacing: 0.02em;
      }
      .frontier-ext-pyr-theme-bar strong { color: #fff; font-weight: 600; }
      /* Side-action row — Psychic NPC + Combat Bag buttons. */
      .frontier-ext-pyr-side-actions {
        display: flex;
        gap: 0.4rem;
        justify-content: center;
        padding: 0.4rem 0.6rem 0.2rem;
        flex-wrap: wrap;
      }
      .frontier-ext-pyr-side-actions .frontier-ext-action-btn {
        font-size: 0.82rem;
        padding: 0.3rem 0.6rem;
      }
      /* Item-found modal content. */
      .frontier-ext-pyr-item-found {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        padding: 0.8rem 0.6rem;
      }
      .frontier-ext-pyr-item-found .headline {
        font-weight: bold;
        color: #ffd98a;
        font-size: 1rem;
      }
      .frontier-ext-pyr-item-found .label {
        font-size: 1.1rem;
        color: #fff;
        font-weight: 600;
      }
      .frontier-ext-pyr-item-found .bag-count {
        font-size: 0.8rem;
        opacity: 0.7;
      }
      .frontier-ext-pyr-item-found .bag-full {
        color: #ff9090;
        font-size: 0.85rem;
        font-weight: bold;
      }
      .frontier-ext-pyr-item-placeholder {
        font-size: 2rem;
        line-height: 1;
      }
      /* Psychic NPC dialog. */
      .frontier-ext-pyr-kinesiste {
        padding: 0.8rem 0.6rem;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        color: #f2d999;
      }
      .frontier-ext-pyr-kinesiste .intro {
        font-style: italic;
        text-align: center;
        color: #e0b0ff;
      }
      .frontier-ext-pyr-kinesiste .theme-line {
        display: flex;
        justify-content: space-between;
        padding: 0.25rem 0.5rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0.25rem;
      }
      .frontier-ext-pyr-kinesiste .theme-line.next {
        background: rgba(80, 40, 120, 0.35);
        color: #fff;
      }
      .frontier-ext-pyr-kinesiste .lbl { opacity: 0.75; font-size: 0.88rem; }
      .frontier-ext-pyr-kinesiste .val { font-weight: bold; }
      /* Pre-run Psychic NPC line — sits in the facility preview above
         the action buttons. Shown ONLY for the Pyramid at registration
         / resume / round-cleared transitions, never mid-run. */
      .frontier-ext-pyr-kinesiste-preview {
        margin: 0.35rem 0.5rem;
        padding: 0.35rem 0.55rem;
        background: linear-gradient(180deg, rgba(80, 40, 120, 0.35), rgba(50, 20, 80, 0.5));
        border-radius: 0.3rem;
        text-align: center;
        color: #f2d999;
      }
      .frontier-ext-pyr-kinesiste-preview .intro {
        font-style: italic;
        font-size: 0.85rem;
        color: #e0b0ff;
        margin-bottom: 0.2rem;
      }
      .frontier-ext-pyr-kinesiste-preview .theme {
        font-size: 0.92rem;
      }
      .frontier-ext-pyr-kinesiste-preview .theme strong { color: #fff; }
      /* Combat Bag viewer. */
      .frontier-ext-pyr-bag {
        padding: 0.6rem;
        color: #f2d999;
      }
      .frontier-ext-pyr-bag .cap {
        text-align: center;
        font-size: 0.85rem;
        opacity: 0.8;
        margin-bottom: 0.35rem;
      }
      .frontier-ext-pyr-bag-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
      }
      .frontier-ext-pyr-bag-row {
        display: grid;
        grid-template-columns: 2rem 1fr auto;
        gap: 0.4rem;
        align-items: center;
        padding: 0.2rem 0.4rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0.25rem;
        font-size: 0.88rem;
      }
      .frontier-ext-pyr-bag-row .icon { text-align: center; }
      .frontier-ext-pyr-bag-row .count { opacity: 0.8; font-weight: bold; }
      .frontier-ext-pyr-bag-row.empty { text-align: center; opacity: 0.6; grid-template-columns: 1fr; }
      .frontier-ext-pyr-bag-row .frontier-ext-action-btn.small {
        padding: 0.2rem 0.5rem;
        font-size: 0.75rem;
      }
      .frontier-ext-pyr-bag-row .frontier-ext-action-btn.small.danger {
        background: linear-gradient(180deg, #802020 0%, #501010 100%);
        border-color: rgba(255, 120, 120, 0.5);
      }
      .frontier-ext-pyr-bag-row .held-pill {
        font-size: 0.72rem;
        opacity: 0.6;
        font-style: italic;
        padding: 0.1rem 0.35rem;
      }
      /* Layout adjustment: when a use-button (or held-pill) is present,
         the row grows to 4 columns. */
      .frontier-ext-pyr-bag-row { grid-template-columns: 2rem 1fr auto auto; }
      /* Items-held error modal (Pyramid registration refusal). */
      .frontier-ext-pyr-items-error {
        padding: 0.8rem;
        text-align: center;
        color: #ffcccc;
        font-size: 0.9rem;
        line-height: 1.4;
      }
      /* Target picker for "Utiliser" consumables. 3-card row of slot
         buttons; disabled cards dim + cursor not-allowed. */
      .frontier-ext-pyr-use-picker {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.4rem;
        padding: 0.6rem 0.6rem 0.3rem;
      }
      .frontier-ext-pyr-target-card {
        background: linear-gradient(180deg, #3a2a1a 0%, #22160c 100%);
        color: #f2d999;
        border: 1px solid rgba(255, 210, 130, 0.35);
        border-radius: 0.4rem;
        padding: 0.5rem 0.4rem;
        font-size: 0.82rem;
        text-align: center;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s, border-color 0.15s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
      }
      .frontier-ext-pyr-target-card:hover:not([disabled]) {
        background: linear-gradient(180deg, #4a3620 0%, #2c1c10 100%);
        border-color: rgba(255, 210, 130, 0.7);
      }
      .frontier-ext-pyr-target-card:active:not([disabled]) { transform: translateY(1px); }
      .frontier-ext-pyr-target-card.invalid,
      .frontier-ext-pyr-target-card[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .frontier-ext-pyr-target-card .name { font-weight: bold; color: #fff; }
      .frontier-ext-pyr-target-card .hp { opacity: 0.9; }
      .frontier-ext-pyr-target-card .status {
        display: inline-block;
        background: rgba(180, 80, 180, 0.6);
        padding: 0.05rem 0.35rem;
        border-radius: 0.2rem;
        font-size: 0.7rem;
      }
      .frontier-ext-pyr-target-card .invalid-label {
        font-size: 0.7rem;
        font-style: italic;
        opacity: 0.7;
      }
      .frontier-ext-pyr-use-picker .no-target {
        grid-column: 1 / -1;
        text-align: center;
        opacity: 0.7;
        font-style: italic;
        padding: 0.4rem;
      }
      .frontier-ext-pyr-target-card.equipped-here {
        border-color: #ffd700;
        background: linear-gradient(180deg, #4a3a18 0%, #32220c 100%);
      }
      .frontier-ext-pyr-target-card .equipped {
        font-size: 0.72rem;
        opacity: 0.8;
        font-style: italic;
      }
      .frontier-ext-pyr-target-card .here-pill {
        font-size: 0.7rem;
        color: #ffd700;
        font-weight: bold;
      }
      .frontier-ext-pyr-bag-row .held-equipped-badge {
        display: inline-block;
        margin-left: 0.15rem;
        color: #ffd700;
        font-size: 0.85rem;
      }
      .frontier-ext-pyr-toast {
        position: absolute;
        bottom: 0.6rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.82);
        color: #ffd98a;
        padding: 0.3rem 0.6rem;
        border-radius: 0.25rem;
        font-size: 0.85rem;
        pointer-events: none;
        border: 1px solid rgba(255, 210, 130, 0.3);
      }
      /* Pyramid modal gets the same size override as Factory. */
      #tooltipBox.frontier-ext-pyramid-open {
        max-height: 92vh !important;
        max-width: min(30rem, 94vw) !important;
        width: auto !important;
      }
      #tooltipBox.frontier-ext-pyramid-open #tooltipMid {
        max-height: 80vh;
        overflow-y: auto;
      }
      /* Swap modal sections — opponent (red tint) + yours (green tint). */
      .frontier-ext-factory-swap-section {
        margin: 0.35rem 0 0.6rem;
      }
      .frontier-ext-factory-swap-section .section-label {
        padding: 0.3rem 0.8rem;
        font-weight: bold;
        font-size: 0.85rem;
        letter-spacing: 0.04em;
        margin: 0 0.6rem;
        border-radius: 0.3rem 0.3rem 0 0;
        text-transform: uppercase;
      }
      .frontier-ext-factory-swap-section .section-label.opponent {
        background: linear-gradient(90deg, rgba(192, 57, 43, 0.35), rgba(140, 40, 30, 0.25));
        color: #ffc8c0;
        border-left: 3px solid #c0392b;
      }
      .frontier-ext-factory-swap-section .section-label.yours {
        background: linear-gradient(90deg, rgba(106, 176, 76, 0.35), rgba(70, 130, 50, 0.25));
        color: #caf0b8;
        border-left: 3px solid #6ab04c;
      }
      /* Tint the cards so players see side-at-a-glance */
      .frontier-ext-factory-card.swap-take {
        border-color: rgba(192, 57, 43, 0.3);
      }
      .frontier-ext-factory-card.swap-take:hover {
        border-color: rgba(192, 57, 43, 0.6);
      }
      .frontier-ext-factory-card.swap-take.selected {
        border-color: #e74c3c;
        background: linear-gradient(135deg, rgba(120, 40, 30, 0.55), rgba(70, 20, 15, 0.55));
        box-shadow:
          0 3px 10px rgba(0, 0, 0, 0.55),
          0 0 14px rgba(231, 76, 60, 0.4),
          inset 0 0 0 1px rgba(231, 76, 60, 0.25);
      }
      .frontier-ext-factory-card.swap-give {
        border-color: rgba(106, 176, 76, 0.3);
      }
      .frontier-ext-factory-card.swap-give:hover {
        border-color: rgba(106, 176, 76, 0.6);
      }
      /* Inline actions row inside the rental modal — placed in tooltipMid
         instead of tooltipBottom so the 6-card grid can't hide it. */
      .frontier-ext-factory-actions {
        display: flex;
        justify-content: center;
        gap: 0.6rem;
        padding: 0.5rem 0.6rem 0.7rem;
        flex-wrap: wrap;
      }
      /* Visual disabled state for pseudo-disabled action buttons.
         We use a class instead of the native disabled attribute so the
         click handler can short-circuit without the browser eating
         pointer events on children. */
      .frontier-ext-action-btn.disabled {
        opacity: 0.45;
        cursor: not-allowed;
        filter: grayscale(0.5);
      }
      .frontier-ext-action-btn.disabled:hover {
        filter: grayscale(0.5);
        transform: none;
      }
      /* ── Battle Pike ─────────────────────────────────
         Curtain-door picker, status/heal modals, room/HP banners. */
      .frontier-ext-pike-banner {
        display: flex;
        justify-content: space-around;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.8rem;
        background: linear-gradient(90deg,
          rgba(70, 10, 10, 0.55),
          rgba(140, 20, 20, 0.55),
          rgba(70, 10, 10, 0.55));
        border-radius: 0.3rem;
        margin: 0.3rem 0.6rem;
        color: #ffdcdc;
        font-size: 0.9rem;
        flex-wrap: wrap;
      }
      .frontier-ext-pike-banner strong {
        color: #ffd700;
        font-size: 1.05rem;
        margin: 0 0.2rem;
      }
      .frontier-ext-pike-banner .boss-flag {
        color: #ff6b6b;
        font-weight: bold;
        text-shadow: 0 0 4px rgba(255, 50, 50, 0.6);
      }
      .frontier-ext-pike-hp-summary {
        display: flex;
        gap: 0.35rem;
        padding: 0.3rem 0.6rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      .frontier-ext-pike-hp-pill {
        background: rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.2);
        padding: 0.15rem 0.5rem;
        border-radius: 0.3rem;
        font-size: 0.75rem;
        color: #fff;
      }
      .frontier-ext-pike-hp-pill .bar {
        display: inline-block;
        width: 2.8rem;
        height: 0.35rem;
        background: rgba(255,255,255,0.15);
        border-radius: 0.15rem;
        margin-left: 0.3rem;
        vertical-align: middle;
        overflow: hidden;
      }
      .frontier-ext-pike-hp-pill .bar > span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #6ab04c, #4ade80);
      }
      .frontier-ext-pike-hp-pill.low .bar > span {
        background: linear-gradient(90deg, #c0392b, #e74c3c);
      }
      .frontier-ext-pike-hp-pill.mid .bar > span {
        background: linear-gradient(90deg, #e67e22, #f1c40f);
      }
      .frontier-ext-pike-hp-pill .st {
        display: inline-block;
        margin-left: 0.3rem;
        padding: 0 0.25rem;
        border-radius: 0.15rem;
        font-size: 0.7rem;
      }
      .frontier-ext-pike-hp-pill .st.poisoned { background: #8e44ad; color: #fff; }
      .frontier-ext-pike-hp-pill .st.burn { background: #c0392b; color: #fff; }
      .frontier-ext-pike-hp-pill .st.paralysis { background: #f39c12; color: #000; }
      /* Heal-on-full feedback: bright 3-pulse glow on pills that were
         just touched by a heal door while already at 100% HP. Tells
         the player the heal IS applied (not a bug) — just redundant.
         Bright green-gold shadow + background tint so it reads on the
         dark Pike modal background. */
      .frontier-ext-pike-hp-pill.heal-full-flash {
        animation: frontierPikeHealFullFlash 2.4s ease-out 1;
        border-color: rgba(180, 255, 150, 1);
      }
      @keyframes frontierPikeHealFullFlash {
        0%, 100% {
          background: rgba(0, 0, 0, 0.45);
          box-shadow:
            0 0 0 0 rgba(180, 255, 150, 0),
            inset 0 0 0 0 rgba(180, 255, 150, 0);
        }
        15%, 50%, 85% {
          background: rgba(90, 200, 100, 0.55);
          box-shadow:
            0 0 22px 6px rgba(180, 255, 150, 0.95),
            inset 0 0 14px rgba(255, 255, 200, 0.75);
        }
        30%, 65% {
          background: rgba(0, 0, 0, 0.45);
          box-shadow:
            0 0 8px 2px rgba(180, 255, 150, 0.35),
            inset 0 0 6px rgba(180, 255, 150, 0.25);
        }
      }

      .frontier-ext-pike-doors {
        display: flex;
        gap: 1.1rem;
        padding: 0.8rem 0.6rem 0.4rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      /* Receptionist hint — sits between the curtain row and the abandon
         button. Before the button is clicked, it's a compact "ask"
         prompt; after, it shows the vague clue text above the revealed
         door number. */
      .frontier-ext-pike-hint {
        display: flex;
        justify-content: center;
        padding: 0.4rem 0.8rem 0.2rem;
      }
      .frontier-ext-pike-hint-btn {
        background: linear-gradient(180deg, #3a2a1a 0%, #22160c 100%);
        color: #f2d999;
        border: 1px solid rgba(255, 210, 130, 0.35);
        border-radius: 0.4rem;
        padding: 0.35rem 0.7rem;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.1s;
      }
      .frontier-ext-pike-hint-btn:hover {
        background: linear-gradient(180deg, #4a3620 0%, #2c1c10 100%);
        border-color: rgba(255, 210, 130, 0.6);
      }
      .frontier-ext-pike-hint-btn:active { transform: translateY(1px); }
      .frontier-ext-pike-hint.revealed {
        flex-direction: column;
        align-items: center;
        gap: 0.2rem;
        margin: 0.3rem 0.8rem;
        padding: 0.45rem 0.8rem;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 210, 130, 0.35);
        border-radius: 0.35rem;
        color: #fff4d8;
        font-style: italic;
        font-size: 0.95rem;
        text-align: center;
        line-height: 1.35;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }
      .frontier-ext-pike-hint.revealed .intro {
        display: block;
        color: #ffd87a;
        font-weight: bold;
        font-size: 0.9rem;
        font-style: normal;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .frontier-ext-pike-hint.revealed .text {
        opacity: 1;
        color: #fff4d8;
      }
      .frontier-ext-pike-door {
        position: relative;
        width: 6.2rem;
        height: 10rem;
        cursor: pointer;
        border-radius: 0.35rem;
        overflow: hidden;
        transition: transform 0.15s, filter 0.2s, box-shadow 0.2s;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
        user-select: none;
      }
      .frontier-ext-pike-door:hover {
        transform: translateY(-4px) scale(1.04);
        filter: drop-shadow(0 4px 10px rgba(255, 80, 80, 0.5)) brightness(1.08);
      }
      .frontier-ext-pike-door:active {
        transform: translateY(-1px) scale(1.00);
      }
      .frontier-ext-pike-door svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .frontier-ext-pike-door .door-number {
        position: absolute;
        top: 0.4rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.75);
        color: #ffd700;
        font-weight: bold;
        padding: 0.15rem 0.55rem;
        border-radius: 0.25rem;
        font-size: 0.85rem;
        letter-spacing: 0.05em;
        pointer-events: none;
        border: 1px solid rgba(255, 215, 0, 0.5);
      }
      .frontier-ext-pike-door.revealed {
        animation: pikeCurtainSway 0.5s ease-out;
      }
      @keyframes pikeCurtainSway {
        0%   { transform: scaleY(1) translateY(0); }
        40%  { transform: scaleY(0.96) translateY(-2px); }
        100% { transform: scaleY(1) translateY(0); }
      }
      .frontier-ext-pike-door.locked {
        cursor: not-allowed;
        filter: grayscale(0.6) brightness(0.5);
      }

      .frontier-ext-pike-event {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.8rem;
      }
      .frontier-ext-pike-event .icon {
        font-size: 2.4rem;
      }
      .frontier-ext-pike-event .headline {
        font-weight: bold;
        font-size: 1.1rem;
        color: #ffdcdc;
      }
      .frontier-ext-pike-event.heal .icon { color: #4ade80; }
      .frontier-ext-pike-event.heal .headline { color: #baf5c9; }
      .frontier-ext-pike-event.trap .icon { color: #e74c3c; }
      .frontier-ext-pike-event.trap .headline { color: #ffb3b3; }
      /* Hostile-Pokémon sprite inside the status_species event card.
         Scaled 3× and pixel-rendered so the Gen-1-style sprites look
         crisp at the modal size; subtle red glow aligns with the
         "attack" framing of the event. */
      .frontier-ext-pike-hostile-sprite {
        width: auto;
        height: 4.2rem;
        image-rendering: pixelated;
        filter: drop-shadow(0 0 8px rgba(231, 76, 60, 0.65));
      }
      .frontier-ext-pike-event .body {
        text-align: center;
        font-size: 0.9rem;
        opacity: 0.9;
        color: var(--light2, #fff);
        max-width: 22rem;
      }
      /* ── Round-cleared modal (all facilities) ──────────────────────────── */
      .frontier-ext-round-header {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.6rem;
        padding: 0.6rem 0;
      }
      .frontier-ext-round-header .trophy {
        font-size: 3.2rem;
        filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.55));
      }
      .frontier-ext-round-header .facility-icon svg {
        width: 4rem;
        height: 4rem;
        color: #ffd700;
        opacity: 0.95;
      }
      .frontier-ext-round-cleared {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.9rem 0.3rem;
        text-align: center;
      }
      .frontier-ext-round-cleared .celebration {
        font-size: 1.15rem;
        color: var(--light2, #fff);
      }
      .frontier-ext-round-cleared .celebration strong {
        color: #ffd700;
        font-size: 1.35rem;
        margin: 0 0.2rem;
        text-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
      }
      .frontier-ext-round-cleared .stats {
        display: flex;
        gap: 1.2rem;
        font-size: 0.9rem;
        opacity: 0.9;
      }
      .frontier-ext-round-cleared .stats strong {
        color: #ffd700;
        margin-left: 0.25rem;
      }
      .frontier-ext-round-next {
        margin-top: 0.4rem;
        padding: 0.35rem 0.7rem;
        border-radius: 0.3rem;
        font-size: 0.92rem;
        background: rgba(255, 255, 255, 0.08);
      }
      .frontier-ext-round-next.boss {
        color: #ffd700;
        background: linear-gradient(90deg,
          rgba(200, 40, 40, 0.35),
          rgba(255, 140, 0, 0.35),
          rgba(200, 40, 40, 0.35));
        font-weight: bold;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
      }
      .frontier-ext-round-award {
        padding: 0.3rem 0.8rem;
        border-radius: 0.3rem;
        font-weight: bold;
        animation: roundAwardPulse 1.6s ease-in-out infinite;
      }
      .frontier-ext-round-award.silver {
        color: #e8e8e8;
        background: linear-gradient(90deg, rgba(160,160,160,0.15), rgba(220,220,220,0.35), rgba(160,160,160,0.15));
        text-shadow: 0 0 4px rgba(200, 200, 200, 0.6);
      }
      .frontier-ext-round-award.gold {
        color: #fff2a6;
        background: linear-gradient(90deg, rgba(184,134,11,0.2), rgba(255,215,0,0.45), rgba(184,134,11,0.2));
        text-shadow: 0 0 6px rgba(255, 215, 0, 0.65);
      }
      @keyframes roundAwardPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.04); }
      }
      .frontier-ext-round-hint {
        padding: 0.4rem 1rem 0.6rem;
        font-style: italic;
        text-align: center;
        font-size: 0.82rem;
        opacity: 0.75;
        color: var(--dark1, #2a1a0a);
      }
      /* ── Team-menu lock mode (frontier-ext runs) ──────────────────────────
         Applied on #team-menu whenever a frontier-ext run is about to launch
         or is in progress. Blocks every interaction that would let the
         player swap / reorder / heal their team mid-challenge — team
         switcher, drag handles, click-to-change-pkmn, click-to-change-item.
         Save-and-Go and Go-back buttons stay active so the player can
         still confirm the combat or back out to the Frontier tab. */
      /* Hide the team switcher + auto-build ONLY during active combat
         launch. In tied-slot browsing mode we let the player navigate
         to other preview teams so they can use different teams for wild
         zones / other facilities while this run is paused. */
      #team-menu.frontier-ext-team-locked-strict .team-menu-selector-new {
        display: none !important;
      }
      #team-menu.frontier-ext-team-locked-strict .team-menu-selector {
        display: none !important;
      }
      #team-menu.frontier-ext-team-locked #team-preview .explore-team-member {
        pointer-events: none;
        filter: saturate(0.88);
        position: relative;
      }
      #team-menu.frontier-ext-team-locked #team-preview .team-held-item {
        pointer-events: none !important;
      }
      /* Duplicate-team button (teamDuplicate.js) can overwrite a preview
         slot with another's contents — including the tied slot. Hide it
         in both lock modes so the player can't bypass the lock via copy. */
      #team-menu.frontier-ext-team-locked #team-duplicate-button,
      #team-menu.frontier-ext-team-locked #auto-build-button {
        display: none !important;
      }
      /* Anything inside team-preview that would spawn a sub-menu (rename,
         remove, edit moves, etc.) — block via pointer-events at the root. */
      #team-menu.frontier-ext-team-locked #team-preview {
        -webkit-user-drag: none;
      }
      /* Safety net — block any residual dragstart gestures. */
      #team-menu.frontier-ext-team-locked #team-preview [draggable="true"] {
        user-select: none;
        -webkit-user-drag: none;
      }
      /* The lock banner, injected above #team-preview.
         All properties marked !important so the game's sibling layout
         rules (flex / reset styles) can't strip the encadrement. */
      .frontier-ext-team-lock-banner {
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 0.6rem !important;
        margin: 0.6rem 0.7rem !important;
        padding: 0.7rem 1rem !important;
        background: linear-gradient(90deg,
          rgba(140, 20, 20, 0.85),
          rgba(200, 80, 20, 0.85),
          rgba(140, 20, 20, 0.85)) !important;
        color: #ffe6b5 !important;
        font-weight: bold !important;
        border-radius: 0.4rem !important;
        border: 2px solid rgba(255, 190, 90, 0.75) !important;
        font-size: 0.95rem !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7) !important;
        box-shadow:
          0 2px 6px rgba(0, 0, 0, 0.45),
          inset 0 0 0 1px rgba(255, 230, 180, 0.15) !important;
        flex-wrap: wrap !important;
      }
      .frontier-ext-team-lock-banner .lock-icon {
        font-size: 1.4rem !important;
        filter: drop-shadow(0 0 3px rgba(255, 180, 90, 0.7));
      }
      .frontier-ext-team-lock-banner .subtle {
        font-weight: normal !important;
        font-style: italic !important;
        font-size: 0.82rem !important;
        opacity: 0.9 !important;
        margin-left: auto !important;
        color: #ffdcb0 !important;
      }
      /* ── Arena judges' verdict toast (3-criterion breakdown) ──────────
         Drops in from the top of the screen when the Arena's 3-turn judge
         fires. Auto-dismisses after 4 seconds. Green border on victory,
         red on loss. */
      /* Arena verdict card — Emerald-styled scoresheet + arbiter dialog.
         Three criteria (Mental / Technique / Physique), each awarding a
         symbol per side: ● red circle = 2pt win, △ blue triangle = 1pt
         tie, ✕ black cross = 0pt loss. Symbols reveal one row at a time
         with staggered animation, then the totals strike in, then an
         arbiter dialog announces the outcome. */
      .frontier-ext-arena-verdict {
        position: fixed;
        top: 2rem;
        left: 50%;
        transform: translate(-50%, -150%);
        z-index: 9999;
        background:
          linear-gradient(180deg, #fdf8e6 0%, #e8dcae 55%, #c7b877 100%);
        color: #2a1e07;
        padding: 0.75rem 0.9rem 0.9rem;
        border-radius: 0.6rem;
        box-shadow:
          0 6px 20px rgba(0, 0, 0, 0.55),
          inset 0 0 0 2px #3b2a0d,
          inset 0 0 0 4px #fdf8e6,
          inset 0 0 0 6px #8a6a1c;
        min-width: 22rem;
        max-width: 26rem;
        font-family: "Segoe UI", system-ui, sans-serif;
        font-size: 0.95rem;
        opacity: 0;
        transition: transform 0.35s cubic-bezier(.3,1.4,.6,1), opacity 0.35s;
        pointer-events: none;
      }
      .frontier-ext-arena-verdict.show {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      .frontier-ext-arena-verdict .verdict-title {
        font-size: 1.05rem;
        font-weight: bold;
        text-align: center;
        margin: 0 0 0.55rem;
        color: #4a2e0a;
        letter-spacing: 0.04em;
        text-shadow: 0 1px 0 rgba(255,255,255,0.55);
      }
      .frontier-ext-arena-verdict .verdict-head {
        display: grid;
        grid-template-columns: 1fr 6rem 1fr;
        gap: 0.4rem;
        align-items: center;
        font-weight: bold;
        font-size: 0.85rem;
        color: #2d1e05;
        margin-bottom: 0.3rem;
      }
      .frontier-ext-arena-verdict .verdict-head .you    { text-align: right;  color: #3a5fa6; }
      .frontier-ext-arena-verdict .verdict-head .them   { text-align: left;   color: #a03838; }
      .frontier-ext-arena-verdict .verdict-head .criterion { text-align: center; color: #5a4208; }
      .frontier-ext-arena-verdict .verdict-rows {
        display: flex;
        flex-direction: column;
        gap: 0.28rem;
        border-top: 1px solid #8a6a1c;
        border-bottom: 1px solid #8a6a1c;
        padding: 0.35rem 0.15rem;
        background: rgba(255,255,255,0.28);
      }
      .frontier-ext-arena-verdict .verdict-row {
        display: grid;
        grid-template-columns: 1fr 6rem 1fr;
        gap: 0.4rem;
        align-items: center;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.35s ease, transform 0.35s ease;
      }
      .frontier-ext-arena-verdict .verdict-row.shown {
        opacity: 1;
        transform: translateY(0);
      }
      .frontier-ext-arena-verdict .verdict-row .label {
        text-align: center;
        font-weight: bold;
        color: #4a2e0a;
        font-size: 0.9rem;
        letter-spacing: 0.03em;
      }
      .frontier-ext-arena-verdict .verdict-row .mark {
        font-size: 1.6rem;
        line-height: 1;
        font-weight: bold;
        display: inline-block;
      }
      .frontier-ext-arena-verdict .verdict-row .mark.left  { text-align: right;  padding-right: 0.4rem; }
      .frontier-ext-arena-verdict .verdict-row .mark.right { text-align: left;   padding-left:  0.4rem; }
      .frontier-ext-arena-verdict .mark-win  { color: #c83434; text-shadow: 0 0 3px rgba(200,52,52,0.45); }
      .frontier-ext-arena-verdict .mark-tie  { color: #2c5fb0; text-shadow: 0 0 3px rgba(44,95,176,0.45); }
      .frontier-ext-arena-verdict .mark-lose { color: #1a1a1a; opacity: 0.85; }
      .frontier-ext-arena-verdict .verdict-total {
        display: grid;
        grid-template-columns: 1fr 6rem 1fr;
        gap: 0.4rem;
        align-items: center;
        font-weight: bold;
        margin-top: 0.4rem;
        font-size: 1rem;
        opacity: 0;
        transition: opacity 0.35s ease;
      }
      .frontier-ext-arena-verdict .verdict-total.shown { opacity: 1; }
      .frontier-ext-arena-verdict .verdict-total .you    { text-align: right;  color: #1d3a78; }
      .frontier-ext-arena-verdict .verdict-total .them   { text-align: left;   color: #7a1515; }
      .frontier-ext-arena-verdict .verdict-total .sep    { text-align: center; color: #4a2e0a; letter-spacing: 0.12em; }
      .frontier-ext-arena-verdict .verdict-arbiter {
        margin-top: 0.5rem;
        padding: 0.45rem 0.55rem;
        background: linear-gradient(180deg, #fdf8e6, #e8d99b);
        border: 1px solid #5a4208;
        border-radius: 0.35rem;
        font-size: 0.88rem;
        color: #2a1e07;
        min-height: 1.4rem;
        line-height: 1.3;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .frontier-ext-arena-verdict .verdict-arbiter.shown { opacity: 1; }
      .frontier-ext-arena-verdict .verdict-arbiter .speaker {
        display: inline-block;
        font-weight: bold;
        color: #5a2e02;
        letter-spacing: 0.05em;
        margin-right: 0.25rem;
      }
      /* Per-slot HP + status overlay inside the locked team preview.
         Positioned top-right because the game's #{team-i-held-item}
         sits top-left and would otherwise cover our pills. */
      .frontier-ext-team-slot-hp {
        position: absolute;
        top: 0.4rem;
        right: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.18rem;
        pointer-events: none;
        z-index: 50;
        align-items: flex-end;
      }
      .frontier-ext-team-slot-hp .hp-pill {
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        padding: 0.1rem 0.45rem;
        border-radius: 0.25rem;
        font-size: 0.78rem;
        font-weight: bold;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .frontier-ext-team-slot-hp .hp-pill.low { background: rgba(192, 57, 43, 0.9); }
      .frontier-ext-team-slot-hp .hp-pill.mid { background: rgba(230, 126, 34, 0.9); }
      .frontier-ext-team-slot-hp .hp-pill.ko {
        background: rgba(60, 60, 60, 0.95);
        color: #ff6b6b;
        text-shadow: 0 0 3px rgba(255, 80, 80, 0.7);
      }
      .frontier-ext-team-slot-hp .status-pill {
        padding: 0.1rem 0.4rem;
        border-radius: 0.25rem;
        font-size: 0.72rem;
        font-weight: bold;
        text-align: center;
      }
      .frontier-ext-team-slot-hp .status-pill.poisoned { background: #8e44ad; color: #fff; }
      .frontier-ext-team-slot-hp .status-pill.burn { background: #c0392b; color: #fff; }
      .frontier-ext-team-slot-hp .status-pill.paralysis { background: #f39c12; color: #000; }
    `;
    const style = document.createElement("style");
    style.id = "frontier-ext-css";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── 4b. SECTION DIVIDER ──────────────────────────────────────────────────
  // Renders a labelled band between the vanilla facilities (division-locked)
  // and our secret section (Open Level, no division rules).
  function buildDivider() {
    const lang = "en";
    const t = {
          title: "⚔️ Battle Frontier — Hoenn",
          sub: "Gen 3 Emerald rules · Level 100 Pokémon required · Teams of 3 · No division restriction" };

    const div = document.createElement("div");
    div.className = "frontier-ext-divider";
    div.innerHTML = `
      <span class="frontier-ext-divider-title">${t.title}</span>
      <span class="frontier-ext-divider-sub">${t.sub}</span>
    `;
    return div;
  }

  // ─── 5. TILE BUILDER ──────────────────────────────────────────────────────
  function buildTile(facility) {
    const lang = "en";
    const name = facility.name;
    const streakLabel = "Streak";
    const maxLabel = "Best";

    const streak = (saved.frontierExt && saved.frontierExt.streaks[facility.id]) || 0;
    const maxStreak = (saved.frontierExt && saved.frontierExt.maxStreaks[facility.id]) || 0;
    const symbols = (saved.frontierExt && saved.frontierExt.symbols[facility.id]) || { silver: false, gold: false };

    const silverClass = symbols.silver ? "silver" : "locked";
    const goldClass = symbols.gold ? "gold" : "locked";

    const unlocked = isUnlocked();

    // "EN COURS" / "EN PAUSE" badge — surfaces the run state on the
    // tile so the player knows at a glance which facilities have a
    // live or paused streak, without opening each one. Active = red
    // pulse, paused = muted amber.
    const activeRun = saved.frontierExt && saved.frontierExt.activeRun;
    const pausedRun = saved.frontierExt && saved.frontierExt.pausedRuns
      && saved.frontierExt.pausedRuns[facility.id];
    const tileRun = (activeRun && activeRun.facilityId === facility.id) ? activeRun : pausedRun;
    const isActiveHere = !!(activeRun && activeRun.facilityId === facility.id);
    const isPausedHere = !isActiveHere && !!pausedRun;
    const activeLabel = "IN PROGRESS";
    const pausedLabel = "PAUSED";
    let inProgressTag = "";
    if (isActiveHere) {
      const r = tileRun.round + 1, goal = nextGoalRoundFor(r, facility);
      const tip = `Run ${r}/${goal}`;
      inProgressTag = `<span class="frontier-ext-inprogress-tag" title="${tip}">● ${activeLabel}</span>`;
    } else if (isPausedHere) {
      const r = tileRun.round + 1;
      const tip = `Paused at round ${r}`;
      inProgressTag = `<span class="frontier-ext-paused-tag" title="${tip}">⏸ ${pausedLabel}</span>`;
    }
    // "🔥 Difficulté croissante" sticker: lights up on the facility tile
    // as soon as the run (active OR paused) is past Gold with a
    // multiplier ≥ 2. Disappears when the streak ends. Multiplier
    // reflects the upcoming round.
    let heatTag = "";
    if (tileRun) {
      const upcomingMult = difficultyMultiplier(tileRun.round + 1, facility);
      if (upcomingMult >= 2) {
        const heatTitle = `Difficulty ×${upcomingMult} — rematch streak`;
        heatTag = `<span class="frontier-ext-heat-tag" title="${heatTitle}">🔥 ×${upcomingMult}</span>`;
      }
    }

    const tile = document.createElement("div");
    tile.className = "explore-ticket frontier-ticket frontier-ext-tile" + (unlocked ? "" : " locked");
    tile.style.setProperty("--hue", facility.hueRotate + "deg");
    tile.dataset.facility = facility.id;

    // Golden padlock overlay when locked.
    const lockOverlay = unlocked
      ? ""
      : `<svg class="frontier-ext-lock-icon" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3m0 11a2 2 0 0 1 1 3.7V20h-2v-1.3A2 2 0 0 1 12 15"/></svg>`;

    // Structure mirrors the vanilla Battle Tower / Battle Factory tile in
    // explore.js line ~7383+ : frontier-flair SVG as a direct child, then the
    // left label span, then the right-side sprite container.
    tile.innerHTML = `
      <span class="hitbox"></span>
      ${lockOverlay}
      <div style="width: 100%;">
        ${facility.iconSvg}
        <span class="explore-ticket-left">
          <span style="font-size:1.2rem">
            ${name}
          </span>
          <span>
            <strong class="frontier-ext-streak">${streakLabel}: ${streak}<br>${maxLabel}: ${maxStreak}</strong>
            <span class="frontier-ext-symbol ${silverClass}" title="${`Silver Symbol (round ${silverRoundFor(facility)})`}">●</span>
            <span class="frontier-ext-symbol ${goldClass}" title="${`Gold Symbol (round ${goldRoundFor(facility)})`}">●</span>
            <span class="frontier-ext-state-pills">
              ${heatTag}
              ${inProgressTag}
            </span>
          </span>
        </span>
      </div>
      <div style="width: 8rem;" class="explore-ticket-right">
        <span class="explore-ticket-bg" style="background-image: url(img/bg/${facility.background}.png);"></span>
        <img class="explore-ticket-sprite sprite-trim frontier-ext-brain-icon"
             style="z-index: 10;"
             src="img/trainers/${facility.brain.sprite}.png"
             alt="${facility.brain.name}">
      </div>
    `;

    // Right-click / long-press opens the help tooltip even when locked, so
    // the player can still read what the facility will do once they unlock it.
    tile.dataset.help = "FrontierExt:" + facility.id;
    // Left-click: preview / battle start if unlocked, else show the lock
    // message using the same pattern as the shop's locked apricorn category
    // (explore.js:1676-1681).
    tile.addEventListener("click", () => {
      if (!isUnlocked()) {
        showLockedTooltip();
        return;
      }
      openFacilityPreview(facility);
    });
    return tile;
  }

  function showLockedTooltip() {
    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    if (top) top.style.display = "none";
    if (title) title.style.display = "none";
    if (bottom) bottom.style.display = "none";
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = unlockText();
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Shown when the player clicks on a facility tile while a run is
  // active in a DIFFERENT facility. The rule is simple: one active run
  // at a time. The player must either continue or abandon the current
  // run before starting another.
  function showRunInProgressElsewhere(attemptedFacility) {
    const lang = "en";
    const run = saved.frontierExt.activeRun;
    const activeFacility = FACILITIES.find((f) => f.id === run.facilityId);
    if (!activeFacility) return;
    const activeName = activeFacility.name;
    const attemptedName = attemptedFacility.name;
    const brainName = activeFacility.brain.name;

    const t = {
          title: "⚠️ A run is already in progress",
          body: `You have an active streak in <strong>${activeName}</strong> (Round ${run.round + 1}). Finish or abandon that streak before starting <strong>${attemptedName}</strong>.`,
          reason: "Only one team can be locked in the Hoenn ZdC at a time.",
          goToActive: "Resume " + activeName,
          abandon: "Abandon current streak",
          close: "Close" };

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      top.innerHTML = `<img src="img/trainers/${activeFacility.brain.sprite}.png"
        style="max-height: 120px; image-rendering: pixelated;"
        alt="${brainName}">`;
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = t.title;
    }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div style="padding: 0.6rem 0.9rem;">
          <div style="margin-bottom: 0.5rem;">${t.body}</div>
          <div style="font-style: italic; opacity: 0.75; font-size: 0.9rem;">${t.reason}</div>
        </div>
      `;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="elsewhere-resume">${t.goToActive}</button>
          <button class="frontier-ext-action-btn danger" data-action="elsewhere-abandon">${t.abandon}</button>
          <button class="frontier-ext-action-btn" data-action="elsewhere-close">${t.close}</button>
        </div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => {
          const act = btn.dataset.action;
          if (act === "elsewhere-resume") {
            openFacilityPreview(activeFacility);
          } else if (act === "elsewhere-abandon") {
            handleRunAction("abandon", activeFacility);
          } else {
            if (typeof closeTooltip === "function") closeTooltip();
          }
        };
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // ─── 6. FACILITY PREVIEW / RUN MODAL ──────────────────────────────────────
  // Left-click on an unlocked tile opens this. Shows different content
  // depending on whether a run is already in progress for this facility.
  function openFacilityPreview(facility) {
    // Make sure any oversized modal class from a previous screen is
    // cleared — stale class could otherwise force the facility-preview
    // modal to render too tall.
    try {
      const box = document.getElementById("tooltipBox");
      if (box) {
        box.classList.remove("frontier-ext-factory-open");
        box.classList.remove("frontier-ext-pyramid-open");
        box.classList.remove("frontier-ext-run-lock-open");
      }
      const bg = document.getElementById("tooltipBackground");
      if (bg) bg.classList.remove("frontier-ext-run-lock-open");
    } catch (e) { /* ignore */ }
    const lang = "en";
    const name = facility.name;
    const brainName = facility.brain.name;

    ensureSaveSlot();
    const activeRun = saved.frontierExt.activeRun;
    const pausedRun = saved.frontierExt.pausedRuns && saved.frontierExt.pausedRuns[facility.id];
    const isActive = activeRun && activeRun.facilityId === facility.id;
    const isPaused = !isActive && !!pausedRun;
    const run = isActive ? activeRun : (isPaused ? pausedRun : null);
    // Block only when ANOTHER facility holds the active (locked) run.
    // Paused runs in other facilities never block — they're by design
    // frozen and unlocked, so the player can hop between facilities.
    if (activeRun && activeRun.facilityId !== facility.id) {
      showRunInProgressElsewhere(facility);
      return;
    }

    // Gendered role label for this facility's brain (Anabel / Greta /
    // Lucy get "Zone Leader de Zone", the rest get "Zone Leader").
    // (Zone Leader role label — fixed English now that FR branches are gone.)

    const t = {
          brain: `${"Zone Leader"}:`,
          maxStreak: "Best streak:",
          inProgress: "Run in progress",
          paused: "Paused",
          start: "Start a run",
          cont: "Continue (Round {r})",
          resume: "Resume (Round {r})",
          rest: "Rest",
          abandon: "Abandon",
          round: "Round",
          silverBanner: (r)    => `⚡ Round ${r} — the ${"Zone Leader"} (Silver) is next!`,
          goldBanner:   (r)    => `💎 Round ${r} — the ${"Zone Leader"} (Gold) is next!`,
          rematchBanner:(r, m) => `🔥 Round ${r} — ${"Zone Leader"} rematch ×${m}!` };

    const maxStreak = saved.frontierExt.maxStreaks[facility.id] || 0;

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      top.innerHTML = `<img src="img/trainers/${facility.brain.sprite}.png" style="max-height: 140px; image-rendering: pixelated;" alt="${brainName}">`;
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = name;
    }

    const hasRun = isActive || isPaused;
    const nextRound = hasRun ? run.round + 1 : 1;
    const isBossRound = hasRun && !!getBossRoundInfo(nextRound, facility);

    if (mid) {
      mid.style.display = "block";
      let html = `<div style="padding:0.4rem 0.8rem;font-style:italic;opacity:0.9;">`;
      if (hasRun) {
        const dome = isDomeFacility(facility);
        const pike = isPikeFacility(facility);
        const perRound = battlesPerRound(facility);
        let battleStr = "";
        if (dome) {
          battleStr = ` · ${"Battle"} ${run.bracketBattle || 1}/${DOME_BRACKET_SIZE}`;
        } else if (pike) {
          battleStr = ` · ${"Room"} ${run.pikeRoom || 1}/${PIKE_ROOM_COUNT}`;
        } else if (perRound > 1) {
          // Tower / Palace / Arena / Factory — show battle progress within
          // the current round so the player sees movement even when the
          // round counter hasn't ticked over yet (7 battles = 1 round).
          battleStr = ` · ${"Battle"} ${run.battleInRound || 1}/${perRound}`;
        }
        const stateLabel = isPaused ? t.paused : t.inProgress;
        html += `<strong>${stateLabel}</strong> — ${t.round} ${run.round + 1}/${nextGoalRoundFor(run.round + 1, facility)}${battleStr}`;
      } else {
        html += `${facility.desc}`;
      }
      html += `</div>`;
      if (isBossRound) {
        const info = getBossRoundInfo(nextRound, facility);
        let bannerTxt = "";
        if (info) {
          if (info.kind === "silver")      bannerTxt = t.silverBanner(nextRound);
          else if (info.kind === "gold")   bannerTxt = t.goldBanner(nextRound);
          else /* rematch */                bannerTxt = t.rematchBanner(nextRound, info.multiplier);
        }
        if (bannerTxt) html += `<div style="padding:0.3rem 0.8rem;color:#ffd700;font-weight:bold;">${bannerTxt}</div>`;
      }
      mid.innerHTML = html;
    }

    if (bottom) {
      bottom.style.display = "block";
      // Button row depends on state:
      //   • Active (locked in combat) — Continue + Rest + Abandon
      //   • Paused (resumeable, no lock) — Resume + Abandon (no Rest
      //     because the run is already paused)
      //   • Fresh — Start only
      let buttons;
      if (isActive) {
        buttons = `
          <button class="frontier-ext-action-btn primary" data-action="continue">${t.cont.replace("{r}", run.round + 1)}</button>
          <button class="frontier-ext-action-btn" data-action="rest">${t.rest}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        `;
      } else if (isPaused) {
        buttons = `
          <button class="frontier-ext-action-btn primary" data-action="resume">${t.resume.replace("{r}", run.round + 1)}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        `;
      } else {
        buttons = `
          <button class="frontier-ext-action-btn primary" data-action="start">${t.start}</button>
        `;
      }

      // Pyramid-only: Psychic NPC row reveals the theme the player is
      // about to face. Shown at registration (fresh facility), on
      // resume (before re-entering), and on round-cleared transitions
      // (covered by the Continue state) — NEVER mid-run inside the
      // dungeon itself.
      let kinesisteRowHtml = "";
      if (isPyramidFacility(facility)) {
        // pyramidThemeIndex is bumped inside onRunVictory BEFORE
        // roundJustCleared gets set, so at preview time the "current"
        // theme is already the one the player is about to play. No
        // +1 lookup — just read the current slot.
        const themeForPreview = run ? pyramidCurrentTheme(run) : PYRAMID_THEMES[0];
        const themeLabelPreview = themeForPreview.label;
        const introLine = "🔮 The Psychic whispers: \"I sense the next theme…\"";
        const themeLine = `Next theme: <strong>${themeLabelPreview}</strong>`;
        kinesisteRowHtml = `
          <div class="frontier-ext-pyr-kinesiste-preview">
            <div class="intro">${introLine}</div>
            <div class="theme">${themeLine}</div>
          </div>`;
      }

      bottom.innerHTML = `
        <div class="frontier-ext-help-rules" style="grid-template-columns:auto 1fr;">
          <span class="label">${t.brain}</span>
          <span class="value">${brainName}</span>
          <span class="label">${t.maxStreak}</span>
          <span class="value">${maxStreak}</span>
        </div>
        ${kinesisteRowHtml}
        <div class="frontier-ext-run-actions">${buttons}</div>
      `;

      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }

    // Lock the close × when the active run is bound to THIS facility —
    // user must pick Continuer / Repos / Abandonner. Paused runs keep
    // the × because they're already parked; fresh facilities too.
    try {
      const bg = document.getElementById("tooltipBackground");
      const box = document.getElementById("tooltipBox");
      if (isActive) {
        if (bg)  bg.classList.add("frontier-ext-run-lock-open");
        if (box) box.classList.add("frontier-ext-run-lock-open");
      }
    } catch (e) { /* ignore */ }

    if (typeof openTooltip === "function") openTooltip();
  }

  // Dôme pick-2-of-3 modal — opens AFTER the bracket preview when the
  // player clicks "Lancer le combat". Shows the player's 3 mons as
  // togglable cards; exactly 2 must be selected. The chosen 2 become the
  // active battlers; the third is temporarily cleared from the preview
  // team before combat and restored in the leaveCombat hook.
  function openDomePokemonSelection(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const lang = "en";

    const bracket = ensureBracketForDome(facility);
    const currentIdx = (run.bracketBattle || 1) - 1;
    const opponent = bracket[currentIdx];
    if (!opponent) return;

    const pt = (saved.previewTeams && saved.previewTeams[saved.currentPreviewTeam]) || {};
    const playerMons = [];
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (pt[sl] && pt[sl].pkmn) playerMons.push({ slot: sl, id: pt[sl].pkmn });
    }

    // Selection persisted on the run so re-opening keeps picks
    if (!run.domeSelection) run.domeSelection = [];

    const t = {
          title: "Pick 2 Pokémon",
          desc: "Both sides see each other's teams. Pick 2 Pokémon for this match.",
          yourTeam: "Your team",
          opponentTeam: "Opponent",
          need2: "Select exactly 2 Pokémon.",
          confirm: "⚔️ Confirm & fight",
          abandon: "Abandon" };

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) { top.style.display = "none"; }
    if (title) { title.style.display = "block"; title.innerHTML = t.title; }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div style="padding:0.5rem 0.8rem;font-style:italic;opacity:0.85;">${t.desc}</div>
        <div class="frontier-ext-dome-teams">
          <div class="frontier-ext-dome-side">
            <div class="frontier-ext-dome-label">${t.yourTeam}</div>
            <div class="frontier-ext-dome-slots" id="frontier-ext-dome-player"></div>
          </div>
          <div class="frontier-ext-dome-side">
            <div class="frontier-ext-dome-label">${t.opponentTeam} — ${opponent.name}</div>
            <div class="frontier-ext-dome-slots">
              ${opponent.team.map((s) =>
                `<div class="frontier-ext-dome-card opponent"><img src="img/pkmn/sprite/${s.id}.png" alt="${s.id}"><div>${typeof format === "function" ? format(s.id) : s.id}</div></div>`
              ).join("")}
            </div>
          </div>
        </div>
      `;
      const playerCtr = document.getElementById("frontier-ext-dome-player");
      if (playerCtr) {
        playerCtr.innerHTML = playerMons.map((m) => {
          const selected = run.domeSelection.indexOf(m.id) !== -1;
          return `<div class="frontier-ext-dome-card player${selected ? " selected" : ""}" data-monid="${m.id}"><img src="img/pkmn/sprite/${m.id}.png" alt="${m.id}"><div>${typeof format === "function" ? format(m.id) : m.id}</div></div>`;
        }).join("");
        playerCtr.querySelectorAll("[data-monid]").forEach((el) => {
          el.onclick = () => toggleDomeSelection(el.dataset.monid, facility);
        });
      }
    }
    if (bottom) {
      bottom.style.display = "block";
      const canConfirm = run.domeSelection.length === DOME_ACTIVE_SIZE;
      bottom.innerHTML = `
        <div style="padding:0.4rem 0.8rem;font-size:0.85rem;color:${canConfirm ? "#2a5e2a" : "#7a2e1a"};text-align:center;">
          ${canConfirm ? `✓ ${run.domeSelection.length}/${DOME_ACTIVE_SIZE}` : t.need2}
        </div>
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="confirm-dome" ${canConfirm ? "" : "disabled style=\"opacity:0.4;cursor:not-allowed;\""}>${t.confirm}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Selection stores Pokémon IDs (not slot keys) so reorders or team
  // switches between pick-time and launch-time can't cheese. If the
  // player moves their mons around, the match still uses the exact
  // Pokémon they chose. If they switch to a different preview team
  // that doesn't contain one of the picked IDs, the missing slot stays
  // empty — natural penalty for trying to cheat.
  function toggleDomeSelection(monId, facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    if (!run.domeSelection) run.domeSelection = [];
    const idx = run.domeSelection.indexOf(monId);
    if (idx !== -1) {
      run.domeSelection.splice(idx, 1);
    } else if (run.domeSelection.length < DOME_ACTIVE_SIZE) {
      run.domeSelection.push(monId);
    } else {
      run.domeSelection.shift();
      run.domeSelection.push(monId);
    }
    openDomePokemonSelection(facility);
  }

  // GLOBAL SAFETY RULE: this overlay MUST NEVER mutate saved.previewTeams.
  // Any write to saved.* that can persist to disk could corrupt the
  // player's save if an error occurs mid-operation. The Dôme's 2-of-3
  // rule is instead applied to the RUNTIME `team[]` object (populated by
  // the game's injectPreviewTeam from currentTeam on each battle
  // launch); team[] is ephemeral so clearing non-selected slots there
  // has zero save-corruption risk.
  //
  // applyDomeSelection is now a marker — it only confirms the selection
  // and lets the team-filter hook do the actual filtering at launch.
  function applyDomeSelection() {
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return;
    run.domeSelectionConfirmed = true;
  }

  // Back-compat shim for earlier buggy saves that still carry a
  // domeTeamBackup. If one is found, restore from it then clear so it
  // never fires twice. New runs never populate this field anymore.
  function restoreDomeSelection() {
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run || !run.domeTeamBackup) return;
    const ptKey = run.domeTeamSlot || saved.currentPreviewTeam;
    const pt = saved.previewTeams && saved.previewTeams[ptKey];
    if (pt) {
      for (const sl of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
        delete pt[sl];
      }
      for (const sl of Object.keys(run.domeTeamBackup)) {
        pt[sl] = run.domeTeamBackup[sl];
      }
    }
    run.domeTeamBackup = null;
    run.domeTeamSlot = null;
  }

  // Hook injectPreviewTeam (teams.js:280) so that AFTER the game copies
  // currentTeam → team[] at combat launch, we null out the RUNTIME team[]
  // entries the player didn't pick for the Dôme match. saved.previewTeams
  // stays untouched — zero corruption risk.
  function installDomeTeamFilter() {
    if (typeof window.injectPreviewTeam !== "function") {
      setTimeout(installDomeTeamFilter, 200);
      return;
    }
    if (window.__frontierExtDomeFilterHooked) return;
    window.__frontierExtDomeFilterHooked = true;
    const orig = window.injectPreviewTeam;
    window.injectPreviewTeam = function () {
      const res = orig.apply(this, arguments);
      try {
        const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
        if (!run || !Array.isArray(run.domeSelection) ||
            run.domeSelection.length !== DOME_ACTIVE_SIZE) return res;
        const facility = FACILITIES.find((f) => f.id === run.facilityId);
        if (!isDomeFacility(facility)) return res;
        // Only filter when actually launching a Dôme-run battle
        // (saved.currentArea is set to RUN_AREA_ID in injectPreviewTeam
        // at line 448 via the buffer assignment).
        if (saved.currentArea !== RUN_AREA_ID) return res;
        if (typeof team === "undefined") return res;

        // Filter + PACK the team (anti-cheese). Three things to solve:
        //   1. Anti-cheese: if the player reordered the team or switched
        //      preview teams between pick and launch, keep only the
        //      exact mons they picked (matched by Pokémon ID).
        //   2. Pack to contiguous slots starting at slot1, because the
        //      game hardcodes `exploreActiveMember = "slot1"` in
        //      initialiseArea. Leaving slot1 empty would crash
        //      updateTeamPkmn at team[slot1].pkmn.id lookup.
        //   3. SEND ORDER: canonical Dome rule — the Pokémon are sent
        //      in the order the player picked them (not preview-slot
        //      order). Iterate run.domeSelection (push-in-click-order,
        //      see the toggle at line ~3417) and resolve each id to
        //      its source slot. This makes the first pick = slot1 =
        //      first Pokémon on the field.
        const slotById = {};
        for (const slotKey of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
          const slot = team[slotKey];
          if (!slot) continue;
          const mon = slot.pkmn;
          const monId = mon && (mon.id || (typeof mon === "string" ? mon : null));
          if (monId && !slotById[monId]) slotById[monId] = slot;
        }
        const kept = [];
        for (const pickedId of run.domeSelection) {
          const slot = slotById[pickedId];
          if (slot) kept.push({ pkmn: slot.pkmn, item: slot.item });
        }
        const SLOTS = ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"];
        for (let i = 0; i < SLOTS.length; i++) {
          const slot = team[SLOTS[i]];
          if (!slot) continue;
          if (i < kept.length) {
            slot.pkmn = kept[i].pkmn;
            slot.item = kept[i].item;
          } else {
            slot.pkmn = undefined;
            slot.item = undefined;
          }
        }
      } catch (e) {
        console.error("[frontier-ext] dome team filter failed:", e);
      }
      return res;
    };
  }

  // Heal any lingering corruption from earlier buggy saves. Walks every
  // preview team and any team slot containing `null` gets its key
  // deleted — restoring the game's "slot absent = empty" invariant.
  function sanitizeNullSlots() {
    if (typeof saved !== "object" || !saved || !saved.previewTeams) return 0;
    let healed = 0;
    for (const key of Object.keys(saved.previewTeams)) {
      const pt = saved.previewTeams[key];
      if (!pt || typeof pt !== "object") continue;
      for (const sl of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
        if (pt[sl] === null) {
          delete pt[sl];
          healed++;
        }
      }
    }
    if (healed > 0) {
      console.info("[frontier-ext] sanitized " + healed + " null preview-team slot(s)");
    }
    return healed;
  }

  // Hook every entry point that reads preview-team slots so the sanitizer
  // runs BEFORE the game crashes on a null value. explore.js:9915
  // (arceusCheck) and teams.js:911 (updatePreviewTeam) both blow up on
  // `pt[slotN].pkmn` when the slot is null.
  function installTeamSanitizerHooks() {
    const fnNames = ["updatePreviewTeam", "arceusCheck", "switchMenu"];
    for (const name of fnNames) {
      (function wrap(n) {
        const attempt = () => {
          if (typeof window[n] !== "function") {
            setTimeout(attempt, 200);
            return;
          }
          if (window["__frontierExtHook_" + n]) return;
          window["__frontierExtHook_" + n] = true;
          const orig = window[n];
          window[n] = function () {
            try { sanitizeNullSlots(); } catch (e) { /* ignore */ }
            return orig.apply(this, arguments);
          };
        };
        attempt();
      })(name);
    }
  }

  // Runs at bootstrap and on any updateFrontier re-render. If we find a
  // pending domeTeamBackup but no combat is in progress, that means a
  // previous run got interrupted between applyDomeSelection() and
  // restoreDomeSelection() — probably because launchCombat errored or
  // the page reloaded mid-pick. Restore automatically so the player's
  // team isn't stuck in a mutated 2-mon state.
  function recoverCorruptedDomeTeam() {
    if (typeof saved !== "object" || !saved || !saved.frontierExt) return;
    const run = saved.frontierExt.activeRun;
    if (!run || !run.domeTeamBackup) return;
    // Are we currently mid-combat in a frontier-ext run? If so, the
    // mutation is intentional; don't restore.
    if (saved.currentArea === RUN_AREA_ID) return;
    // Otherwise the team is corrupted. Restore + wipe the dome selection
    // so the next match starts fresh.
    try {
      restoreDomeSelection();
      run.domeSelection = [];
      console.info("[frontier-ext] recovered mutated Dôme team from backup");
    } catch (e) {
      console.error("[frontier-ext] recovery failed:", e);
    }
  }

  // Dome-specific preview: shows the 3-trainer bracket before launching
  // each individual battle inside it. Highlights the current opponent.
  function openDomeBracketPreview(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run || run.facilityId !== facility.id) return;

    const lang = "en";
    const bracket = ensureBracketForDome(facility);
    const currentIdx = (run.bracketBattle || 1) - 1;
    const trainer = bracket[currentIdx];
    if (!trainer) return;

    const t = {
          round: "Round",
          bracket: "Bracket",
          battle: "Battle",
          vs: "vs",
          nextOpp: "Next opponent",
          remainingInBracket: "Upcoming opponents in this bracket",
          warn: "⚠️ All your Pokémon must be level 100.",
          launch: "⚔️ Launch battle",
          abandon: "Abandon",
          qf: "QF",
          sf: "SF",
          final: "Final" };

    const labels = [t.qf, t.sf, t.final];
    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      top.innerHTML = `<img src="img/trainers/${trainer.sprite}.png" style="max-height: 140px; image-rendering: pixelated;" alt="${trainer.name}">`;
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${t.round} ${run.round + 1} — ${labels[currentIdx]}: ${trainer.name}`;
    }
    if (mid) {
      mid.style.display = "block";
      const teamPreview = trainer.team
        .map((slot) => (typeof format === "function" ? format(slot.id) : slot.id))
        .join(" · ");
      // Bracket overview — mark current battle, grey out completed & upcoming
      const bracketRows = bracket.map((tr, i) => {
        const teamStr = tr.team
          .map((s) => (typeof format === "function" ? format(s.id) : s.id))
          .join(" · ");
        const status = i < currentIdx
          ? "✓"
          : i === currentIdx
          ? "▶"
          : "·";
        const style = i === currentIdx
          ? "color:#ffd700;font-weight:bold;"
          : i < currentIdx
          ? "opacity:0.45;"
          : "opacity:0.7;";
        const bossMark = tr.isBoss ? " 👑" : "";
        return `<div style="${style}padding:0.15rem 0;">${status} ${labels[i]}: <strong>${tr.name}${bossMark}</strong> — ${teamStr}</div>`;
      }).join("");
      mid.innerHTML = `
        <div style="padding:0.5rem 0.8rem;">
          <div style="font-weight:bold;color:#ffd700;margin-bottom:0.3rem;">${t.nextOpp}:</div>
          <div>${teamPreview}</div>
        </div>
        <div style="padding:0.4rem 0.8rem;border-top:1px dashed rgba(255,255,255,0.15);margin-top:0.3rem;">
          <div style="font-size:0.85rem;opacity:0.8;margin-bottom:0.2rem;">${t.bracket} (${t.round} ${run.round + 1})</div>
          ${bracketRows}
        </div>
      `;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div style="padding:0.4rem 0.8rem;color:#7a2e1a;font-size:0.85rem;text-align:center;">${t.warn}</div>
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="launch">${t.launch}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Shows upcoming trainer + simulate win/loss buttons (placeholder until
  // real combat is wired in Étape 2).
  function openSimulatedFight(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run || run.facilityId !== facility.id) return;

    const lang = "en";
    const nextRound = run.round + 1;
    const _bossInfo = getBossRoundInfo(nextRound, facility);
    const perRound = battlesPerRound(facility);
    const battleInRound = run.battleInRound || 1;
    // Brain fight only on the LAST battle of a boss round. Battles 1..N-1
    // of a boss round still face regular pool trainers. Dome handles its
    // own brain slot via ensureBracketForDome; Pike via its door picker.
    const isBrainBattleHere = _bossInfo && battleInRound === perRound;
    const isSilverBoss = isBrainBattleHere && _bossInfo.kind === "silver";
    const isGoldBoss = isBrainBattleHere && _bossInfo.kind !== "silver";

    const t = {
          round: "Round",
          battle: "Battle",
          vs: "vs",
          warn: "⚠️ All your Pokémon must be level 100. The battle will be very hard otherwise!",
          launch: "⚔️ Launch battle",
          abandon: "Abandon" };

    // Generate or REUSE the upcoming trainer. Persistence matters: if
    // we re-rolled on every modal open, the player could close the
    // tooltip and re-click the facility tile until they liked the
    // matchup. Cache on `run.upcomingTrainer` — gets cleared in
    // onRunVictory/onRunDefeat so the next battle always rolls fresh.
    // Boss trainers are deterministic (fixed teams per brain), so the
    // "cache" is really only load-protection for them.
    let trainer = run.upcomingTrainer;
    const trainerStale = !trainer
      || trainer.facilityId !== facility.id
      || trainer.round !== nextRound
      || (!!trainer.isBoss) !== (isSilverBoss || isGoldBoss);
    if (trainerStale) {
      if (isSilverBoss || isGoldBoss) {
        const brainDiff = computeRunDifficulty(nextRound, facility);
        const brainTeam = isSilverBoss ? facility.brain.teamSilver : facility.brain.teamGold;
        trainer = {
          name: facility.brain.name,
          sprite: facility.brain.sprite,
          team: brainTeam
            ? brainTeam.map((id) => ({ id, moves: pickMovesetFor(id, brainDiff) }))
            : [1, 2, 3].map(() => {
                const id = pickFromPool(3);
                return { id, moves: pickMovesetFor(id, brainDiff) };
              }),
          isBoss: true,
          facilityId: facility.id,
          round: nextRound,
          tier: brainDiff.tier,
          multiplier: brainDiff.mult };
      } else {
        trainer = generateTrainer(nextRound, facility);
        // generateTrainer already sets facilityId + round; nothing extra.
      }
    }

    // Factory species-overlap dedupe: if the opponent happens to roll a
    // species already in the player's rental team, the combat engine would
    // read `pkmn[id]` which is currently overridden with the PLAYER's
    // rental spec (applyFactoryMoves). Net effect: the opponent fights
    // with your own stats, and post-battle swap becomes a no-op. Re-roll
    // any overlap from the same tier pool so every opponent mon is
    // distinct from your rentals. Run ONLY on a fresh trainer roll, never
    // on a cached one — otherwise reopening the modal would re-roll
    // overlapping slots and give the player another trainer-variation
    // cheese.
    if (trainerStale && isFactoryFacility(facility) && run.factoryTeam && Array.isArray(trainer.team)) {
      const rentalIds = new Set(run.factoryTeam.map((r) => r.id));
      const tierForPool = trainer.tier || 1;
      const poolForReroll = getPoolForFacility(facility, tierForPool, nextRound);
      const rerollDiff = computeRunDifficulty(nextRound, facility);
      let safety = 0;
      for (let i = 0; i < trainer.team.length; i++) {
        while (rentalIds.has(trainer.team[i].id) && safety < 50) {
          safety++;
          const newId = poolForReroll[Math.floor(Math.random() * poolForReroll.length)]
            || pickFromPool(tierForPool);
          if (!newId || rentalIds.has(newId)) continue;
          trainer.team[i] = {
            id: newId,
            moves: pickMovesetFor(newId, rerollDiff),
            nature: trainer.team[i].nature || simulateNatureFor(newId) };
        }
      }
    }

    run.upcomingTrainer = trainer;

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      top.innerHTML = `<img src="img/trainers/${trainer.sprite}.png" style="max-height: 140px; image-rendering: pixelated;" alt="${trainer.name}">`;
    }
    if (title) {
      title.style.display = "block";
      const battleStr = perRound > 1
        ? ` · ${t.battle} ${battleInRound}/${perRound}`
        : "";
      title.innerHTML = `${t.round} ${nextRound}${battleStr} — ${trainer.name}`;
    }
    // Boss / mini-boss tag: surface the encounter's true threat level
    // so the player can anticipate before committing.
    //   • Brain fight (silver / gold / post-Gold rematch) → gold banner
    //   • Mini-boss (last battle of a non-boss round)     → orange banner
    //   • Regular fight                                    → no banner
    const miniBoss = isMiniBossBattle(run, facility);
    const bossInfoForBanner = (isSilverBoss || isGoldBoss)
      ? getBossRoundInfo(nextRound, facility)
      : null;
    let bossBannerHtml = "";
    if (bossInfoForBanner) {
      const multStr = bossInfoForBanner.multiplier > 1 ? ` ×${bossInfoForBanner.multiplier}` : "";
      const label = bossInfoForBanner.kind === "silver"
        ? `⚡ Zone Leader (Silver) — canonical team, hidden ability`
        : bossInfoForBanner.kind === "gold"
          ? `💎 Zone Leader (Gold) — upgraded team, max IVs`
          : `🔥 Zone Leader rematch${multStr} — enhanced team, multiplier active`;
      bossBannerHtml = `<div style="padding:0.35rem 0.8rem;color:#ffd700;font-weight:bold;font-size:0.95rem;text-shadow:0 0 5px rgba(255,215,0,0.5);border-left:3px solid rgba(255,215,0,0.55);margin:0.3rem 0.5rem;">${label}</div>`;
    } else if (miniBoss) {
      const miniBossLabel = "⚡ Round guardian — enhanced trainer (maxed stats, hidden ability)";
      bossBannerHtml = `<div style="padding:0.3rem 0.8rem;color:#ffb347;font-weight:bold;font-size:0.92rem;text-shadow:0 0 4px rgba(255,140,0,0.4);">${miniBossLabel}</div>`;
    }

    if (mid) {
      mid.style.display = "block";
      const teamPreview = trainer.team
        .map((slot) => (typeof format === "function" ? format(slot.id) : slot.id))
        .join(" · ");
      mid.innerHTML = `
        ${bossBannerHtml}
        <div style="padding:0.5rem 0.8rem;">
          <div style="opacity:0.75;font-size:0.9rem;">${t.vs}</div>
          <div style="font-weight:bold;margin-top:0.2rem;">${teamPreview}</div>
        </div>
      `;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div style="padding:0.4rem 0.8rem;color:#7a2e1a;font-size:0.85rem;text-align:center;">${t.warn}</div>
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="launch">${t.launch}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    // Combat-launch is always locked to an active run — hide the close
    // ×, forcing Launch or Abandon.
    try {
      const bg = document.getElementById("tooltipBackground");
      const box = document.getElementById("tooltipBox");
      if (bg)  bg.classList.add("frontier-ext-run-lock-open");
      if (box) box.classList.add("frontier-ext-run-lock-open");
    } catch (e) { /* ignore */ }
    if (typeof openTooltip === "function") openTooltip();
  }

  function handleRunAction(action, facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;

    if (action === "start") {
      // Another facility already holds the active (locked) run: refuse.
      // openFacilityPreview already surfaces this via
      // showRunInProgressElsewhere, but handleRunAction is also reachable
      // programmatically / from external callers / save-editor attacks —
      // without this belt-and-braces guard a direct "start" call would
      // overwrite activeRun and orphan the previous run's state.
      const existing = saved.frontierExt.activeRun;
      if (existing && existing.facilityId !== facility.id) {
        showRunInProgressElsewhere(facility);
        return;
      }
      // Hard gate — every non-Factory facility needs exactly 3 Pokémon
      // in the current preview team BEFORE any run state is created.
      // Without this check, the run gets locked in, the player enters
      // a facility-specific preview screen (dome bracket / pike rooms /
      // pyramid map / simulated fight), then the inner "launch" path
      // would finally block with showTeamSizeError — forcing them to
      // abandon to get out. Fail fast here instead.
      // Factory is exempt (rentals replace the player's team).
      if (!isFactoryFacility(facility) && currentPreviewTeamSize() !== 3) {
        showTeamSizeError(facility);
        return;
      }
      // Pyramid-specific hard gate: the reception NPC refuses entry if
      // any registered Pokémon is holding an item. Surface a clear
      // error modal instead of silently stripping items.
      if (isPyramidFacility(facility) && currentPreviewHasHeldItems()) {
        showPyramidItemsError(facility);
        return;
      }
      saved.frontierExt.activeRun = {
        facilityId: facility.id,
        round: 0,
        upcomingTrainer: null,
        bracketBattle: 1,
        bracketTrainers: null,
        bracketRound: null,
        // The preview team slot tied to THIS run. While the run is alive,
        // this preview slot is locked against edits (no slot click, no
        // drag, no item swap) — switching to another preview slot in the
        // team menu is still allowed, so the player can use different
        // teams elsewhere. See applyFrontierTeamLock.
        tiedPreviewSlot: saved.currentPreviewTeam,
        // Battle-in-round counter for facilities that use 7-battle sets
        // (Tower / Palace / Arena / Factory). Brain only appears at the
        // last battle of a boss round. Reset to 1 at end of each round.
        battleInRound: 1,
        // Pike fresh-run state: room 1, no doors rolled, pikeTeam
        // populated right after this block from the active preview team.
        pikeRoom: 1,
        pikeDoors: null,
        pikeDoorPicked: null,
        pikeTeam: null,
        pikeTeamSource: null };
      saved.frontierExt.streaks[facility.id] = 0;
      // Pike: snapshot the player's active preview team into the per-run
      // Pike team state before entering any room. This is the source of
      // truth for HP/status persistence across every combat of the run.
      if (isPikeFacility(facility)) initPikePyramidTeamFromPreview();
      // Pyramid also needs the runTeam snapshot (HP/status persist via
      // the same pikeTeam structure — facility has persistHpStatus flag).
      if (isPyramidFacility(facility)) {
        initPikePyramidTeamFromPreview();
        const newRun = saved.frontierExt.activeRun;
        // Init theme index + Combat Bag. The theme index only advances
        // on successful round clears; losing a run nulls activeRun and
        // the next start therefore begins at theme 0 — matches the
        // canonical "perdre = retour au first theme" rule.
        if (typeof newRun.pyramidThemeIndex !== "number") newRun.pyramidThemeIndex = 0;
        pyramidEnsureBag(newRun);
      }
      if (isDomeFacility(facility)) openDomeBracketPreview(facility);
      else if (isPikeFacility(facility)) openPikeRoomPreview(facility);
      else if (isFactoryFacility(facility)) openFactoryRentalSelection(facility);
      else if (isPyramidFacility(facility)) openPyramidFloorMap(facility);
      else openSimulatedFight(facility);
      return;
    }
    if (action === "continue") {
      // Same hard gate as "start" — the player may have edited the team
      // while browsing the facility preview. Fail fast before we route
      // back into a sub-flow that would only block at the inner launch.
      if (!isFactoryFacility(facility) && currentPreviewTeamSize() !== 3) {
        showTeamSizeError(facility);
        return;
      }
      // Pyramid-specific: still no items between rounds. If the player
      // re-equipped during the round-cleared break, force them to
      // unequip before continuing.
      if (isPyramidFacility(facility) && currentPreviewHasHeldItems()) {
        showPyramidItemsError(facility);
        return;
      }
      // Re-tie the run to the currently-selected preview slot. Between
      // rounds the team is unlocked by design (players want to edit or
      // swap teams), and the onRunVictory tied-team guard used to
      // silently abandon runs when the tied slot's count drifted —
      // which is exactly what happens if you swap to a different team
      // or remove a mon from the tied one. Re-tying on every resume so
      // the guard only ever sees the team the player is actually about
      // to fight with. Factory keeps its private FACTORY_PREVIEW_SLOT.
      if (run && !isFactoryFacility(facility)) {
        run.tiedPreviewSlot = saved.currentPreviewTeam;
      }
      // Consume the between-rounds unlock flag so the team re-locks as
      // soon as the player commits to the next round preview.
      if (run) run.roundJustCleared = false;
      // Pike: re-snapshot team in case the player edited between rounds.
      if (isPikeFacility(facility)) initPikePyramidTeamFromPreview();
      if (isDomeFacility(facility)) openDomeBracketPreview(facility);
      else if (isPikeFacility(facility)) openPikeRoomPreview(facility);
      else if (isFactoryFacility(facility) && !run.factoryTeam) {
        // No rentals yet for this round — open selection modal.
        openFactoryRentalSelection(facility);
      }
      else if (isPyramidFacility(facility)) openPyramidFloorMap(facility);
      else openSimulatedFight(facility);
      return;
    }
    if (action === "pike-next") {
      // PIKE-ONLY. Pyramid has its own dedicated modal flow (item-
      // found, bag view, equip picker, use picker) with their own
      // action keys (pyr-*), and never dispatches pike-next. The
      // legacy Pyramid branch here became unreachable after the
      // Pyramid rework removed heal/cure tiles.
      pikeAdvanceAfterEvent(facility);
      return;
    }
    // Pyramid — item-tile "Prendre" button: push into Combat Bag, apply
    // effect if consumable, return to the floor map. Button data-attr
    // carries the rolled item id (see showPyramidItemFoundModal).
    if (action === "pyr-take-item") {
      if (!isPyramidFacility(facility)) return;
      const btn = document.querySelector("[data-action='pyr-take-item']");
      const itemId = btn && btn.dataset.itemId;
      if (itemId) takePyramidItem(facility, itemId);
      else pyramidAfterEvent(facility);
      return;
    }
    if (action === "pyr-bag-open") {
      if (isPyramidFacility(facility)) showPyramidBagDialog(facility);
      return;
    }
    if (action === "pyr-bag-close") {
      if (isPyramidFacility(facility)) openPyramidFloorMap(facility);
      return;
    }
    // Round-cleared modal: "Continue" validates the team size (the player
    // may have edited it while paused), re-snapshots Pike team so HP+status
    // start clean from the current preview team, then opens the next-round
    // preview appropriate to the facility.
    if (action === "round-continue") {
      // Factory skips the size check — rentals are assigned by us, not
      // the player's preview team.
      if (!isFactoryFacility(facility) && currentPreviewTeamSize() !== 3) {
        showTeamSizeError(facility);
        return;
      }
      // Re-tie the run to the current preview slot — see the identical
      // block in the "continue" action for the rationale (silent-abandon
      // fix when the player swaps teams between rounds).
      if (run && !isFactoryFacility(facility)) {
        run.tiedPreviewSlot = saved.currentPreviewTeam;
      }
      // Consume the between-rounds unlock flag — from this point the
      // team is committed to the upcoming round and locked again.
      if (run) run.roundJustCleared = false;
      if (isPikeFacility(facility) || isPyramidFacility(facility)) {
        // Both Pike and Pyramid share the runTeam structure for HP/status
        // persist — re-snapshot in case the player edited between rounds.
        initPikePyramidTeamFromPreview();
      }
      if (isFactoryFacility(facility)) {
        restoreFactoryMoves(run);
        run.factoryPool = null;
        run.factorySelection = [];
        run.factoryTeam = null;
      }
      if (isPyramidFacility(facility)) {
        // New round → regenerate floor 1 from scratch.
        run.pyramid = null;
      }
      if (isDomeFacility(facility)) openDomeBracketPreview(facility);
      else if (isPikeFacility(facility)) openPikeRoomPreview(facility);
      else if (isFactoryFacility(facility)) openFactoryRentalSelection(facility);
      else if (isPyramidFacility(facility)) openPyramidFloorMap(facility);
      else openSimulatedFight(facility);
      return;
    }
    // Factory-specific: player confirms the 3 rentals out of 6.
    if (action === "factory-confirm") {
      confirmFactorySelection(facility);
      return;
    }
    // Factory-specific: post-battle swap modal actions.
    if (action === "factory-swap-confirm") {
      confirmFactorySwap(facility);
      return;
    }
    if (action === "factory-swap-skip") {
      if (run) {
        run.pendingFactorySwap = null;
        run.factorySwapSelection = [null, null];
      }
      openSimulatedFight(facility);
      return;
    }
    if (action === "abandon") {
      // Abandon fires from two places: active-run in-progress tooltip
      // (run stored on activeRun), and paused-run tooltip (run stored
      // on pausedRuns[facility.id]). Cover both: pick whichever is
      // bound to this facility.
      const activeHere = run && run.facilityId === facility.id ? run : null;
      const pausedHere = saved.frontierExt.pausedRuns && saved.frontierExt.pausedRuns[facility.id];
      const doomedRun = activeHere || pausedHere;
      if (doomedRun) {
        const finalRound = doomedRun.round;
        if (finalRound > (saved.frontierExt.maxStreaks[facility.id] || 0)) {
          saved.frontierExt.maxStreaks[facility.id] = finalRound;
        }
        if (isFactoryFacility(facility)) {
          try { cleanupFactoryRun(doomedRun); } catch (e) { /* ignore */ }
        }
        try { restoreEnemyRuntimeStats(doomedRun); } catch (e) { /* ignore */ }
        if (isPyramidFacility(facility)) {
          try { setPyramidModalSizing(false); } catch (e) { /* ignore */ }
          // Strip any Pyramid-mirrored held items from the preview team
          // before activeRun is nulled below, so the player's preview
          // slot returns to its pre-run itemless state.
          try { cleanupPyramidPreviewItems(doomedRun); } catch (e) { /* ignore */ }
          doomedRun.pyramid = null;
        }
      }
      // Clear from whichever slot held it + zero the streak counter.
      if (activeHere) saved.frontierExt.activeRun = null;
      if (pausedHere && saved.frontierExt.pausedRuns) {
        delete saved.frontierExt.pausedRuns[facility.id];
      }
      saved.frontierExt.streaks[facility.id] = 0;
      // Team stays unlocked now that the challenge is over. removeLock
      // is a no-op if the lock wasn't applied (paused-run abandon).
      try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
      // Force-flush to localStorage so F5 / tab-close immediately after
      // abandoning can't revert the decision via the 60s auto-save
      // window — mirrors the Rest action's eager save.
      try { if (typeof saveGame === "function") saveGame(); } catch (e) { /* ignore */ }
      refreshActiveFrontierView();
      if (typeof closeTooltip === "function") closeTooltip();
      return;
    }
    if (action === "back") {
      openFacilityPreview(facility);
      return;
    }
    // "Rest" — pause the current run FULLY. Moves activeRun into
    // pausedRuns[facilityId], removes every lock (team, other-facility
    // blocking, Factory preview slot, enemy stat overrides), and closes
    // the tooltip. The in-progress sticker still shows on the tile
    // because getRunForFacility returns the paused record; clicking
    // the tile later offers Resume / Abandon. While paused the player
    // can freely use their team elsewhere, start a run in a different
    // facility, etc. Multiple paused runs can coexist — one per
    // facility — since they carry zero locks.
    if (action === "rest") {
      const run = saved.frontierExt.activeRun;
      if (run && run.facilityId === facility.id) {
        // Belt & braces: restore all the runtime overrides before we
        // let the team out of the lock (Factory preview slot, enemy
        // pkmn[id] IV/ability stashes, etc.).
        if (isFactoryFacility(facility)) {
          try { cleanupFactoryRun(run); } catch (e) { /* ignore */ }
        }
        try { restoreEnemyRuntimeStats(run); } catch (e) { /* ignore */ }
        // Keep the run object so Resume can pick up exactly where it
        // left off. Drop transient UI-only fields that should reroll
        // on resume: upcomingTrainer (would reuse a stale preview),
        // factory pool/selection/team (re-picked at resume), pike
        // doors (re-rolled each room anyway), pyramid floor (re-
        // generates on next entry).
        run.upcomingTrainer = null;
        run.factoryPool = null;
        run.factorySelection = [];
        run.factoryTeam = null;
        run.pikeDoors = null;
        run.pikeDoorPicked = null;
        run.pyramid = null;
        saved.frontierExt.pausedRuns[run.facilityId] = run;
        saved.frontierExt.activeRun = null;
        try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
        // Force-flush to localStorage NOW so an F5 / tab-close before
        // the next periodic save interval (60s) can't revert the pause.
        // Calls the vanilla saveGame directly — doesn't add anything to
        // the save payload shape, just triggers the existing serialiser
        // earlier than its timer would.
        try { if (typeof saveGame === "function") saveGame(); } catch (e) { /* ignore */ }
      }
      if (typeof closeTooltip === "function") closeTooltip();
      refreshActiveFrontierView();
      return;
    }
    // "Resume" — pull a paused run back into activeRun and re-apply
    // the team lock. Only fires when openFacilityPreview surfaced the
    // Resume button (i.e. pausedRuns[facilityId] exists AND no other
    // active run is in progress).
    if (action === "resume") {
      const paused = saved.frontierExt.pausedRuns && saved.frontierExt.pausedRuns[facility.id];
      if (!paused) return;
      // Guard against race: only resume if no other facility is
      // currently active. openFacilityPreview already blocks the
      // entry UI in that case, but belt & braces here in case of
      // programmatic resume.
      if (saved.frontierExt.activeRun && saved.frontierExt.activeRun.facilityId !== facility.id) {
        showRunInProgressElsewhere(facility);
        return;
      }
      // Re-tie to whichever preview slot the player currently has
      // selected (they may have edited/swapped teams while paused).
      // Factory is exempt — it owns FACTORY_PREVIEW_SLOT and will
      // regenerate rentals on next round preview.
      if (!isFactoryFacility(facility)) {
        paused.tiedPreviewSlot = saved.currentPreviewTeam;
      }
      // Flag set when resuming — the facility preview's "Continue"
      // button will route to the next-step screen. We keep
      // roundJustCleared truthy so the tooltip shows the between-
      // rounds Continue button shape rather than mid-round.
      paused.roundJustCleared = true;
      saved.frontierExt.activeRun = paused;
      delete saved.frontierExt.pausedRuns[facility.id];
      try { applyFrontierTeamLock(); } catch (e) { /* ignore */ }
      openFacilityPreview(facility);
      return;
    }
    if (action === "launch") {
      // Team-size check happens HERE for both Dôme and non-Dôme so the
      // error path never leaves the team in a mutated state. Dôme needs
      // 3 Pokémon to START — the pick-2 modal comes next.
      if (currentPreviewTeamSize() !== 3) {
        showTeamSizeError(facility);
        return;
      }
      if (isDomeFacility(facility)) {
        openDomePokemonSelection(facility);
        return;
      }
      launchCombat(facility);
      return;
    }
    if (action === "confirm-dome") {
      // Team already validated at "launch" — apply the 2-of-3 mutation
      // and fire combat. launchCombat skips its own size check when a
      // dome selection is already applied.
      const r = saved.frontierExt.activeRun;
      if (!r || !Array.isArray(r.domeSelection) || r.domeSelection.length !== DOME_ACTIVE_SIZE) return;
      applyDomeSelection();
      launchCombat(facility);
      return;
    }
  }

  // ─── 6b. HELP TOOLTIP (right-click / long-press) ──────────────────────────
  // Each tile sets dataset.help = "FrontierExt:<id>". When the game's
  // right-click handler calls tooltipData("help", that string), we intercept
  // and fill the tooltip with a rules breakdown specific to the facility.
  function installHelpTooltip() {
    if (typeof window.tooltipData !== "function") {
      setTimeout(installHelpTooltip, 100);
      return;
    }
    const origTooltipData = window.tooltipData;
    window.tooltipData = function (category, data) {
      if (category === "help" && typeof data === "string" && data.indexOf("FrontierExt:") === 0) {
        const facId = data.slice("FrontierExt:".length);
        // Section-level help (the "?" icon on the Hoenn tab header).
        if (facId === "__section__") {
          fillHoennSectionHelp();
          if (typeof openTooltip === "function") openTooltip();
          return;
        }
        const facility = FACILITIES.find((f) => f.id === facId);
        if (facility) {
          fillHelpTooltip(facility);
          if (typeof openTooltip === "function") openTooltip();
          return;
        }
      }
      return origTooltipData.apply(this, arguments);
    };
  }

  // Fills the help tooltip with section-wide Hoenn ZdC rules — shown
  // when the player clicks the "?" next to the Hoenn tab header. Covers
  // what's different from the vanilla Battle Frontier: Gen 3 rules,
  // teams of 3, level 100, no division restriction, Rest/Resume flow,
  // mini-boss and rematch mechanics.
  function fillHoennSectionHelp() {
    const lang = "en";
    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    if (top) top.style.display = "none";
    if (mid) { mid.style.display = "none"; mid.innerHTML = ""; }
    if (title) {
      title.style.display = "block";
      // Plain text centred title matching the vanilla "VS Zone de Combat"
      // help tooltip — "VS" prefix instead of an emoji/icon.
      title.innerHTML = "VS Battle Frontier — Hoenn";
    }
    if (bottom) {
      bottom.style.display = "block";
      // Body goes in `tooltipBottom` (beige/tan panel) — same slot vanilla
      // uses for the "Battle Frontier houses different types of challenges"
      // intro. One condensed paragraph covering the full ruleset.
      bottom.innerHTML = "Gen 3 Emerald rules: teams of 3 level-100 Pokémon, no division restrictions. Seven facilities each with their own rules and Zone Leader (Silver &amp; Gold symbols, then escalating post-Gold rematches). Rest pauses a run without losing the streak; closing the game mid-active-run counts as defeat.";
    }
  }

  function fillHelpTooltip(facility) {
    const lang = "en";
    const name = facility.name;
    const desc = facility.desc;
    const brainName = facility.brain.name;

    // Localised labels
    const t = {
          rules: "Rules",
          brain: "Zone Leader",
          silverAt: "Silver Symbol",
          goldAt: "Gold Symbol",
          teamSilver: "Silver Team",
          teamGold: "Gold Team",
          round: "Battle",
          repeatable: "Fully repeatable — runs reset each attempt but streaks are kept for posterity." };

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      // Strip the frontier-flair class (which forces 7rem absolute-positioned
      // sizing meant for the tile) so the tooltip header shows a compact 3rem
      // icon instead.
      const compactIcon = facility.iconSvg.replace(/\bclass="frontier-flair"\s*/, "");
      top.innerHTML = `<span class="frontier-ext-tooltip-icon">${compactIcon}</span>`;
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = name;
    }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `<div style="padding: 0.4rem 0.8rem; font-style: italic; opacity: 0.9;">${desc}</div>`;
    }
    if (bottom) {
      bottom.style.display = "block";
      const teamSilverStr = facility.brain.teamSilver
        ? facility.brain.teamSilver.map((id) => format(id)).join(" · ")
        : ("Random rentals");
      const teamGoldStr = facility.brain.teamGold
        ? facility.brain.teamGold.map((id) => format(id)).join(" · ")
        : ("Random rentals");

      bottom.innerHTML = `
        <div class="frontier-ext-help-brain-wrap">
          <img class="frontier-ext-help-brain" src="img/trainers/${facility.brain.sprite}.png" alt="${brainName}">
        </div>
        <div class="frontier-ext-help-rules">
          <span class="label">${t.brain}:</span>
          <span class="value">${brainName}</span>
          <span class="label">${t.silverAt} (${t.round} ${silverRoundFor(facility)}):</span>
          <span class="value">${teamSilverStr}</span>
          <span class="label">${t.goldAt} (${t.round} ${goldRoundFor(facility)}):</span>
          <span class="value">${teamGoldStr}</span>
        </div>
        <div class="frontier-ext-help-footer">${t.repeatable}</div>
      `;
    }
  }

  // ─── 6b1. PALACE RULE — auto-move by nature ──────────────────────────────
  // Pokechill is an auto-battler: each Pokémon cycles slot1→2→3→4→1 via
  // `team[active].turn++` (explore.js:2412). The Palace overrides that
  // sequential cycle with a weighted random pick based on the Pokémon's
  // nature, matching the Gen 3 Battle Palace rule where moves are auto-
  // selected from 3 "style" buckets (ATK / DEF / SUP) per nature.
  //
  // The 7 Pokechill natures (from i18n engine.js:420+):
  //   adamant, modest, jolly, relaxed, quiet, bold, (empty/neutral)
  //
  // Style weights sum to 100 per nature:
  const NATURE_STYLE_WEIGHTS = {
    adamant: [70, 10, 20], // raw offense, Atk ▲ S.Atk ▼
    modest:  [70, 10, 20], // raw offense, S.Atk ▲ Atk ▼
    jolly:   [40, 30, 30], // speedster, erratic
    relaxed: [30, 50, 20], // tanky, HP ▲ Spe ▼ — patient, defensive
    quiet:   [20, 40, 40], // HP ▲ Atk ▼ S.Atk ▼ — support-leaning
    bold:    [15, 60, 25], // Def ▲ S.Def ▲ HP ▼ — defensive specialist
    "":      [40, 30, 30], // neutral / no nature
    none:    [40, 30, 30] };

  // Heuristic classifier: move with power > 0 is ATK; otherwise name-match
  // against known SUP / DEF patterns. Good enough for the Palace rule
  // without introspecting move.hitEffect function bodies.
  const SUP_PATTERNS = /bulk|amnesia|calm|swords|nasty|rest|recover|substitute|protect|detect|aquaRing|ironDefense|cosmic|growth|curse|barrier|harden|sharpen|reflect|lightScreen|safeguard|wish|synthesis|morning|moonlight|roost|agility|tailwind|helpingHand|coil|dragonDance|quiverDance|shellSmash|shiftGear|workUp|rockPolish|defog|hazeClear|doubleTeam|minimize|withdraw|stockpile|ingrain|leechSeed|gigaDrain/i;
  const DEF_PATTERNS = /leer|growl|willO|thunder.*[Ww]ave|sleep|toxic|poisonPowder|stunSpore|spore|confuse|hypno|charm|screech|metalSound|sweetKiss|babyDoll|glare|attract|disable|taunt|torment|encore|yawn|embargo|worryS|knockOff|trick|switcheroo|memento/i;

  function classifyMoveId(moveId) {
    if (!moveId) return null;
    const m = typeof move !== "undefined" ? move[moveId] : null;
    if (!m) return "SUP"; // unknown → treat as SUP
    if (m.power && m.power > 0) return "ATK";
    if (SUP_PATTERNS.test(moveId)) return "SUP";
    if (DEF_PATTERNS.test(moveId)) return "DEF";
    return "DEF"; // default for status moves we can't classify
  }

  // Generic slot-picker by nature. Works for both player (reads nature from
  // pkmn[id].nature, moves from pkmn[id].moves.slot1..4) and enemy (nature
  // + moves passed explicitly because NPCs don't have persistent pkmn state).
  function pickSlotByNatureGeneric(moves1to4, nature) {
    const weights = NATURE_STYLE_WEIGHTS[(nature || "").toLowerCase()] || NATURE_STYLE_WEIGHTS.none;

    const slots = [];
    for (let i = 1; i <= 4; i++) {
      const mv = moves1to4[i - 1] || moves1to4["slot" + i];
      if (!mv) continue;
      slots.push({ slot: i, style: classifyMoveId(mv) });
    }
    if (slots.length === 0) return null;

    const byStyle = { ATK: [], DEF: [], SUP: [] };
    slots.forEach((s) => byStyle[s.style].push(s.slot));

    const roll = Math.random() * (weights[0] + weights[1] + weights[2]);
    let targetStyle = "ATK";
    if (roll >= weights[0]) targetStyle = "DEF";
    if (roll >= weights[0] + weights[1]) targetStyle = "SUP";

    const candidates = byStyle[targetStyle].length ? byStyle[targetStyle] : slots.map((s) => s.slot);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function pickSlotByNature(member) {
    if (!member || !member.pkmn || typeof pkmn === "undefined") return null;
    const pk = pkmn[member.pkmn.id];
    if (!pk || !pk.moves) return null;
    return pickSlotByNatureGeneric(pk.moves, pk.nature || "");
  }

  function isInPalaceRun() {
    if (typeof saved !== "object" || !saved) return false;
    if (!saved.frontierExt || !saved.frontierExt.activeRun) return false;
    if (saved.currentArea !== RUN_AREA_ID) return false;
    const facility = FACILITIES.find((f) => f.id === saved.frontierExt.activeRun.facilityId);
    return !!(facility && facility.rules && facility.rules.autoMoveByNature);
  }

  // Wrap exploreCombatPlayer to re-pick the next move slot (by nature)
  // every time the game naturally advances `team[active].turn`. This keeps
  // the bar/timer logic of the original intact — we only overwrite the
  // *target slot* for the next move charge.
  function installPalaceMoveHook() {
    if (typeof window.exploreCombatPlayer !== "function") {
      setTimeout(installPalaceMoveHook, 200);
      return;
    }
    if (window.__palaceHookInstalled) return;
    window.__palaceHookInstalled = true;
    const orig = window.exploreCombatPlayer;
    window.exploreCombatPlayer = function () {
      let prevTurn = null;
      let active = null;
      if (isInPalaceRun() && typeof exploreActiveMember !== "undefined") {
        active = team[exploreActiveMember];
        if (active) prevTurn = active.turn;
      }
      const res = orig.apply(this, arguments);
      if (active) {
        const newTurn = active.turn;
        if (newTurn !== prevTurn && newTurn !== null && newTurn !== undefined) {
          const picked = pickSlotByNature(active);
          if (picked !== null && picked >= 1 && picked <= 4) {
            active.turn = picked;
          }
        }
      }
      return res;
    };
  }

  // Mirror hook for the enemy side (exploreCombatWild). NPC trainers don't
  // have a real nature — we simulate one per slot at trainer-generation time
  // and read it back from areas[RUN_AREA_ID].frontierExtNatures[currentTrainerSlot].
  //
  // IMPORTANT: `exploreCombatWildTurn` is declared `let` at top of explore.js
  // (line 3525), same for `currentTrainerSlot` (line 182). These are in the
  // script scope, not on `window` — we MUST use bare-identifier access
  // (via eval) to read AND write them, otherwise `window.X` gives undefined
  // and a bare assignment in strict-mode throws. Same pattern as the
  // fusePkmn fix in i18n/engine.js.
  function installPalaceEnemyHook() {
    if (typeof window.exploreCombatWild !== "function") {
      setTimeout(installPalaceEnemyHook, 200);
      return;
    }
    if (window.__palaceEnemyHookInstalled) return;
    window.__palaceEnemyHookInstalled = true;
    const orig = window.exploreCombatWild;

    // Indirect eval — runs in global scope so it can read/write script-
    // scope `let` bindings from any classic <script>.
    const globalEval = eval;
    const readWildTurn = () => {
      try { return globalEval("typeof exploreCombatWildTurn === 'undefined' ? null : exploreCombatWildTurn"); }
      catch (e) { return null; }
    };
    const writeWildTurn = (n) => {
      try { globalEval("exploreCombatWildTurn = " + JSON.stringify(n)); }
      catch (e) { /* ignore */ }
    };
    const readTrainerSlot = () => {
      try { return globalEval("typeof currentTrainerSlot === 'undefined' ? 1 : currentTrainerSlot"); }
      catch (e) { return 1; }
    };

    window.exploreCombatWild = function () {
      const palaceActive = isInPalaceRun();
      const prevTurn = palaceActive ? readWildTurn() : null;
      const res = orig.apply(this, arguments);
      if (palaceActive) {
        const newTurn = readWildTurn();
        if (newTurn !== prevTurn && newTurn !== null && newTurn !== undefined) {
          const slotIdx = readTrainerSlot();
          const area = areas[RUN_AREA_ID];
          if (!area) return res;
          const nature = (area.frontierExtNatures && area.frontierExtNatures[slotIdx]) || "";
          const moves = area.team["slot" + slotIdx + "Moves"] || [];
          const picked = pickSlotByNatureGeneric(moves, nature);
          if (picked !== null && picked >= 1 && picked <= 4) {
            writeWildTurn(picked);
          }
        }
      }
      return res;
    };
  }

  // ─── 6b2a. ARENA RULE — 3 turns max, judges pick the winner ─────────────
  // Canonical Gen 3 Emerald Battle Arena:
  //   • Each battle lasts at most 3 turns per side. If neither side is KO'd
  //     by then, a panel of judges decides the winner based on 3 criteria:
  //       - Mind  (Esprit)    : aggression — how many offensive moves used
  //       - Skill (Technique) : efficiency — damage dealt ratio
  //       - Body  (Corps)     : durability — remaining HP %
  //   • Winner of 2/3 criteria wins. 3-way tie → HP is the tiebreaker.
  //   • 7 battles per round like Tower/Palace/Factory (declared in the
  //     facility def). The judge verdict forces a KO so the game's own
  //     victory/defeat plumbing fires — no custom combat-end code needed.
  const ARENA_TURNS_PER_SIDE = 3;

  function isArenaFacility(facility) {
    return !!(facility && facility.rules && facility.rules.threeTurnJudge);
  }
  function isInArenaRun() {
    if (typeof saved !== "object" || !saved) return false;
    if (!saved.frontierExt || !saved.frontierExt.activeRun) return false;
    if (saved.currentArea !== RUN_AREA_ID) return false;
    const facility = FACILITIES.find((f) => f.id === saved.frontierExt.activeRun.facilityId);
    return isArenaFacility(facility);
  }

  // Per-matchup metrics stored on the active run. Each "matchup" is one
  // player-active vs one enemy-active encounter. Counters reset every
  // time either side's active Pokémon changes (KO-switch, judge-forced
  // KO, etc.), so a 3-Pokémon-vs-3 combat produces up to 3 judge events.
  function arenaFreshMatchupCounters() {
    return {
      playerMoves: 0,
      enemyMoves: 0,
      playerDamage: 0,
      enemyDamage: 0,
      playerAttacks: 0,
      enemyAttacks: 0,
      judgeFired: false };
  }
  function arenaResetState() {
    if (!saved || !saved.frontierExt || !saved.frontierExt.activeRun) return;
    saved.frontierExt.activeRun.arenaState = {
      ...arenaFreshMatchupCounters(),
      lastPlayerSlot: null,
      lastEnemySlot: null,
      matchupCount: 0,      // how many matchups opened in this combat
      judgesFired: 0,       // how many judge verdicts fired
      judgeFiring: false,   // true during the 3s verdict pause (freezes combat)
    };
  }
  function arenaGetState() {
    return saved && saved.frontierExt && saved.frontierExt.activeRun
      ? saved.frontierExt.activeRun.arenaState
      : null;
  }

  // Reset only the per-matchup counters without touching the higher-level
  // matchup/judge tallies. Used when a new matchup starts.
  function arenaResetMatchup(state) {
    state.playerMoves = 0;
    state.enemyMoves = 0;
    state.playerDamage = 0;
    state.enemyDamage = 0;
    state.playerAttacks = 0;
    state.enemyAttacks = 0;
    state.judgeFired = false;
  }

  // Read the currently-active member ids on both sides. Script-scope
  // `let` bindings so we need indirect eval.
  function arenaReadActiveSlots() {
    const globalEval = eval;
    let playerSlot = null, enemySlot = null;
    try { playerSlot = globalEval("typeof exploreActiveMember === 'undefined' ? null : exploreActiveMember"); } catch (e) {}
    try { enemySlot = globalEval("typeof currentTrainerSlot === 'undefined' ? 1 : currentTrainerSlot"); } catch (e) {}
    return { playerSlot, enemySlot };
  }

  // Per-matchup HP ratios: the player's CURRENT ACTIVE vs the enemy's
  // CURRENT ACTIVE. Body criterion compares just these two, not totals
  // across the whole team — the judge fires per-matchup so "50% HP left
  // on my active" is what matters, not my bench.
  function arenaReadHpRatios() {
    const globalEval = eval;
    let wildHp = 0, wildMax = 0;
    try {
      wildHp = Number(globalEval("typeof wildPkmnHp === 'undefined' ? 0 : wildPkmnHp")) || 0;
      wildMax = Number(globalEval("typeof wildPkmnHpMax === 'undefined' ? 0 : wildPkmnHpMax")) || 0;
    } catch (e) { /* ignore */ }

    let playerHp = 0, playerMax = 0;
    try {
      const { playerSlot } = arenaReadActiveSlots();
      if (playerSlot && typeof team !== "undefined" && team[playerSlot] && team[playerSlot].pkmn
          && typeof pkmn !== "undefined") {
        const p = pkmn[team[playerSlot].pkmn.id];
        if (p && p.playerHpMax) {
          playerHp = Math.max(0, p.playerHp || 0);
          playerMax = p.playerHpMax;
        }
      }
    } catch (e) { /* ignore */ }

    return {
      playerRatio: playerMax > 0 ? playerHp / playerMax : 0,
      enemyRatio:  wildMax > 0  ? Math.max(0, wildHp) / wildMax  : 0,
      wildHp, wildMax, playerHp, playerMax };
  }

  // Per-criterion scoring — canonical Emerald rules:
  //   • Win     → 2pt (cercle rouge ●)
  //   • Égalité → 1pt (triangle bleu △)
  //   • Défaite → 0pt (croix noire ✕)
  // Total across Mental + Technique + Physique → whoever has fewer
  // points is KO'd. Equal totals → BOTH active Pokémon are KO'd.
  // `eps` is the "close enough to call it a tie" threshold — continuous
  // criteria (damage, HP%) need a tolerance so residual float drift
  // doesn't crown an arbitrary winner.
  function arenaScoreCriterion(playerVal, enemyVal, eps) {
    if (Math.abs(playerVal - enemyVal) <= eps) return { p: 1, e: 1, tie: true };
    if (playerVal > enemyVal)                  return { p: 2, e: 0, tie: false, playerWins: true };
    return { p: 0, e: 2, tie: false, playerWins: false };
  }
  function arenaMarkChar(score) {
    return score === 2 ? "●" : score === 1 ? "△" : "✕";
  }
  function arenaMarkClass(score) {
    return score === 2 ? "mark-win" : score === 1 ? "mark-tie" : "mark-lose";
  }

  // Verdict UI — Emerald-styled scoresheet that reveals each criterion
  // in sequence (1.2s per stage), then the totals, then an arbiter
  // dialog announcing the outcome. The return value is the total time
  // the overlay will stay on screen — arenaRenderJudge uses it to time
  // the actual KO so the ruling and the faint animation stay in sync.
  function showArenaVerdict(outcome) {
    const lang = "en";
    const l = {
          title: "Judge's Decision",
          cat: ["Category 1, Mind!", "Category 2, Skill!", "Category 3, Body!"],
          labelMental: "MIND",
          labelTechnique: "SKILL",
          labelPhysique: "BODY",
          arbiter: "JUDGE:",
          winVerbs: [
            { p: "Player's POKéMON attacked the most!", e: "Opponent's POKéMON attacked the most!", tie: "Both POKéMON attacked equally often!" },
            { p: "Player's POKéMON landed its hits best!", e: "Opponent's POKéMON landed its hits best!", tie: "Both POKéMON were equally effective!" },
            { p: "Player's POKéMON has the most energy left!", e: "Opponent's POKéMON has the most energy left!", tie: "Both POKéMON have equal energy!" },
          ],
          winnerLine: (kind) => kind === "player"
            ? "Opponent's POKéMON is knocked out!"
            : kind === "enemy"
              ? "Your POKéMON is knocked out!"
              : "Both POKéMON are knocked out!" };

    const host = document.createElement("div");
    host.className = "frontier-ext-arena-verdict";
    const row = (idx, label, sP, sE) => `
      <div class="verdict-row" data-idx="${idx}">
        <span class="mark left ${arenaMarkClass(sP)}">${arenaMarkChar(sP)}</span>
        <span class="label">${label}</span>
        <span class="mark right ${arenaMarkClass(sE)}">${arenaMarkChar(sE)}</span>
      </div>`;
    host.innerHTML = `
      <div class="verdict-title">${l.title}</div>
      <div class="verdict-head">
        <span class="you">${"Player"}</span>
        <span class="criterion">—</span>
        <span class="them">${"Opponent"}</span>
      </div>
      <div class="verdict-rows">
        ${row(0, l.labelMental,    outcome.mental.p,    outcome.mental.e)}
        ${row(1, l.labelTechnique, outcome.technique.p, outcome.technique.e)}
        ${row(2, l.labelPhysique,  outcome.physique.p,  outcome.physique.e)}
      </div>
      <div class="verdict-total">
        <span class="you">${outcome.totalP}</span>
        <span class="sep">${"Judgment"}</span>
        <span class="them">${outcome.totalE}</span>
      </div>
      <div class="verdict-arbiter"><span class="speaker">${l.arbiter}</span><span class="text"></span></div>
    `;
    document.body.appendChild(host);
    requestAnimationFrame(() => host.classList.add("show"));

    const rows = host.querySelectorAll(".verdict-row");
    const totalEl = host.querySelector(".verdict-total");
    const arbText = host.querySelector(".verdict-arbiter .text");
    const arbBox  = host.querySelector(".verdict-arbiter");

    const criteria = ["mental", "technique", "physique"];
    const announce = (text) => {
      arbText.textContent = " " + text;
      arbBox.classList.add("shown");
    };

    // Stage timings: each criterion row reveals + arbiter line, 1.2s apart.
    // Then totals appear at T=3600, final verdict line at T=4200.
    const STAGE_MS = 1200;
    criteria.forEach((key, i) => {
      setTimeout(() => {
        rows[i].classList.add("shown");
        const s = outcome[key];
        const verb = s.tie ? l.winVerbs[i].tie
                   : s.playerWins ? l.winVerbs[i].p
                                  : l.winVerbs[i].e;
        announce(`${l.cat[i]} ${verb}`);
      }, i * STAGE_MS);
    });

    setTimeout(() => { totalEl.classList.add("shown"); }, 3 * STAGE_MS);
    setTimeout(() => {
      const kind = outcome.totalP > outcome.totalE ? "player"
                 : outcome.totalE > outcome.totalP ? "enemy" : "tie";
      announce(l.winnerLine(kind));
    }, 3 * STAGE_MS + 600);

    const dismissAt = 3 * STAGE_MS + 2200;
    setTimeout(() => {
      try {
        host.classList.remove("show");
        setTimeout(() => { try { host.remove(); } catch (e) {} }, 400);
      } catch (e) {}
    }, dismissAt);

    return dismissAt;
  }

  // Combat pause window — matches the longest verdict animation so the
  // rAF loop stays frozen until the arbiter has finished speaking AND
  // the final KO message has been visible for ~1s.
  const ARENA_PAUSE_MS = 4800;

  // Compute per-matchup scores, show verdict overlay, freeze the combat
  // for ARENA_PAUSE_MS, then apply the KO(s). One of three branches:
  //   • totalP > totalE → enemy active KO'd, engine pulls next enemy mon
  //   • totalE > totalP → player active KO'd, engine switches to next mon
  //   • totalP = totalE → BOTH active mons KO'd (double knockout)
  function arenaRenderJudge() {
    const state = arenaGetState();
    if (!state || state.judgeFired || state.judgeFiring) return;
    state.judgeFired = true;
    state.judgeFiring = true;
    state.judgesFired = (state.judgesFired || 0) + 1;

    const hp = arenaReadHpRatios();

    // Mental (canonical "eagerness to attack") — ratio of offensive
    // moves to total actions. Tie tolerance ≈ one-hundredth of a point
    // so ratios like 2/3 vs 2/3 tie exactly; ≥ epsilon apart → strict
    // ordering. Raw counts were exploitable by speed stackers (see the
    // old Pachirisu + Costar + No Retreat write-up); ratios aren't.
    const playerMindRatio = state.playerMoves > 0 ? state.playerAttacks / state.playerMoves : 0;
    const enemyMindRatio  = state.enemyMoves  > 0 ? state.enemyAttacks  / state.enemyMoves  : 0;
    const mental    = arenaScoreCriterion(playerMindRatio, enemyMindRatio, 0.01);

    // Technique — total damage dealt across the matchup. Floats accumulate
    // to hundredths from residual ticks, so we use a 1 HP tolerance.
    const technique = arenaScoreCriterion(state.playerDamage, state.enemyDamage, 1);

    // Physique — current HP fraction of the active mon. 1%-point tolerance.
    const physique  = arenaScoreCriterion(hp.playerRatio, hp.enemyRatio, 0.01);

    const totalP = mental.p + technique.p + physique.p;
    const totalE = mental.e + technique.e + physique.e;
    const playerWins = totalP > totalE;
    const enemyWins  = totalE > totalP;
    const doubleKo   = totalP === totalE;

    showArenaVerdict({ mental, technique, physique, totalP, totalE });

    // Snapshot BEFORE the 3s pause:
    //   • active slot + species (for the targeted KO)
    //   • every team member's HP (used to restore the bench after the
    //     KO, in case anything leaked damage to them during the
    //     verdict window)
    // Previous versions only snapshotted the active slot and trusted
    // the engine to leave the bench alone — player reports kept
    // surfacing "triple KO" after one verdict, so now we actively
    // re-pin every non-losing slot's HP after we write the targeted 0.
    const snapshotActive = arenaReadActiveSlots();
    const snapshotPlayerPkmnId =
      snapshotActive.playerSlot
        && typeof team !== "undefined"
        && team[snapshotActive.playerSlot]
        && team[snapshotActive.playerSlot].pkmn
        ? team[snapshotActive.playerSlot].pkmn.id
        : null;

    const hpSnapshot = {};
    try {
      if (typeof team !== "undefined" && typeof pkmn !== "undefined") {
        // Frontier teams only ever use slot1-3 (Gen 3 Emerald rule,
        // enforced via expectedTeamSize). Iterating slot4-6 would pull
        // leftover data from the player's non-Frontier team state —
        // harmless for the snapshot itself but incorrect semantically
        // and would leak restores onto mons that aren't even playing.
        for (const sl of ["slot1", "slot2", "slot3"]) {
          if (!team[sl] || !team[sl].pkmn || !team[sl].pkmn.id) continue;
          const p = pkmn[team[sl].pkmn.id];
          if (p && typeof p.playerHp === "number") hpSnapshot[sl] = p.playerHp;
        }
      }
    } catch (e) { /* ignore */ }

    // Freeze combat ticks during the pause, then deliver the KO + reset.
    // Note: judgeFiring stays TRUE past the KO on a player-wins verdict.
    // The installArenaSwapFreeze wrap on setWildPkmn detects that the
    // post-verdict spawn is the "bridge" case (judgeFiring true when
    // setWildPkmn fires), extends the freeze for ARENA_SWAP_FREEZE_MS,
    // then clears everything. This closes the ~1s gap between the
    // vanilla respawnTimer (1000ms default) and our post-spawn
    // invincibility window — during which the rAF loop would unfreeze
    // and pachirisu could squeeze an attack in.
    const globalEval = eval;
    // Helper: KO the player's active mon snapshot-pinned at verdict
    // time. Skips if already switched or if HP already 0. Returns the
    // species id that was KO'd (or null), so the bench-restore loop
    // knows which slot to leave at 0.
    const koPlayerSnapshot = () => {
      if (!snapshotPlayerPkmnId || typeof pkmn === "undefined") return null;
      const snapSpec = pkmn[snapshotPlayerPkmnId];
      const { playerSlot: nowSlot } = arenaReadActiveSlots();
      const stillOnField = nowSlot === snapshotActive.playerSlot
        && team[nowSlot]
        && team[nowSlot].pkmn
        && team[nowSlot].pkmn.id === snapshotPlayerPkmnId;
      const stillAlive = snapSpec && (snapSpec.playerHp || 0) > 0;
      if (stillOnField && stillAlive) {
        snapSpec.playerHp = 0;
        return snapshotPlayerPkmnId;
      }
      return null;
    };
    // Restore every OTHER bench slot's HP from snapshot — guard against
    // residual ticks / weather / ghost hooks leaking damage during the
    // verdict pause to mons who weren't on the field.
    const restoreBench = (killedSpeciesId) => {
      if (typeof team === "undefined" || typeof pkmn === "undefined") return;
      for (const sl of ["slot1", "slot2", "slot3"]) {
        if (!team[sl] || !team[sl].pkmn || !team[sl].pkmn.id) continue;
        const speciesId = team[sl].pkmn.id;
        if (killedSpeciesId && speciesId === killedSpeciesId) continue;
        const snapHp = hpSnapshot[sl];
        if (typeof snapHp !== "number" || snapHp <= 0) continue;
        const p = pkmn[speciesId];
        if (!p) continue;
        if (typeof p.playerHp === "number" && p.playerHp < snapHp) {
          p.playerHp = snapHp;
        }
      }
    };

    setTimeout(() => {
      try {
        if (playerWins) {
          // Enemy active only — write 0 to wild HP; engine's
          // trainer-slot-advance pulls the next opponent mon.
          globalEval("wildPkmnHp = 0");
          if (typeof updateWildPkmn === "function") updateWildPkmn();
          restoreBench(null);
        } else if (enemyWins) {
          // Player active only.
          const killedSpeciesId = koPlayerSnapshot();
          restoreBench(killedSpeciesId);
          if (typeof updateTeamPkmn === "function") updateTeamPkmn();
        } else if (doubleKo) {
          // Canonical Emerald: total-tie → BOTH active Pokémon are K.O.
          // Write both 0s; engine's own switch/advance logic will spawn
          // the next enemy mon AND advance the player's active member.
          globalEval("wildPkmnHp = 0");
          if (typeof updateWildPkmn === "function") updateWildPkmn();
          const killedSpeciesId = koPlayerSnapshot();
          restoreBench(killedSpeciesId);
          if (typeof updateTeamPkmn === "function") updateTeamPkmn();
        }
      } catch (e) { console.error("[frontier-ext] arena force-KO failed:", e); }

      // Reset matchup counters. The active-slot change detection in the
      // combat hooks will also catch the switch — this is belt+braces.
      arenaResetMatchup(state);
      // Flag clearing is split by branch:
      //   • playerWins/doubleKo: keep judgeFiring=true. The game will
      //     spawn a new enemy via respawnTimer → setWildPkmn; our
      //     setWildPkmn wrap detects the bridge case, extends the
      //     freeze for ARENA_SWAP_FREEZE_MS, then clears everything.
      //   • enemyWins: the player's own team advances via
      //     switchMemberNext — no setWildPkmn fires, no bridge needed.
      if (enemyWins) {
        state.judgeFiring = false;
      }
    }, ARENA_PAUSE_MS);
  }

  // Judge trigger: wait for BOTH actives to have completed 3 moves.
  // A "tour d'attaque" = a full round where each side acted once;
  // 3 tours = both sides have moved 3 times each. The speed team may
  // hit 3 moves first but has to wait for the opponent's 3 before the
  // verdict — speed doesn't buy extra attack count for the judge.
  //
  // A KO before either side reaches 3 moves skips the judge entirely
  // (the downed Pokémon isn't "noted"): the game's own switch-to-next
  // logic runs, a new matchup opens, counters reset. Losing 3 Pokémon
  // = combat over in the usual way, judgment or not.
  function arenaCheckJudge() {
    const state = arenaGetState();
    if (!state || state.judgeFired || state.judgeFiring) return;
    // Fire when ENEMY has completed ARENA_TURNS_PER_SIDE actions,
    // regardless of how many moves the player racked up. Rationale:
    // with a Pachirisu + Speed+3 build the player finishes 3 moves
    // long before the enemy manages even one, so the old
    // "both >= 3" check waited a long time and often the player
    // overkilled the enemy via raw DPS before the judge could
    // intervene. With the enemy-only trigger, the judge forces a
    // ruling every 3 enemy turns — which is the canonical Gen 3
    // cadence (Emerald counts turns, not actions). The criteria
    // themselves (Mind ratio / Skill / Body) still reward the
    // player correctly for dominating damage output.
    if (state.enemyMoves < ARENA_TURNS_PER_SIDE) return;
    const hp = arenaReadHpRatios();
    if (hp.wildHp <= 0 || hp.playerHp <= 0) return;
    arenaRenderJudge();
  }

  // Wrap exploreCombatPlayer + exploreCombatWild to count moves, damage
  // and offensive-move shares per side. Identical structure to the Palace
  // hook: pre-orig snapshot, post-orig diff.
  // ─── ARENA ENEMY-SWAP FREEZE ──────────────────────────────────────────────
  // Combat loop is an `animate` function self-scheduled via
  // requestAnimationFrame (explore.js:3322). Wrapping exploreCombatPlayer/
  // Wild at their entry points doesn't stop the already-running rAF loop,
  // so Pachirisu kept attacking during judge verdicts. The clean way to
  // freeze is to hijack `shouldCombatStop()` (explore.js:2114) — animate
  // calls it every frame and returns early if it's true. See
  // installArenaShouldCombatStopHook below.
  //
  // This hook only raises the post-swap invincibility flag — strip buffs
  // reverted per player request, combat HP lock done via shouldCombatStop.
  // 1s window = both sides are "invincible" (combat frozen) while the
  // new enemy's sprite + HP settle in. After the window clears, combat
  // resumes naturally.
  const ARENA_SWAP_FREEZE_MS = 3000;
  function installArenaSwapFreeze() {
    if (typeof window.setWildPkmn !== "function") {
      setTimeout(installArenaSwapFreeze, 150);
      return;
    }
    if (window.__arenaSwapFreezeHooked) return;
    window.__arenaSwapFreezeHooked = true;
    const orig = window.setWildPkmn;
    window.setWildPkmn = function () {
      const res = orig.apply(this, arguments);
      try {
        if (!isInArenaRun()) return res;
        const state = arenaGetState();
        if (!state) return res;
        // Skip the first setWildPkmn of a combat — that's the initial
        // enemy load, not a swap.
        if (!state.initialLoadSeen) {
          state.initialLoadSeen = true;
          return res;
        }
        // Two cases:
        //   • Bridge case — judgeFiring is STILL true (player won the
        //     verdict, the KO triggered respawnTimer → setWildPkmn here).
        //     arenaRenderJudge deliberately kept judgeFiring up to close
        //     the gap. We extend it for another ARENA_SWAP_FREEZE_MS of
        //     post-spawn invincibility, then clear BOTH flags at once.
        //   • Natural swap — enemy just died from regular combat (not
        //     from a verdict). judgeFiring is already false. Fire the
        //     usual 1s invincibility window via arenaSwapFreezing.
        if (state.judgeFiring) {
          setTimeout(() => {
            state.judgeFiring = false;
            state.arenaSwapFreezing = false;
          }, ARENA_SWAP_FREEZE_MS);
          state.arenaSwapFreezing = true;
        } else {
          state.arenaSwapFreezing = true;
          setTimeout(() => { state.arenaSwapFreezing = false; }, ARENA_SWAP_FREEZE_MS);
        }
      } catch (e) { console.error("[frontier-ext] arena swap freeze failed:", e); }
      return res;
    };
  }

  // Hijack shouldCombatStop so the vanilla combat animation loop (animate
  // inside exploreCombatWild, explore.js:3322) treats our arena verdict
  // pause + post-swap invincibility as a legit "stop combat" state.
  // Without this, the rAF loop keeps ticking during my 3s verdict pause
  // and Pachirisu one-shots 2–3 enemies while the verdict card is still
  // on screen — which produced the 2-kill / 3-kill reports.
  function installArenaShouldCombatStopHook() {
    if (typeof window.shouldCombatStop !== "function") {
      setTimeout(installArenaShouldCombatStopHook, 150);
      return;
    }
    if (window.__arenaShouldCombatStopHooked) return;
    window.__arenaShouldCombatStopHooked = true;
    const orig = window.shouldCombatStop;
    window.shouldCombatStop = function () {
      try {
        if (isInArenaRun()) {
          const s = arenaGetState();
          if (s && (s.judgeFiring || s.arenaSwapFreezing)) return true;
        }
      } catch (e) { /* fall through to orig */ }
      return orig.apply(this, arguments);
    };
  }

  // Block voluntary switches in the Dojo/Arena. Canonical Emerald rule:
  // once a Pokémon is on the field, it fights until KO (3-turn judge
  // verdict counts as a KO). Forced-switch moves (Baton Pass, Whirlwind)
  // and Eject Button / Eject Pack all route through switchMember, so
  // the single guard neutralises every voluntary path at once.
  //
  // Post-KO auto-switches (switchMemberNext called when the active's
  // playerHp hit 0) still work: we only block when the active is ALIVE,
  // mirroring the existing choiceSpecs/choiceBand guards at teams.js:608.
  function installArenaSwitchBlock() {
    if (typeof window.switchMember !== "function") {
      setTimeout(installArenaSwitchBlock, 150);
      return;
    }
    if (window.__arenaSwitchBlockHooked) return;
    window.__arenaSwitchBlockHooked = true;
    const orig = window.switchMember;
    window.switchMember = function (member) {
      try {
        if (isInArenaRun()
            && typeof exploreActiveMember !== "undefined"
            && team[exploreActiveMember]
            && team[exploreActiveMember].pkmn
            && pkmn[team[exploreActiveMember].pkmn.id]
            && pkmn[team[exploreActiveMember].pkmn.id].playerHp > 0
            && exploreActiveMember !== member) {
          return;
        }
      } catch (e) { /* fall through */ }
      return orig.apply(this, arguments);
    };
  }

  // Universal × lock: any time openTooltip fires while an active run
  // is in progress, add the run-lock class so the vanilla close button
  // is hidden. The player is forced to commit via the in-modal buttons
  // (Continue / Rest / Abandon, or the modal's own flow controls) —
  // matches the Battle Frontier pattern where you can't accidentally
  // "cancel out" of the challenge screen.
  //
  // Mirror cleanup on closeTooltip so modals outside a run aren't
  // silently stripping the × (no reason to affect non-frontier tips).
  function installRunLockTooltipHook() {
    if (typeof window.openTooltip !== "function"
     || typeof window.closeTooltip !== "function") {
      setTimeout(installRunLockTooltipHook, 200);
      return;
    }
    if (window.__frontierExtRunLockHooked) return;
    window.__frontierExtRunLockHooked = true;
    const origOpen = window.openTooltip;
    const origClose = window.closeTooltip;
    const lockClass = "frontier-ext-run-lock-open";
    // Canonical exit-blocker: tooltip.js:60 and :66 both short-circuit
    // if a #prevent-tooltip-exit element exists in the DOM, so we plant
    // an invisible marker whenever a run is active. Handles both the
    // backdrop-click and Escape-key exits.
    //
    // CRITICAL: Pokechill itself reuses `id="prevent-tooltip-exit"` on
    // legitimate interactive elements (e.g. the "Yeah!" wipe-data
    // confirmation button in index.html line 528). We mark OUR blocker
    // with a `data-frontier-ext-blocker` attribute and only remove the
    // marked copy — otherwise apply() on a content swap would wipe
    // Pokechill's button and leave the player staring at an empty bar.
    const BLOCKER_MARKER = "data-frontier-ext-blocker";
    const ensureBlocker = () => {
      // If a vanilla blocker already exists (non-ours), don't duplicate.
      const existing = document.getElementById("prevent-tooltip-exit");
      if (existing && !existing.hasAttribute(BLOCKER_MARKER)) return;
      if (existing) return;
      const el = document.createElement("div");
      el.id = "prevent-tooltip-exit";
      el.setAttribute(BLOCKER_MARKER, "1");
      el.style.display = "none";
      document.body.appendChild(el);
    };
    const removeBlocker = () => {
      const el = document.getElementById("prevent-tooltip-exit");
      if (el && el.hasAttribute(BLOCKER_MARKER)) {
        try { el.remove(); } catch (e) {}
      }
    };
    // Detect whether the current tooltip belongs to our overlay by
    // looking at the CURRENT tooltip content only — any ZdC-rendered
    // modal injects at least one element whose class name starts with
    // `frontier-ext-`. Vanilla tooltips (item inspection, Pokémon
    // inspection, delete-data confirm, …) don't carry that namespace.
    //
    // Earlier versions also checked `box.classList` for the Factory /
    // Pyramid sizing classes, but those classes aren't managed by
    // apply() and can stay "stale" after a Factory/Pyramid modal
    // closed → the next vanilla tooltip (e.g. right-clicking a held
    // item inside the team editor during a run) would wrongly match
    // as a frontier tooltip, get the lock applied, hide the × and
    // trap the player. Content-only detection avoids that class of
    // false positive.
    const isFrontierTooltip = () => {
      const box = document.getElementById("tooltipBox");
      if (!box) return false;
      return !!box.querySelector('[class*="frontier-ext-"]');
    };
    const apply = () => {
      try {
        const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
        const bg = document.getElementById("tooltipBackground");
        const box = document.getElementById("tooltipBox");
        if (run && isFrontierTooltip()) {
          if (bg)  bg.classList.add(lockClass);
          if (box) box.classList.add(lockClass);
          ensureBlocker();
        } else {
          if (bg)  bg.classList.remove(lockClass);
          if (box) box.classList.remove(lockClass);
          removeBlocker();
        }
      } catch (e) { /* ignore */ }
    };
    window.openTooltip = function () {
      const res = origOpen.apply(this, arguments);
      apply();
      return res;
    };
    window.closeTooltip = function () {
      try {
        const bg = document.getElementById("tooltipBackground");
        const box = document.getElementById("tooltipBox");
        if (bg)  bg.classList.remove(lockClass);
        if (box) box.classList.remove(lockClass);
        removeBlocker();
      } catch (e) { /* ignore */ }
      return origClose.apply(this, arguments);
    };
  }

  // ─── MENU LOCK DURING ACTIVE RUN ─────────────────────────────────────────
  // While a ZdC run is in progress, every non-VS action in the overworld
  // menu is a save-integrity hazard: Items would let the player bag-swap
  // mid-run; Team/Dex/Genetics could shuffle species; Mystery Gift /
  // Export Reward / Wonder Trade touch external state we can't roll back.
  // The only legitimate exit is through VS → Hoenn → facility tile →
  // Continue / Rest / Abandon, so we gate the menu to VS only.
  //
  // Defense in depth:
  //   1. Hook `switchMenu`: refuse any id !== "vs" when activeRun exists.
  //   2. Hook the three claim* functions that bypass switchMenu entirely.
  //   3. Visual: mirror vanilla explore.js's `style.filter =
  //      "brightness(0.6)"` on every non-VS menu tile so the player
  //      sees the same grey-out they already know means "not now".
  //      Clicks are blocked by #1/#2 above — the filter is cosmetic.
  //   4. MutationObserver (childList only) on #menu-items keeps the
  //      filter synced if the menu re-renders mid-run.
  function installMenuLockDuringRun() {
    const hasRun = () => !!(saved && saved.frontierExt && saved.frontierExt.activeRun);

    // Match vanilla's gray-out mechanism (scripts/explore.js uses
    // el.style.filter = "brightness(0.6)" to dim menus while in an
    // area). Inline styles survive className replacements the vanilla
    // game occasionally does on #menu-items tiles. The JS-level wraps
    // on switchMenu + claim* are the real enforcement; the filter is
    // just the visual cue.
    const syncMenuLockCss = () => {
      try {
        const menu = document.getElementById("menu-items");
        if (!menu) return;
        const locked = hasRun();
        for (const el of menu.querySelectorAll(".menu-item")) {
          // Keep VS unlocked so the player can reach the Hoenn sub-tab
          // where Continue / Rest / Abandon live.
          const isVs = el.id === "menu-item-vs";
          const shouldDim = locked && !isVs;
          const target = shouldDim ? "brightness(0.6)" : "";
          if (el.style.filter !== target) el.style.filter = target;
        }
      } catch (e) { /* ignore */ }
    };
    window.__frontierExtSyncMenuLock = syncMenuLockCss;

    if (typeof window.switchMenu === "function" && !window.__frontierExtSwitchMenuHooked) {
      window.__frontierExtSwitchMenuHooked = true;
      const orig = window.switchMenu;
      window.switchMenu = function (id) {
        if (hasRun() && id !== "vs") return;
        return orig.apply(this, arguments);
      };
    }
    for (const name of ["claimMysteryGift", "claimExportReward", "claimWonderTrade"]) {
      if (typeof window[name] === "function" && !window["__frontierExtHooked_" + name]) {
        window["__frontierExtHooked_" + name] = true;
        const orig = window[name];
        window[name] = function () {
          if (hasRun()) return;
          return orig.apply(this, arguments);
        };
      }
    }
    syncMenuLockCss();
    try {
      const menu = document.getElementById("menu-items");
      if (menu && typeof MutationObserver === "function") {
        // childList only — NOT attributes. Watching attribute
        // mutations while the callback writes `el.style.filter`
        // creates an infinite feedback loop (style change → observer
        // fires → writes style → fires again) that freezes the page.
        const mo = new MutationObserver(syncMenuLockCss);
        mo.observe(menu, { childList: true, subtree: true });
      }
    } catch (e) { /* ignore */ }
  }

  // Pyramid status-persistence hook. Wild encounters bias their slot-1
  // move toward status infliction (biasPyramidWildMoveset), but vanilla
  // moveBuff caps paralysis at 2 turns and the rest at 3 — after which
  // the status clears mid-battle and the pressure fades. In the Pyramid
  // we want statuses to STICK (like Pike's trap rooms) so the player
  // is forced to spend items. When a status buff is being applied in a
  // Pyramid run with no explicit turnOverride, force turnOverride = 99
  // (same constant Pike uses; effectively "whole combat"). Other buff
  // types — stat boosts/drops, confusion, etc. — are untouched so
  // temporary combat dynamics still behave normally.
  function installPyramidStatusStickHook() {
    if (typeof window.moveBuff !== "function") {
      setTimeout(installPyramidStatusStickHook, 200);
      return;
    }
    if (window.__frontierExtPyrStatusStickHooked) return;
    window.__frontierExtPyrStatusStickHooked = true;
    const STATUS_RX = /^(burn|freeze|paralysis|poisoned|sleep)$/;
    const orig = window.moveBuff;
    window.moveBuff = function (target, buff, mod, turnOverride) {
      try {
        if (turnOverride === undefined
            && typeof buff === "string" && STATUS_RX.test(buff)
            && isInPyramidRun()) {
          return orig.call(this, target, buff, mod, PIKE_PYRAMID_STATUS_TURNS);
        }
      } catch (e) { /* fall through to orig */ }
      return orig.apply(this, arguments);
    };
  }

  function installArenaCombatHooks() {
    if (typeof window.exploreCombatPlayer !== "function"
     || typeof window.exploreCombatWild !== "function") {
      setTimeout(installArenaCombatHooks, 200);
      return;
    }
    if (window.__arenaHookInstalled) return;
    window.__arenaHookInstalled = true;

    const globalEval = eval;
    const readWildHp = () => { try { return Number(globalEval("typeof wildPkmnHp === 'undefined' ? 0 : wildPkmnHp")) || 0; } catch (e) { return 0; } };
    const readWildTurn = () => { try { return globalEval("typeof exploreCombatWildTurn === 'undefined' ? null : exploreCombatWildTurn"); } catch (e) { return null; } };
    const readTrainerSlot = () => { try { return globalEval("typeof currentTrainerSlot === 'undefined' ? 1 : currentTrainerSlot"); } catch (e) { return 1; } };

    // Called at the start of both hooks to reset per-matchup counters
    // when either side's active Pokémon changes (KO-switch or judge-forced
    // KO). Returns the state for downstream use, or null if not in arena.
    const detectMatchupChange = () => {
      const state = arenaGetState();
      if (!state) return null;
      const { playerSlot, enemySlot } = arenaReadActiveSlots();
      if (state.lastPlayerSlot === null && state.lastEnemySlot === null) {
        // First tick of this combat — record the initial matchup.
        state.lastPlayerSlot = playerSlot;
        state.lastEnemySlot = enemySlot;
        state.matchupCount = 1;
        return state;
      }
      if (playerSlot !== state.lastPlayerSlot || enemySlot !== state.lastEnemySlot) {
        // New matchup — reset per-matchup counters, bump matchup counter.
        arenaResetMatchup(state);
        state.lastPlayerSlot = playerSlot;
        state.lastEnemySlot = enemySlot;
        state.matchupCount = (state.matchupCount || 0) + 1;
      }
      return state;
    };

    // Damage-per-side HP reader for the enemy side (single active mon).
    const readPlayerActiveHp = () => {
      try {
        const { playerSlot } = arenaReadActiveSlots();
        if (!playerSlot || typeof team === "undefined" || !team[playerSlot]
            || !team[playerSlot].pkmn || typeof pkmn === "undefined") return 0;
        const p = pkmn[team[playerSlot].pkmn.id];
        return p ? Math.max(0, p.playerHp || 0) : 0;
      } catch (e) { return 0; }
    };

    // ── Player side: detect when team[active].turn changes → 1 move fired.
    const origPlayer = window.exploreCombatPlayer;
    window.exploreCombatPlayer = function () {
      const arenaActive = isInArenaRun();
      // During the verdict pause, freeze combat entirely — skip orig.
      if (arenaActive) {
        const s = arenaGetState();
        if (s && (s.judgeFiring || s.arenaSwapFreezing)) return;
      }
      let active = null, prevTurn = null, prevWildHp = null;
      if (arenaActive && typeof exploreActiveMember !== "undefined") {
        detectMatchupChange();
        active = team[exploreActiveMember];
        prevTurn = active ? active.turn : null;
        prevWildHp = readWildHp();
      }
      const res = origPlayer.apply(this, arguments);
      if (arenaActive && active) {
        const newTurn = active.turn;
        if (newTurn !== prevTurn && newTurn !== null && newTurn !== undefined) {
          const state = arenaGetState();
          if (state && !state.judgeFiring) {
            state.playerMoves++;
            const postWildHp = readWildHp();
            state.playerDamage += Math.max(0, (prevWildHp || 0) - postWildHp);
            try {
              const p = pkmn[active.pkmn.id];
              const moveKey = p && p.moves && p.moves["slot" + prevTurn];
              if (moveKey && move[moveKey] && move[moveKey].power && move[moveKey].power > 0) {
                state.playerAttacks++;
              }
            } catch (e) { /* ignore */ }
            arenaCheckJudge();
          }
        }
      }
      return res;
    };

    // ── Enemy side: detect when exploreCombatWildTurn changes.
    const origWild = window.exploreCombatWild;
    window.exploreCombatWild = function () {
      const arenaActive = isInArenaRun();
      if (arenaActive) {
        const s = arenaGetState();
        if (s && (s.judgeFiring || s.arenaSwapFreezing)) return;
      }
      let prevWildTurn = null, prevPlayerHp = 0;
      if (arenaActive) {
        detectMatchupChange();
        prevWildTurn = readWildTurn();
        prevPlayerHp = readPlayerActiveHp();
      }
      const res = origWild.apply(this, arguments);
      if (arenaActive) {
        const newWildTurn = readWildTurn();
        if (newWildTurn !== prevWildTurn && newWildTurn !== null && newWildTurn !== undefined) {
          const state = arenaGetState();
          if (state && !state.judgeFiring) {
            state.enemyMoves++;
            const postPlayerHp = readPlayerActiveHp();
            state.enemyDamage += Math.max(0, prevPlayerHp - postPlayerHp);
            try {
              const area = areas[RUN_AREA_ID];
              const slotIdx = readTrainerSlot();
              const moves = area && area.team && area.team["slot" + slotIdx + "Moves"];
              const moveKey = moves && moves[prevWildTurn - 1];
              if (moveKey && move[moveKey] && move[moveKey].power && move[moveKey].power > 0) {
                state.enemyAttacks++;
              }
            } catch (e) { /* ignore */ }
            // Player's active Pokémon just died OUTSIDE a judge verdict
            // (normal KO from an enemy attack, possibly the enemy's 3rd
            // action of the matchup). The counters we just tallied belong
            // to the DEAD Pokémon; if we let them stand, the next player
            // Pokémon comes in with inflated enemy counters on its ledger
            // — the judge then fires on the new matchup with stale data
            // ("0 player attacks vs 3 stale enemy attacks" → auto-win for
            // whichever side has non-zero counters). Reset the matchup
            // immediately so the incoming Pokémon starts from a clean
            // slate. detectMatchupChange would eventually catch this via
            // the slot change on the next tick, but engine-side KO
            // switching can be deferred by the respawn timer — closing
            // the window explicitly avoids a judge firing inside it.
            if (prevPlayerHp > 0 && postPlayerHp <= 0) {
              arenaResetMatchup(state);
              state.lastPlayerSlot = null;
              state.lastEnemySlot = null;
              return res;
            }
            arenaCheckJudge();
          }
        }
      }
      return res;
    };
  }

  // ─── 6b2b. FACTORY RULE — rental pool, pick 3 of 6, no preview team ─────
  // Canonical Gen 3 Emerald Battle Factory:
  //   • Each round opens with a fresh pool of 6 random rentals.
  //   • Player picks 3 as their team for the round — they do NOT use
  //     their own Pokémon. The rentals' movesets are generated via the
  //     same pickMovesetFor pipeline as NPC trainers.
  //   • 7 battles per round (declared in facility.battlesPerRound).
  //   • Between rounds a fresh pool of 6 is rolled and the selection
  //     modal opens again.
  //   • Phase 2 (not yet implemented): after each win, an option to
  //     swap one of your 3 with one of the defeated's 3.
  const FACTORY_POOL_SIZE = 6;
  const FACTORY_TEAM_SIZE = 3;
  const FACTORY_PREVIEW_SLOT = "__frontierExtFactory";

  function isFactoryFacility(facility) {
    return !!(facility && facility.rules && facility.rules.rentalPool);
  }

  // The 7 natures Pokechill exposes (matching natureDictionary). "" is
  // the neutral slot — no stat change.
  const FACTORY_RENTAL_NATURES = ["adamant", "modest", "jolly", "relaxed", "quiet", "bold", ""];

  // Random 0-6 IV. Pokechill's IV scale is 0 to 6 (see teams.js:521+ and
  // the game's pkmn init at pkmnDictionary.js:20195).
  function rollFactoryIv() { return Math.floor(Math.random() * 7); }

  function rollFactoryIvs() {
    return {
      hp: rollFactoryIv(),
      atk: rollFactoryIv(),
      def: rollFactoryIv(),
      satk: rollFactoryIv(),
      sdef: rollFactoryIv(),
      spe: rollFactoryIv() };
  }

  // Pick a random ability for this species from the game's global
  // ability dict. Uses `learnPkmnAbility(id)` when available (canonical
  // type-weighted picker), else falls back to a random key.
  function rollFactoryAbility(id) {
    if (typeof pkmn === "undefined" || !pkmn[id]) return null;
    if (typeof learnPkmnAbility === "function") {
      try {
        const picked = learnPkmnAbility(id);
        if (picked) return picked;
      } catch (e) { /* fall through */ }
    }
    // Fallback: pick the hidden ability id if defined, else null.
    const h = pkmn[id].hiddenAbility;
    return h ? (h.id || null) : null;
  }

  // Tier-scaled pool of FACTORY_POOL_SIZE unique rentals. Uses the same
  // tier-by-round curve as generateTrainer AND the same
  // getPoolForFacility narrowing — so player and enemy start from a
  // balanced weak pool in rounds 1-3, then the whole tier opens up.
  //
  // CRITICAL: each rental gets its own randomised nature / IVs / ability
  // — completely independent of the user's own pkmn[id] state. This
  // means the user can never "get lucky" on a species they've trained
  // to S-tier IVs; rentals are always freshly rolled stat blocks.
  function generateFactoryRentalPool(facility, round) {
    const diff = computeRunDifficulty(round, facility);
    const { tier } = diff;

    const pool = getPoolForFacility(facility, tier, round);

    const rentals = [];
    const used = new Set();
    let safety = 0;
    while (rentals.length < FACTORY_POOL_SIZE && safety < 100) {
      safety++;
      const id = pool[Math.floor(Math.random() * pool.length)];
      if (!id || used.has(id)) continue; // no duplicate species in the pool
      used.add(id);
      rentals.push({
        id,
        moves: pickMovesetFor(id, diff),
        nature: FACTORY_RENTAL_NATURES[Math.floor(Math.random() * FACTORY_RENTAL_NATURES.length)],
        ivs: rollFactoryIvs(),
        ability: rollFactoryAbility(id) });
    }
    return rentals;
  }

  // Temporarily override a rental's full stat block on the shared
  // `pkmn[id]` entry — moves, nature, IVs, ability — so the combat
  // engine reads the RENTAL's randomised spec and never the user's own
  // trained Pokémon of the same species. Originals are stashed on
  // run.factoryOriginalState so we can fully restore at round-end /
  // run-end (even if the user never caught that species originally, we
  // record `undefined` and restore back to `undefined`).
  function applyFactoryMoves(run) {
    if (!run || !run.factoryTeam || typeof pkmn === "undefined") return;
    if (!run.factoryOriginalState) run.factoryOriginalState = {};
    for (const rental of run.factoryTeam) {
      const p = pkmn[rental.id];
      if (!p) continue;
      if (!run.factoryOriginalState[rental.id]) {
        // Also stash level / exp / caught — without this, rentals of
        // species the player never caught (legendaries, mythicals like
        // Diancie) would keep pkmn[id].level = 1 default, and the
        // combat engine would send a lv-1 rental against a lv-100 enemy.
        run.factoryOriginalState[rental.id] = {
          moves: p.moves ? { ...p.moves } : undefined,
          nature: p.nature,
          ivs: p.ivs ? { ...p.ivs } : undefined,
          ability: p.ability,
          level: p.level,
          exp: p.exp,
          caught: p.caught };
      }
      p.moves = {
        slot1: rental.moves[0],
        slot2: rental.moves[1],
        slot3: rental.moves[2],
        slot4: rental.moves[3] };
      p.nature = rental.nature || "";
      p.ivs = { ...rental.ivs };
      p.ability = rental.ability || undefined;
      // Force rental to level 100 regardless of whether the player has
      // ever caught that species. `caught` >= 1 keeps the rental from
      // being rejected by any "must be caught" pathway; the restore step
      // puts both back to whatever the player actually had.
      p.level = 100;
      if (!p.caught || p.caught < 1) p.caught = 1;
      // CRITICAL: exp must be < 100. updateTeamExp (explore.js:1795)
      // recursively calls itself when exp >= 100 (it decrements by 100
      // per iteration to process pending level-ups). Setting exp = 1M
      // causes ~10k stack frames → RangeError: Maximum call stack size
      // exceeded the first time updateTeamExp runs in Factory combat.
      // Rentals are pinned at level 100 so they never actually level
      // up; leave exp at whatever placeholder works for the level bar.
      p.exp = 0;
    }
  }
  function restoreFactoryMoves(run) {
    if (!run || !run.factoryOriginalState || typeof pkmn === "undefined") return;
    for (const [id, orig] of Object.entries(run.factoryOriginalState)) {
      if (!pkmn[id]) continue;
      pkmn[id].moves = orig.moves;
      pkmn[id].nature = orig.nature;
      pkmn[id].ivs = orig.ivs;
      pkmn[id].ability = orig.ability;
      if ("level" in orig) pkmn[id].level = orig.level;
      if ("exp"   in orig) pkmn[id].exp   = orig.exp;
      if ("caught" in orig) pkmn[id].caught = orig.caught;
    }
    run.factoryOriginalState = {};
  }

  // ─── ENEMY RUNTIME STATS (non-Factory crescendo) ──────────────────────────
  // Same stash/restore pattern as the Factory's applyFactoryMoves, but
  // targeted at ENEMY-only species on any facility. Called from
  // buildEphemeralRunArea to inject:
  //   • IVs scaled by `diff.ivRating` (0..6 crescendo; see computeRunDifficulty)
  //   • Ability override (random learnPkmnAbility pick, or hidden ability
  //     when forceHiddenAbility is set) with probability `diff.abilityChance`
  //
  // Caveat — vanilla combat reads `pkmn[id]` for BOTH sides, so if the
  // enemy's species overlaps with one the player brought, the player's own
  // mon temporarily gains the enemy IV/ability too. This mirrors what
  // applyFactoryMoves already does for rentals and is accepted as the
  // Emerald "Frontier stat cap" feel.
  //
  // `trainer.team` = [{ id, moves, nature, ... }, ...]
  function applyEnemyRuntimeStats(run, trainer, diff) {
    if (!run || !trainer || !diff) return;
    if (typeof pkmn === "undefined") return;
    // Belt & braces: if a previous combat's overrides were never cleaned
    // up (e.g. exitCombat hook skipped due to a mid-battle crash), restore
    // first so we don't compound stashes across combats.
    if (run.enemyRuntimeState && Object.keys(run.enemyRuntimeState).length) {
      restoreEnemyRuntimeStats(run);
    }
    run.enemyRuntimeState = {};
    const team = Array.isArray(trainer.team) ? trainer.team : [];
    const ivVal = Math.max(0, Math.min(6, diff.ivRating | 0));
    for (const slot of team) {
      if (!slot || !slot.id) continue;
      const p = pkmn[slot.id];
      if (!p) continue;
      if (!run.enemyRuntimeState[slot.id]) {
        run.enemyRuntimeState[slot.id] = {
          ivs: p.ivs ? { ...p.ivs } : undefined,
          ability: p.ability };
      }
      p.ivs = { hp: ivVal, atk: ivVal, def: ivVal, satk: ivVal, sdef: ivVal, spe: ivVal };

      // Ability roll. forceHiddenAbility wins if the species has a hidden
      // ability defined; else probabilistic `learnPkmnAbility` pick.
      const wantHidden = diff.forceHiddenAbility && p.hiddenAbility && p.hiddenAbility.id;
      const rollAbility = !wantHidden && diff.abilityChance > 0
        && Math.random() < diff.abilityChance;
      if (wantHidden) {
        p.ability = p.hiddenAbility.id;
      } else if (rollAbility && typeof learnPkmnAbility === "function") {
        try {
          const picked = learnPkmnAbility(slot.id, 1 + (diff.mult - 1));
          if (picked) p.ability = picked;
        } catch (e) { /* keep original ability */ }
      }
    }
  }

  function restoreEnemyRuntimeStats(run) {
    if (!run || !run.enemyRuntimeState || typeof pkmn === "undefined") return;
    for (const [id, orig] of Object.entries(run.enemyRuntimeState)) {
      if (!pkmn[id]) continue;
      pkmn[id].ivs = orig.ivs;
      pkmn[id].ability = orig.ability;
    }
    run.enemyRuntimeState = {};
  }

  // Switch the active previewTeam slot to the private Factory slot so
  // the combat engine uses rentals. The user's current slot is stashed
  // and restored when the run ends.
  //
  // NOTE: teams.js:461 iterates `for (const slot in team)` which spans
  // all six slots — so EVERY slot key must exist on the preview team
  // (as at least `{ pkmn: undefined, item: undefined }`) or the game
  // crashes with "Cannot read properties of undefined (reading 'pkmn')".
  // We fill the unused slots 4/5/6 with empty stubs for this reason.
  function enterFactoryPreviewSlot(run) {
    if (!run.factoryOriginalPreviewSlot) {
      run.factoryOriginalPreviewSlot = saved.currentPreviewTeam;
    }
    if (!saved.previewTeams[FACTORY_PREVIEW_SLOT]) {
      saved.previewTeams[FACTORY_PREVIEW_SLOT] = {};
    }
    const pt = saved.previewTeams[FACTORY_PREVIEW_SLOT];
    // Ensure every one of the 6 slots exists as an object so the game's
    // injectPreviewTeam loop can safely read `.pkmn` / `.item` on each.
    for (const sl of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
      pt[sl] = { pkmn: undefined, item: undefined };
    }
    run.factoryTeam.forEach((rental, i) => {
      pt["slot" + (i + 1)] = { pkmn: rental.id, item: undefined };
    });
    saved.currentPreviewTeam = FACTORY_PREVIEW_SLOT;
    run.tiedPreviewSlot = FACTORY_PREVIEW_SLOT;
  }
  function restoreFactoryPreviewSlot(run) {
    if (run && run.factoryOriginalPreviewSlot) {
      if (saved.currentPreviewTeam === FACTORY_PREVIEW_SLOT) {
        saved.currentPreviewTeam = run.factoryOriginalPreviewSlot;
      }
      run.factoryOriginalPreviewSlot = null;
    }
    // Wipe the private slot (nothing valuable to keep).
    if (saved.previewTeams && saved.previewTeams[FACTORY_PREVIEW_SLOT]) {
      const pt = saved.previewTeams[FACTORY_PREVIEW_SLOT];
      for (const sl of Object.keys(pt)) delete pt[sl];
    }
  }

  // Full cleanup called at abandon / defeat / run-end.
  function cleanupFactoryRun(run) {
    try { restoreFactoryMoves(run); } catch (e) { /* ignore */ }
    try { restoreFactoryPreviewSlot(run); } catch (e) { /* ignore */ }
    try { setFactoryModalSizing(false); } catch (e) { /* ignore */ }
    if (run) {
      run.factoryPool = null;
      run.factorySelection = null;
      run.factoryTeam = null;
    }
  }

  // Add / remove the "factory modal open" class on #tooltipBox AND its
  // parent #tooltipBackground so the modal gets an enlarged viewport
  // AND the vanilla close button can be restyled (top-right small pill
  // instead of the default mid-center button that overlaps the action
  // row). Class cleared every time we navigate away from the rental
  // screen.
  function setFactoryModalSizing(on) {
    const box = document.getElementById("tooltipBox");
    const bg = document.getElementById("tooltipBackground");
    if (on) {
      if (box) box.classList.add("frontier-ext-factory-open");
      if (bg)  bg.classList.add("frontier-ext-factory-open");
    } else {
      if (box) box.classList.remove("frontier-ext-factory-open");
      if (bg)  bg.classList.remove("frontier-ext-factory-open");
    }
  }

  // ── UI: Rental selection modal ─────────────────────────────────────────
  function openFactoryRentalSelection(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const lang = "en";
    setFactoryModalSizing(true);

    // Generate (or keep cached) pool for this round.
    if (!Array.isArray(run.factoryPool) || run.factoryPool.length !== FACTORY_POOL_SIZE) {
      run.factoryPool = generateFactoryRentalPool(facility, run.round + 1);
      run.factorySelection = [];
    }
    if (!Array.isArray(run.factorySelection)) run.factorySelection = [];

    const t = {
          title: "Rental Pokémon",
          subtitle: "Pick 3 out of 6. This team fights through all 7 battles of the round.",
          pickN: "Selected: {n}/3",
          confirm: "⚔️ Confirm & start",
          cancel: "Back",
          abandon: "Abandon",
          noItem: "No item" };

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) top.style.display = "none";
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${facility.name} — ${t.title}`;
    }

    const renderCards = () => {
      const ivLabels = { hp: "HP", atk: "Atk", def: "Def", satk: "SAtk", sdef: "SDef", spe: "Spe" };
      const neutralLabel = "Neutral";
      const ivTier = (v) => v <= 2 ? "low" : v <= 4 ? "mid" : "high";
      // Pokechill ships a global returnTypeColor(type) helper — used
      // to accent each move chip with its type colour.
      const typeColor = (t) => (typeof returnTypeColor === "function")
        ? returnTypeColor(t) : "#888";

      const cards = run.factoryPool.map((rental, idx) => {
        const selected = run.factorySelection.indexOf(idx) !== -1;
        const pickPos = run.factorySelection.indexOf(idx);
        const monName = typeof format === "function" ? format(rental.id) : rental.id;
        const natureLabel = rental.nature
          ? (typeof format === "function" ? format(rental.nature) : rental.nature)
          : neutralLabel;
        const abilityLabel = rental.ability
          ? (typeof format === "function" ? format(rental.ability) : rental.ability)
          : "—";

        const iv = rental.ivs || {};
        const ivRow = (k) => {
          const v = Math.max(0, Math.min(6, (iv[k] | 0)));
          const pct = (v / 6) * 100;
          return `
            <div class="iv-row">
              <span class="iv-label">${ivLabels[k]}</span>
              <div class="iv-bar"><div class="iv-bar-fill ${ivTier(v)}" style="width:${pct}%"></div></div>
              <span class="iv-value">${v}</span>
            </div>`;
        };
        const ivsBlock = `
          <div class="ivs">
            ${ivRow("hp")}${ivRow("atk")}${ivRow("def")}
            ${ivRow("satk")}${ivRow("sdef")}${ivRow("spe")}
          </div>`;

        const movesList = rental.moves.map((k) => {
          const label = typeof format === "function" ? format(k) : k;
          const mv = typeof move !== "undefined" ? move[k] : null;
          const tCol = mv ? typeColor(mv.type) : "#888";
          return `<span class="move" style="--move-type:${tCol}">${label}</span>`;
        }).join("");

        return `
          <div class="frontier-ext-factory-card ${selected ? "selected" : ""}" data-idx="${idx}">
            <div class="card-header">
              <img src="img/pkmn/sprite/${rental.id}.png" alt="${monName}" class="sprite">
              <div class="title-block">
                <div class="name">${monName}</div>
                <div class="tags">
                  <span class="tag-nature">${natureLabel}</span>
                  <span class="tag-ability">${abilityLabel}</span>
                </div>
              </div>
              ${selected ? `<div class="pick-badge">${pickPos + 1}</div>` : ""}
            </div>
            ${ivsBlock}
            <div class="moves">${movesList}</div>
          </div>
        `;
      }).join("");
      return cards;
    };

    const canConfirm = run.factorySelection.length === FACTORY_TEAM_SIZE;

    if (mid) {
      mid.style.display = "block";
      // Confirm button moved inside mid (right after the counter) so
      // it's always visible — the 6-card grid is tall enough that a
      // button placed in tooltipBottom can end up below the fold.
      mid.innerHTML = `
        <div class="frontier-ext-factory-subtitle">${t.subtitle}</div>
        <div class="frontier-ext-factory-grid">${renderCards()}</div>
        <div class="frontier-ext-factory-counter">${t.pickN.replace("{n}", run.factorySelection.length)}</div>
        <div class="frontier-ext-factory-actions">
          <button class="frontier-ext-action-btn primary ${canConfirm ? "" : "disabled"}" data-action="factory-confirm">${t.confirm}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
      `;
      mid.querySelectorAll(".frontier-ext-factory-card").forEach((el) => {
        el.addEventListener("click", () => toggleFactorySelection(parseInt(el.dataset.idx, 10), facility));
      });
      mid.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => {
          if (btn.classList.contains("disabled")) return;
          handleRunAction(btn.dataset.action, facility);
        };
      });
    }

    // Tooltip bottom left empty — action buttons are inline in mid.
    if (bottom) {
      bottom.style.display = "none";
      bottom.innerHTML = "";
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  function toggleFactorySelection(idx, facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !Array.isArray(run.factoryPool)) return;
    if (!Array.isArray(run.factorySelection)) run.factorySelection = [];
    const pos = run.factorySelection.indexOf(idx);
    if (pos !== -1) {
      // Unselect
      run.factorySelection.splice(pos, 1);
    } else {
      if (run.factorySelection.length >= FACTORY_TEAM_SIZE) return; // cap
      run.factorySelection.push(idx);
    }
    openFactoryRentalSelection(facility); // re-render
  }

  // Confirm selection → freeze team, override moves, switch preview slot,
  // and fire combat directly (no team-preview menu — rentals are chosen
  // already via the modal).
  function confirmFactorySelection(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !Array.isArray(run.factorySelection)) return;
    if (run.factorySelection.length !== FACTORY_TEAM_SIZE) return;

    // Freeze the picked rentals.
    run.factoryTeam = run.factorySelection.map((i) => run.factoryPool[i]);

    // Runtime setup.
    enterFactoryPreviewSlot(run);
    applyFactoryMoves(run);

    // Modal will be replaced by the combat-launch team-menu — reset our
    // oversized-modal class so nothing else inherits it.
    setFactoryModalSizing(false);

    // Fire combat through the normal launchCombat path. The private
    // preview slot + tied-slot lock ensure the team-menu UI shows the
    // rentals and blocks edits. Player clicks "Save and Go" normally.
    launchCombat(facility);
  }

  // ── Factory swap modal ─────────────────────────────────────────────
  // Shown after every mid-round Factory victory. Presents the defeated
  // opponent's 3 rentals + the player's 3 current rentals. Player picks
  // one from each side to trade, or skips. Click the Confirm button to
  // apply the swap, or Skip to proceed without trading.
  function openFactorySwapModal(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    if (!Array.isArray(run.pendingFactorySwap) || !Array.isArray(run.factoryTeam)) {
      // Nothing to swap — just go straight to next battle preview.
      openSimulatedFight(facility);
      return;
    }
    const lang = "en";
    setFactoryModalSizing(true);

    if (!Array.isArray(run.factorySwapSelection)) run.factorySwapSelection = [null, null];
    // [takeIdx, giveIdx] — idx into pendingFactorySwap and factoryTeam.

    const t = {
          title: "Post-battle swap",
          subtitle: "You won! You may trade one of your Pokémon with one of your opponent's, or skip.",
          opponentTeam: "Defeated opponent",
          yourTeam: "Your current team",
          confirm: "🔄 Confirm swap",
          skip: "Skip — keep my team",
          pickBoth: "Pick one Pokémon from each side to swap." };

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) top.style.display = "none";
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${facility.name} — ${t.title}`;
    }

    const renderCard = (rental, side, idx, isSelected) => {
      const monName = typeof format === "function" ? format(rental.id) : rental.id;
      const natureLabel = rental.nature
        ? (typeof format === "function" ? format(rental.nature) : rental.nature)
        : ("Neutral");
      const abilityLabel = rental.ability
        ? (typeof format === "function" ? format(rental.ability) : rental.ability)
        : "—";
      const typeColor = (ty) => (typeof returnTypeColor === "function") ? returnTypeColor(ty) : "#888";
      const moves = (rental.moves || []).map((k) => {
        const label = typeof format === "function" ? format(k) : k;
        const mv = typeof move !== "undefined" ? move[k] : null;
        const tCol = mv ? typeColor(mv.type) : "#888";
        return `<span class="move" style="--move-type:${tCol}">${label}</span>`;
      }).join("");
      const iv = rental.ivs || {};
      const ivTier = (v) => v <= 2 ? "low" : v <= 4 ? "mid" : "high";
      const ivLabels = { hp: "HP", atk: "Atk", def: "Def", satk: "SAtk", sdef: "SDef", spe: "Spe" };
      const ivRow = (k) => {
        const v = Math.max(0, Math.min(6, (iv[k] | 0)));
        return `<div class="iv-row"><span class="iv-label">${ivLabels[k]}</span>
          <div class="iv-bar"><div class="iv-bar-fill ${ivTier(v)}" style="width:${(v / 6) * 100}%"></div></div>
          <span class="iv-value">${v}</span></div>`;
      };
      return `
        <div class="frontier-ext-factory-card ${isSelected ? "selected" : ""} swap-${side}"
             data-swap-side="${side}" data-swap-idx="${idx}">
          <div class="card-header">
            <img src="img/pkmn/sprite/${rental.id}.png" alt="${monName}" class="sprite">
            <div class="title-block">
              <div class="name">${monName}</div>
              <div class="tags">
                <span class="tag-nature">${natureLabel}</span>
                <span class="tag-ability">${abilityLabel}</span>
              </div>
            </div>
          </div>
          <div class="ivs">
            ${ivRow("hp")}${ivRow("atk")}${ivRow("def")}
            ${ivRow("satk")}${ivRow("sdef")}${ivRow("spe")}
          </div>
          <div class="moves">${moves}</div>
        </div>
      `;
    };

    const [takeIdx, giveIdx] = run.factorySwapSelection;
    const opponentGrid = run.pendingFactorySwap.map((r, i) =>
      renderCard(r, "take", i, takeIdx === i)).join("");
    const yourGrid = run.factoryTeam.map((r, i) =>
      renderCard(r, "give", i, giveIdx === i)).join("");

    const canConfirm = takeIdx !== null && giveIdx !== null;

    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div class="frontier-ext-factory-subtitle">${t.subtitle}</div>
        <div class="frontier-ext-factory-swap-section">
          <div class="section-label opponent">${t.opponentTeam}</div>
          <div class="frontier-ext-factory-grid">${opponentGrid}</div>
        </div>
        <div class="frontier-ext-factory-swap-section">
          <div class="section-label yours">${t.yourTeam}</div>
          <div class="frontier-ext-factory-grid">${yourGrid}</div>
        </div>
        <div class="frontier-ext-factory-counter">${canConfirm ? "✓" : t.pickBoth}</div>
        <div class="frontier-ext-factory-actions">
          <button class="frontier-ext-action-btn primary ${canConfirm ? "" : "disabled"}" data-action="factory-swap-confirm">${t.confirm}</button>
          <button class="frontier-ext-action-btn" data-action="factory-swap-skip">${t.skip}</button>
        </div>
      `;
      mid.querySelectorAll(".frontier-ext-factory-card").forEach((el) => {
        el.addEventListener("click", () => {
          const side = el.dataset.swapSide;
          const idx = parseInt(el.dataset.swapIdx, 10);
          if (side === "take") run.factorySwapSelection[0] = idx;
          else run.factorySwapSelection[1] = idx;
          openFactorySwapModal(facility); // re-render
        });
      });
      mid.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => {
          if (btn.classList.contains("disabled")) return;
          handleRunAction(btn.dataset.action, facility);
        };
      });
    }
    if (bottom) { bottom.style.display = "none"; bottom.innerHTML = ""; }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Execute the chosen swap: restore the outgoing rental's original pkmn
  // state, insert the incoming rental into factoryTeam (same slot), apply
  // its spec so the next combat picks up the new moves/nature/ivs/ability.
  function confirmFactorySwap(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !Array.isArray(run.pendingFactorySwap)) return;
    const [takeIdx, giveIdx] = run.factorySwapSelection || [null, null];
    if (takeIdx === null || giveIdx === null) return;
    const incoming = run.pendingFactorySwap[takeIdx];
    const outgoing = run.factoryTeam[giveIdx];
    if (!incoming || !outgoing) return;

    // Restore the OUTGOING rental's original pkmn state (we no longer
    // need it overridden; keep the user's data clean for the species).
    // Includes level / exp / caught so rentals of never-caught species
    // don't leak a level-100 entry into the dex after the swap.
    if (run.factoryOriginalState && run.factoryOriginalState[outgoing.id]
        && typeof pkmn !== "undefined" && pkmn[outgoing.id]) {
      const orig = run.factoryOriginalState[outgoing.id];
      pkmn[outgoing.id].moves = orig.moves;
      pkmn[outgoing.id].nature = orig.nature;
      pkmn[outgoing.id].ivs = orig.ivs;
      pkmn[outgoing.id].ability = orig.ability;
      if ("level" in orig) pkmn[outgoing.id].level = orig.level;
      if ("exp"   in orig) pkmn[outgoing.id].exp   = orig.exp;
      if ("caught" in orig) pkmn[outgoing.id].caught = orig.caught;
      delete run.factoryOriginalState[outgoing.id];
    }

    // Replace in factoryTeam and in the private previewTeam slot so the
    // combat engine sees the new species on next launch.
    run.factoryTeam[giveIdx] = incoming;
    const pt = saved.previewTeams && saved.previewTeams[FACTORY_PREVIEW_SLOT];
    if (pt) pt["slot" + (giveIdx + 1)] = { pkmn: incoming.id, item: undefined };

    // Apply the new rental's full spec (moves + nature + IVs + ability)
    // to pkmn[id], backing up the incoming species' original state so
    // we can restore it at run-end.
    applyFactoryMoves(run);

    // Clear swap state + reset selection.
    run.pendingFactorySwap = null;
    run.factorySwapSelection = [null, null];

    // Move on to the next battle preview.
    openSimulatedFight(facility);
  }

  // ─── 6b2c. PYRAMID RULE — grid dungeon + theme rotation + Combat Bag ────
  // Canonical Gen 3 Emerald Battle Pyramid:
  //   • Round = climb 7 floors (5×5 grid each) with persistent HP/status.
  //   • Tile contents hidden ("?") until the player walks adjacent.
  //   • Each trainer brings ONE Pokémon (canonical rule); wild
  //     encounters are filtered by the current theme pool (see
  //     PYRAMID_THEMES). Trainer species use the facility's normal
  //     pool, NOT the theme — only wilds are theme-bound.
  //   • Wild movesets are biased toward status moves (forces the
  //     player to burn bag items to stay healthy — see
  //     biasPyramidWildMoveset + PYRAMID_THEME_PREFERRED_STATUS_MOVES).
  //   • Status-buff duration in-combat is forced to 99 turns while
  //     inside a Pyramid run (installPyramidStatusStickHook) so
  //     paralysis / poison / burn stick the whole fight.
  //   • Final floor of a boss round culminates in Bayar (Brandon) —
  //     pyramidEncounterKind = "brain" fires through launchCombat's
  //     canonical-team branch.
  //
  // Theme rotation: pyramidThemeIndex advances by one per successful
  // series clear. Losing a run nulls activeRun, so the next entry
  // begins at theme 0 — matches the canonical "perdre = retour au
  // first theme". The Psychic NPC NPC (facility-preview row) reveals
  // the CURRENT theme (which equals the theme the player is about to
  // play, since the index is bumped before roundJustCleared posts).
  //
  // Combat Bag: a per-run inventory capped at 10 DISTINCT item ids.
  // Consumables stack; held items don't (unique per id). Held items
  // equip onto pikeTeam[slot].item and are mirrored into
  // saved.previewTeams[tied][slot].item so the team-menu UI actually
  // shows the icon (cleared on every exit — see FRONTIER_EXT.md).
  const PYR_GRID_SIZE = 5;
  const PYR_TILES = {
    EMPTY: "empty",
    WALL: "wall",
    STAIRS: "stairs",
    TRAINER: "trainer",
    WILD: "wild",
    ITEM: "item",
    // Legacy tile kinds — kept here so in-flight saves from before
    // the item rework still parse. The generator no longer emits them
    // and pyramidResolveTile maps them to safe no-ops on resolve.
    HEAL_FULL: "healFull",
    HEAL_PARTIAL: "healHalf",
    CURE_STATUS: "cure" };
  const PYRAMID_THEMES = [
    { key: "paralysis",             label: "Paralysis",
      pool: ["plusle", "minun", "pikachu", "electabuzz", "vileplume", "manectric", "breloom", "jolteon"] },
    { key: "poison",                label: "Poison",
      pool: ["gulpin", "roselia", "butterfree", "seviper", "skarmory", "ludicolo", "crobat", "gengar"] },
    { key: "burn",               label: "Burn",
      pool: ["growlithe", "vulpix", "magcargo", "ninetales", "medicham", "weezing", "dusclops", "houndoom"] },
    { key: "iceType",            label: "Ice type",
      pool: ["glalie", "sneasel", "dewgong", "piloswine", "jynx", "cloyster", "walrein", "lapras"] },
    { key: "psyType",              label: "Psychic type",
      pool: ["wobbuffet", "metang", "exeggutor", "slowking", "xatu", "alakazam", "starmie", "espeon"] },
    { key: "rockType",            label: "Rock type",
      pool: ["golem", "steelix", "omastar", "lunatone", "shuckle", "armaldo", "cradily", "aerodactyl"] },
    { key: "fightType",           label: "Fighting type",
      pool: ["poliwrath", "hariyama", "breloom", "medicham", "hitmonchan", "hitmonlee", "heracross", "machamp"] },
    { key: "weather",                 label: "Weather",
      pool: ["quagsire", "tropius", "pupitar", "lapras", "cacturne", "flareon", "walrein", "gyarados"] },
    { key: "bugType",          label: "Bug type",
      pool: ["pineco", "shuckle", "venomoth", "scizor", "heracross", "forretress", "armaldo", "shedinja"] },
    { key: "darkType",         label: "Dark type",
      pool: ["sableye", "sneasel", "crawdaunt", "shiftry", "cacturne", "absol", "houndoom", "umbreon"] },
    { key: "waterType",              label: "Water type",
      pool: ["octillery", "dewgong", "pelipper", "quagsire", "ludicolo", "slowking", "starmie", "blastoise"] },
    { key: "ghostType",          label: "Ghost type",
      pool: ["duskull", "haunter", "banette", "misdreavus", "sableye", "dusclops", "shedinja", "gengar"] },
    { key: "steelType",            label: "Steel type",
      pool: ["mawile", "magneton", "steelix", "scizor", "forretress", "skarmory", "aggron", "metagross"] },
    { key: "flyDragon",   label: "Flying & Dragon",
      pool: ["dragonair", "vibrava", "altaria", "flygon", "aerodactyl", "gyarados", "kingdra", "charizard"] },
    { key: "evoStones",   label: "Evolution stones",
      pool: ["arcanine", "poliwrath", "raichu", "vaporeon", "jolteon", "flareon", "ninetales", "starmie"] },
    { key: "normalType",           label: "Normal type",
      pool: ["kangaskhan", "swellow", "ursaring", "porygon2", "tauros", "fearow", "snorlax", "slaking"] },
  ];
  // NOTE: Bulbapedia lists 20 themes for the vanilla Pyramid but 4 are
  // mechanic-themed (HP points / Levitation / Trap / Self-destruct) that
  // don't map cleanly to Pokechill's state model. Per user, those were
  // struck out of the rotation — we ship the 16 type/status themes that
  // DO translate cleanly.

  const PYRAMID_THEME_COUNT = PYRAMID_THEMES.length;

  function pyramidCurrentTheme(run) {
    if (!run) return PYRAMID_THEMES[0];
    const idx = ((run.pyramidThemeIndex | 0) % PYRAMID_THEME_COUNT + PYRAMID_THEME_COUNT) % PYRAMID_THEME_COUNT;
    return PYRAMID_THEMES[idx];
  }
  function pyramidNextTheme(run) {
    if (!run) return PYRAMID_THEMES[0];
    const idx = ((((run.pyramidThemeIndex | 0) + 1) % PYRAMID_THEME_COUNT) + PYRAMID_THEME_COUNT) % PYRAMID_THEME_COUNT;
    return PYRAMID_THEMES[idx];
  }

  // Canonical Pyramid loot. Mix of consumables (immediate effect when
  // taken) and held items (stored in the bag, applied to a team slot
  // later via the bag UI). Items crossed out by the user in the source
  // table are NOT listed here.
  //
  //   kind semantics:
  //     cure(status)       — immediate: clear the named status on one
  //                          slot that has it; shown as 🍒 consumable
  //     heal(ratio)        — immediate: raise hpRatio by ratio, cap 1.0
  //     heal_full_cure     — immediate: hpRatio=1, status=null
  //     revive(ratio)      — immediate: revives a fainted slot to ratio
  //     held               — stored in bag; held-item assignment to a
  //                          team slot happens via the bag UI (later).
  const PYRAMID_ITEMS = [
    { id: "cheriBerry",   label: "Cheri Berry",   kind: "cure", cure: "paralysis" },
    { id: "chestoBerry",   label: "Chesto Berry",  kind: "cure", cure: "sleep" },
    { id: "pechaBerry",   label: "Pecha Berry",   kind: "cure", cure: "poisoned" },
    { id: "rawstBerry",  label: "Rawst Berry",   kind: "cure", cure: "burn" },
    // aspearBerry (freeze) dropped — Pokechill doesn't actually apply a
    // freeze status in combat, so the cure has nothing to act on.
    { id: "persimBerry",   label: "Persim Berry",  kind: "cure", cure: "confused" },
    { id: "hyperPotion", label: "Hyper Potion",  kind: "heal", ratio: 0.6 },
    { id: "fullRestore",     label: "Full Restore",  kind: "heal_full_cure" },
    { id: "revive",       label: "Revive",        kind: "revive", ratio: 0.5 },
    { id: "maxRevive",   label: "Max Revive",    kind: "revive", ratio: 1.0 },
    // Held items — every entry exists in Pokechill's itemDictionary so
    // combat code actually reads + applies them. Items from the
    // canonical wiki list that aren't in Pokechill (Muscle Band, Wide
    // Lens, incense variants, etc.) were dropped per user rule "retire
    // les items hold qui servent à rien en combat". We top up the pool
    // with broadly-useful Gen 6+ holds that Pokechill does ship.
    { id: "choiceBand",       label: "Choice Band",      kind: "held" },
    { id: "choiceSpecs",    label: "Choice Specs",     kind: "held" },
    { id: "leftovers",            label: "Leftovers",        kind: "held" },
    { id: "quickClaw",       label: "Quick Claw",       kind: "held" },
    { id: "lifeOrb",          label: "Life Orb",         kind: "held" },
    { id: "assaultVest",   label: "Assault Vest",     kind: "held" },
    { id: "weaknessPolicy",   label: "Weakness Policy",  kind: "held" },
    { id: "loadedDice",         label: "Loaded Dice",      kind: "held" },
    { id: "eviolite",          label: "Eviolite",         kind: "held" },
    { id: "mentalHerb",      label: "Mental Herb",      kind: "held" },
    { id: "clearAmulet",   label: "Clear Amulet",     kind: "held" },
    { id: "heavyDutyBoots",    label: "Heavy-Duty Boots", kind: "held" },
  ];

  const PYRAMID_BAG_CAP = 10; // max 10 distinct item ids in the Combat Bag

  function pyramidItemDef(id) {
    return PYRAMID_ITEMS.find((it) => it.id === id) || null;
  }
  function pyramidItemLabel(id, lang) {
    const def = pyramidItemDef(id);
    if (!def) return id;
    return def.label;
  }
  function pyramidItemSprite(id) {
    // Pokechill doesn't store a `.sprite` field on its item entries —
    // tooltip.js:949 just uses `img/items/${id}.png` directly. Mirror
    // that convention: when the id exists in the game's registry we
    // know the PNG is present, so return the convention path. Custom
    // Pyramid-only items (berries, potions, revives) aren't in
    // `item[]` → return null and the bag UI falls back to the 📦
    // placeholder.
    if (typeof item === "undefined" || !item[id]) return null;
    return `img/items/${id}.png`;
  }

  function isPyramidFacility(facility) {
    return !!(facility && facility.rules && facility.rules.gridNav);
  }
  function isInPyramidRun() {
    if (typeof saved !== "object" || !saved) return false;
    if (!saved.frontierExt || !saved.frontierExt.activeRun) return false;
    const facility = FACILITIES.find((f) => f.id === saved.frontierExt.activeRun.facilityId);
    return isPyramidFacility(facility);
  }

  // ── Pixel-art tile SVGs ──────────────────────────────────────────────
  // All 16×16 viewBox, styled via CSS for size (pixelated rendering).
  const PYR_TILE_SVG = {
    floor: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="2" y="3" width="2" height="1" fill="#a98848"/><rect x="10" y="6" width="1" height="1" fill="#a98848"/><rect x="5" y="10" width="2" height="1" fill="#a98848"/><rect x="12" y="12" width="1" height="2" fill="#a98848"/><rect x="1" y="14" width="1" height="1" fill="#a98848"/></svg>`,
    wall: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#4a3520"/><rect x="0" y="0" width="16" height="1" fill="#6a4f30"/><rect x="0" y="4" width="16" height="1" fill="#2a1d10"/><rect x="5" y="1" width="1" height="3" fill="#2a1d10"/><rect x="11" y="1" width="1" height="3" fill="#2a1d10"/><rect x="0" y="8" width="16" height="1" fill="#2a1d10"/><rect x="2" y="5" width="1" height="3" fill="#2a1d10"/><rect x="8" y="5" width="1" height="3" fill="#2a1d10"/><rect x="14" y="5" width="1" height="3" fill="#2a1d10"/><rect x="0" y="12" width="16" height="1" fill="#2a1d10"/><rect x="5" y="9" width="1" height="3" fill="#2a1d10"/><rect x="11" y="9" width="1" height="3" fill="#2a1d10"/><rect x="2" y="13" width="1" height="3" fill="#2a1d10"/><rect x="8" y="13" width="1" height="3" fill="#2a1d10"/><rect x="14" y="13" width="1" height="3" fill="#2a1d10"/></svg>`,
    // Stairs tile rendered as a flat blue rectangle per user spec —
    // reads unambiguously as "exit / advance" without looking like a
    // decorative tile.
    stairs: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="2" y="4" width="12" height="8" fill="#3060c0" stroke="#2040a0" stroke-width="1"/></svg>`,
    question: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><text x="8" y="13" font-size="12" font-weight="bold" text-anchor="middle" fill="#5a3020" font-family="monospace">?</text></svg>`,
    heal: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="5" y="2" width="6" height="12" fill="#f86060"/><rect x="2" y="5" width="12" height="6" fill="#f86060"/><rect x="6" y="3" width="4" height="10" fill="#ff8080"/><rect x="3" y="6" width="10" height="4" fill="#ff8080"/></svg>`,
    cure: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><circle cx="8" cy="8" r="5" fill="#70e070"/><rect x="7" y="4" width="2" height="8" fill="#ffffff"/><rect x="4" y="7" width="8" height="2" fill="#ffffff"/></svg>`,
    trainer: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="6" y="2" width="4" height="3" fill="#2a1a0a"/><rect x="5" y="5" width="6" height="6" fill="#5080d0"/><rect x="4" y="11" width="3" height="3" fill="#2a1a0a"/><rect x="9" y="11" width="3" height="3" fill="#2a1a0a"/></svg>`,
    wild: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="4" y="4" width="2" height="2" fill="#5a8030"/><rect x="10" y="3" width="3" height="3" fill="#5a8030"/><rect x="7" y="8" width="2" height="2" fill="#5a8030"/><rect x="3" y="11" width="3" height="2" fill="#5a8030"/><rect x="11" y="12" width="2" height="2" fill="#5a8030"/></svg>`,
    // Item tile — small pouch / gift silhouette on the pyramid floor.
    item: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#c9a86a"/><rect x="5" y="6" width="6" height="7" fill="#d07030" stroke="#8a4018" stroke-width="1"/><rect x="4" y="5" width="8" height="2" fill="#e08040" stroke="#8a4018" stroke-width="1"/><rect x="7" y="5" width="2" height="8" fill="#ffd060"/><rect x="6" y="3" width="4" height="3" fill="#ffd060"/></svg>`,
    fog: `<svg viewBox="0 0 16 16" preserveAspectRatio="none"><rect width="16" height="16" fill="#2a1a14"/><rect x="3" y="3" width="2" height="2" fill="#3a2520" opacity="0.6"/><rect x="11" y="5" width="2" height="2" fill="#3a2520" opacity="0.6"/><rect x="7" y="9" width="2" height="2" fill="#3a2520" opacity="0.6"/></svg>` };
  // Explorer character — simple trainer silhouette with 2-frame walk.
  // The "walk" animation alternates two leg positions via CSS.
  const PYR_CHARACTER_SVG = `
<svg viewBox="0 0 16 20" preserveAspectRatio="xMidYMid meet" class="pyr-char">
  <!-- Hat -->
  <rect x="4" y="1" width="8" height="2" fill="#c04040"/>
  <rect x="3" y="3" width="10" height="1" fill="#c04040"/>
  <!-- Face -->
  <rect x="5" y="4" width="6" height="3" fill="#f0c898"/>
  <rect x="5" y="5" width="1" height="1" fill="#2a1a0a"/>
  <rect x="10" y="5" width="1" height="1" fill="#2a1a0a"/>
  <!-- Body (blue shirt) -->
  <rect x="4" y="7" width="8" height="5" fill="#4060c0"/>
  <rect x="4" y="7" width="8" height="1" fill="#6080e0"/>
  <!-- Arms -->
  <rect x="3" y="8" width="1" height="3" fill="#4060c0"/>
  <rect x="12" y="8" width="1" height="3" fill="#4060c0"/>
  <!-- Legs (base) -->
  <rect class="pyr-leg-l" x="5" y="12" width="2" height="5" fill="#303030"/>
  <rect class="pyr-leg-r" x="9" y="12" width="2" height="5" fill="#303030"/>
  <!-- Shoes -->
  <rect x="5" y="17" width="2" height="1" fill="#1a1a1a"/>
  <rect x="9" y="17" width="2" height="1" fill="#1a1a1a"/>
</svg>`.trim();

  // ── Floor generation ───────────────────────────────────────────────────
  // Random but guaranteed-solvable: start at (col ceil/2, row = SIZE-1),
  // stairs somewhere at row 0-1, with enough floor tiles to connect.
  // Walls clustered randomly; encounters + items sprinkled across empty
  // tiles. Player's tile is always floor/empty (no encounter on start).
  function generatePyramidFloor(facility, floorNum, isLastFloor) {
    const size = PYR_GRID_SIZE;
    const grid = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) row.push(PYR_TILES.EMPTY);
      grid.push(row);
    }

    // Random walls — ~18% of tiles. Never on start or stairs cells.
    const startX = Math.floor(size / 2);
    const startY = size - 1;
    let stairsX = Math.floor(Math.random() * size);
    let stairsY = 0;
    // Avoid a trivial collision (shouldn't happen but safe).
    if (stairsX === startX && stairsY === startY) stairsX = (stairsX + 1) % size;

    // Carve a GUARANTEED path from start → stairs BEFORE placing walls.
    // Without this, random wall placement can cluster into a diagonal
    // barrier (observed: walls at (1,4)(2,3)(3,2)(4,1) cut off top-left
    // stairs from bottom-center start). Random L-shape (vertical-first or
    // horizontal-first) keeps layout variety. Cells on this path are
    // tagged "protected" and skipped by the wall placer below.
    const protectedCells = new Set();
    const cellKey = (x, y) => y * size + x;
    {
      const vFirst = Math.random() < 0.5;
      let px = startX;
      let py = startY;
      protectedCells.add(cellKey(px, py));
      const stepToward = (from, to) => (from < to ? from + 1 : from - 1);
      if (vFirst) {
        while (py !== stairsY) { py = stepToward(py, stairsY); protectedCells.add(cellKey(px, py)); }
        while (px !== stairsX) { px = stepToward(px, stairsX); protectedCells.add(cellKey(px, py)); }
      } else {
        while (px !== stairsX) { px = stepToward(px, stairsX); protectedCells.add(cellKey(px, py)); }
        while (py !== stairsY) { py = stepToward(py, stairsY); protectedCells.add(cellKey(px, py)); }
      }
    }

    // Place walls
    const wallCount = Math.floor(size * size * 0.18);
    let placedWalls = 0, safety = 0;
    while (placedWalls < wallCount && safety < 50) {
      safety++;
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      if (x === startX && y === startY) continue;
      if (x === stairsX && y === stairsY) continue;
      if (protectedCells.has(cellKey(x, y))) continue; // keep the carved path open
      if (grid[y][x] !== PYR_TILES.EMPTY) continue;
      grid[y][x] = PYR_TILES.WALL;
      placedWalls++;
    }

    // Safety net: if the carve above somehow failed or a future change
    // skips it, BFS-verify reachability and break a wall if blocked.
    const isReachable = () => {
      const seen = new Set([cellKey(startX, startY)]);
      const queue = [[startX, startY]];
      while (queue.length) {
        const [cx, cy] = queue.shift();
        if (cx === stairsX && cy === stairsY) return true;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const k = cellKey(nx, ny);
          if (seen.has(k)) continue;
          if (grid[ny][nx] === PYR_TILES.WALL) continue;
          seen.add(k);
          queue.push([nx, ny]);
        }
      }
      return false;
    };
    let breakSafety = 0;
    while (!isReachable() && breakSafety < 30) {
      breakSafety++;
      // Find any wall and remove it; fall through until BFS succeeds.
      const walls = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (grid[y][x] === PYR_TILES.WALL) walls.push([x, y]);
        }
      }
      if (!walls.length) break;
      const [wx, wy] = walls[Math.floor(Math.random() * walls.length)];
      grid[wy][wx] = PYR_TILES.EMPTY;
    }

    // Place stairs (last floor stairs handled specially by runVictory).
    grid[stairsY][stairsX] = PYR_TILES.STAIRS;

    // Encounter + item distribution across remaining empty tiles.
    // Later floors get more trainer density and fewer heals.
    const difficulty = floorNum / 7;
    const emptyCells = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid[y][x] === PYR_TILES.EMPTY && !(x === startX && y === startY)) {
          emptyCells.push({ x, y });
        }
      }
    }
    // Shuffle
    emptyCells.sort(() => Math.random() - 0.5);

    // Distribution (of the empty-cell count) — canonical Pyramid has
    // trainers, wild Pokémon and items only. Healing comes exclusively
    // from items found during the run (stored in the Combat Bag). No
    // heal/cure tiles anymore.
    //   trainers : 28% → 42% (scales with floor)
    //   wild     : 18% → 22%
    //   items    : ~15%
    const trainerCount = Math.max(2, Math.floor(emptyCells.length * (0.28 + 0.14 * difficulty)));
    const wildCount = Math.max(1, Math.floor(emptyCells.length * (0.18 + 0.04 * difficulty)));
    const itemCount  = Math.max(1, Math.floor(emptyCells.length * 0.15));

    const assign = (type, count) => {
      for (let i = 0; i < count && emptyCells.length; i++) {
        const c = emptyCells.shift();
        grid[c.y][c.x] = type;
      }
    };
    assign(PYR_TILES.TRAINER, trainerCount);
    assign(PYR_TILES.WILD, wildCount);
    assign(PYR_TILES.ITEM, itemCount);

    return {
      grid,
      playerX: startX,
      playerY: startY,
      stairsX, stairsY,
      visited: { [startY * size + startX]: true }, // player's start tile
      revealed: { [startY * size + startX]: true },
      floor: floorNum,
      isLastFloor: !!isLastFloor };
  }

  // BFS check — is the stairs tile reachable from the player's current
  // position? Used as both a load-time migration guard (old saves with
  // unwinnable layouts) and a defense-in-depth against future generator
  // regressions.
  function pyramidFloorIsSolvable(state) {
    if (!state || !Array.isArray(state.grid)) return true;
    const size = state.grid.length;
    const sx = state.playerX, sy = state.playerY;
    const tx = state.stairsX, ty = state.stairsY;
    const seen = new Set([sy * size + sx]);
    const queue = [[sx, sy]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (cx === tx && cy === ty) return true;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const k = ny * size + nx;
        if (seen.has(k)) continue;
        if (state.grid[ny][nx] === PYR_TILES.WALL) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return false;
  }

  // Lazy init — called from start / advanceFloor / continue paths.
  // Also auto-heals unwinnable floors left over from older saves: if the
  // stairs are not reachable from the player's current tile, regenerate
  // the floor in place (keeping the floor number + isLastFloor flag).
  function ensurePyramidFloor(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return null;
    if (!run.pyramid) {
      const floor = 1;
      run.pyramid = generatePyramidFloor(facility, floor, floor === 7);
    } else if (!pyramidFloorIsSolvable(run.pyramid)) {
      const prevFloor = run.pyramid.floor || 1;
      const prevLast = !!run.pyramid.isLastFloor;
      run.pyramid = generatePyramidFloor(facility, prevFloor, prevLast);
    }
    return run.pyramid;
  }

  function setPyramidModalSizing(on) {
    const box = document.getElementById("tooltipBox");
    if (!box) return;
    if (on) box.classList.add("frontier-ext-pyramid-open");
    else box.classList.remove("frontier-ext-pyramid-open");
  }

  // ── UI: Floor map ───────────────────────────────────────────────────
  function openPyramidFloorMap(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    // Block map access if the tied team is no longer a legal 3. This
    // catches the "empty team dodges all combats to reach stairs × 7
    // and wins the round" cheese at its entry point.
    if (!canRunProceed(facility)) return;
    const state = ensurePyramidFloor(facility);
    if (!state) return;
    setPyramidModalSizing(true);
    const lang = "en";

    const t = {
          title: "Battle Pyramid",
          floor: "Floor",
          hpStatus: "Team status",
          hintStart: "Explore the floor — click an adjacent tile to move.",
          hintFinal: `Final floor — the ${"Zone Leader"} is waiting near the stairs.`,
          abandon: "Abandon" };

    const nextRound = run.round + 1;
    const bossInfo = getBossRoundInfo(nextRound, facility);
    const isBossFloor = state.floor === 7 && !!bossInfo;

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) top.style.display = "none";
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${t.title} — ${t.floor} ${state.floor}/7`;
    }

    // Build grid HTML
    const tileHtml = (x, y) => {
      const key = y * PYR_GRID_SIZE + x;
      const tile = state.grid[y][x];
      const isVisited = !!state.visited[key];
      const isRevealed = !!state.revealed[key];
      const isPlayer = x === state.playerX && y === state.playerY;
      const isAdjacent = Math.abs(x - state.playerX) + Math.abs(y - state.playerY) === 1;

      // Walls always visible; other tiles show their SVG only if revealed,
      // else show "?" (fog-of-contents). Stairs also always visible.
      let svg = PYR_TILE_SVG.fog;
      let cls = "pyr-tile";
      if (tile === PYR_TILES.WALL) {
        svg = PYR_TILE_SVG.wall; cls += " wall";
      } else if (tile === PYR_TILES.STAIRS) {
        svg = PYR_TILE_SVG.stairs; cls += " stairs";
      } else if (isRevealed || isVisited) {
        if (tile === PYR_TILES.EMPTY) { svg = PYR_TILE_SVG.floor; cls += " floor"; }
        else if (tile === PYR_TILES.TRAINER) { svg = PYR_TILE_SVG.trainer; cls += " trainer"; }
        else if (tile === PYR_TILES.WILD) { svg = PYR_TILE_SVG.wild; cls += " wild"; }
        else if (tile === PYR_TILES.ITEM) { svg = PYR_TILE_SVG.item; cls += " item"; }
        // Legacy tile SVGs for in-flight saves — rendered as plain floor
        // to avoid stale heal graphics on tiles that no longer heal.
        else if (tile === PYR_TILES.HEAL_FULL || tile === PYR_TILES.HEAL_PARTIAL
                 || tile === PYR_TILES.CURE_STATUS) { svg = PYR_TILE_SVG.floor; cls += " floor"; }
      } else {
        // Unrevealed non-wall: floor + ? overlay
        svg = PYR_TILE_SVG.question; cls += " unrevealed";
      }
      if (isAdjacent && tile !== PYR_TILES.WALL) cls += " clickable";
      if (isPlayer) cls += " player-here";
      const playerSprite = isPlayer ? `<div class="pyr-char-mount">${PYR_CHARACTER_SVG}</div>` : "";
      return `<div class="${cls}" data-x="${x}" data-y="${y}">${svg}${playerSprite}</div>`;
    };

    let gridHtml = '<div class="frontier-ext-pyr-grid" style="grid-template-columns: repeat(' + PYR_GRID_SIZE + ', 1fr);">';
    for (let y = 0; y < PYR_GRID_SIZE; y++) {
      for (let x = 0; x < PYR_GRID_SIZE; x++) gridHtml += tileHtml(x, y);
    }
    gridHtml += '</div>';

    // HP summary reused from Pike (persistHpStatus → runTeam shape identical).
    const hpSummary = renderFrontierTeamHpSummary();

    const hint = isBossFloor ? t.hintFinal : t.hintStart;
    const hintClass = isBossFloor ? "pyr-hint boss" : "pyr-hint";

    // Theme header + Combat Bag button. The Psychic NPC (next-theme
    // oracle) is NOT available mid-run — the canon has her visible
    // only at registration / between rounds, so we wire that into the
    // facility preview modal instead (see openFacilityPreview for the
    // Pyramid-specific augmentation). Mid-run the player sees only
    // the CURRENT theme label for reference.
    const currentTheme = pyramidCurrentTheme(run);
    const themeLabel = currentTheme.label;
    const themeHeaderTxt = `Current theme: <strong>${themeLabel}</strong>`;
    pyramidEnsureBag(run);
    const bagBtnLabel = `🎒 Bag (${pyramidBagCount(run)}/${run.combatBag.cap})`;

    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div class="frontier-ext-pyr-theme-bar">${themeHeaderTxt}</div>
        ${hpSummary}
        <div class="${hintClass}">${hint}</div>
        ${gridHtml}
        <div class="frontier-ext-pyr-side-actions">
          <button class="frontier-ext-action-btn" data-action="pyr-bag-open">${bagBtnLabel}</button>
        </div>
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
      `;
      mid.querySelectorAll(".pyr-tile.clickable").forEach((el) => {
        el.addEventListener("click", () => {
          const tx = parseInt(el.dataset.x, 10);
          const ty = parseInt(el.dataset.y, 10);
          pyramidMovePlayerTo(tx, ty, facility);
        });
      });
      mid.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (bottom) { bottom.style.display = "none"; bottom.innerHTML = ""; }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Generic HP summary — reuses the Pike team shape (pikeTeam). Shows
  // name + HP% + status pill for each slot. Pyramid uses the same
  // per-run team state via persistHpStatus.
  function renderFrontierTeamHpSummary() {
    const run = saved.frontierExt.activeRun;
    if (!run) return "";
    migratePikePyramidTeam();
    if (!run.pikeTeam) return "";
    const l = pikeL10n();
    const statusLabel = {
      poisoned: l.statusPoisoned, burn: l.statusBurn, paralysis: l.statusParalysis,
      sleep: l.statusSleep, freeze: l.statusFreeze };
    const cells = [];
    for (const sl of ["slot1", "slot2", "slot3"]) {
      const ps = run.pikeTeam[sl];
      if (!ps || !ps.pkmnId) continue;
      const ratio = (typeof ps.hpRatio === "number") ? ps.hpRatio : 1.0;
      const status = ps.status ? normalizePikePyramidStatus(ps.status) : null;
      const pct = Math.round(ratio * 100);
      const barWidth = Math.max(0, Math.min(100, pct));
      const cls = ratio <= 0 ? "low" : (ratio <= 0.25 ? "low" : (ratio <= 0.5 ? "mid" : ""));
      const monName = typeof format === "function" ? format(ps.pkmnId) : ps.pkmnId;
      const statusPill = status
        ? `<span class="st ${status}">${statusLabel[status] || status}</span>`
        : "";
      // Heal-flash glow: same flag as renderPikeHpSummary reads. Any
      // heal path (nurse, partial, tough-post-combat, Pyramid bag
      // item…) sets pikeTeam[sl].healJustApplied = true; the very
      // next HP render (this modal, the door picker, the floor map,
      // whichever renders first) lights that slot up with a pulse
      // and clears the flag so subsequent renders don't replay.
      const healFlash = ps.healJustApplied ? " heal-full-flash" : "";
      if (ps.healJustApplied) ps.healJustApplied = false;
      cells.push(`
        <span class="frontier-ext-pike-hp-pill ${cls}${healFlash}">
          ${monName}: ${ratio <= 0 ? "KO" : pct + "%"}
          <span class="bar"><span style="width:${barWidth}%"></span></span>
          ${statusPill}
        </span>
      `);
    }
    if (!cells.length) return "";
    return `<div class="frontier-ext-pike-hp-summary">${cells.join("")}</div>`;
  }

  // ── Movement + encounter resolution ────────────────────────────────
  function pyramidMovePlayerTo(tx, ty, facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !run.pyramid) return;
    // Re-validate the tied team on EVERY tile click — without this, a
    // map opened with 3 mons could continue to advance after the tied
    // team was emptied (external edit, pre-fix save). With the guard,
    // any move that would lead to a stairs-advance or combat is
    // blocked the moment the team falls below 3.
    if (!canRunProceed(facility)) return;
    const state = run.pyramid;
    // Must be adjacent + not a wall.
    const dx = Math.abs(tx - state.playerX);
    const dy = Math.abs(ty - state.playerY);
    if (dx + dy !== 1) return;
    if (state.grid[ty][tx] === PYR_TILES.WALL) return;

    // Move + mark revealed + visited.
    state.playerX = tx; state.playerY = ty;
    const key = ty * PYR_GRID_SIZE + tx;
    state.visited[key] = true;
    state.revealed[key] = true;
    // Reveal orthogonal neighbours (peek)
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([ddx, ddy]) => {
      const nx = tx + ddx, ny = ty + ddy;
      if (nx < 0 || nx >= PYR_GRID_SIZE || ny < 0 || ny >= PYR_GRID_SIZE) return;
      state.revealed[ny * PYR_GRID_SIZE + nx] = true;
    });

    // Resolve tile contents.
    pyramidResolveTile(facility);
  }

  function pyramidResolveTile(facility) {
    const run = saved.frontierExt.activeRun;
    const state = run.pyramid;
    const tile = state.grid[state.playerY][state.playerX];
    const key = state.playerY * PYR_GRID_SIZE + state.playerX;

    switch (tile) {
      case PYR_TILES.TRAINER: {
        // Canonical Gen 3 Pyramid: each trainer brings a SINGLE Pokémon.
        // Trainers DO NOT follow the theme (confirmed by user); only
        // wild tiles are theme-filtered. We generate normally then
        // slice the team down to one mon.
        state.grid[state.playerY][state.playerX] = PYR_TILES.EMPTY;
        const trainer = generateTrainer(run.round + 1, facility);
        trainer.team = (trainer.team || []).slice(0, 1);
        run.upcomingTrainer = trainer;
        run.pyramidEncounterKind = "trainer";
        launchCombat(facility);
        return;
      }
      case PYR_TILES.WILD: {
        // Single wild Pokémon, species pulled from the CURRENT THEME's
        // pool (not the facility-wide pool). Theme rotates every series.
        // Wild movesets are biased toward status moves — the Pyramid's
        // core design pressure is "chip the player's HP/status over 7
        // floors with no free heals", so wilds land a status hit as
        // often as possible.
        state.grid[state.playerY][state.playerX] = PYR_TILES.EMPTY;
        const theme = pyramidCurrentTheme(run);
        const id = theme.pool[Math.floor(Math.random() * theme.pool.length)];
        const diff = computeRunDifficulty(run.round + 1, facility);
        const moves = pickMovesetFor(id, diff);
        biasPyramidWildMoveset(id, moves, theme.key);
        const wildTrainer = {
          name: "Wild Pokémon",
          sprite: "hiker",
          team: [{ id, moves, nature: "" }],
          isWild: true,
          facilityId: facility.id,
          round: run.round + 1,
          tier: diff.tier,
          multiplier: diff.mult };
        run.upcomingTrainer = wildTrainer;
        run.pyramidEncounterKind = "wild";
        launchCombat(facility);
        return;
      }
      case PYR_TILES.ITEM: {
        // Roll a random loot item from the Pyramid item registry, show
        // the "Prendre" popup, and on confirm push into the Combat Bag
        // (respecting the 10-distinct-items cap).
        //
        // Held items DON'T stack (single copy owned at a time). If the
        // initial roll lands on a held item the player already has in
        // the bag, re-roll up to N times until we find something
        // fresh — better UX than showing a "Prendre" screen for an
        // item that would be silently abandoned on click. If every
        // re-roll collides (player already owns every held id the
        // pool can offer), fall back to a consumable.
        state.grid[state.playerY][state.playerX] = PYR_TILES.EMPTY;
        const bag = pyramidEnsureBag(run);
        const ownedHeld = new Set(
          bag.items
            .map((it) => it.id)
            .filter((id) => { const d = pyramidItemDef(id); return d && d.kind === "held"; })
        );
        const isDuplicateHeld = (def) => def.kind === "held" && ownedHeld.has(def.id);
        let pick = PYRAMID_ITEMS[Math.floor(Math.random() * PYRAMID_ITEMS.length)];
        let safety = 0;
        while (isDuplicateHeld(pick) && safety < 10) {
          pick = PYRAMID_ITEMS[Math.floor(Math.random() * PYRAMID_ITEMS.length)];
          safety++;
        }
        if (isDuplicateHeld(pick)) {
          const consumables = PYRAMID_ITEMS.filter((d) => d.kind !== "held");
          if (consumables.length) pick = consumables[Math.floor(Math.random() * consumables.length)];
        }
        showPyramidItemFoundModal(facility, pick);
        run.pyramidPendingAfterEvent = true;
        return;
      }
      // Legacy tile types (pre-rework saves). Consume silently + advance.
      case PYR_TILES.HEAL_FULL:
      case PYR_TILES.HEAL_PARTIAL:
      case PYR_TILES.CURE_STATUS: {
        state.grid[state.playerY][state.playerX] = PYR_TILES.EMPTY;
        openPyramidFloorMap(facility);
        return;
      }
      case PYR_TILES.STAIRS: {
        // Boss floor check — final floor of a boss round → brain fight
        // instead of free floor-advance.
        const bossInfo = getBossRoundInfo(run.round + 1, facility);
        if (state.floor === 7 && bossInfo) {
          // Fire brain combat.
          run.upcomingTrainer = null; // let launchCombat boss path generate
          run.pyramidEncounterKind = "brain";
          launchCombat(facility);
          return;
        }
        // Otherwise: advance floor (or round if floor 7).
        pyramidAdvanceFloor(facility);
        return;
      }
      case PYR_TILES.EMPTY:
      default:
        // No-op, re-render the map for the new position.
        openPyramidFloorMap(facility);
        return;
    }
  }

  // Advance to next floor (new random layout) or end the round if on 7.
  function pyramidAdvanceFloor(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !run.pyramid) return;
    // Final team-size guard right before any round-victory fires via
    // the non-combat path (stairs → floor 7 wrap). Without this an
    // emptied tied team could clear a round by dodging every trainer
    // tile and walking up stairs 7 times.
    if (!canRunProceed(facility)) return;
    const nextFloor = run.pyramid.floor + 1;
    if (nextFloor > 7) {
      // All 7 floors cleared — round complete. Set the flag that
      // onRunVictory's Pyramid branch reads to route to round-end.
      run.pyramidRoundComplete = true;
      onRunVictory();
      // We're not coming from a real combat here, so exit-redirect won't
      // fire — open the round-cleared modal ourselves.
      if (run.roundJustCleared) {
        showRoundClearedModal(facility);
      }
      return;
    }
    run.pyramid = generatePyramidFloor(facility, nextFloor, nextFloor === 7);
    openPyramidFloorMap(facility);
  }

  // Called after a non-combat event modal (item found / legacy heal).
  // Player clicks the "Prendre" / "Next" button → pike-next action
  // fires → we re-route back to the floor map.
  function pyramidAfterEvent(facility) {
    const run = saved.frontierExt.activeRun;
    if (run) run.pyramidPendingAfterEvent = false;
    openPyramidFloorMap(facility);
  }

  // ─── Pyramid Combat Bag ──────────────────────────────────────────────
  // Persistent per-run inventory, capped at PYRAMID_BAG_CAP distinct
  // item ids. Each entry carries a count so the cap limits variety, not
  // raw pile size — matches canonical Gen 3 Pyramid rules.
  function pyramidEnsureBag(run) {
    if (!run) return null;
    if (!run.combatBag || typeof run.combatBag !== "object") {
      run.combatBag = { items: [], cap: PYRAMID_BAG_CAP };
    }
    if (typeof run.combatBag.cap !== "number") run.combatBag.cap = PYRAMID_BAG_CAP;
    if (!Array.isArray(run.combatBag.items)) run.combatBag.items = [];
    return run.combatBag;
  }
  // Try to add one unit of `id` to the bag. Semantics differ by kind:
  //   • Consumables: stack freely (count increments).
  //   • Held items : do NOT stack — a duplicate pickup is refused
  //                  (returns false). The bag is a registry of owned
  //                  held types; a Pokémon can carry a held item
  //                  without removing it from the bag (bag = ownership
  //                  list, slot.item = active equipment).
  // Returns true if stored, false if either the bag is at distinct-id
  // capacity OR the incoming id is a held item the player already has.
  function pyramidAddToBag(run, id) {
    const bag = pyramidEnsureBag(run);
    const def = pyramidItemDef(id);
    const isHeld = def && def.kind === "held";
    const existing = bag.items.find((it) => it.id === id);
    if (existing) {
      if (isHeld) return false;            // held items can't stack
      existing.count = (existing.count || 1) + 1;
      return true;
    }
    if (bag.items.length >= bag.cap) return false;
    bag.items.push({ id, count: 1 });
    return true;
  }

  // Is this held item currently equipped on any team slot? Used to
  // annotate the bag UI and prevent double-equip of the same id.
  function pyramidEquippedSlot(run, id) {
    if (!run || !run.pikeTeam) return null;
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (run.pikeTeam[sl] && run.pikeTeam[sl].item === id) return sl;
    }
    return null;
  }
  // Distinct-id count — what the bag's cap actually limits. The UI
  // shows this number against PYRAMID_BAG_CAP so "Contenu : 8/10"
  // reflects the rule "ne peut contenir que 10 objets différents".
  function pyramidBagCount(run) {
    const bag = pyramidEnsureBag(run);
    return bag.items.length;
  }
  // Total-unit count (sum of stacks). Only used when we actually want
  // the number of physical items the player is carrying.
  function pyramidBagTotalUnits(run) {
    const bag = pyramidEnsureBag(run);
    return bag.items.reduce((n, it) => n + (it.count || 0), 0);
  }

  // Status moves the wild Pyramid Pokémon prefer — all verified present
  // in Pokechill's moveDictionary. Ordered by general nastiness; the
  // bias fn picks one the species can actually learn, falling back to
  // the first movepool-compatible option.
  // Status moves the bias can inject. Kept to moves with BROAD canonical
  // distribution (type-learn makes sense thematically) and capped at
  // moderate power/accuracy — no 100%-sleep ordeals. Spore (Parasect-
  // exclusive in canon) and lovelyKiss (Jynx-exclusive) used to be in
  // this list; they were pulled because Pokechill's type-based moveset
  // model lets every grass/normal mon inherit them, which produced
  // Rafflesia-with-Spore and similar oddities. StunSpore / sleepPowder
  // are the expected grass-type options.
  const PYRAMID_WILD_STATUS_MOVES = [
    "willOWisp",    // burn (fire / ghost)
    "thunderWave",  // paralysis (electric / psychic / ghost / fairy)
    "stunSpore",    // paralysis (grass)
    "toxic",        // bad poison (poison / all)
    "poisonPowder", // plain poison (grass)
    "confuseRay",   // confusion (ghost / psychic / all)
    "swagger",      // attack boost + confusion (all)
    // `glare` (canonical paralysis for snake-line mons) dropped: not
    // declared in Pokechill's moveDictionary. Any bias entry here MUST
    // exist upstream, otherwise slot-1 inherits a ghost move key that
    // renders blank in combat.
  ];

  // Per-theme preferred status-move pool. When the current Pyramid
  // theme calls for a specific status (Paralysis / Poison / Burn),
  // the bias narrows to just moves that INFLICT that status so the
  // floor's flavour actually delivers. Non-status themes (Ice / Psy /
  // Rock / …) fall back to the full PYRAMID_WILD_STATUS_MOVES pool,
  // since the theme is about species typing, not a specific ailment.
  const PYRAMID_THEME_PREFERRED_STATUS_MOVES = {
    paralysis: ["thunderWave", "stunSpore"],
    poison:    ["toxic", "poisonPowder"],
    burn:      ["willOWisp"] };

  // Inject a status move into slot1 of a wild's moveset IF the species
  // can actually learn it. Pokechill doesn't store a per-species
  // movepool — instead each move[id] declares a `moveset: [types…]`
  // list of types that can learn it. A species can learn the move iff
  // one of its types appears in that list.
  //
  // When `themeKey` matches a status theme (paralysis / poison / burn),
  // candidates are narrowed to moves of that status first — so a wild
  // Rafflesia on the "Paralysie" floor rolls stunSpore, not toxic.
  // If the species can't learn any of the theme-preferred moves, we
  // fall back to the full pool so there's SOMETHING to annoy with.
  function biasPyramidWildMoveset(speciesId, moveset, themeKey) {
    if (!Array.isArray(moveset) || !speciesId) return;
    if (typeof pkmn === "undefined" || !pkmn[speciesId]) return;
    if (typeof move === "undefined") return;
    const p = pkmn[speciesId];
    const types = (Array.isArray(p.type) ? p.type : [p.type]).filter(Boolean);
    const canLearn = (mvKey) => {
      const def = move[mvKey];
      if (!def || !Array.isArray(def.moveset)) return false;
      // Pokechill's pickMovesetFor treats "all" AND "normal" as
      // universal-learn markers (line 1313-1314). Mirror both here so
      // this bias accepts the same move set the main generator does
      // — without the two gates, Butterfree on Poison theme couldn't
      // roll Toxic (moveset ["poison", "all"]) and the bias silently
      // failed.
      if (def.moveset.includes("all")) return true;
      if (def.moveset.includes("normal")) return true;
      return types.some((t) => def.moveset.includes(t));
    };
    const preferred = themeKey && PYRAMID_THEME_PREFERRED_STATUS_MOVES[themeKey];
    let candidates = preferred ? preferred.filter(canLearn) : [];
    if (!candidates.length) candidates = PYRAMID_WILD_STATUS_MOVES.filter(canLearn);
    if (!candidates.length) return;
    // Skip if the rolled moveset already carries one of them.
    for (const mv of moveset) if (candidates.includes(mv)) return;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    // Overwrite slot1 (highest-priority AI choice in Pokechill's pick
    // order) so the wild opens with the annoyance.
    moveset[0] = chosen;
  }

  // Canonical Pyramid: no held items allowed at registration. Instead
  // of silently stripping (previous behaviour), we surface a hard error
  // to the player so they know they need to unequip manually — matches
  // the Emerald reception NPC wording "vos Pokémon ne doivent pas tenir
  // d'objets à l'inscription."
  function currentPreviewHasHeldItems() {
    const pt = (saved && saved.previewTeams && saved.previewTeams[saved.currentPreviewTeam]) || {};
    // Pyramid-equipped items are mirrored into the preview (so the
    // locked team-menu UI actually shows the icons), so they'd trip
    // this check at between-round Continue. Exempt any item that
    // matches the active run's pikeTeam equipment for that slot.
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    const pikeByslot = (run && run.pikeTeam) ? run.pikeTeam : null;
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (!pt[sl] || !pt[sl].pkmn || !pt[sl].item) continue;
      const pyramidItem = pikeByslot && pikeByslot[sl] ? pikeByslot[sl].item : null;
      if (pyramidItem && pt[sl].item === pyramidItem) continue; // our own mirror
      return true;
    }
    return false;
  }

  // Mirror (or clear) a Pyramid equipped item into the tied preview
  // team's slot. `itemId` null clears the slot. Called by the equip
  // flow so the locked team-menu UI actually shows the held-item icon
  // (it reads from saved.previewTeams). The mirror is transient —
  // cleanupPyramidPreviewItems wipes it when the run ends.
  function mirrorPyramidItemToPreview(slotKey, itemId) {
    try {
      const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
      if (!run) return;
      const slot = run.tiedPreviewSlot || saved.currentPreviewTeam;
      const pt = saved.previewTeams && saved.previewTeams[slot];
      if (!pt || !pt[slotKey]) return;
      pt[slotKey].item = itemId || undefined;
    } catch (e) { /* ignore */ }
  }
  // Run-end cleanup: clear every preview slot's item where the value
  // matches what the pyramid had equipped. Keeps any legitimate
  // pre-existing items untouched (shouldn't exist per the entry block,
  // but belt + braces).
  function cleanupPyramidPreviewItems(run) {
    try {
      if (!run) return;
      const slot = run.tiedPreviewSlot;
      const pt = saved && saved.previewTeams && saved.previewTeams[slot];
      if (!pt || !run.pikeTeam) return;
      for (const sl of ["slot1", "slot2", "slot3"]) {
        const eq = run.pikeTeam[sl] && run.pikeTeam[sl].item;
        if (eq && pt[sl] && pt[sl].item === eq) pt[sl].item = undefined;
      }
    } catch (e) { /* ignore */ }
  }
  function showPyramidItemsError(facility) {
    const lang = "en";
    const t = { title: "Registration refused",
          body: "None of your Pokémon may hold an item when entering the Pyramid. Unequip all items and try again.",
          back: "OK" };
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    if (top) top.style.display = "none";
    if (titleEl) { titleEl.style.display = "block"; titleEl.innerHTML = t.title; }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `<div class="frontier-ext-pyr-items-error">⚠️ ${t.body}</div>`;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="pyr-items-error-close">${t.back}</button>
        </div>`;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => openFacilityPreview(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Apply an item's immediate effect. Held items are no-ops here — they
  // just sit in the bag. Returns { applied: bool, slot: "slot1|2|3|null",
  // message: string } so the caller can surface context to the UI.
  function applyPyramidItemEffect(run, id) {
    const def = pyramidItemDef(id);
    if (!def || !run || !run.pikeTeam) return { applied: false };
    const lang = "en";
    const slots = ["slot1", "slot2", "slot3"];
    const alive = slots.filter((sl) => {
      const ps = run.pikeTeam[sl];
      return ps && (ps.hpRatio || 0) > 0;
    });
    const fainted = slots.filter((sl) => {
      const ps = run.pikeTeam[sl];
      return ps && (ps.hpRatio || 0) <= 0;
    });

    if (def.kind === "cure") {
      // Find the first alive slot that carries the matching status.
      const target = alive.find((sl) => run.pikeTeam[sl].status === def.cure);
      if (!target) {
        return { applied: false, slot: null,
          message: "No Pokémon has that status — stored." };
      }
      run.pikeTeam[target].status = null;
      return { applied: true, slot: target,
        message: "Status cured." };
    }
    if (def.kind === "heal") {
      const target = alive
        .slice()
        .sort((a, b) => (run.pikeTeam[a].hpRatio || 0) - (run.pikeTeam[b].hpRatio || 0))[0];
      if (!target) return { applied: false, slot: null,
        message: "Nobody to heal — stored." };
      const ps = run.pikeTeam[target];
      if ((ps.hpRatio || 0) >= 1) return { applied: false, slot: null,
        message: "Team at full HP — stored." };
      ps.hpRatio = Math.min(1.0, (ps.hpRatio || 0) + (def.ratio || 0.5));
      return { applied: true, slot: target,
        message: "HP restored." };
    }
    if (def.kind === "heal_full_cure") {
      // Full heal + status cure on the weakest-% alive slot.
      const target = alive
        .slice()
        .sort((a, b) => (run.pikeTeam[a].hpRatio || 0) - (run.pikeTeam[b].hpRatio || 0))[0];
      if (!target) return { applied: false, slot: null,
        message: "Nobody to heal — stored." };
      run.pikeTeam[target].hpRatio = 1.0;
      run.pikeTeam[target].status = null;
      return { applied: true, slot: target,
        message: "Fully restored." };
    }
    if (def.kind === "revive") {
      const target = fainted[0];
      if (!target) return { applied: false, slot: null,
        message: "Nobody to revive — stored." };
      run.pikeTeam[target].hpRatio = Math.max(0, Math.min(1, def.ratio || 0.5));
      run.pikeTeam[target].status = null;
      return { applied: true, slot: target,
        message: "Pokémon revived." };
    }
    // Held items: no immediate effect.
    return { applied: true, slot: null,
      message: "Stored in the Combat Bag." };
  }

  // Item-found modal. Shows the item (label + optional sprite) and a
  // single "Prendre" button. Taking the item: push to bag + apply effect
  // if consumable + show a brief flash of the result. Non-takable (bag
  // full): the button becomes "Laisser" and the item is abandoned.
  function showPyramidItemFoundModal(facility, itemPick) {
    const lang = "en";
    const run = saved.frontierExt.activeRun;
    pyramidEnsureBag(run);
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const facName = facility.name;
    const label = pyramidItemLabel(itemPick.id, lang);
    const spritePath = pyramidItemSprite(itemPick.id);
    const bagFull = run.combatBag.items.length >= run.combatBag.cap
      && !run.combatBag.items.some((it) => it.id === itemPick.id);

    const t = {
          title: `${facName} — Floor ${run.pyramid.floor}/7`,
          headline: "You found an item!",
          take: "Take",
          leave: "Leave",
          bagFull: "Bag full — can't take this new item.",
          bagCount: (n, cap) => `Bag: ${n}/${cap}` };

    if (top) top.style.display = "none";
    if (titleEl) {
      titleEl.style.display = "block";
      titleEl.innerHTML = t.title;
    }
    if (mid) {
      mid.style.display = "block";
      const spriteHtml = spritePath
        ? `<img src="${spritePath}" alt="${label}" style="width:48px;height:48px;image-rendering:pixelated;">`
        : `<div class="frontier-ext-pyr-item-placeholder">📦</div>`;
      mid.innerHTML = `
        <div class="frontier-ext-pyr-item-found">
          <div class="headline">${t.headline}</div>
          <div class="icon">${spriteHtml}</div>
          <div class="label">${label}</div>
          <div class="bag-count">${t.bagCount(pyramidBagCount(run), run.combatBag.cap)}</div>
          ${bagFull ? `<div class="bag-full">${t.bagFull}</div>` : ""}
        </div>`;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="pyr-take-item" data-item-id="${itemPick.id}">
            ${bagFull ? `✗ ${t.leave}` : `✓ ${t.take}`}
          </button>
        </div>`;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Commit the find: push to bag (ALL items — consumables and held
  // alike — go straight into the Combat Bag). No auto-apply: the
  // player opens the bag later to use a consumable on a specific
  // Pokémon, which matches canonical Gen 3 Pyramid bag semantics.
  //
  // If the bag is already full of distinct ids AND the incoming item
  // is a new one, we open a "bag full — choose one to drop" picker
  // instead of silently trashing the pickup.
  function takePyramidItem(facility, itemId) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const def = pyramidItemDef(itemId);
    if (!def) { pyramidAfterEvent(facility); return; }
    const bag = pyramidEnsureBag(run);
    const alreadyIn = !!bag.items.find((it) => it.id === itemId);
    // Held items don't stack — a duplicate pickup is simply abandoned
    // (the player already owns one and can't acquire a second copy).
    if (alreadyIn && def.kind === "held") {
      pyramidAfterEvent(facility);
      return;
    }
    if (!alreadyIn && bag.items.length >= bag.cap) {
      showPyramidBagFullPicker(facility, itemId);
      return;
    }
    pyramidAddToBag(run, itemId);
    pyramidAfterEvent(facility);
  }

  // Shown when the player picks up a NEW item id while the bag holds
  // PYRAMID_BAG_CAP distinct ids. Lists every existing bag entry as a
  // "drop" button; clicking drops ALL units of that id and inserts the
  // new find. A "Jeter le nouvel objet" action lets the player keep
  // the bag as-is and abandon the find.
  function showPyramidBagFullPicker(facility, newItemId) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const def = pyramidItemDef(newItemId);
    if (!def) { pyramidAfterEvent(facility); return; }
    pyramidEnsureBag(run);
    const lang = "en";
    const newLabel = def.label;
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const t = { title: "Bag full — what to drop?",
          body: (n) => `You found <strong>${n}</strong>, but your Bag is full. Pick an item to drop and replace, or abandon the find.`,
          drop: "Drop",
          abandon: "Abandon the new item" };

    if (top) top.style.display = "none";
    if (titleEl) { titleEl.style.display = "block"; titleEl.innerHTML = t.title; }
    if (mid) {
      mid.style.display = "block";
      const rows = run.combatBag.items.map((it) => {
        const idef = pyramidItemDef(it.id);
        const label = idef ? (idef.label) : it.id;
        const sprite = pyramidItemSprite(it.id);
        const icon = sprite
          ? `<img src="${sprite}" alt="${label}" style="width:20px;height:20px;image-rendering:pixelated;vertical-align:middle;">`
          : `<span class="frontier-ext-pyr-bag-icon">📦</span>`;
        return `
          <li class="frontier-ext-pyr-bag-row">
            <span class="icon">${icon}</span>
            <span class="label">${label}</span>
            <span class="count">×${it.count}</span>
            <button class="frontier-ext-action-btn small danger" data-pyr-drop="${it.id}">${t.drop}</button>
          </li>`;
      }).join("");
      mid.innerHTML = `
        <div class="frontier-ext-pyr-bag">
          <div class="cap">${t.body(newLabel)}</div>
          <ul class="frontier-ext-pyr-bag-list">${rows}</ul>
        </div>`;
      mid.querySelectorAll("[data-pyr-drop]").forEach((btn) => {
        btn.onclick = () => {
          const dropId = btn.dataset.pyrDrop;
          // Drop the ENTIRE stack of the chosen id. Previously we
          // decremented by 1, but that left stacked consumables
          // (e.g. 2× Baie Ceriz) behind after click → bag still full
          // → picker re-opens and the player has to click again.
          // Per user rule: one click frees the slot immediately.
          run.combatBag.items = run.combatBag.items.filter((it) => it.id !== dropId);
          pyramidAddToBag(run, newItemId);
          pyramidAfterEvent(facility);
        };
      });
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn" data-pyr-drop-new="1">${t.abandon}</button>
        </div>`;
      bottom.querySelectorAll("[data-pyr-drop-new]").forEach((btn) => {
        btn.onclick = () => pyramidAfterEvent(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Remove one unit of `id` from the bag. If the entry's count drops
  // to 0, the entry itself is removed (freeing a slot under the cap).
  function pyramidConsumeFromBag(run, id) {
    const bag = pyramidEnsureBag(run);
    const entry = bag.items.find((it) => it.id === id);
    if (!entry) return false;
    entry.count = (entry.count || 1) - 1;
    if (entry.count <= 0) bag.items = bag.items.filter((it) => it !== entry);
    return true;
  }

  // Apply a consumable effect to a SPECIFIC slot (user-picked from the
  // bag UI). Returns true if the effect took (bag unit consumed), false
  // if the target is invalid for the item (e.g. revive on an alive mon).
  function applyPyramidItemEffectTo(run, id, slotKey) {
    const def = pyramidItemDef(id);
    if (!def || !run || !run.pikeTeam) return false;
    const ps = run.pikeTeam[slotKey];
    if (!ps || !ps.pkmnId) return false;

    if (def.kind === "cure") {
      if (ps.status !== def.cure) return false;
      ps.status = null;
      ps.healJustApplied = true; // glow flag
      return true;
    }
    if (def.kind === "heal") {
      if ((ps.hpRatio || 0) <= 0) return false;           // fainted — need revive
      if ((ps.hpRatio || 0) >= 1) return false;           // already full
      ps.hpRatio = Math.min(1.0, (ps.hpRatio || 0) + (def.ratio || 0.5));
      ps.healJustApplied = true; // glow flag
      return true;
    }
    if (def.kind === "heal_full_cure") {
      if ((ps.hpRatio || 0) <= 0) return false;               // fainted — use revive
      if ((ps.hpRatio || 0) >= 1 && !ps.status) return false; // nothing to fix
      ps.hpRatio = 1.0;
      ps.status = null;
      ps.healJustApplied = true; // glow flag
      return true;
    }
    if (def.kind === "revive") {
      if ((ps.hpRatio || 0) > 0) return false;
      ps.hpRatio = Math.max(0, Math.min(1, def.ratio || 0.5));
      ps.status = null;
      ps.healJustApplied = true; // glow flag
      return true;
    }
    // Held items: not usable from the bag — must be equipped via the
    // (future) equip UI. Returning false here leaves the item in place.
    return false;
  }

  // Psychic NPC dialog — reveals the NEXT theme name so the player can
  // plan before committing to the next round. One-click info modal,
  // closes back to whatever preview was underneath.
  function showPyramidKinesisteDialog(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const lang = "en";
    const next = pyramidNextTheme(run);
    const curr = pyramidCurrentTheme(run);
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const facName = facility.name;
    const t = {
          title: `${facName} — Psychic`,
          intro: "\"I can sense the waves of your next trial…\"",
          currentLabel: "Current theme:",
          nextLabel: "Next theme:",
          back: "Back" };

    if (top) top.style.display = "none";
    if (titleEl) {
      titleEl.style.display = "block";
      titleEl.innerHTML = t.title;
    }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div class="frontier-ext-pyr-kinesiste">
          <div class="intro">${t.intro}</div>
          <div class="theme-line">
            <span class="lbl">${t.currentLabel}</span>
            <span class="val">${curr.label}</span>
          </div>
          <div class="theme-line next">
            <span class="lbl">${t.nextLabel}</span>
            <span class="val">${next.label}</span>
          </div>
        </div>`;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn" data-action="pyr-kinesiste-close">${t.back}</button>
        </div>`;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => openPyramidFloorMap(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Combat Bag viewer — each row shows item + count + (for consumables)
  // a "Utiliser" button that opens a Pokémon-target picker. Held items
  // are greyed out with a "tenu" placeholder until the equip UI ships.
  function showPyramidBagDialog(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    pyramidEnsureBag(run);
    const lang = "en";
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const facName = facility.name;
    const t = { title: `${facName} — Combat Bag`,
          empty: "Your bag is empty.",
          cap: (n, c) => `Contents: ${n}/${c}`,
          back: "Back",
          use: "Use",
          held: "Equip" };

    if (top) top.style.display = "none";
    if (titleEl) {
      titleEl.style.display = "block";
      titleEl.innerHTML = t.title;
    }
    if (mid) {
      mid.style.display = "block";
      const items = run.combatBag.items;
      const rows = items.length
        ? items.map((it) => {
            const def = pyramidItemDef(it.id);
            const label = def ? (def.label) : it.id;
            const sprite = pyramidItemSprite(it.id);
            const icon = sprite
              ? `<img src="${sprite}" alt="${label}" style="width:24px;height:24px;image-rendering:pixelated;vertical-align:middle;">`
              : `<span class="frontier-ext-pyr-bag-icon">📦</span>`;
            const equippedOn = (def && def.kind === "held") ? pyramidEquippedSlot(run, it.id) : null;
            const actionBtn = (def && def.kind === "held")
              ? `<button class="frontier-ext-action-btn small" data-pyr-equip="${it.id}">${t.held}</button>`
              : `<button class="frontier-ext-action-btn small" data-pyr-use="${it.id}">${t.use}</button>`;
            const equippedBadge = equippedOn
              ? `<span class="held-equipped-badge">★</span>`
              : "";
            return `<li class="frontier-ext-pyr-bag-row"><span class="icon">${icon}${equippedBadge}</span><span class="label">${label}</span><span class="count">×${it.count}</span>${actionBtn}</li>`;
          }).join("")
        : `<li class="frontier-ext-pyr-bag-row empty">${t.empty}</li>`;
      mid.innerHTML = `
        <div class="frontier-ext-pyr-bag">
          <div class="cap">${t.cap(pyramidBagCount(run), run.combatBag.cap)}</div>
          <ul class="frontier-ext-pyr-bag-list">${rows}</ul>
        </div>`;
      mid.querySelectorAll("[data-pyr-use]").forEach((btn) => {
        btn.onclick = () => showPyramidUseTargetPicker(facility, btn.dataset.pyrUse);
      });
      mid.querySelectorAll("[data-pyr-equip]").forEach((btn) => {
        btn.onclick = () => showPyramidEquipPicker(facility, btn.dataset.pyrEquip);
      });
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn" data-action="pyr-bag-close">${t.back}</button>
        </div>`;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => openPyramidFloorMap(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Pick a team slot as the target for a consumable item. Each slot is
  // a clickable card showing HP% + current status. Only slots for which
  // the effect is applicable stay enabled (e.g. revive → fainted only,
  // heal → alive + not full, cure → has matching status).
  function showPyramidUseTargetPicker(facility, itemId) {
    const run = saved.frontierExt.activeRun;
    if (!run || !run.pikeTeam) return;
    const def = pyramidItemDef(itemId);
    if (!def) { showPyramidBagDialog(facility); return; }
    const lang = "en";
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const itemLabel = def.label;
    const t = { title: `Use ${itemLabel} on…`,
          back: "Cancel",
          invalid: "not applicable",
          noTarget: "No valid target for this item." };

    const isValidFor = (sl) => {
      const ps = run.pikeTeam[sl];
      if (!ps || !ps.pkmnId) return false;
      if (def.kind === "cure")         return ps.status === def.cure;
      if (def.kind === "heal")         return (ps.hpRatio || 0) > 0 && (ps.hpRatio || 0) < 1;
      if (def.kind === "heal_full_cure") return (ps.hpRatio || 0) > 0 && ((ps.hpRatio || 0) < 1 || !!ps.status);
      if (def.kind === "revive")       return (ps.hpRatio || 0) <= 0;
      return false;
    };

    if (title) { title.style.display = "block"; title.innerHTML = t.title; }
    if (mid) {
      mid.style.display = "block";
      const statusLabel = {
        poisoned: "Poisoned",
        burn:     "Burned",
        paralysis:"Paralyzed",
        sleep:    "Asleep",
        freeze:   "Frozen",
        confused: "Confused" };
      const anyValid = ["slot1", "slot2", "slot3"].some(isValidFor);
      const cards = ["slot1", "slot2", "slot3"].map((sl) => {
        const ps = run.pikeTeam[sl];
        if (!ps || !ps.pkmnId) return "";
        const monName = typeof format === "function" ? format(ps.pkmnId) : ps.pkmnId;
        const pct = Math.round((ps.hpRatio || 0) * 100);
        const statusPill = ps.status ? `<span class="status">${statusLabel[ps.status] || ps.status}</span>` : "";
        const valid = isValidFor(sl);
        return `
          <button class="frontier-ext-pyr-target-card ${valid ? "" : "invalid"}"
                  data-pyr-use-target="${sl}" ${valid ? "" : "disabled"}>
            <div class="name">${monName}</div>
            <div class="hp">${(ps.hpRatio || 0) <= 0 ? "K.O." : `${pct}%`}</div>
            ${statusPill}
            ${valid ? "" : `<div class="invalid-label">(${t.invalid})</div>`}
          </button>`;
      }).join("");
      mid.innerHTML = `
        <div class="frontier-ext-pyr-use-picker">
          ${cards}
          ${!anyValid ? `<div class="no-target">${t.noTarget}</div>` : ""}
        </div>`;
      mid.querySelectorAll("[data-pyr-use-target]").forEach((card) => {
        card.onclick = () => {
          const slot = card.dataset.pyrUseTarget;
          const ok = applyPyramidItemEffectTo(run, itemId, slot);
          if (ok) pyramidConsumeFromBag(run, itemId);
          showPyramidBagDialog(facility);
        };
      });
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn" data-pyr-use-cancel="1">${t.back}</button>
        </div>`;
      bottom.querySelectorAll("[data-pyr-use-cancel]").forEach((btn) => {
        btn.onclick = () => showPyramidBagDialog(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Equip picker for held items. Three slot cards showing the current
  // equipment (or "libre"). Clicking a slot moves the new held item
  // onto it; if the slot already had an item, that old item is pushed
  // back into the bag (can fail if the bag is full of distinct ids
  // AND the returned id isn't already there — guarded + error toast).
  function showPyramidEquipPicker(facility, itemId) {
    const run = saved.frontierExt.activeRun;
    if (!run || !run.pikeTeam) return;
    const def = pyramidItemDef(itemId);
    if (!def || def.kind !== "held") { showPyramidBagDialog(facility); return; }
    const lang = "en";
    const itemLabel = def.label;
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    const t = { title: `Equip ${itemLabel} on…`,
          back: "Cancel",
          free: "Empty",
          here: "equipped here",
          unequipBtn: "Unequip" };

    const currentlyOn = pyramidEquippedSlot(run, itemId);

    if (titleEl) { titleEl.style.display = "block"; titleEl.innerHTML = t.title; }
    if (mid) {
      mid.style.display = "block";
      const cards = ["slot1", "slot2", "slot3"].map((sl) => {
        const ps = run.pikeTeam[sl];
        if (!ps || !ps.pkmnId) return "";
        const monName = typeof format === "function" ? format(ps.pkmnId) : ps.pkmnId;
        const curItemId = ps.item || null;
        const curDef = curItemId ? pyramidItemDef(curItemId) : null;
        const curLabel = curDef ? (curDef.label) : (curItemId || t.free);
        const isHere = currentlyOn === sl;
        return `
          <button class="frontier-ext-pyr-target-card ${isHere ? "equipped-here" : ""}" data-pyr-equip-target="${sl}">
            <div class="name">${monName}</div>
            <div class="equipped">${curItemId ? curLabel : `<em>${t.free}</em>`}</div>
            ${isHere ? `<div class="here-pill">✓ ${t.here}</div>` : ""}
          </button>`;
      }).join("");
      // Add an "unequip" action when this item is already worn on a slot.
      const unequipBtnHtml = currentlyOn
        ? `<button class="frontier-ext-action-btn small danger" data-pyr-equip-unequip="1">${t.unequipBtn}</button>`
        : "";
      mid.innerHTML = `
        <div class="frontier-ext-pyr-use-picker">${cards}</div>
        ${unequipBtnHtml ? `<div class="frontier-ext-pyr-side-actions">${unequipBtnHtml}</div>` : ""}`;
      mid.querySelectorAll("[data-pyr-equip-target]").forEach((card) => {
        card.onclick = () => {
          const slot = card.dataset.pyrEquipTarget;
          pyramidEquipToSlot(run, slot, itemId);
          showPyramidBagDialog(facility);
        };
      });
      mid.querySelectorAll("[data-pyr-equip-unequip]").forEach((btn) => {
        btn.onclick = () => {
          if (currentlyOn) {
            run.pikeTeam[currentlyOn].item = null;
            mirrorPyramidItemToPreview(currentlyOn, null);
          }
          showPyramidBagDialog(facility);
        };
      });
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn" data-pyr-equip-cancel="1">${t.back}</button>
        </div>`;
      bottom.querySelectorAll("[data-pyr-equip-cancel]").forEach((btn) => {
        btn.onclick = () => showPyramidBagDialog(facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Assign the held `itemId` to pikeTeam[slotKey].item.
  //   • If the item was already worn on another slot, MOVE it (single
  //     copy, single active slot).
  //   • Target slot's previous item (if any) is simply unequipped —
  //     held items always live in the bag, so nothing is discarded
  //     and nothing is refunded. The only time a held item leaves
  //     the bag is the bag-full drop picker (player-driven choice).
  //   • Equipping doesn't consume the bag entry for the new item
  //     itself (held = owned, bag always shows it).
  // Always succeeds. Returns true.
  function pyramidEquipToSlot(run, slotKey, itemId) {
    if (!run || !run.pikeTeam || !run.pikeTeam[slotKey]) return false;
    const previouslyOn = pyramidEquippedSlot(run, itemId);
    if (previouslyOn && previouslyOn !== slotKey) {
      run.pikeTeam[previouslyOn].item = null;
      mirrorPyramidItemToPreview(previouslyOn, null);
    }
    run.pikeTeam[slotKey].item = itemId;
    mirrorPyramidItemToPreview(slotKey, itemId);
    return true;
  }

  // One-shot toast flash inside the current tooltip — lives 2s then
  // the caller re-renders whatever was underneath. Used for equip
  // failure feedback so the player gets a readable reason without
  // a separate modal transition.
  function flashPyramidBagToast(message) {
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    if (!mid) return;
    const toast = document.createElement("div");
    toast.className = "frontier-ext-pyr-toast";
    toast.textContent = message;
    mid.appendChild(toast);
    setTimeout(() => { try { toast.remove(); } catch (e) {} }, 2000);
  }

  // Apply pikeTeam[slot].item onto the live team[slot].item right after
  // injectPreviewTeam copies the preview team over. The preview has no
  // items (we block held items at registration), so this is the only
  // way Pyramid-equipped gear reaches combat.
  function installPyramidEquipSync() {
    if (typeof window.injectPreviewTeam !== "function") {
      setTimeout(installPyramidEquipSync, 200);
      return;
    }
    if (window.__frontierExtPyramidEquipHooked) return;
    window.__frontierExtPyramidEquipHooked = true;
    const orig = window.injectPreviewTeam;
    window.injectPreviewTeam = function () {
      const res = orig.apply(this, arguments);
      try {
        const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
        if (!run) return res;
        const fac = FACILITIES.find((f) => f.id === run.facilityId);
        if (!isPyramidFacility(fac)) return res;
        if (!run.pikeTeam || typeof team === "undefined") return res;
        if (saved.currentArea !== RUN_AREA_ID) return res;
        for (const sl of ["slot1", "slot2", "slot3"]) {
          const ps = run.pikeTeam[sl];
          if (!ps || !ps.item) continue;
          if (!team[sl]) continue;
          team[sl].item = ps.item;
        }
      } catch (e) { console.error("[frontier-ext] pyramid equip sync failed:", e); }
      return res;
    };
  }

  // Pyramid held-item level override: items equipped via the Combat
  // Bag should ALWAYS hit their max-level effect regardless of how
  // many copies the player has farmed in their main inventory.
  // Pokechill's `returnItemLevel(id)` scales from 1 to 5 based on
  // `item[id].got` — which is fine for the overworld but would make
  // a Pyramid-equipped Leftovers / Quick Claw / etc. feel weaker than
  // intended if the player only has a single copy. Wrap the function
  // so any id currently on a pikeTeam[slot].item inside an active
  // Pyramid run resolves to level 5 (stars / "max level" label / 5).
  function installPyramidItemMaxLevel() {
    if (typeof window.returnItemLevel !== "function") {
      setTimeout(installPyramidItemMaxLevel, 200);
      return;
    }
    if (window.__frontierExtItemLevelHooked) return;
    window.__frontierExtItemLevelHooked = true;
    const orig = window.returnItemLevel;
    const isPyramidEquipped = (id) => {
      try {
        const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
        if (!run || !run.pikeTeam) return false;
        const fac = FACILITIES.find((f) => f.id === run.facilityId);
        if (!fac || !isPyramidFacility(fac)) return false;
        for (const sl of ["slot1", "slot2", "slot3"]) {
          if (run.pikeTeam[sl] && run.pikeTeam[sl].item === id) return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    };
    window.returnItemLevel = function (id, mod) {
      if (isPyramidEquipped(id)) {
        if (mod === "stars") return `<span style="color:#4fffa7ff">✦✦✦✦✦</span>`;
        if (mod === "left")  return "(max level reached)";
        return 5;
      }
      // Defensive fall-through: the custom Pyramid-only ids (berries,
      // potions, revives…) don't live in `item[]`. Vanilla's body
      // (explore.js:2079) reads `item[id].got` and would throw on
      // those. If the id isn't in the vanilla registry just return
      // level 1 instead of delegating — none of those IDs should ever
      // reach returnItemLevel outside a Pyramid run (they only exist
      // inside the run's combatBag), but this guards the edge case.
      if (typeof item === "undefined" || !item[id]) {
        if (mod === "stars") return `<span style="color:#4fffa7ff">✦</span>✦✦✦✦`;
        if (mod === "left")  return "(level 1)";
        return 1;
      }
      return orig.apply(this, arguments);
    };
  }

  // ─── 6b3. PIKE RULE — 14 rooms, 3 doors, HP/status persist ───────────────
  // Signature Gen 3 Emerald Battle Pike rules:
  //   • Each round = 14 rooms.
  //   • Each room shows 3 closed curtains (doors). The player picks one; the
  //     contents — trainer fight / heal / trap / boss — are revealed only
  //     after clicking.
  //   • HP + status carry over between rooms in the same round. A full-heal
  //     door clears both; a partial-heal door restores HP only; a trap door
  //     inflicts a random status on one slot.
  //   • Room 14 is always a fight. On boss rounds (round 7, 49, post-Gold
  //     rematches), it's the Brain — otherwise it's an elite trainer one
  //     tier above the normal round pool, as a final gauntlet spike.
  //   • Room 1 of each new round resets HP to 100% and clears status.

  // Localised labels for door-result announcements and banners. Everything
  // else goes through the i18n overlay at runtime, but the door picker and
  // heal/trap modals use their own structured copy because they're
  // dynamically composed.
  const PIKE_L10N = {
    pickDoor: "Pick a door",
    subDesc: "Curtains hide battles, heals, wild Pokémon and status rooms. Your choice is final.",
    room: "Room",
    round: "Round",
    team: "Team",
    brainRoom: "Final room — the Zone Leader awaits!",
    toughRoom: "Final room — an elite trainer guards the exit.",
    bossBanner: "⚡ Zone Leader incoming!",
    healFullTitle: "Nurse encounter!",
    healFullBody: "Your whole team heals to 100% HP and any status is cured.",
    healPartialTitle: "Passing healer",
    healPartialBody: (n) => `${n === 1 ? "One Pokémon" : "Two Pokémon"} of your team heals fully and is cured of status.`,
    toughHealTitle: "Rewarding victory",
    toughHealBody: "Your team is fully healed after this tough fight.",
    statusTitle: "Hostile Pokémon!",
    statusBody: (species, status, n) => `A wild ${species} attacked! ${n === 1 ? "One of your Pokémon is" : `${n} of your Pokémon are`} afflicted: ${status}.`,
    wildTitle: "Wild Pokémon!",
    wildBody: "A wild Pokémon attacks.",
    emptyTitle: "Peaceful room",
    emptyBody: "Lucky — nobody here attacks.",
    next: "Next room",
    cancel: "Back",
    back: "Back",
    abandon: "Abandon",
    fightBrain: "Face the Zone Leader",
    fightTough: "Start the fight",
    fightWild: "Fight the wild",
    statusPoisoned: "Poisoned",
    statusBurn: "Burned",
    statusParalysis: "Paralyzed",
    statusSleep: "Asleep",
    statusFreeze: "Frozen",
    hintButton: "Ask for a hint",
    hintIntroDoor: (n) => `Behind door ${n}…`,
    hintPresence:    "A trainer? I sense a presence…",
    hintConversation: "I think I heard something…",
    hintSmell:        "The distinctive smell of Pokémon…",
    hintNostalgia:    "There's a wave of nostalgia coming from it…",
    hintDread:        "Something horrible is about to befall you.",
    hintImmune:       "Immune",
  };

  function pikeL10n() { return PIKE_L10N; }

  // ─── PIKE TEAM SNAPSHOT ──────────────────────────────────────────────────
  // Dedicated per-run team state. Solves two problems at once:
  //   1. The game's injectPreviewTeam + setPkmnTeamHp path hard-resets
  //      pkmn[id].playerHp to playerHpMax and wipes team[].buffs on every
  //      combat entry — a runtime-only side-state means we own the HP/status
  //      truth and can re-apply them after the reset lands.
  //   2. Pyramid will need exactly the same persistent-team semantics, so we
  //      keep the shape generic (pkmnId/item/hpRatio/status per slot).
  //
  // Shape:
  //   run.pikeTeam = {
  //     slot1: { pkmnId: "dragonite", item: "lumBerry", hpRatio: 1.0, status: null },
  //     slot2: {...},
  //     slot3: {...},
  //   }
  // hpRatio is 0..1 (1.0 = full HP). status is one of PIKE_PYRAMID_STATUSES
  // or null.
  function initPikePyramidTeamFromPreview() {
    ensureSaveSlot();
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return;
    const pt = (saved.previewTeams && saved.previewTeams[saved.currentPreviewTeam]) || {};
    run.pikeTeam = {};
    run.pikeTeamSource = saved.currentPreviewTeam; // Remember which preview slot seeded us
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (pt[sl] && pt[sl].pkmn) {
        run.pikeTeam[sl] = {
          pkmnId: pt[sl].pkmn,
          item: pt[sl].item || null,
          hpRatio: 1.0,
          status: null };
      }
    }
  }

  // One-time migration for saves that were started before run.pikeTeam
  // existed — rebuild it from the legacy pikeHpState / pikeStatus + the
  // preview team slot, so the run can resume without losing progress.
  function migratePikePyramidTeam() {
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return;
    if (run.pikeTeam) return; // already migrated
    const fac = FACILITIES.find((f) => f.id === run.facilityId);
    // Migration only runs for facilities that use the runTeam machinery.
    if (!hasRunTeamState(fac)) return;
    const pt = (saved.previewTeams && saved.previewTeams[saved.currentPreviewTeam]) || {};
    run.pikeTeam = {};
    run.pikeTeamSource = saved.currentPreviewTeam;
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (!pt[sl] || !pt[sl].pkmn) continue;
      const hp = (run.pikeHpState && run.pikeHpState[sl]);
      const st = (run.pikeStatus && run.pikeStatus[sl]);
      run.pikeTeam[sl] = {
        pkmnId: pt[sl].pkmn,
        item: pt[sl].item || null,
        hpRatio: (typeof hp === "number") ? hp : 1.0,
        status: st ? normalizePikePyramidStatus(st) : null };
    }
  }

  // Weighted random outcome for a single door at a given room index. The
  // weights shift with room progression: early rooms bias toward heals so
  // the player survives long enough to feel the mechanic; mid rooms
  // balance combat vs utility; late rooms (11+) strip heals and turn
  // every encounter into pressure before the room-14 finale.
  //
  // Canonical Gen 3 Pike outcomes mirrored here:
  //   • combat_solo      — trainer with 3 Pokémon
  //   • combat_tough     — stronger trainer, win → team heal
  //   • heal_full        — nurse, full heal + status cure for all 3
  //   • heal_partial     — 1 or 2 Pokémon fully healed + status cured
  //   • status_species   — hostile species inflicts its trademark status
  //                        on N Pokémon (N scales with room 1-5/6-10/11+)
  //   • wild             — single wild Pokémon encounter
  //   • empty            — peaceful room, no fight, advance freely
  function rollSinglePikeDoor(room, facility) {
    const run = saved.frontierExt.activeRun;
    const nextRound = run.round + 1;
    const early = room <= 4;
    const late = room >= 11;

    // Order: [combat_solo, combat_tough, heal_full, heal_partial,
    //         status_species, wild, empty]
    let weights;
    if (early)      weights = [30, 10, 10, 15, 10, 15, 10];
    else if (late)  weights = [40, 20,  3,  7, 15, 12,  3];
    else            weights = [35, 12,  7, 13, 13, 12,  8];

    const total = weights.reduce((a, b) => a + b, 0);
    const roll = Math.random() * total;
    let cum = 0;

    cum += weights[0];
    if (roll < cum) {
      return { type: "combat_solo", data: { trainer: generateTrainer(nextRound, facility) } };
    }
    cum += weights[1];
    if (roll < cum) {
      const t = generateTrainer(nextRound, facility);
      t.tier = Math.min(5, (t.tier || 1) + 1);
      return { type: "combat_tough", data: { trainer: t, healOnWin: true } };
    }
    cum += weights[2];
    if (roll < cum) return { type: "heal_full", data: {} };
    cum += weights[3];
    if (roll < cum) {
      const count = Math.random() < 0.5 ? 1 : 2;
      return { type: "heal_partial", data: { count } };
    }
    cum += weights[4];
    if (roll < cum) {
      const speciesKeys = Object.keys(PIKE_STATUS_SPECIES);
      const species = speciesKeys[Math.floor(Math.random() * speciesKeys.length)];
      const statuses = PIKE_STATUS_SPECIES[species];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      return {
        type: "status_species",
        data: { species, status, count: pikeStatusCountByRoom(room) } };
    }
    cum += weights[5];
    if (roll < cum) {
      // Wild encounter — single Pokémon from the facility pool, scaled.
      const diff = computeRunDifficulty(nextRound, facility);
      const pool = getPoolForFacility(facility, diff.tier, nextRound);
      const id = pool[Math.floor(Math.random() * pool.length)];
      const wildTrainer = {
        name: ("Wild Pokémon"),
        sprite: "wild_silhouette",
        team: [{ id, moves: pickMovesetFor(id, diff), nature: "" }],
        isWild: true,
        facilityId: facility.id,
        round: nextRound,
        tier: diff.tier,
        multiplier: diff.mult };
      return { type: "wild", data: { trainer: wildTrainer } };
    }
    return { type: "empty", data: {} };
  }

  // Roll all 3 doors for a given room. Guarantees the final room is always
  // a fight (Brain on boss rounds, tough trainer otherwise). For normal
  // rooms, forces at least 1 combat door so the player never gets a free
  // triple-heal jackpot.
  function rollPikeDoors(room, facility) {
    const run = saved.frontierExt.activeRun;
    const nextRound = run.round + 1;
    const bossInfo = getBossRoundInfo(nextRound, facility);

    if (room === PIKE_ROOM_COUNT) {
      if (bossInfo) {
        // All 3 doors lead to the Brain — final room of a boss round.
        return [
          { type: "brain", data: { kind: bossInfo.kind } },
          { type: "brain", data: { kind: bossInfo.kind } },
          { type: "brain", data: { kind: bossInfo.kind } },
        ];
      }
      // Normal round final: 3 tough elite trainers (tier bump).
      const tough = () => {
        const t = generateTrainer(nextRound, facility);
        // Bump the trainer's difficulty tier one step for the finale.
        t.tier = Math.min(5, (t.tier || 1) + 1);
        return { type: "tough", data: { trainer: t } };
      };
      return [tough(), tough(), tough()];
    }

    const doors = [];
    for (let i = 0; i < PIKE_DOOR_COUNT; i++) {
      doors.push(rollSinglePikeDoor(room, facility));
    }
    // Ensure at least 1 combat-ish door (solo / tough / wild) in every
    // room — otherwise a 3×heal or 3×empty jackpot would trivialise the
    // round. Canonical Pike guarantees an encounter eventually too.
    const isCombatish = (d) => d && (
      d.type === "combat_solo" || d.type === "combat_tough" ||
      d.type === "wild" || d.type === "brain" ||
      // Legacy (pre-rework) saves may still carry these types:
      d.type === "combat" || d.type === "tough"
    );
    if (!doors.some(isCombatish)) {
      doors[Math.floor(Math.random() * doors.length)] = {
        type: "combat_solo",
        data: { trainer: generateTrainer(run.round + 1, facility) } };
    }
    return doors;
  }

  // Compact HP bar summary rendered inside the pike preview. Reads from
  // run.pikeTeam (the unified per-run team state). Shows nothing if the
  // run has no team state yet (should never happen post-init — migration
  // covers legacy saves).
  function renderPikeHpSummary() {
    const run = saved.frontierExt.activeRun;
    if (!run) return "";
    migratePikePyramidTeam();
    const l = pikeL10n();
    const statusLabel = {
      poisoned: l.statusPoisoned, burn: l.statusBurn, paralysis: l.statusParalysis,
      sleep: l.statusSleep, freeze: l.statusFreeze };
    const cells = [];
    const source = run.pikeTeam || {};
    for (const sl of ["slot1", "slot2", "slot3"]) {
      const ps = source[sl];
      if (!ps || !ps.pkmnId) continue;
      const ratio = (typeof ps.hpRatio === "number") ? ps.hpRatio : 1.0;
      const status = ps.status ? normalizePikePyramidStatus(ps.status) : null;
      const pct = Math.round(ratio * 100);
      const barWidth = Math.max(0, Math.min(100, pct));
      const cls = ratio <= 0.25 ? "low" : (ratio <= 0.5 ? "mid" : "");
      const monName = typeof format === "function" ? format(ps.pkmnId) : ps.pkmnId;
      const statusPill = status
        ? `<span class="st ${status}">${statusLabel[status] || status}</span>`
        : "";
      // Heal-just-applied glow. Flag is set by every heal path (nurse
      // heal_full, heal_partial, Pyramid bag heals, tough-combat
      // post-win heal). Consumed on first render so the animation
      // doesn't replay on subsequent HP summary refreshes. Shows on
      // ALL slots that were healed — including already-full ones
      // (addresses "heal-on-full looks like a bug" UX note) AND
      // partial heals that didn't reach 100%.
      const healFlash = ps.healJustApplied ? " heal-full-flash" : "";
      if (ps.healJustApplied) ps.healJustApplied = false;
      cells.push(`
        <span class="frontier-ext-pike-hp-pill ${cls}${healFlash}">
          ${monName}: ${pct}%
          <span class="bar"><span style="width:${barWidth}%"></span></span>
          ${statusPill}
        </span>
      `);
    }
    if (!cells.length) return "";
    return `<div class="frontier-ext-pike-hp-summary">${cells.join("")}</div>`;
  }

  // Render the 3-door picker modal. Opened every time we enter a new room.
  // run.pikeDoors is rolled once per room — re-opening the same modal (e.g.
  // player backed out and reopened the tile) keeps the same 3 outcomes so
  // they can't reroll a bad set.
  function openPikeRoomPreview(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const lang = "en";
    const l = pikeL10n();

    if (!run.pikeRoom || run.pikeRoom < 1) run.pikeRoom = 1;
    if (run.pikeRoom > PIKE_ROOM_COUNT) run.pikeRoom = PIKE_ROOM_COUNT;
    if (!Array.isArray(run.pikeDoors) || run.pikeDoors.length !== PIKE_DOOR_COUNT) {
      run.pikeDoors = rollPikeDoors(run.pikeRoom, facility);
    }

    // Re-entry guard: if the user already picked a door in this room and
    // closed the tooltip before resolving the outcome, resume exactly where
    // they left off — don't let them pick a different curtain (would
    // enable rerolling bad matchups or healing twice).
    const pickedIdx = run.pikeDoorPicked;
    if (pickedIdx !== null && pickedIdx !== undefined
        && Array.isArray(run.pikeDoors) && run.pikeDoors[pickedIdx]) {
      const d = run.pikeDoors[pickedIdx];
      const isCombatishPicked = d.type === "combat_solo" || d.type === "combat_tough"
        || d.type === "wild" || d.type === "brain"
        || d.type === "combat" || d.type === "tough"; // legacy
      if (isCombatishPicked) {
        // Re-fire the committed combat directly.
        applyPikeDoor(pickedIdx, facility);
        return;
      }
      if (d.applied) {
        // Heal/status/empty already resolved. Re-show the event modal
        // without re-running the effect so the player can still click
        // "Next".
        const l = pikeL10n();
        const statusName = (s) => ({
          poisoned: l.statusPoisoned, burn: l.statusBurn, paralysis: l.statusParalysis,
          sleep: l.statusSleep, freeze: l.statusFreeze })[s] || s;
        const speciesName = (id) => (typeof format === "function" ? format(id) : id);
        let m = null;
        let mOpts = undefined;
        if (d.type === "heal_full")    m = ["heal", l.healFullTitle, l.healFullBody, "full"];
        else if (d.type === "heal_partial") m = ["heal", l.healPartialTitle, l.healPartialBody(d.data.count || 1), "partial"];
        else if (d.type === "status_species") {
          m = ["trap", l.statusTitle, l.statusBody(speciesName(d.data.species), statusName(d.data.status), d.data.count || 1), d.data.status];
          mOpts = { spriteId: d.data.species };
        }
        else if (d.type === "empty")   m = ["heal", l.emptyTitle, l.emptyBody, "empty"];
        // Legacy fallbacks for in-progress saves:
        else if (d.type === "heal_half") m = ["heal", l.healPartialTitle, l.healPartialBody(2), "partial"];
        else if (d.type === "trap")      m = ["trap", l.statusTitle, `${l.statusTitle} (${statusName(d.data.status)})`, d.data.status];
        if (m) {
          showPikeEventModal(facility, m[0], m[1], m[2], m[3], mOpts);
          return;
        }
      }
    }

    const nextRound = run.round + 1;
    const isFinalRoom = run.pikeRoom === PIKE_ROOM_COUNT;
    const bossInfo = getBossRoundInfo(nextRound, facility);
    const isBossFinale = isFinalRoom && !!bossInfo;

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      if (isBossFinale) {
        top.style.display = "block";
        top.innerHTML = `<img src="img/trainers/${facility.brain.sprite}.png"
          style="max-height: 140px; image-rendering: pixelated;"
          alt="${facility.brain.name}">`;
      } else {
        // No header decoration for non-boss rooms — the title + 3 curtains
        // in the bottom already carry the Pike identity; a curtain in the
        // header just overlaps the title and adds visual noise.
        top.style.display = "none";
        top.innerHTML = "";
      }
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${facility.name} — ${l.room} ${run.pikeRoom}/${PIKE_ROOM_COUNT}`;
    }
    if (mid) {
      mid.style.display = "block";
      let banner = `
        <div class="frontier-ext-pike-banner">
          <span>${l.round} <strong>${nextRound}</strong></span>
          <span>${l.room} <strong>${run.pikeRoom}</strong>/${PIKE_ROOM_COUNT}</span>`;
      if (isBossFinale) {
        banner += `<span class="boss-flag">${l.bossBanner}</span>`;
      }
      banner += `</div>`;
      const hpSummary = renderPikeHpSummary();
      const prompt = isFinalRoom
        ? (isBossFinale ? l.brainRoom : l.toughRoom)
        : `<div style="text-align:center;padding:0.3rem 0.8rem;font-style:italic;opacity:0.9;">${l.pickDoor}</div>
           <div style="text-align:center;padding:0 0.8rem 0.3rem;font-size:0.82rem;opacity:0.75;">${l.subDesc}</div>`;
      mid.innerHTML = banner + hpSummary +
        (isFinalRoom
          ? `<div style="text-align:center;padding:0.4rem 0.8rem;color:#ffd700;font-weight:bold;">${prompt}</div>`
          : prompt);
    }
    if (bottom) {
      bottom.style.display = "block";
      const doors = run.pikeDoors.map((_, idx) => `
        <div class="frontier-ext-pike-door" data-door="${idx}">
          <span class="door-number">${idx + 1}</span>
          ${CURTAIN_SVG}
        </div>
      `).join("");
      // Hint: already-revealed hint takes precedence; otherwise show the
      // ask-button. Final rooms don't show a hint button — the room's
      // nature is already obvious (boss / tough fight).
      let hintHtml = "";
      if (!isFinalRoom) {
        // Strict current-room guard: refuse to render a hint whose
        // `room` tag doesn't match the preview we're drawing. Any
        // stale hint is nulled out so the ask-button re-appears.
        if (run.pikeHint && run.pikeHint.room !== undefined
            && run.pikeHint.room !== run.pikeRoom) {
          run.pikeHint = null;
        }
        if (run.pikeHint && typeof run.pikeHint.doorIdx === "number") {
          const cat = run.pikeHint.category;
          const hintText = {
            presence: l.hintPresence,
            conversation: l.hintConversation,
            smell: l.hintSmell,
            nostalgia: l.hintNostalgia,
            dread: l.hintDread }[cat] || "";
          hintHtml = `
            <div class="frontier-ext-pike-hint revealed">
              <span class="intro">${l.hintIntroDoor(run.pikeHint.doorIdx + 1)}</span>
              <span class="text">${hintText}</span>
            </div>`;
        } else {
          hintHtml = `
            <div class="frontier-ext-pike-hint">
              <button class="frontier-ext-pike-hint-btn" data-pike-hint="1">🔍 ${l.hintButton}</button>
            </div>`;
        }
      }
      bottom.innerHTML = `
        <div class="frontier-ext-pike-doors">${doors}</div>
        ${hintHtml}
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn danger" data-action="abandon">${l.abandon}</button>
        </div>
      `;
      bottom.querySelectorAll(".frontier-ext-pike-door").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = parseInt(el.dataset.door, 10);
          // Play a quick reveal wobble before applying, for UX feedback.
          el.classList.add("revealed");
          // Lock all sibling doors so the user can't multi-click.
          bottom.querySelectorAll(".frontier-ext-pike-door").forEach((sib) => {
            if (sib !== el) sib.classList.add("locked");
          });
          setTimeout(() => applyPikeDoor(idx, facility), 280);
        });
      });
      const hintBtn = bottom.querySelector("[data-pike-hint]");
      if (hintBtn) {
        hintBtn.addEventListener("click", () => {
          requestPikeHint(facility);
        });
      }
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Roll a hint: pick a random door in the current room, bucket its type
  // into a category, then persist the (doorIdx, category) pair on the
  // run so re-opening the preview keeps the same hint. Once per room —
  // the player can't spam the button to narrow down all three doors.
  function requestPikeHint(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !Array.isArray(run.pikeDoors)) return;
    // If the stored hint is still bound to the CURRENT room, reuse it
    // (idempotent re-render). Otherwise discard it — a stale hint
    // could have leaked through an edge case; this is the safety net.
    if (run.pikeHint
        && typeof run.pikeHint.doorIdx === "number"
        && run.pikeHint.room === run.pikeRoom) {
      openPikeRoomPreview(facility);
      return;
    }
    const doorIdx = Math.floor(Math.random() * run.pikeDoors.length);
    const door = run.pikeDoors[doorIdx];
    const category = PIKE_HINT_CATEGORY[door.type] || "presence";
    // Stamp the hint with the room it was rolled FOR so the display
    // branch can refuse to render when the tag is stale — guarantees
    // "une salle d'avance" can't happen.
    run.pikeHint = { doorIdx, category, room: run.pikeRoom };
    openPikeRoomPreview(facility);
  }

  // Entry point from a curtain click. Dispatches to the right handler
  // based on door type. Combat-style doors (solo / tough / wild / brain)
  // lead straight into launchCombat; heal / status / empty show a
  // confirmation modal and advance to the next room on "Next".
  function applyPikeDoor(idx, facility) {
    const run = saved.frontierExt.activeRun;
    if (!run || !Array.isArray(run.pikeDoors)) return;
    const door = run.pikeDoors[idx];
    if (!door) return;
    run.pikeDoorPicked = idx;
    const l = pikeL10n();
    const statusName = (s) => ({
      poisoned: l.statusPoisoned, burn: l.statusBurn, paralysis: l.statusParalysis,
      sleep: l.statusSleep, freeze: l.statusFreeze })[s] || s;
    const speciesName = (id) => (typeof format === "function" ? format(id) : id);

    switch (door.type) {
      case "combat_solo":
      case "combat_tough":
      case "wild": {
        run.upcomingTrainer = door.data.trainer;
        // combat_tough: mark the current battle so onRunVictory knows to
        // fully heal the team after the win.
        run.pikePostBattleHeal = !!door.data.healOnWin;
        launchCombat(facility);
        return;
      }
      case "brain": {
        // Let launchCombat follow its boss path — getBossRoundInfo picks
        // the right team at run.round+1. Null upcomingTrainer so that
        // path fires instead of the cached random trainer.
        run.upcomingTrainer = null;
        run.pikePostBattleHeal = false;
        launchCombat(facility);
        return;
      }
      case "heal_full": {
        if (!door.applied) applyPikeHealRatio(1.0);
        door.applied = true;
        showPikeEventModal(facility, "heal", l.healFullTitle, l.healFullBody, "full");
        return;
      }
      case "heal_partial": {
        const count = door.data.count || 1;
        if (!door.applied) applyPikeHealPartial(count);
        door.applied = true;
        showPikeEventModal(facility, "heal", l.healPartialTitle, l.healPartialBody(count), "partial");
        return;
      }
      case "status_species": {
        door.data.status = normalizePikePyramidStatus(door.data.status);
        if (!door.applied) applyPikeStatusSpecies(door.data.status, door.data.count || 1);
        door.applied = true;
        showPikeEventModal(
          facility, "trap", l.statusTitle,
          l.statusBody(speciesName(door.data.species), statusName(door.data.status), door.data.count || 1),
          door.data.status,
          { spriteId: door.data.species },
        );
        return;
      }
      case "empty": {
        door.applied = true;
        showPikeEventModal(facility, "heal", l.emptyTitle, l.emptyBody, "empty");
        return;
      }
      // Legacy: in-flight saves from before the rework.
      case "combat":
      case "tough": {
        run.upcomingTrainer = door.data.trainer;
        run.pikePostBattleHeal = door.type === "tough";
        launchCombat(facility);
        return;
      }
      case "heal_half": {
        if (!door.applied) applyPikeHealPartial(2);
        door.applied = true;
        showPikeEventModal(facility, "heal", l.healPartialTitle, l.healPartialBody(2), "partial");
        return;
      }
      case "trap": {
        door.data.status = normalizePikePyramidStatus(door.data.status);
        if (!door.applied) applyPikeTrap(door.data.status);
        door.applied = true;
        showPikeEventModal(facility, "trap", l.statusTitle, `${l.statusTitle} (${statusName(door.data.status)})`, door.data.status);
        return;
      }
    }
  }

  // Heal exactly N Pokémon (N=1 or 2) to full HP + cure status. Picks
  // randomly among slots that are alive (hpRatio > 0) — a fainted mon
  // isn't eligible, which matches Gen 3 Pike where the healer targets
  // living party members.
  function applyPikeHealPartial(n) {
    const run = saved.frontierExt.activeRun;
    migratePikePyramidTeam();
    if (!run.pikeTeam) return;
    const alive = ["slot1", "slot2", "slot3"].filter((sl) => {
      const ps = run.pikeTeam[sl];
      return ps && (ps.hpRatio || 0) > 0;
    });
    // Shuffle and take N. If fewer alive than N, heal all of them.
    for (let i = alive.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [alive[i], alive[j]] = [alive[j], alive[i]];
    }
    const targets = alive.slice(0, n);
    for (const sl of targets) {
      const ps = run.pikeTeam[sl];
      ps.hpRatio = 1.0;
      ps.status = null;
      ps.healJustApplied = true; // glow flag, read by HP summary renderers
    }
  }

  // Apply a species-triggered status to N Pokémon, respecting type
  // immunity. `status` is one of the PIKE_PYRAMID_STATUSES keys; `count` is
  // the room-progression count (1 / 2 / 3). Prefers slots that are alive
  // AND not already statused — if fewer eligible slots exist than the
  // count, applies to as many as possible.
  function applyPikeStatusSpecies(status, count) {
    const run = saved.frontierExt.activeRun;
    migratePikePyramidTeam();
    if (!run.pikeTeam) return;
    const eligible = ["slot1", "slot2", "slot3"].filter((sl) => {
      const ps = run.pikeTeam[sl];
      if (!ps || !ps.pkmnId) return false;
      if ((ps.hpRatio || 0) <= 0) return false;     // fainted — skip
      if (ps.status) return false;                  // already statused
      if (pikePkmnImmuneToStatus(ps.pkmnId, status)) return false;
      return true;
    });
    // Shuffle, take count.
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const targets = eligible.slice(0, count);
    for (const sl of targets) {
      run.pikeTeam[sl].status = normalizePikePyramidStatus(status);
    }
  }

  // Heal a flat ratio across all 3 slots in run.pikeTeam. Capped at 1.0.
  // Full-heal (>=1.0) clears status; partial heals leave status intact
  // (matches Gen 3 Pike — only Nurse rooms cure status).
  function applyPikeHealRatio(ratio) {
    const run = saved.frontierExt.activeRun;
    migratePikePyramidTeam();
    if (!run.pikeTeam) return;
    for (const sl of ["slot1", "slot2", "slot3"]) {
      const ps = run.pikeTeam[sl];
      if (!ps) continue;
      const cur = (typeof ps.hpRatio === "number") ? ps.hpRatio : 1.0;
      ps.hpRatio = Math.min(1.0, cur + ratio);
      if (ratio >= 1.0) ps.status = null;
      // Flag EVERY touched slot for the next render — renderPikeHpSummary
      // uses this to play a short glow on slots sitting at 100% HP after
      // a heal door fires. Prevents the "the door healed a full-HP mon?
      // is that a bug?" UX gotcha. Flag is cleared on room advance.
      ps.healJustApplied = true;
    }
  }

  // Pick a random Pike-team slot and inflict a status on it. Only one slot
  // per trap door, matching the Gen 3 Pike one-Pokémon trap rule.
  function applyPikeTrap(status) {
    const run = saved.frontierExt.activeRun;
    migratePikePyramidTeam();
    if (!run.pikeTeam) return;
    const candidates = ["slot1", "slot2", "slot3"].filter((sl) => run.pikeTeam[sl]);
    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    run.pikeTeam[target].status = normalizePikePyramidStatus(status);
  }

  // Heal/trap confirmation modal. User clicks "Next room" to advance.
  function showPikeEventModal(facility, kind, title, body, variant, opts) {
    const lang = "en";
    const l = pikeL10n();
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    // Hostile-Pokémon events pass a species id via opts.spriteId so the
    // modal can render the actual sprite (much clearer than the generic
    // ☠️ emoji — the player immediately recognises Gloom / Kirlia /
    // Dusclops / …). Fall back to the emoji icon if no sprite id was
    // supplied OR the sprite asset doesn't exist.
    const spriteId = opts && opts.spriteId;
    let iconHtml;
    if (spriteId) {
      iconHtml = `<img class="frontier-ext-pike-hostile-sprite" src="img/pkmn/sprite/${spriteId}.png" alt="${spriteId}" onerror="this.style.display='none'">`;
    } else {
      const emoji = kind === "heal"
        ? (variant === "full" ? "💚" : variant === "empty" ? "🍃" : "🌿")
        : "☠️";
      iconHtml = emoji;
    }
    const facName = facility.name;

    // PIKE-ONLY. The Pyramid used to share this modal for heal/cure
    // tiles and that required an internal branch to switch the unit
    // label to "Étage X/7". Those Pyramid tiles are gone (items are
    // rolled via PYR_TILES.ITEM → showPyramidItemFoundModal), so the
    // modal is now unambiguously a Pike construct.
    const run = saved.frontierExt.activeRun;
    const unitLabel = l.room;
    const unitValue = `${run.pikeRoom}/${PIKE_ROOM_COUNT}`;
    const nextLabel = l.next;

    if (top) top.style.display = "none";
    if (titleEl) {
      titleEl.style.display = "block";
      titleEl.innerHTML = `${facName} — ${unitLabel} ${unitValue}`;
    }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div class="frontier-ext-pike-event ${kind}">
          <div class="icon">${iconHtml}</div>
          <div class="headline">${title}</div>
          <div class="body">${body}</div>
        </div>
        ${renderFrontierTeamHpSummary()}
      `;
    }
    if (bottom) {
      bottom.style.display = "block";
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="pike-next">${nextLabel}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${l.abandon}</button>
        </div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // ─── ROUND-CLEARED MODAL (all facilities) ────────────────────────────────
  // Shown after any full round is completed. Mirrors the vanilla Battle
  // Tower's "save every 7 floors" pattern: celebrate the round, show
  // streak / symbol progress, then let the player either continue
  // immediately or pause to change team before the next round.
  //
  // A "round" is facility-specific:
  //   • Tower / Palace / Arena / Factory : 1 battle  = 1 round
  //   • Dôme                              : 3 battles (bracket) = 1 round
  //   • Pic                               : 14 rooms  = 1 round
  //   • Pyramid                          : 7 floors  = 1 round (TBD)
  //
  // When the player picks "Pause", activeRun stays alive and the modal
  // closes; they can then open the team editor, change their team, and
  // resume via the facility tile's "Continue (Round N+1)" button.
  // "Continue" from inside the modal validates team size, re-snapshots
  // Pike-specific state (so team edits while paused are picked up), and
  // opens the appropriate next-round preview.
  function showRoundClearedModal(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const lang = "en";
    const name = facility.name;
    const brainName = facility.brain.name;
    const nextRound = run.round + 1;
    const bossInfo = getBossRoundInfo(nextRound, facility);

    // All brains surface as "Zone Leader" — the legacy bilingual build
    // had gendered forms in French; that distinction doesn't exist in
    // English so every brain uses the same label.
    const t = {
          headline: "Round cleared!",
          justCleared: "Round",
          cleared: "cleared",
          streak: "Current streak",
          best: "Best",
          next: "Next round",
          normal: "Standard trainer",
          silver: `⚡ The ${"Zone Leader"} (Silver) is next!`,
          gold:   `💎 The ${"Zone Leader"} (Gold) is next!`,
          rematch:`🔥 ${"Zone Leader"} rematch ×` + (bossInfo && bossInfo.multiplier),
          continue: "Continue — Round " + nextRound,
          rest: "Rest",
          abandon: "Abandon",
          hint: "Auto-saved. Continue moves on to the next round. Rest closes this menu without breaking the streak — team unlocked, come back via the tile anytime. Abandon ends the streak.",
          silverAwarded: "🏆 Silver Symbol unlocked!",
          goldAwarded: "🏆 Gold Symbol unlocked!" };

    const streak = saved.frontierExt.streaks[facility.id] || 0;
    const best = saved.frontierExt.maxStreaks[facility.id] || 0;
    const symbols = saved.frontierExt.symbols[facility.id] || { silver: false, gold: false };
    // A symbol was just earned if the round that was completed matches the
    // silver/gold threshold. run.round has already been incremented.
    const silverJustEarned = run.round === silverRoundFor(facility) && symbols.silver;
    const goldJustEarned = run.round === goldRoundFor(facility) && symbols.gold;

    let nextBanner = "";
    if (bossInfo) {
      if (bossInfo.kind === "silver") nextBanner = `<div class="frontier-ext-round-next boss">${t.silver}</div>`;
      else if (bossInfo.kind === "gold") nextBanner = `<div class="frontier-ext-round-next boss">${t.gold}</div>`;
      else nextBanner = `<div class="frontier-ext-round-next boss">${t.rematch}</div>`;
    }

    let awards = "";
    if (silverJustEarned) awards += `<div class="frontier-ext-round-award silver">${t.silverAwarded}</div>`;
    if (goldJustEarned) awards += `<div class="frontier-ext-round-award gold">${t.goldAwarded}</div>`;

    const top = document.getElementById("tooltipTop");
    const title = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");

    if (top) {
      top.style.display = "block";
      // Use the facility icon (without the frontier-flair positioning class)
      // inside a small celebratory card.
      const compactIcon = facility.iconSvg.replace(/\bclass="frontier-flair"\s*/, "");
      top.innerHTML = `
        <div class="frontier-ext-round-header">
          <div class="trophy">🏆</div>
          <div class="facility-icon">${compactIcon}</div>
        </div>
      `;
    }
    if (title) {
      title.style.display = "block";
      title.innerHTML = `${name} — ${t.headline}`;
    }
    if (mid) {
      mid.style.display = "block";
      mid.innerHTML = `
        <div class="frontier-ext-round-cleared">
          <div class="celebration">${t.justCleared} <strong>${run.round}</strong> ${t.cleared} !</div>
          <div class="stats">
            <span>${t.streak}: <strong>${streak}</strong></span>
            <span>${t.best}: <strong>${best}</strong></span>
          </div>
          ${awards}
          ${nextBanner}
        </div>
      `;
    }
    if (bottom) {
      bottom.style.display = "block";
      // Hostess-style flow à la Gen 3 Battle Tower: two-button choice
      // between continuing the streak and abandoning. The game auto-saves
      // in the background so no separate "Save" option is needed.
      // Three-button layout — ordered left-to-right by intent strength:
      //   • Continue  (primary / green)  — straight into next round
      //   • Rest      (neutral / black)  — pause without killing streak
      //   • Abandon   (danger / red)     — truly end the streak
      // Rest keeps activeRun alive with roundJustCleared=true so the tile
      // tooltip still shows the "Continue (Round N+1)" resume button
      // whenever the player comes back later.
      bottom.innerHTML = `
        <div class="frontier-ext-run-actions">
          <button class="frontier-ext-action-btn primary" data-action="round-continue">${t.continue}</button>
          <button class="frontier-ext-action-btn" data-action="rest">${t.rest}</button>
          <button class="frontier-ext-action-btn danger" data-action="abandon">${t.abandon}</button>
        </div>
        <div class="frontier-ext-round-hint">${t.hint}</div>
      `;
      bottom.querySelectorAll("[data-action]").forEach((btn) => {
        btn.onclick = () => handleRunAction(btn.dataset.action, facility);
      });
    }
    if (typeof openTooltip === "function") openTooltip();
  }

  // Advance room after a no-combat event (heal / trap). If this pushes us
  // past the final room (shouldn't happen — room 14 always rolls combat
  // doors), we fall through to a full round-complete path for safety.
  function pikeAdvanceAfterEvent(facility) {
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    run.pikeRoom = (run.pikeRoom || 1) + 1;
    run.pikeDoors = null;
    run.pikeDoorPicked = null;
    run.pikeHint = null;

    if (run.pikeRoom > PIKE_ROOM_COUNT) {
      // Defensive: should never happen in normal play — room 14 ALWAYS
      // rolls combat doors (brain / tough), and combat doors route
      // through onRunVictory, not here. Reaching this branch means
      // either:
      //   • a save-tampered pikeRoom value, or
      //   • a future regression in rollPikeDoors.
      // In either case, granting silver/gold symbols (and by extension
      // updating the streak) without a completed boss fight is a
      // progression cheat. Heal/reset the team so the run stays
      // consistent, but REFUSE to grant round credit / symbols /
      // streak. The player has to legitimately clear room 14 to
      // advance — closing the tooltip sends them back to the tile
      // where they'll reopen the picker for a freshly-rolled room 1.
      run.pikeRoom = 1;
      if (run.pikeTeam) {
        for (const sl of ["slot1", "slot2", "slot3"]) {
          if (run.pikeTeam[sl]) {
            run.pikeTeam[sl].hpRatio = 1.0;
            run.pikeTeam[sl].status = null;
          }
        }
      }
      refreshActiveFrontierView();
      if (typeof closeTooltip === "function") closeTooltip();
      return;
    }
    openPikeRoomPreview(facility);
  }

  // Apply persisted Pike HP + status from run.pikeTeam to the runtime
  // state. Writes to `pkmn[id].playerHp` (species dict — NOT team[slot])
  // and to `team[slot].buffs[status]` (slot-local). Idempotent.
  //
  // Emits diagnostic logs so we can confirm the write lands after the
  // game's setPkmnTeamHp reset — toggle with `window.__frontierExt.pikeDebug`.
  function applyPikePyramidHpState() {
    try {
      const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
      if (!run) return;
      if (saved.currentArea !== RUN_AREA_ID) return;
      const fac = FACILITIES.find((f) => f.id === run.facilityId);
      // Accept any facility with persistHpStatus (Pike + Pyramid share
      // this mechanism). Using hasRunTeamState instead of isPikeFacility
      // extends the HP/status restore to all facilities that opt in.
      if (!hasRunTeamState(fac)) return;
      migratePikePyramidTeam();
      if (!run.pikeTeam) return;
      if (typeof team === "undefined" || typeof pkmn === "undefined") return;
      const debug = !!window.__frontierExt?.pikeDebug;
      if (debug) console.log("[pike-apply] start, pikeTeam:", JSON.parse(JSON.stringify(run.pikeTeam)));

      let appliedAny = false;
      for (const sl of ["slot1", "slot2", "slot3"]) {
        const ps = run.pikeTeam[sl];
        if (!ps) continue;
        if (!team[sl] || !team[sl].pkmn) {
          if (debug) console.log(`[pike-apply] ${sl}: no team slot`);
          continue;
        }
        const pokeData = pkmn[team[sl].pkmn.id];
        if (!pokeData) {
          if (debug) console.log(`[pike-apply] ${sl}: no pkmn data for ${team[sl].pkmn.id}`);
          continue;
        }

        // INTEGRITY CHECK — if the Pokémon in this slot has changed since
        // the Pike snapshot (either via a lock bypass or a legitimate
        // swap between rounds that wasn't captured by initPikePyramidTeamFromPreview),
        // DO NOT inherit the old Pokémon's HP/status. Reset this slot to
        // full HP + no status, and update pikeTeam to track the new mon.
        if (ps.pkmnId && ps.pkmnId !== team[sl].pkmn.id) {
          if (debug) console.log(`[pike-apply] ${sl}: pkmn changed ${ps.pkmnId} -> ${team[sl].pkmn.id}, resetting HP/status`);
          ps.pkmnId = team[sl].pkmn.id;
          ps.hpRatio = 1.0;
          ps.status = null;
          // No writes to pokeData.playerHp / team[sl].buffs — the game's
          // setPkmnTeamHp already set full HP + cleared buffs, and that's
          // what we want for the swapped-in Pokémon.
          continue;
        }

        // HP restore. CRITICAL: when ratio is 0 (KO'd in a previous room)
        // we must write exactly 0 — not clamp to 1 — so the game's
        // `playerHp <= 0` death path triggers and the Pokémon can't keep
        // attacking. Clamp to min-1 only for *live* ratios where floor()
        // could otherwise round a tiny positive to 0.
        if (typeof ps.hpRatio === "number" && pokeData.playerHpMax) {
          const newHp = ps.hpRatio > 0
            ? Math.max(1, Math.floor(pokeData.playerHpMax * ps.hpRatio))
            : 0;
          if (debug) console.log(`[pike-apply] ${sl} ${team[sl].pkmn.id}: hp ${pokeData.playerHp}/${pokeData.playerHpMax} -> ${newHp} (ratio ${ps.hpRatio})`);
          pokeData.playerHp = newHp;
          appliedAny = true;
        }

        // Status restore — normalise so legacy keys ("poison") are
        // upgraded before hitting the buff dict.
        const st = ps.status ? normalizePikePyramidStatus(ps.status) : null;
        if (st) {
          if (!team[sl].buffs) team[sl].buffs = {};
          if (debug) console.log(`[pike-apply] ${sl}: status ${st} x${PIKE_PYRAMID_STATUS_TURNS}`);
          team[sl].buffs[st] = PIKE_PYRAMID_STATUS_TURNS;
          appliedAny = true;
        }
      }

      if (appliedAny) {
        try {
          if (typeof updateTeamPkmn === "function") updateTeamPkmn();
          if (typeof updateTeamBuffs === "function") updateTeamBuffs();
          if (debug) {
            // Read-back verification: did our writes stick?
            for (const sl of ["slot1", "slot2", "slot3"]) {
              if (!team[sl] || !team[sl].pkmn) continue;
              const pd = pkmn[team[sl].pkmn.id];
              console.log(`[pike-apply] readback ${sl}: hp=${pd?.playerHp}/${pd?.playerHpMax} buffs=`, JSON.parse(JSON.stringify(team[sl].buffs || {})));
            }
          }
        } catch (e) { /* UI refresh is best-effort */ }
      }
    } catch (e) {
      console.error("[frontier-ext] pike state apply failed:", e);
    }
  }

  // ─── TEAM-MENU LOCK (ZdC Hoenn) ──────────────────────────────────────────
  // During a frontier-ext run, players must not be able to:
  //   • switch preview teams (the <select id="team-slot-selector">)
  //   • swap Pokémon inside a slot (click on the slot card)
  //   • swap items (click on the held-item card)
  //   • drag-and-drop to reorder slots (exchanges HP/status — critical bug)
  //   • trigger the auto-build button (would wipe the team)
  //
  // Only the "Save and Go" and "Go back" header buttons must remain
  // clickable so the player can still launch the fight or return to the
  // Frontier tab. The CSS class `.frontier-ext-team-locked` on #team-menu
  // + `pointer-events: none` on the slot cards handle interactions. We
  // also add a lock banner and, for Pike, decorate each slot with its
  // stored HP + status so the player can see the team state at a glance.
  // True when the player is actually launching / inside a frontier combat.
  // In this "strict" context we hide the team-switcher too — no browsing
  // other teams mid-launch.
  function isFrontierRunActive() {
    if (typeof saved !== "object" || !saved) return false;
    const run = saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return false;
    return saved.currentAreaBuffer === RUN_AREA_ID || saved.currentArea === RUN_AREA_ID;
  }

  // True when the currently-viewed preview team is THE team tied to an
  // active run. In this context we lock edits on the current slot but
  // keep the switcher visible so the player can navigate to another
  // preview team for wild zones / other facilities.
  function isFrontierTiedSlotActive() {
    if (typeof saved !== "object" || !saved) return false;
    const run = saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return false;
    const tied = run.tiedPreviewSlot || run.pikeTeamSource;
    if (!tied) return false;
    return saved.currentPreviewTeam === tied;
  }

  // The team is considered "committed" from the moment a run starts.
  // Only between rounds — marked by `run.roundJustCleared` — is the
  // team unlocked for edits, matching the vanilla Gen 3 save-point
  // at the end of each set. Any other state (fresh run before 1st
  // battle, mid-round, paused combat, …) keeps the team locked.
  //
  // Previously this function returned false when no damage / no picked
  // door / etc. was committed, which left a cheat window between "Start
  // run" and the first real combat where the player could swap items or
  // Pokémon. The single-flag check closes that window.
  function isFrontierMidRound() {
    if (typeof saved !== "object" || !saved) return false;
    const run = saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return false;
    // Active run exists → locked. roundJustCleared is the only unlock
    // signal; it stays true from onRunVictory until round-continue /
    // continue consumes it when the player starts the next round.
    return !run.roundJustCleared;
  }

  function getFrontierRunFacility() {
    if (typeof saved !== "object" || !saved) return null;
    const run = saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return null;
    return FACILITIES.find((f) => f.id === run.facilityId) || null;
  }

  // Refresh the HP + status pills on each Pike team slot. Reads LIVE
  // values first (combat engine updates pkmn[id].playerHp / team[sl].buffs
  // on every tick) and falls back to run.pikeTeam for the team-preview
  // outside combat. Idempotent — safe to call from both the lock apply
  // path and from updateTeamPkmn / updateTeamBuffs wraps for real-time
  // updates during combat.
  //
  // The overlay DOM is created here if missing, so this function alone
  // is enough to decorate slot cards whether they come from
  // updatePreviewTeam (team menu) or setPkmnTeam (combat sidebar) —
  // both use the same #explore-${slot}-member container id.
  function refreshFrontierPikePills() {
    if (typeof team === "undefined" || typeof pkmn === "undefined") return;
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return;
    const fac = FACILITIES.find((f) => f.id === run.facilityId);
    // Any facility with persistHpStatus gets live HP/status pills on its
    // combat team (Pike + Pyramid currently).
    if (!fac || !hasRunTeamState(fac)) return;
    const l = pikeL10n();
    const statusLabel = {
      poisoned: l.statusPoisoned, burn: l.statusBurn, paralysis: l.statusParalysis,
      sleep: l.statusSleep, freeze: l.statusFreeze };
    for (const sl of ["slot1", "slot2", "slot3"]) {
      const card = document.getElementById(`explore-${sl}-member`);
      if (!card) continue;
      // Lazily create the overlay container.
      let overlay = card.querySelector(".frontier-ext-team-slot-hp");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "frontier-ext-team-slot-hp";
        overlay.innerHTML = `<span class="hp-pill">--</span>`;
        if (getComputedStyle(card).position === "static") card.style.position = "relative";
        card.appendChild(overlay);
      }

      // Live values from the combat engine; fallback to pikeTeam snapshot.
      let ratio = 1.0;
      let status = null;
      if (team[sl] && team[sl].pkmn) {
        const pokeData = pkmn[team[sl].pkmn.id];
        if (pokeData && pokeData.playerHpMax) {
          ratio = Math.max(0, Math.min(1, (pokeData.playerHp || 0) / pokeData.playerHpMax));
        }
        if (team[sl].buffs) {
          for (const st of PIKE_PYRAMID_STATUSES) {
            if (team[sl].buffs[st] > 0) { status = st; break; }
          }
        }
      } else if (run.pikeTeam && run.pikeTeam[sl]) {
        const ps = run.pikeTeam[sl];
        if (typeof ps.hpRatio === "number") ratio = ps.hpRatio;
        if (ps.status) status = normalizePikePyramidStatus(ps.status);
      }

      const pct = Math.round(ratio * 100);
      const hpCls = ratio <= 0 ? "ko" : (ratio <= 0.25 ? "low" : (ratio <= 0.5 ? "mid" : ""));
      const hpText = ratio <= 0 ? "KO" : `${pct}%`;

      const hpPill = overlay.querySelector(".hp-pill");
      if (hpPill) {
        // Only rewrite if changed (avoid useless DOM churn every tick).
        const newClass = `hp-pill ${hpCls}`.trim();
        if (hpPill.className !== newClass) hpPill.className = newClass;
        if (hpPill.textContent !== hpText) hpPill.textContent = hpText;
      }

      let statusPill = overlay.querySelector(".status-pill");
      if (status) {
        if (!statusPill) {
          statusPill = document.createElement("span");
          statusPill.className = "status-pill";
          overlay.appendChild(statusPill);
        }
        const newClass = `status-pill ${status}`;
        if (statusPill.className !== newClass) statusPill.className = newClass;
        const newText = statusLabel[status] || status;
        if (statusPill.textContent !== newText) statusPill.textContent = newText;
      } else if (statusPill) {
        statusPill.remove();
      }
    }
  }

  // Wrap updateTeamPkmn + updateTeamBuffs so each HP / buff tick propagates
  // to our slot pills. Both functions fire very frequently during combat
  // — refreshFrontierPikePills short-circuits out if nothing's open and
  // diffs before any DOM write when it IS, so the cost per call is
  // negligible.
  function installLivePillHooks() {
    const attach = (name) => {
      if (typeof window[name] !== "function") {
        setTimeout(() => attach(name), 200);
        return;
      }
      const flag = `__frontierExtHook_${name}`;
      if (window[flag]) return;
      window[flag] = true;
      const orig = window[name];
      window[name] = function () {
        const res = orig.apply(this, arguments);
        try { refreshFrontierPikePills(); } catch (e) { /* ignore */ }
        return res;
      };
    };
    attach("updateTeamPkmn");
    attach("updateTeamBuffs");
  }

  // Recursion guard. The MutationObserver on #team-menu watches the
  // `class` + `style` attributes, and this function mutates both —
  // without the guard we'd fire a self-triggering loop that freezes the
  // event loop (the browser hangs without any error).
  let __applyingFrontierLock = false;

  // Apply the lock: toggle class + insert banner + decorate slots with
  // Pike HP / status (if it's a Pike run). Safe to call multiple times;
  // each invocation rebuilds the banner + decorations idempotently.
  //
  // Two modes:
  //   • STRICT: combat launch in progress. Hide the preview-team switcher
  //     so nothing moves while confirming the team for battle.
  //   • TIED-SLOT: the currently-browsed preview team IS the one bound to
  //     the active run. Lock edits on this team but let the player switch
  //     to another preview slot freely — they may want to use a different
  //     team for wild zones / other facilities in the meantime.
  function applyFrontierTeamLock() {
    if (__applyingFrontierLock) return;
    __applyingFrontierLock = true;
    try {
      _applyFrontierTeamLockInner();
    } finally {
      // Let one microtask pass before releasing the guard so the observer
      // callbacks triggered by our own DOM writes get swallowed.
      Promise.resolve().then(() => { __applyingFrontierLock = false; });
    }
  }
  function _removeFrontierTeamLockInner() {
    const teamMenu = document.getElementById("team-menu");
    if (!teamMenu) return;
    teamMenu.classList.remove("frontier-ext-team-locked");
    teamMenu.classList.remove("frontier-ext-team-locked-strict");
    const banner = document.getElementById("frontier-ext-team-lock-banner");
    if (banner) banner.remove();
    document.querySelectorAll(".frontier-ext-team-slot-hp").forEach((el) => el.remove());
    document.querySelectorAll("[data-__frontier-locked-drag='1'], [data-__frontierLockedDrag='1']").forEach((el) => {
      el.draggable = true;
      delete el.dataset.__frontierLockedDrag;
    });
  }

  function _applyFrontierTeamLockInner() {
    const teamMenu = document.getElementById("team-menu");
    if (!teamMenu) return;
    const strict = isFrontierRunActive();
    const tiedSlot = isFrontierTiedSlotActive();
    const midRound = isFrontierMidRound();
    const tiedLock = !strict && tiedSlot && midRound;
    if (!strict && !tiedLock) {
      // Inline remove — avoids self-reentry via the guarded wrapper.
      _removeFrontierTeamLockInner();
      return;
    }
    teamMenu.classList.add("frontier-ext-team-locked");
    teamMenu.classList.toggle("frontier-ext-team-locked-strict", strict);
    const lang = "en";
    const facility = getFrontierRunFacility();
    const facName = facility ? (facility.name) : "";

    // Insert (or refresh) the lock banner above #team-preview.
    let banner = document.getElementById("frontier-ext-team-lock-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "frontier-ext-team-lock-banner";
      banner.className = "frontier-ext-team-lock-banner";
      const preview = document.getElementById("team-preview");
      if (preview && preview.parentNode) {
        preview.parentNode.insertBefore(banner, preview);
      } else {
        teamMenu.appendChild(banner);
      }
    }
    const subtle = strict
      ? "· can't be changed during combat"
      : "· round in progress, switch to another team for other zones";
    const txt = `<span class="lock-icon">🔒</span><span>Team locked — ${facName}</span><span class="subtle">&nbsp;${subtle}</span>`;
    banner.innerHTML = txt;

    // For Pike: delegate HP / status pill decoration to the shared live
    // refresh helper. It's idempotent (reuses existing overlays, diffs
    // before DOM writes) so calling it here aligns the team-menu view
    // with whatever values the combat engine has right now.
    if (facility && isPikeFacility(facility)) {
      migratePikePyramidTeam();
      try { refreshFrontierPikePills(); } catch (e) { /* ignore */ }
    } else {
      // Non-Pike lock (strict mode for other facilities) — strip any
      // stale Pike pills that might linger from a previous run.
      document.querySelectorAll(".frontier-ext-team-slot-hp").forEach((el) => el.remove());
    }

    // Drag-kill safety net: even with pointer-events:none, some browsers
    // still fire dragstart on native draggable elements. Strip the
    // draggable attribute while locked.
    document.querySelectorAll("#team-preview [draggable='true']").forEach((el) => {
      el.dataset.__frontierLockedDrag = "1";
      el.draggable = false;
    });
  }

  function removeFrontierTeamLock() {
    if (__applyingFrontierLock) return;
    __applyingFrontierLock = true;
    try {
      _removeFrontierTeamLockInner();
    } finally {
      Promise.resolve().then(() => { __applyingFrontierLock = false; });
    }
  }

  // Wrap updatePreviewTeam so every render (including initial open, team
  // switch attempts, auto-refreshes) gets the lock applied or stripped
  // automatically. Stacks after any existing Dome / sanitizer wraps.
  function installTeamMenuLockHook() {
    if (typeof window.updatePreviewTeam !== "function") {
      setTimeout(installTeamMenuLockHook, 200);
      return;
    }
    if (window.__frontierExtTeamLockHooked) return;
    window.__frontierExtTeamLockHooked = true;
    const orig = window.updatePreviewTeam;
    window.updatePreviewTeam = function () {
      // Pre-render the lock banner + class BEFORE the game wipes and
      // rebuilds #team-preview. User-visible timing: banner shows first,
      // then the (locked) team slots paint — no unlocked-team flash.
      try { applyFrontierTeamLock(); }
      catch (e) { console.error("[frontier-ext] pre-render lock failed:", e); }
      const res = orig.apply(this, arguments);
      // Post-render pass re-decorates slot cards with HP / status pills
      // (slots were just freshly re-created, so those overlays were
      // wiped with innerHTML = "" inside updatePreviewTeam).
      try { applyFrontierTeamLock(); }
      catch (e) { console.error("[frontier-ext] post-render lock failed:", e); }
      return res;
    };
  }

  // True if the given Pokémon species ID is currently part of the tied
  // preview team of an active frontier run. Used by the right-click
  // blocker to forbid editing the run's Pokémon even when the player
  // browses to them from ANY screen (dex, storage, genetics, etc.).
  function isPkmnInActiveRunTeam(pkmnId) {
    if (!pkmnId) return false;
    if (typeof saved !== "object" || !saved) return false;
    const run = saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return false;
    const tiedSlot = run.tiedPreviewSlot || run.pikeTeamSource;
    if (!tiedSlot) return false;
    const pt = saved.previewTeams && saved.previewTeams[tiedSlot];
    if (!pt) return false;
    for (const sl of ["slot1", "slot2", "slot3"]) {
      if (pt[sl] && pt[sl].pkmn === pkmnId) return true;
    }
    return false;
  }

  // Capture-phase right-click / long-press blocker that stops the game's
  // tooltip.js contextmenu handler from opening the Pokémon editor on
  // any team sprite during an active frontier run.
  //
  // Two independent rules:
  //   • Scope to #explore-team (combat sidebar) + #team-preview
  //     (team-menu) during a run — covers sprites regardless of which
  //     species they depict.
  //   • Any element whose data-pkmn-editor VALUE matches a species in
  //     the tied run-team is blocked anywhere (dex, storage, genetics,
  //     party overview) so you can't bypass the lock by looking up the
  //     mon through a different screen.
  function installFrontierRightClickBlock() {
    if (window.__frontierExtContextBlock) return;
    window.__frontierExtContextBlock = true;
    const shouldBlock = (e) => {
      if (typeof saved !== "object" || !saved) return false;
      if (!saved.frontierExt || !saved.frontierExt.activeRun) return false;
      const target = e.target && e.target.closest
        ? e.target.closest("[data-pkmn-editor]")
        : null;
      if (!target) return false;
      // Rule 1: anywhere, if the sprite points to a run-team species.
      const pkmnId = target.dataset && target.dataset.pkmnEditor;
      if (isPkmnInActiveRunTeam(pkmnId)) return true;
      // Rule 2: anywhere inside team-preview / explore-team containers.
      const exploreTeam = document.getElementById("explore-team");
      const teamPreview = document.getElementById("team-preview");
      return (exploreTeam && exploreTeam.contains(target))
          || (teamPreview && teamPreview.contains(target));
    };
    const blocker = (e) => {
      if (!shouldBlock(e)) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopImmediatePropagation(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
    };
    document.addEventListener("contextmenu", blocker, { capture: true });
  }

  // Capture-phase event filter at the document level. This is the
  // ultimate safety net — it fires BEFORE any game listener (the game's
  // own dragstart/click/touchstart handlers on slot cards, held-item
  // cards, etc. all use bubble phase). If the event target is inside a
  // locked #team-preview, we preventDefault + stopImmediatePropagation so
  // the game never sees it.
  //
  // Even if somebody (me or the user) forgets to set pointer-events or
  // draggable=false on a new DOM node, this blocks the interaction
  // regardless. Events blocked: pointerdown, mousedown, click, dragstart,
  // touchstart (critical for mobile + trackpad drag).
  function installTeamLockEventFilter() {
    if (window.__frontierExtLockFilterInstalled) return;
    window.__frontierExtLockFilterInstalled = true;

    const shouldBlock = (e) => {
      const teamMenu = document.getElementById("team-menu");
      if (!teamMenu || !teamMenu.classList.contains("frontier-ext-team-locked")) return false;
      const preview = document.getElementById("team-preview");
      if (!preview) return false;
      // Block anything inside the team-preview container (slots, held
      // items, move tags, sprite — everything). Header buttons (save,
      // back) live outside and stay clickable.
      return preview.contains(e.target);
    };
    const blocker = (e) => {
      if (!shouldBlock(e)) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopImmediatePropagation(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
    };
    // capture: true fires before game listeners on descendants.
    const opts = { capture: true, passive: false };
    ["pointerdown", "mousedown", "click", "dragstart", "touchstart", "touchmove"]
      .forEach((evt) => document.addEventListener(evt, blocker, opts));
  }

  // Secondary safety net: a MutationObserver that watches #team-menu for
  // visibility / class changes and re-applies the lock. Catches every
  // code path that shows the menu — including paths that bypass
  // updatePreviewTeam (e.g. just toggling display), and repairs state
  // after any F5 / post-bootstrap load race.
  function installTeamMenuObserver() {
    const teamMenu = document.getElementById("team-menu");
    if (!teamMenu) {
      setTimeout(installTeamMenuObserver, 300);
      return;
    }
    if (window.__frontierExtTeamMenuObserved) return;
    window.__frontierExtTeamMenuObserved = true;
    const observer = new MutationObserver(() => {
      try { applyFrontierTeamLock(); }
      catch (e) { /* defensive — never throw from observer */ }
    });
    observer.observe(teamMenu, { attributes: true, attributeFilter: ["style", "class"] });
    // Also run once now in case the menu is already open on load.
    try { applyFrontierTeamLock(); } catch (e) { /* ignore */ }
  }

  // Pokechill resets HP + clears all buffs in `initialiseArea()`
  // (explore.js:3937+ → setPkmnTeamHp() at 3958, then the buff purge
  // loop at 3967-3969). That function runs via a setTimeout inside
  // injectPreviewTeam (teams.js:487 → ~500ms delay) — so a naive wrap
  // on injectPreviewTeam runs BEFORE the reset and gets clobbered.
  //
  // The correct hook point is `initialiseArea` itself: wrap it, let the
  // game reset HP/buffs to their defaults, then re-apply our Pike state
  // at the tail of the same call. Every post-orig write overrides the
  // freshly-maxed value — perfect timing.
  function installPikePyramidHpRestoreHook() {
    if (typeof window.initialiseArea !== "function") {
      setTimeout(installPikePyramidHpRestoreHook, 200);
      return;
    }
    if (window.__frontierExtPikeHpHooked) return;
    window.__frontierExtPikeHpHooked = true;
    const orig = window.initialiseArea;
    window.initialiseArea = function () {
      const res = orig.apply(this, arguments);
      try { applyPikePyramidHpState(); }
      catch (e) { console.error("[frontier-ext] pike post-init apply failed:", e); }
      // Decorate the freshly-built combat sidebar slots (#explore-slotN-
      // member). setPkmnTeam just ran inside initialiseArea and rebuilt
      // those divs from scratch, so any previous overlay is gone.
      try { refreshFrontierPikePills(); }
      catch (e) { /* best-effort */ }
      return res;
    };
  }

  // Snapshot HP% / status from the runtime team[] into run.pikeTeam at
  // the moment combat ends. Called from the leaveCombat hook BEFORE orig
  // fires, so the game hasn't yet reset buffs / HP.
  //
  // HP source: `pkmn[team[sl].pkmn.id].playerHp` / `.playerHpMax`
  // (teams.js:544+).
  // Status source: `team[sl].buffs.<name>` as a turn counter
  // (explore.js:2566 etc.).
  function snapshotPikePyramidHp() {
    try {
      const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
      if (!run) return;
      const fac = FACILITIES.find((f) => f.id === run.facilityId);
      // Snapshot HP/status for ANY facility that opts into persistHpStatus.
      if (!hasRunTeamState(fac)) return;
      if (typeof team === "undefined" || typeof pkmn === "undefined") return;
      migratePikePyramidTeam();
      if (!run.pikeTeam) return;
      const debug = !!window.__frontierExt?.pikeDebug;

      for (const sl of ["slot1", "slot2", "slot3"]) {
        const ps = run.pikeTeam[sl];
        if (!ps) continue;
        if (!team[sl] || !team[sl].pkmn) continue;
        const pokeData = pkmn[team[sl].pkmn.id];
        if (pokeData && pokeData.playerHpMax) {
          const ratio = Math.max(0, Math.min(1, (pokeData.playerHp || 0) / pokeData.playerHpMax));
          if (debug) console.log(`[pike-snap] ${sl} ${team[sl].pkmn.id}: hp ${pokeData.playerHp}/${pokeData.playerHpMax} -> ratio ${ratio}`);
          ps.hpRatio = ratio;
        }
        let activeStatus = null;
        const buffs = team[sl].buffs;
        if (buffs) {
          for (const st of PIKE_PYRAMID_STATUSES) {
            if (buffs[st] > 0) { activeStatus = st; break; }
          }
        }
        if (debug && activeStatus !== ps.status) console.log(`[pike-snap] ${sl}: status ${ps.status} -> ${activeStatus}`);
        ps.status = activeStatus;
      }
    } catch (e) {
      console.error("[frontier-ext] pike HP snapshot failed:", e);
    }
  }

  // ─── 6c. COMBAT LAUNCH ────────────────────────────────────────────────────
  // Ephemeral area id used throughout. Always reassigned before each fight.
  const RUN_AREA_ID = "frontierExtRun";

  // Construct an `areas[RUN_AREA_ID]` object with the trainer's team. Mirrors
  // the shape of vanilla vsTrainer areas (areasDictionary.js line 5152) so
  // the combat engine at explore.js:484 reads slot1/slot1Moves/... natively.
  function buildEphemeralRunArea(trainer, facility) {
    if (typeof areas === "undefined" || typeof pkmn === "undefined") return null;

    // Dôme: enemy AI picks DOME_ACTIVE_SIZE random mons from their 3-team
    // for the actual match. Keep `trainer.team` untouched (so the bracket
    // preview can still show the full roster); just pick a subset for
    // the area mounting.
    let effectiveTeam = trainer.team;
    if (isDomeFacility(facility) && trainer.team.length > DOME_ACTIVE_SIZE) {
      const indices = [0, 1, 2]
        .sort(() => Math.random() - 0.5)
        .slice(0, DOME_ACTIVE_SIZE);
      effectiveTeam = indices.map((i) => trainer.team[i]);
    }

    // Unified difficulty spec — computed once per combat, drives HP mult,
    // IV injection, and ability overrides. Uses run.round+1 since the
    // vanilla streak counter only advances post-victory (onRunVictory).
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    const thisRound = (run && run.round ? run.round : 0) + 1;
    const diff = computeRunDifficulty(thisRound, facility);

    // "Mini-boss" bump: the LAST non-boss battle of a round-set (battle
    // 7/7 of Tower/Palace/Arena/Factory non-boss rounds) feels like a
    // pre-fight warm-up unless we make it noticeably stronger than
    // battles 1–6. Bumps:
    //   • HP multiplier +2
    //   • IV rating +1 (capped at 6)
    //   • Ability always hidden (if defined)
    // The UI surface label shown in openSimulatedFight uses the same
    // `isMiniBossBattle` helper so preview + combat stay consistent.
    if (isMiniBossBattle(run, facility)) {
      diff.hpMult = (diff.hpMult || 4) + 2;
      diff.ivRating = Math.min(6, (diff.ivRating || 0) + 1);
      diff.forceHiddenAbility = true;
      diff.lastBattleBump = true;
    }

    // Apply enemy runtime stat overrides (IVs + ability) to the Pokémon in
    // the effective team. Non-Factory only — Factory already controls
    // pkmn[id].ivs/ability via applyFactoryMoves on the RENTAL side (which
    // the player uses). If we also rewrote enemy state there, we'd clobber
    // rental IVs on species overlap. The Factory trainer dedupe at
    // openSimulatedFight already guarantees enemy/rental species don't
    // intersect, so Factory opts out cleanly here.
    if (run && !isFactoryFacility(facility)) {
      applyEnemyRuntimeStats(run, { team: effectiveTeam }, diff);
    }

    const team = {};
    // Parallel array: simulated natures per slot so the Palace rule can look
    // up the active opponent's nature by slot index at combat time.
    const naturesBySlot = {};
    effectiveTeam.forEach((slot, i) => {
      const slotN = i + 1;
      if (!pkmn[slot.id]) return;
      team["slot" + slotN] = pkmn[slot.id];
      team["slot" + slotN + "Moves"] = slot.moves;
      naturesBySlot[slotN] = slot.nature || simulateNatureFor(slot.id) || "";
    });

    // Fresh arena state — every new combat starts judge-eligible from 0.
    if (isArenaFacility(facility)) arenaResetState();

    areas[RUN_AREA_ID] = {
      id: RUN_AREA_ID,
      name: trainer.name,
      background: facility.background,
      sprite: trainer.sprite,
      // `difficulty` is read by explore.js:531 as the enemy's HP MULTIPLIER
      // (`hpMultiplier = areas[currentArea].difficulty`). The player's own
      // hpMultiplier is 4 for trainer areas (teams.js:514). Uses the unified
      // diff.hpMult: tier*2+2 base curve (4/6/8/10/12) + 2 per post-Gold
      // rematch level — so mult 2 = +2 HP pool, mult 3 = +4, etc. Makes the
      // multiplier actually bite in combat instead of being purely cosmetic.
      difficulty: diff.hpMult || (trainer.tier ? trainer.tier * 2 + 2 : 4),
      trainer: true,
      type: "vs",
      level: 100,
      team,
      // Custom field read by the enemy Palace hook (see installPalaceEnemyHook).
      frontierExtNatures: naturesBySlot,
      frontierExtFacilityId: facility.id,
      fieldEffect: [],
      itemReward: {},
      defeated: false,
      hpPercentage: 100,
      encounterEffect: function () {
        /* no-op — handled in leaveCombat hook */
      } };
    return areas[RUN_AREA_ID];
  }

  // Count how many slots of the currently-selected preview team are filled.
  function currentPreviewTeamSize() {
    try {
      const pt = saved.previewTeams[saved.currentPreviewTeam];
      if (!pt) return 0;
      let n = 0;
      for (const slot of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
        if (pt[slot] && pt[slot].pkmn) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // Size of the team tied to THIS run — the preview slot the player
  // committed at "start" time. Independent of whatever slot they may
  // have switched to in the team menu. Used to catch scenarios where
  // the tied team was emptied mid-run (pre-fix saves, external edits).
  function tiedTeamSize(run) {
    if (!run || !run.tiedPreviewSlot) return 0;
    try {
      const pt = saved.previewTeams && saved.previewTeams[run.tiedPreviewSlot];
      if (!pt) return 0;
      let n = 0;
      for (const slot of ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"]) {
        if (pt[slot] && pt[slot].pkmn) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  // Central guard called at EVERY in-run interaction point that could
  // otherwise progress the run without a real fight (clicking a map
  // tile, walking onto stairs, opening the floor map / swap modal,
  // launching combat, onRunVictory). Returns true if the run can
  // safely proceed. Returns false (and pops the team-size error) if:
  //   • the run exists but the tied preview slot no longer has 3
  //     filled slots (someone emptied it), OR
  //   • the run's currently-selected preview team has <3 filled slots
  //     and the player is about to enter combat on it.
  // Factory is exempt — rentals replace the player's team entirely.
  function canRunProceed(facility) {
    const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
    if (!run) return true; // no run, nothing to guard
    if (isFactoryFacility(facility)) return true;
    if (tiedTeamSize(run) !== 3) {
      showTeamSizeError(facility);
      return false;
    }
    return true;
  }

  // Team size brought INTO the facility. Every Hoenn facility uses 3 per
  // canonical Gen 3 rules. The Dôme still uses 3 here because the
  // signature rule is "bring 3, pick 2 per match" (see DOME_ACTIVE_SIZE
  // below and the player-pick modal in openDomePokemonSelection).
  function expectedTeamSize(facility) {
    return 3;
  }

  // Dôme only — how many of the 3 Pokémon actually fight in each match.
  // Canonical Gen 3 Emerald: both sides see each other's 3-mon roster,
  // then each side secretly picks 2 to send into battle.
  const DOME_ACTIVE_SIZE = 2;

  function showTeamSizeError(facility) {
    const lang = "en";
    const expected = expectedTeamSize(facility);
    const title = "Invalid team size";
    const msg = `This facility uses Gen 3 rules: exactly ${expected} Pokémon per team. Adjust your team via the editor before starting a fight.`;
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    if (top) top.style.display = "none";
    if (titleEl) { titleEl.style.display = "block"; titleEl.innerHTML = "⚠️ " + title; }
    if (mid) { mid.style.display = "block"; mid.innerHTML = `<div style="padding:0.6rem 0.8rem;">${msg}</div>`; }
    if (bottom) bottom.style.display = "none";
    if (typeof openTooltip === "function") openTooltip();
  }

  // Shown when a run is forced to end because the tied preview slot drifted
  // below 3 Pokémon AND the current preview slot isn't a valid fallback.
  // Replaces what used to be a silent activeRun=null assignment — players
  // kept reporting streaks that "vanished" mid-run (e.g. Tower locked at 16,
  // Palace at 11) without any message. Now they see the why.
  function showTiedTeamLostModal(facility) {
    const lang = "en";
    const title = "Run ended";
    const msg = `The team tied to your run has fewer than 3 Pokémon — runs can't continue on an incomplete team. Start a new streak once your team is back to 3. <br><br><em>Tip: between rounds, keep the same team selection or refill to 3 before clicking "Continue".</em>`;
    const top = document.getElementById("tooltipTop");
    const titleEl = document.getElementById("tooltipTitle");
    const mid = document.getElementById("tooltipMid");
    const bottom = document.getElementById("tooltipBottom");
    if (top) top.style.display = "none";
    if (titleEl) { titleEl.style.display = "block"; titleEl.innerHTML = "⚠️ " + title; }
    if (mid) { mid.style.display = "block"; mid.innerHTML = `<div style="padding:0.7rem 0.9rem;line-height:1.35;">${msg}</div>`; }
    if (bottom) bottom.style.display = "none";
    if (typeof openTooltip === "function") openTooltip();
  }

  // Kick off a real combat round. Same flow as vanilla tile click:
  //   1) set saved.currentAreaBuffer
  //   2) show the team-preview menu
  //   3) hide explore menu
  // The player then picks their team + confirms, which triggers the
  // vanilla combat start path. No need to re-implement combat.
  function launchCombat(facility) {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run || run.facilityId !== facility.id) return;

    // Team-size check — skipped if a Dôme selection has already been
    // applied (handleRunAction("confirm-dome") path). In that state the
    // preview team has been mutated to 2 slots on purpose, and the size
    // check was already done in handleRunAction("launch") *before* the
    // mutation happened. Two-layered validation: the current preview
    // must have 3 (for the vanilla team-preview menu this opens), AND
    // the tied slot must still have 3 (catches emptied tied team).
    const domeApplied = run.domeTeamBackup && isDomeFacility(facility);
    if (!domeApplied) {
      const teamSize = currentPreviewTeamSize();
      if (teamSize !== 3) {
        showTeamSizeError(facility);
        return;
      }
      if (!canRunProceed(facility)) return;
    }

    const nextRound = run.round + 1;
    const bossInfo = getBossRoundInfo(nextRound, facility);
    // For Tower/Palace/Arena/Factory the brain only appears at the FINAL
    // battle of a boss round. Battles 1..N-1 use regular pool trainers
    // even if nextRound === SILVER/GOLD_ROUND. Dome has its own brain
    // placement (last bracket slot, handled by ensureBracketForDome).
    // Pike triggers brain through its door picker — any launchCombat
    // coming from a "brain" door already implies the final-room moment,
    // so Pike keeps the original behaviour unchanged.
    const perRound = battlesPerRound(facility);
    const battleInRound = run.battleInRound || 1;
    // Brain-gate. The brain fight must ONLY appear in specific slots:
    //   • Tower/Palace/Arena/Factory : final battle of a boss round
    //     (battleInRound === perRound).
    //   • Pike : ONLY when the player is on the final room (room 14)
    //     of a boss round. Earlier rooms on the same boss round use
    //     regular trainers from the door picker; forcing the brain
    //     path there meant every Pike trainer on the boss round got
    //     Charline's Seviper/Shuckle/Milotic roster (reported bug).
    //   • Pyramid : the stairs-on-boss-floor tile sets
    //     run.pyramidEncounterKind = "brain" right before launchCombat,
    //     which this marker picks up (battleInRound stays 1 across
    //     all 7 floors so it can't be used as a proxy).
    const brainDueThisBattle = bossInfo
      && !isDomeFacility(facility)
      && (
        (isPikeFacility(facility) && run.pikeRoom === PIKE_ROOM_COUNT)
        || (isPyramidFacility(facility) && run.pyramidEncounterKind === "brain")
        || (!isPikeFacility(facility) && !isPyramidFacility(facility)
            && battleInRound === perRound)
      );

    // Regenerate (or keep) the upcoming trainer for this round
    let trainer;
    if (isDomeFacility(facility)) {
      // Dome: pull the pre-generated trainer from the bracket array at
      // the current sub-position (bracketBattle 1/2/3).
      const bracket = ensureBracketForDome(facility);
      const idx = (run.bracketBattle || 1) - 1;
      trainer = bracket[idx] || generateTrainer(nextRound, facility);
    } else if (brainDueThisBattle) {
      // Post-Gold rematches use the Gold team; Silver uses the Silver team.
      const brainTeam = bossInfo.kind === "silver"
        ? facility.brain.teamSilver
        : facility.brain.teamGold;
      const brainDiff = computeRunDifficulty(nextRound, facility);
      trainer = {
        name: facility.brain.name,
        sprite: facility.brain.sprite,
        team: brainTeam
          ? brainTeam.map((id) => ({
              id,
              moves: pickMovesetFor(id, brainDiff),
              nature: simulateNatureFor(id) }))
          : [1, 2, 3].map(() => {
              const id = pickFromPool(5);
              return { id, moves: pickMovesetFor(id, brainDiff), nature: simulateNatureFor(id) };
            }),
        tier: brainDiff.tier,
        multiplier: bossInfo.multiplier,
        bossKind: bossInfo.kind,
        isBoss: true };
    } else {
      trainer = run.upcomingTrainer || generateTrainer(nextRound, facility);
    }
    run.upcomingTrainer = trainer;

    const area = buildEphemeralRunArea(trainer, facility);
    if (!area) return;

    // Follow the same team-preview opening flow as the vanilla tiles
    // (explore.js Battle Tower tile click handler at line ~7399).
    try {
      saved.currentAreaBuffer = RUN_AREA_ID;
      const previewExit = document.getElementById("preview-team-exit");
      const teamMenu = document.getElementById("team-menu");
      const menuBtn = document.getElementById("menu-button-parent");
      const exploreMenu = document.getElementById("explore-menu");
      // Vanilla team-preview header has TWO buttons: "Save and Go!"
      // (preview-team-exit) and "Go back" (pkmn-team-return). The
      // latter is an escape hatch that bypasses combat without
      // triggering our defeat / abandon flow — letting a frontier
      // player skip unfavourable matchups or dodge battles. Hide it
      // here; restored by explore.js menu handler on legit menu
      // switches. The runtime wrapper on exitPkmnTeam below also
      // no-ops the handler in case the button is revealed via
      // devtools.
      const teamReturn = document.getElementById("pkmn-team-return");
      if (teamReturn) teamReturn.style.display = "none";
      if (previewExit) previewExit.style.display = "flex";
      if (teamMenu) {
        teamMenu.style.zIndex = "50";
        teamMenu.style.display = "flex";
      }
      if (menuBtn) menuBtn.style.display = "none";
      if (typeof updatePreviewTeam === "function") updatePreviewTeam();
      if (typeof afkSeconds !== "undefined") window.afkSeconds = 0;
      if (exploreMenu) exploreMenu.style.display = "none";
      if (typeof closeTooltip === "function") closeTooltip();
    } catch (e) {
      console.error("[frontier-ext] failed to open preview menu:", e);
    }
  }

  // Called from the leaveCombat hook on victory.
  function onRunVictory() {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const facility = FACILITIES.find((f) => f.id === run.facilityId);
    // Belt-and-braces: any call site that reaches onRunVictory with an
    // invalid tied team means something slipped past the per-entry
    // guards. Refuse to credit the streak and abandon the run instead
    // of advancing. Factory is exempt (rentals, no tied preview).
    //
    // Historically silent — which meant players who swapped or edited
    // their preview slot between rounds would have their run vanish
    // mid-progression without ever seeing a message. Now visible: we
    // pop a clear tooltip explaining what happened, and only then kill
    // the run. Defensive: also re-tie to currentPreviewTeam if THAT
    // slot has 3 — gives the player an automatic recovery before we
    // have to abandon at all.
    if (!isFactoryFacility(facility) && tiedTeamSize(run) !== 3) {
      if (currentPreviewTeamSize() === 3) {
        // Silent auto-heal: the CURRENT team is valid, the tied slot
        // just drifted. Re-point the tied slot and continue as if
        // nothing happened — the streak lives.
        run.tiedPreviewSlot = saved.currentPreviewTeam;
      } else {
        // Current team also invalid → no way to continue. Show the
        // player WHY their streak ended instead of silently nuking it.
        try { showTiedTeamLostModal(facility); } catch (e) { /* ignore */ }
        saved.frontierExt.activeRun = null;
        try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
        refreshActiveFrontierView();
        return;
      }
    }

    // Dome: victory advances sub-battle first; round only advances when the
    // whole 3-fight bracket is cleared. Symbol checks happen on bracket
    // completion, not per battle.
    if (isDomeFacility(facility)) {
      run.bracketBattle = (run.bracketBattle || 1) + 1;
      if (run.bracketBattle <= DOME_BRACKET_SIZE) {
        // Still more opponents in this bracket — don't advance round yet.
        run.upcomingTrainer = null;
        return;
      }
      // Bracket cleared → advance round + reset bracket state.
      run.bracketBattle = 1;
      run.bracketTrainers = null;
      run.bracketRound = null;
    }

    // Pyramid — combats happen inside the dungeon. Round completion is
    // driven by the dungeon state (floor > 7 OR floor-7 brain win), not
    // a fixed battle count. So we skip the battleInRound logic here and
    // handle it separately below.
    if (isPyramidFacility(facility)) {
      const brainWin = run.pyramidEncounterKind === "brain";
      run.pyramidEncounterKind = null;
      if (brainWin) {
        // Boss-floor brain combat cleared → full round complete.
        run.pyramidRoundComplete = true;
      }
      if (run.pyramidRoundComplete) {
        run.pyramidRoundComplete = false;
        run.pyramid = null; // fresh dungeon next round
        // Advance the theme index — canonical Pyramid cycles themes per
        // successful series. The Combat Bag persists across this
        // transition (pyramidEnsureBag is a no-op if already set).
        run.pyramidThemeIndex = ((run.pyramidThemeIndex | 0) + 1) % PYRAMID_THEME_COUNT;
        // Canonical round-end housekeeping:
        //   1. Full heal + status cure across the team. Matches Pike's
        //      behaviour at room 14 clear — each new series starts at
        //      100% HP, no lingering statuses from the previous run.
        //   2. Unequip held items. "Les objets tenus par vos Pokémon
        //      sont automatiquement rangés dans le Sac de Combat" —
        //      in our held-in-bag model the bag already owns them, so
        //      we just null pikeTeam[sl].item + wipe the preview
        //      mirror so the locked-team UI and the registration
        //      check both see an itemless team next series.
        if (run.pikeTeam) {
          for (const sl of ["slot1", "slot2", "slot3"]) {
            const ps = run.pikeTeam[sl];
            if (!ps) continue;
            ps.hpRatio = 1.0;
            ps.status = null;
            if (ps.item) {
              mirrorPyramidItemToPreview(sl, null);
              ps.item = null;
            }
          }
        }
        // Fall through to round++ path below.
      } else {
        // Normal dungeon encounter (trainer / wild) — stay in the
        // dungeon. The run.pyramid state is kept; exit-redirect hook
        // auto-reopens the floor map.
        run.upcomingTrainer = null;
        return;
      }
    }

    // Tower / Palace / Arena / Factory — battles come in sets of N (usually
    // 7 per canonical Gen 3 structure). A victory in battle 1..N-1 of a
    // round just advances the counter; only the Nth win triggers the
    // round-advance + boss + round-cleared modal.
    const perRound = battlesPerRound(facility);
    if (perRound > 1 && !isPikeFacility(facility) && !isDomeFacility(facility) && !isPyramidFacility(facility)) {
      // Factory canonical swap rule: after every battle except the last
      // of a round, the player may trade one of their 3 rentals with one
      // of the defeated opponent's 3. Stash the opponent's team HERE,
      // before upcomingTrainer is nulled out, so the swap modal can
      // render the candidates.
      //
      // The swap spec captures the opponent's ACTUAL combat stats ("you
      // take the Pokémon that hit you" — canon Gen 3 Factory): IVs +
      // ability are snapshotted from pkmn[id] as it stood during the
      // fight, not re-rolled. Moves + nature come from the NPC trainer
      // spec. Species overlap with the player's rental team was already
      // eliminated at trainer-generation time (see openSimulatedFight
      // dedupe block), so pkmn[id] here reflects the opponent's own
      // state (either trained by the player in the main game, or the
      // engine defaults for never-caught species).
      if (isFactoryFacility(facility)
          && run.upcomingTrainer
          && (run.battleInRound || 1) < perRound) {
        run.pendingFactorySwap = (run.upcomingTrainer.team || []).map((r) => {
          const p = (typeof pkmn !== "undefined" && pkmn[r.id]) ? pkmn[r.id] : null;
          return {
            id: r.id,
            moves: r.moves || pickMovesetFor(r.id),
            nature: r.nature || simulateNatureFor(r.id) || "",
            ivs: (p && p.ivs) ? { ...p.ivs } : { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spe: 0 },
            ability: (p && p.ability) ? p.ability : null };
        });
      }
      run.battleInRound = (run.battleInRound || 1) + 1;
      if (run.battleInRound <= perRound) {
        run.upcomingTrainer = null;
        return;
      }
      // Round cleared — reset counter, fall through to round++ path.
      run.battleInRound = 1;
    }

    // Pike: combat victory advances the room counter. The round only ticks
    // over when room 14 is cleared. HP/status persist between rooms and
    // reset only when a full round is done.
    if (isPikeFacility(facility)) {
      // combat_tough doors promise a full team heal if the player wins
      // (canonical "hard solo fight, victory = heal" rule). Flag set in
      // applyPikeDoor, cleared here regardless of fight outcome so a
      // later normal combat never inherits a stale heal promise.
      if (run.pikePostBattleHeal && run.pikeTeam) {
        for (const sl of ["slot1", "slot2", "slot3"]) {
          if (run.pikeTeam[sl]) {
            run.pikeTeam[sl].hpRatio = 1.0;
            run.pikeTeam[sl].status = null;
            run.pikeTeam[sl].healJustApplied = true; // glow flag
          }
        }
      }
      run.pikePostBattleHeal = false;
      run.pikeRoom = (run.pikeRoom || 1) + 1;
      run.pikeDoors = null;
      run.pikeDoorPicked = null;
      run.pikeHint = null;
      if (run.pikeRoom <= PIKE_ROOM_COUNT) {
        // More rooms to go — keep HP/status, don't advance round.
        run.upcomingTrainer = null;
        return;
      }
      // Final room cleared → round advance + heal / cure the Pike team
      // for the next round. Don't wipe pikeTeam: we keep the same mons /
      // items for the whole run, just restore them to full between rounds.
      run.pikeRoom = 1;
      if (run.pikeTeam) {
        for (const sl of ["slot1", "slot2", "slot3"]) {
          if (run.pikeTeam[sl]) {
            run.pikeTeam[sl].hpRatio = 1.0;
            run.pikeTeam[sl].status = null;
          }
        }
      }
    }

    run.round += 1;
    saved.frontierExt.streaks[run.facilityId] = run.round;
    if (run.round > (saved.frontierExt.maxStreaks[run.facilityId] || 0)) {
      saved.frontierExt.maxStreaks[run.facilityId] = run.round;
    }
    if (run.round === silverRoundFor(facility)) saved.frontierExt.symbols[run.facilityId].silver = true;
    else if (run.round === goldRoundFor(facility)) saved.frontierExt.symbols[run.facilityId].gold = true;
    run.upcomingTrainer = null;
    // Flag the round-clear so the exit-redirect hook shows a celebration
    // modal (matches vanilla Battle Tower's "save & change team every
    // 7 floors" pattern — each facility uses the modal between rounds).
    run.roundJustCleared = true;
  }

  function onRunDefeat() {
    ensureSaveSlot();
    const run = saved.frontierExt.activeRun;
    if (!run) return;
    const final = run.round;
    if (final > (saved.frontierExt.maxStreaks[run.facilityId] || 0)) {
      saved.frontierExt.maxStreaks[run.facilityId] = final;
    }
    // Factory: restore overridden moves + preview slot BEFORE clearing
    // activeRun, otherwise the stash references disappear.
    const fac = FACILITIES.find((f) => f.id === run.facilityId);
    if (isFactoryFacility(fac)) cleanupFactoryRun(run);
    // Defensive enemy-state restore. exitCombat hook normally does this,
    // but if the defeat path ever fires without going through exitCombat
    // (or if the hook short-circuited) we still want pkmn[] clean.
    try { restoreEnemyRuntimeStats(run); } catch (e) { /* ignore */ }
    if (isPyramidFacility(fac)) {
      try { setPyramidModalSizing(false); } catch (e) { /* ignore */ }
      try { cleanupPyramidPreviewItems(run); } catch (e) { /* ignore */ }
    }
    saved.frontierExt.activeRun = null;
    saved.frontierExt.streaks[run.facilityId] = 0;
    // Run is dead → remove the team-menu lock so the player can reorganise
    // their teams freely again.
    try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
  }

  // Wrap updateVS (explore.js:6797) so our ephemeral RUN_AREA_ID area
  // never appears in the VS Trainers listing. The vanilla filter is just
  // `type === "vs" && !defeated`, which matches our ephemeral area between
  // when buildEphemeralRunArea creates it (defeated=false) and when the
  // game flags it defeated=true on victory. If the player escapes the
  // team-preview menu, or if they lose a run (defeated stays false), the
  // ghost trainer stays in `areas` and leaks into VS until a page refresh.
  //
  // We can't just delete the area post-combat (exitCombat at explore.js:780
  // reads `areas[saved.lastAreaJoined].type` and crashes if missing), so
  // instead we temporarily pull it out of `areas` just while updateVS
  // iterates, then restore it. No state loss, zero VS leak.
  function installVSLeakFilter() {
    if (typeof window.updateVS !== "function") {
      setTimeout(installVSLeakFilter, 150);
      return;
    }
    if (window.__frontierExtVSHooked) return;
    window.__frontierExtVSHooked = true;
    const orig = window.updateVS;
    window.updateVS = function () {
      const stash = (typeof areas === "object" && areas) ? areas[RUN_AREA_ID] : null;
      if (stash) delete areas[RUN_AREA_ID];
      try {
        return orig.apply(this, arguments);
      } finally {
        if (stash) areas[RUN_AREA_ID] = stash;
      }
    };
  }

  // Wrap exitCombat so that after any frontier-ext run battle ends, the
  // player lands on the Battle Frontier tab (not the VS Trainers tab).
  // explore.js:869 forces updateVS() for any area with `trainer: true`,
  // which overrides the Frontier view set earlier at line 866 — we
  // re-apply updateFrontier() after the original exit finishes.
  function installExitRedirect() {
    if (typeof window.exitCombat !== "function") {
      setTimeout(installExitRedirect, 200);
      return;
    }
    if (window.__frontierExtExitHooked) return;
    window.__frontierExtExitHooked = true;
    const orig = window.exitCombat;
    window.exitCombat = function () {
      const wasFrontierRun =
        typeof saved !== "undefined" &&
        saved &&
        (saved.currentArea === RUN_AREA_ID ||
          saved.lastAreaJoined === RUN_AREA_ID);
      // Restore enemy runtime stat overrides BEFORE the vanilla exitCombat
      // runs — so any post-combat state reads (achievements, dex updates,
      // player-team inspection) sees the untouched pkmn[id] state again.
      // Factory has its own cleanup path; applyEnemyRuntimeStats is strictly
      // non-Factory.
      if (wasFrontierRun) {
        const _run = saved && saved.frontierExt && saved.frontierExt.activeRun;
        if (_run) {
          try { restoreEnemyRuntimeStats(_run); } catch (e) { /* ignore */ }
        }
      }
      const res = orig.apply(this, arguments);
      if (wasFrontierRun && typeof updateFrontier === "function") {
        try {
          // Route the post-combat view back to whichever sub-tab holds
          // the facility the run belongs to. Hoenn BF sub-tab for our 7
          // facilities, vanilla Battle Frontier tab for everything else.
          refreshActiveFrontierView();
          // Post-combat auto-reopen. The ZdC flow should always land on a
          // clear "next step" modal — never dump the player on the
          // Frontier tab with no guidance. Branches, in priority order:
          //   1. Round was just cleared (any facility)   : celebration modal
          //   2. Pike mid-round                          : 3-door picker
          //   3. Dome mid-bracket                        : bracket preview
          //   4. Tower/Palace/Arena/Factory mid-round    : next-battle preview
          // Re-check activeRun inside the deferred callback so an abandon
          // between now and the timeout firing doesn't resurrect anything.
          setTimeout(() => {
            const laterRun = saved && saved.frontierExt && saved.frontierExt.activeRun;
            if (!laterRun) return;
            const fac = FACILITIES.find((f) => f.id === laterRun.facilityId);
            if (!fac) return;

            // 1. End-of-round celebration (flag stays alive until
            //    round-continue / continue consumes it).
            if (laterRun.roundJustCleared) {
              showRoundClearedModal(fac);
              return;
            }

            // 2. Pike — auto-open the 3-curtain picker at the next room.
            if (isPikeFacility(fac)
                && laterRun.pikeRoom >= 1
                && laterRun.pikeRoom <= PIKE_ROOM_COUNT) {
              openPikeRoomPreview(fac);
              return;
            }

            // 2b. Pyramid — come back to the floor map after every
            //     combat (dungeon tile-by-tile exploration). The active
            //     pyramid state is kept alive across combats.
            if (isPyramidFacility(fac) && laterRun.pyramid) {
              openPyramidFloorMap(fac);
              return;
            }

            // 3. Dome — auto-open the bracket preview on the next
            //    sub-battle of the same round.
            if (isDomeFacility(fac) && (laterRun.bracketBattle || 1) > 1) {
              openDomeBracketPreview(fac);
              return;
            }

            // 4. Tower / Palace / Arena / Factory — auto-open the next-step
            //    screen. Factory first shows the post-battle swap modal
            //    (when a swap is pending); other facilities go straight
            //    to the simulated-fight preview for the next battle.
            //    battleInRound has been incremented to the *next* battle
            //    in onRunVictory (stays <= perRound until round cleared).
            const perRound = battlesPerRound(fac);
            if (perRound > 1
                && !isPikeFacility(fac)
                && !isDomeFacility(fac)
                && !isPyramidFacility(fac)
                && (laterRun.battleInRound || 1) > 1
                && (laterRun.battleInRound || 1) <= perRound) {
              // Factory post-battle swap offer — renders instead of the
              // simulated fight preview. On skip / confirm the swap
              // handlers themselves open the fight preview.
              if (isFactoryFacility(fac) && Array.isArray(laterRun.pendingFactorySwap)) {
                openFactorySwapModal(fac);
                return;
              }
              openSimulatedFight(fac);
              return;
            }
          }, 80);
        } catch (e) {
          console.error("[frontier-ext] frontier redirect failed:", e);
        }
      }
      return res;
    };
  }

  // Wrap leaveCombat so we can detect which side won when it returns from
  // a frontier-ext run area. Installed once at bootstrap, retries until the
  // game's leaveCombat is defined.
  // Block the vanilla "Go back" (#pkmn-team-return) button from
  // closing the team-preview menu while a frontier run is staged for
  // combat. Without this, the player can back out of the pre-combat
  // team-preview screen, skip the fight entirely, and come back later
  // — getting a fresh trainer re-roll with no cost. We already hide
  // the button visually in launchCombat, but this wrap is the
  // defence-in-depth that also no-ops the handler itself.
  function installExitPkmnTeamBlock() {
    if (typeof window.exitPkmnTeam !== "function") {
      setTimeout(installExitPkmnTeamBlock, 200);
      return;
    }
    if (window.__frontierExtExitPkmnTeamHooked) return;
    window.__frontierExtExitPkmnTeamHooked = true;
    const orig = window.exitPkmnTeam;
    window.exitPkmnTeam = function () {
      try {
        const inRun = typeof saved !== "undefined" && saved &&
                      saved.frontierExt && saved.frontierExt.activeRun;
        const stagedForRunCombat = inRun && saved.currentAreaBuffer === RUN_AREA_ID;
        if (stagedForRunCombat) {
          // Silent no-op — the player must either Save & Go (launch)
          // or abandon the run from the facility panel.
          return;
        }
      } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    };
  }

  // Scale enemy max HP by the current diff's IV rating, mirroring the
  // player-side formula `(base) * Math.pow(1.1, healthIvs)`. Vanilla
  // setWildPkmn computes wildPkmnHp using only pkmn[id].bst.hp + level
  // + area.difficulty — no IV term — so a round-20 enemy with diff.
  // ivRating=6 had the same HP pool as a round-1 enemy with ivRating=0.
  // Now the HP pool grows 1.1^ivRating (max 1.77× at iv 6), matching
  // how the player's own IVs scale their own HP.
  function installEnemyIvHpHook() {
    if (typeof window.setWildPkmn !== "function") {
      setTimeout(installEnemyIvHpHook, 150);
      return;
    }
    if (window.__frontierExtEnemyIvHpHooked) return;
    window.__frontierExtEnemyIvHpHooked = true;
    const orig = window.setWildPkmn;
    const globalEval = eval;
    window.setWildPkmn = function () {
      const res = orig.apply(this, arguments);
      try {
        // Only scale inside a Frontier run — leave vanilla wild areas
        // untouched. The initial setWildPkmn of a combat fires BEFORE
        // the engine swaps saved.currentArea from the overworld to
        // RUN_AREA_ID, so a strict currentArea === RUN_AREA_ID check
        // misses the first enemy load (and thus the judge read a
        // vanilla-sized enemy HP pool). Accept EITHER currentArea OR
        // currentAreaBuffer pointing at RUN_AREA_ID — the buffer is
        // set in launchCombat well before the setWildPkmn call.
        if (typeof saved !== "object" || !saved) return res;
        const inRunArea = saved.currentArea === RUN_AREA_ID
                       || saved.currentAreaBuffer === RUN_AREA_ID;
        if (!inRunArea) return res;
        const run = saved.frontierExt && saved.frontierExt.activeRun;
        if (!run) return res;
        const facility = FACILITIES.find((f) => f.id === run.facilityId);
        if (!facility) return res;
        const diff = computeRunDifficulty(run.round + 1, facility);
        const mult = Math.pow(1.1, Math.max(0, Math.min(6, diff.ivRating | 0)));
        if (mult === 1) return res;
        globalEval("wildPkmnHp = wildPkmnHp * " + mult);
        globalEval("wildPkmnHpMax = wildPkmnHpMax * " + mult);
        if (typeof updateWildPkmn === "function") updateWildPkmn();
      } catch (e) { console.error("[frontier-ext] enemy IV HP scale failed:", e); }
      return res;
    };
  }

  function installCombatHook() {
    if (typeof window.leaveCombat !== "function") {
      setTimeout(installCombatHook, 200);
      return;
    }
    if (window.__frontierExtLeaveCombatHooked) return;
    window.__frontierExtLeaveCombatHooked = true;
    const orig = window.leaveCombat;
    window.leaveCombat = function () {
      const wasFrontierRun = typeof saved !== "undefined" && saved &&
                             saved.currentArea === RUN_AREA_ID;
      // explore.js sets `areas[currentArea].defeated = true` BEFORE calling
      // leaveCombat() on victory. If the flag is set when we arrive here,
      // the player won this round; otherwise they lost (or abandoned).
      const wasVictory = wasFrontierRun &&
                         areas[RUN_AREA_ID] &&
                         areas[RUN_AREA_ID].defeated === true;
      // Pike: snapshot HP% + status from runtime team[] BEFORE the game
      // starts cleaning up combat state. We must act before orig to catch
      // the real values; the post-orig branch then does the higher-level
      // victory/defeat routing.
      if (wasFrontierRun && wasVictory) {
        try { snapshotPikePyramidHp(); }
        catch (e) { console.error("[frontier-ext] pike snapshot failed:", e); }
      }
      const res = orig.apply(this, arguments);
      if (wasFrontierRun) {
        try {
          // Hide the "Rejoin" (recombattre) button — it reads stale trainer
          // data from our ephemeral RUN_AREA_ID and doesn't actually re-fire
          // the facility's next-round logic. Frontier runs ALWAYS advance via
          // the facility preview's Continue button, never the area-rejoin
          // shortcut, so force it hidden in our zones regardless of
          // victory/defeat. Vanilla code sets it visible at explore.js:821
          // then conditionally hides on defeated — our override covers the
          // defeat case too.
          const rejoinBtn = document.getElementById("area-rejoin");
          if (rejoinBtn) rejoinBtn.style.display = "none";
          if (wasVictory) onRunVictory();
          else onRunDefeat();
          // No more preview-team mutation to restore — the Dôme now
          // filters team[] at runtime via installDomeTeamFilter, leaving
          // saved.previewTeams untouched throughout the match.
          // Legacy safety: if an older buggy save still has a backup,
          // restoreDomeSelection() heals it. No-op otherwise.
          restoreDomeSelection();
          const r = saved.frontierExt && saved.frontierExt.activeRun;
          if (r) r.domeSelection = [];
          // DO NOT delete areas[RUN_AREA_ID] here — the game calls
          // exitCombat() *after* leaveCombat() (triggered by the end-of-
          // battle screen buttons), and it reads areas[saved.lastAreaJoined]
          // at explore.js:780. Removing the area causes an uncaught
          // TypeError. Next round's buildEphemeralRunArea() will overwrite
          // the slot, so leaving it in place is safe.
        } catch (e) {
          console.error("[frontier-ext] post-combat failed:", e);
        }
      }
      return res;
    };
  }

  // ─── 7. INJECTION HOOK ────────────────────────────────────────────────────
  // Patch updateVS() / updateFrontier() so the "ZdC d'Hoenn" sub-tab button
  // gets re-appended to the vanilla #vs-selector every time they re-render
  // it (the vanilla rebuild wipes it otherwise), and clears our own listing
  // when the player switches to a different tab. Adds a global
  // `window.updateHoennBF` that does the mirror-image: hides the other
  // listings, highlights the Hoenn tab, renders the 7 secret facilities
  // into `#frontier-hoenn-listing`.
  const HOENN_TAB_ID = "frontier-hoenn-tab";
  const HOENN_LISTING_ID = "frontier-hoenn-listing";

  // DOM guard: creates the Hoenn listing div next to the vanilla ones
  // (siblings inside #vs-menu). Returns the element, or null if the
  // frontier-listing host isn't in the DOM yet (game still booting).
  function ensureHoennListing() {
    let el = document.getElementById(HOENN_LISTING_ID);
    if (el) return el;
    const frontierListing = document.getElementById("frontier-listing");
    if (!frontierListing || !frontierListing.parentNode) return null;
    el = document.createElement("div");
    el.id = HOENN_LISTING_ID;
    el.style.display = "none";
    frontierListing.parentNode.insertBefore(el, frontierListing.nextSibling);
    return el;
  }

  // Build the tab button node. Active = purple pill; inactive = neutral.
  // The SVG is a spiky tower icon distinct from the vanilla "Trainers"
  // circle and "Battle Frontier" flag so the three tabs read at a glance.
  function buildHoennTabButton(lang, active) {
    const btn = document.createElement("div");
    btn.id = HOENN_TAB_ID;
    btn.onclick = () => { if (typeof window.updateHoennBF === "function") window.updateHoennBF(); };
    if (active) {
      btn.style.cssText = "background:#6b4694; outline:solid 1px #a14dff; color:white; z-index:2;";
    }
    const label = "Hoenn BF";
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32"><path fill="currentColor" d="M14 2h4v2h-4zm-1 3h6v3h-6zm-2 4h10v2h-10zm1 3h8v4h-8zm-1 5h10v3h-10zm-1 4h12v3h-12zm-1 4h14v3h-14zm-1 4h16v4h-16z"/></svg>
      ${label}`;
    return btn;
  }

  // Inject / re-inject the Hoenn tab button into #vs-selector. Vanilla
  // updateVS / updateFrontier overwrite the selector's innerHTML on every
  // call, so this has to be called AFTER the vanilla rebuild — otherwise
  // the button disappears the moment the player clicks another tab.
  function ensureHoennTabButton() {
    const sel = document.getElementById("vs-selector");
    if (!sel) return;
    if (sel.querySelector(`#${HOENN_TAB_ID}`)) return;
    const lang = "en";
    sel.appendChild(buildHoennTabButton(lang, false));
  }

  // Single "refresh the current listing" helper. Used by internal code
  // paths that need to re-render after a state change (abandon, victory,
  // rest, etc.) — routes to the Hoenn tab if the active run is in one
  // of our facilities, otherwise falls back to the vanilla frontier tab.
  function refreshActiveFrontierView() {
    // Keep the main-menu lock CSS in sync with run state. Cheap no-op
    // when no menu is mounted or installer hasn't run yet.
    try {
      if (typeof window.__frontierExtSyncMenuLock === "function") {
        window.__frontierExtSyncMenuLock();
      }
    } catch (e) { /* ignore */ }
    const fe = saved && saved.frontierExt;
    const activeRun = fe && fe.activeRun;
    const pausedIds = fe && fe.pausedRuns ? Object.keys(fe.pausedRuns) : [];
    const isHoennActive = activeRun && FACILITIES.some((f) => f.id === activeRun.facilityId);
    const hasHoennPaused = pausedIds.some((id) => FACILITIES.some((f) => f.id === id));
    // Also keep the player on the Hoenn tab if that's where they
    // currently are — otherwise a Rest action (which clears activeRun)
    // would kick them back to vanilla Battle Frontier tab, so the new
    // EN PAUSE badge on the same tile they just interacted with is
    // never visible. Checks computed display on our listing div.
    const hoennListing = document.getElementById(HOENN_LISTING_ID);
    const onHoennTab = !!(hoennListing && getComputedStyle(hoennListing).display !== "none");
    if ((isHoennActive || hasHoennPaused || onHoennTab) && typeof window.updateHoennBF === "function") {
      window.updateHoennBF();
    }
    // No vanilla-updateFrontier fallback here. Previously this branch
    // fired updateFrontier() on every boot via installLoadGameIntegrityHook,
    // which for pre-Giovanni saves triggered the vanilla "Defeat Team
    // Leader Giovanni in VS mode to unlock" popup on every F5. The
    // call was unnecessary — vanilla's own boot path at explore.js:866
    // already handles the case where saved.currentArea is Frontier-typed,
    // and there's no reason for the ZdC overlay to force a Frontier
    // refresh when the player has no Hoenn context. Silent no-op when
    // nothing ZdC-related is active.
  }

  // ─── FACTORY RESTRICTED-MOVES BYPASS ──────────────────────────────────────
  // The enemy moveset generator intentionally ignores the vanilla "at most
  // one restricted move per team" rule — gives boss mons Swords Dance +
  // signature combos etc. Factory rentals inherit this, and after a post-
  // battle swap the player can end up with 2+ restricted moves on a
  // rental, which makes vanilla injectPreviewTeam (teams.js:335+) pop a
  // blocking "Capacités restreintes" modal before combat starts.
  //
  // Fix: while a Factory run is active, wrap injectPreviewTeam so that
  // during its synchronous run every move[].restricted flag reads false.
  // The flag is stashed and restored in a try/finally, so nothing else
  // (tooltip rendering, movepool learning, Dome/Pike/Pyramid validation)
  // sees a clobbered state outside of that exact call window. Bypass
  // ONLY fires for Factory — all other facilities keep the vanilla rule.
  function installFactoryRestrictedBypass() {
    if (typeof window.injectPreviewTeam !== "function") {
      setTimeout(installFactoryRestrictedBypass, 150);
      return;
    }
    if (window.__frontierExtRestrictedBypassHooked) return;
    window.__frontierExtRestrictedBypassHooked = true;
    const orig = window.injectPreviewTeam;
    window.injectPreviewTeam = function () {
      const run = saved && saved.frontierExt && saved.frontierExt.activeRun;
      const facility = run && FACILITIES.find((f) => f.id === run.facilityId);
      const isFactoryRun = facility && isFactoryFacility(facility);
      if (!isFactoryRun || typeof move === "undefined") {
        return orig.apply(this, arguments);
      }
      const stash = [];
      for (const [k, mv] of Object.entries(move)) {
        if (mv && mv.restricted) { stash.push(k); mv.restricted = false; }
      }
      try {
        return orig.apply(this, arguments);
      } finally {
        for (const k of stash) { if (move[k]) move[k].restricted = true; }
      }
    };
  }

  function installInjection() {
    if (typeof window.updateFrontier !== "function" || typeof window.updateVS !== "function") {
      setTimeout(installInjection, 100);
      return;
    }

    // Make sure the Hoenn listing div exists in the DOM even before the
    // player clicks anything.
    ensureHoennListing();

    // Wrap vanilla updateFrontier: after it finishes, re-add the Hoenn
    // tab button + hide our listing AND restore display on the listing
    // the vanilla just populated (updateHoennBF hides it with
    // style.display="none" when the player last switched away — vanilla
    // doesn't re-set display on its own).
    const origUpdateFrontier = window.updateFrontier;
    window.updateFrontier = function () {
      const res = origUpdateFrontier.apply(this, arguments);
      try {
        injectStyles();
        ensureHoennTabButton();
        const hoennListing = document.getElementById(HOENN_LISTING_ID);
        if (hoennListing) {
          hoennListing.innerHTML = "";
          hoennListing.style.display = "none";
        }
        const frontierListing = document.getElementById("frontier-listing");
        const vsListing = document.getElementById("vs-listing");
        if (frontierListing) frontierListing.style.display = "";
        if (vsListing) vsListing.style.display = "none";
      } catch (e) {
        console.error("[frontier-ext] updateFrontier hook failed:", e);
      }
      return res;
    };

    // Same for updateVS (Trainers tab): un-hide vs-listing, hide the
    // other two. Without this, clicking Trainers after visiting the
    // Hoenn tab left vs-listing styled display:none → empty screen
    // even though vanilla had rebuilt the innerHTML correctly.
    const origUpdateVS = window.updateVS;
    window.updateVS = function () {
      const res = origUpdateVS.apply(this, arguments);
      try {
        injectStyles();
        ensureHoennTabButton();
        const hoennListing = document.getElementById(HOENN_LISTING_ID);
        if (hoennListing) {
          hoennListing.innerHTML = "";
          hoennListing.style.display = "none";
        }
        const frontierListing = document.getElementById("frontier-listing");
        const vsListing = document.getElementById("vs-listing");
        if (vsListing) vsListing.style.display = "";
        if (frontierListing) frontierListing.style.display = "none";
      } catch (e) {
        console.error("[frontier-ext] updateVS hook failed:", e);
      }
      return res;
    };

    // Expose the Hoenn BF tab as a global so the vanilla selector buttons
    // can use it via onclick attributes and other hooks can route here.
    window.updateHoennBF = function () {
      try {
        const lang = "en";
        ensureSaveSlot();
        sanitizeNullSlots();
        recoverCorruptedDomeTeam();
        injectStyles();

        const sel = document.getElementById("vs-selector");
        const vsListing = document.getElementById("vs-listing");
        const frontierListing = document.getElementById("frontier-listing");
        const hoennListing = ensureHoennListing();
        if (!sel || !hoennListing) return;

        // Rebuild the selector with three tabs — Hoenn highlighted.
        sel.innerHTML = "";
        const trainersBtn = document.createElement("div");
        trainersBtn.onclick = () => window.updateVS && window.updateVS();
        trainersBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m10.618 15.27l.817.788q.242.242.565.242t.566-.242l.816-.789h1.08q.343 0 .575-.232t.232-.575v-1.08l.789-.816q.242-.243.242-.566t-.242-.565l-.789-.817v-1.08q0-.343-.232-.575t-.575-.232h-1.083l-.95-.945q-.183-.186-.427-.186t-.43.186l-.95.945H9.538q-.344 0-.576.232t-.232.576v1.08l-.789.816Q7.7 11.677 7.7 12t.242.566l.789.816v1.08q0 .343.232.575t.576.232zM9.066 19h-2.45q-.667 0-1.141-.475T5 17.386v-2.451l-1.79-1.803q-.237-.243-.349-.534t-.111-.594q0-.301.112-.596t.347-.538L5 9.066v-2.45q0-.667.475-1.141T6.615 5h2.451l1.803-1.79q.243-.237.534-.349t.594-.111q.301 0 .596.112t.538.347L14.934 5h2.45q.667 0 1.142.475T19 6.615v2.451l1.79 1.803q.237.243.349.534t.111.594q0 .301-.111.596t-.348.538L19 14.934v2.45q0 .667-.475 1.142t-1.14.474h-2.451l-1.803 1.79q-.243.237-.534.349t-.594.111q-.301 0-.596-.111t-.538-.348zm.433-1l2.059 2.058q.173.173.442.173t.442-.173L14.502 18h2.882q.27 0 .443-.173t.173-.442V14.5l2.058-2.059q.173-.173.173-.442t-.173-.442L18 9.498V6.617q0-.27-.173-.443T17.385 6H14.5l-2.059-2.058Q12.27 3.77 12 3.77t-.442.173L9.498 6H6.617q-.27 0-.443.173T6 6.616v2.883l-2.058 2.059q-.173.173-.173.442t.173.442L6 14.502v2.882q0 .27.173.443t.443.173zM12 12"/></svg>
          ${"Trainers"}`;
        sel.appendChild(trainersBtn);
        const bfBtn = document.createElement("div");
        bfBtn.onclick = () => window.updateFrontier && window.updateFrontier();
        bfBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M17 22H7a2 2 0 0 1-2-2v-8.818a.6.6 0 0 0-.1-.333L3.1 8.15a.6.6 0 0 1-.1-.333V2.6a.6.6 0 0 1 .6-.6h1.8a.6.6 0 0 1 .6.6v1.8a.6.6 0 0 0 .6.6h2.8a.6.6 0 0 0 .6-.6V2.6a.6.6 0 0 1 .6-.6h2.8a.6.6 0 0 1 .6.6v1.8a.6.6 0 0 0 .6.6h2.8a.6.6 0 0 0 .6-.6V2.6a.6.6 0 0 1 .6-.6h1.8a.6.6 0 0 1 .6.6v5.218a.6.6 0 0 1-.1.333l-1.8 2.698a.6.6 0 0 0-.1.333V20a2 2 0 0 1-2 2Z"/></svg>
          ${"Battle Frontier"}`;
        sel.appendChild(bfBtn);
        sel.appendChild(buildHoennTabButton(lang, true));

        // Hide the other listings.
        if (vsListing)       { vsListing.innerHTML = "";       vsListing.style.display = "none"; }
        if (frontierListing) { frontierListing.innerHTML = ""; frontierListing.style.display = "none"; }
        hoennListing.style.display = "";

        // Oak gate — 1:1 with how vanilla Pokechill handles the
        // Giovanni gate on Battle Frontier: if the player hasn't
        // beaten the unlock trainer yet, don't render the facility
        // listing at all. Hide it + pop a tooltip with the unlock
        // message. Player sees a clean "come back after Oak" screen
        // instead of a list of locked padlock tiles.
        if (!isUnlocked()) {
          hoennListing.innerHTML = "";
          hoennListing.style.display = "none";
          const hdr = document.getElementById("vs-menu-header");
          if (hdr) hdr.innerHTML = "";
          try { showLockedTooltip(); } catch (e) { /* ignore */ }
          return;
        }

        // Header — match the existing VS Frontier header shape (text only
        // is fine; vanilla updateFrontier uses a much bigger header with
        // a rotation timer, but our section has no rotations).
        const header = document.getElementById("vs-menu-header");
        if (header) {
          const helpLabel = "Hoenn BF";
          // Header structure mirrors the vanilla VS Frontier one
          // (explore.js:7328+) so the existing `.header-help` CSS
          // renders the "?" as a rounded square button with the
          // same metrics. Tower-icon SVG kept from our tab identity;
          // the help SVG is the exact same one vanilla uses. Help
          // fires on right-click / long-press via the vanilla
          // contextmenu listener (tooltip.js:1917) + our tooltipData
          // hook — no onclick, to stay consistent with the rest of
          // the game.
          header.innerHTML = `
            <div style="display:flex; gap:0.2rem">
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" style="vertical-align:middle"><path fill="currentColor" d="M14 2h4v2h-4zm-1 3h6v3h-6zm-2 4h10v2h-10zm1 3h8v4h-8zm-1 5h10v3h-10zm-1 4h12v3h-12zm-1 4h14v3h-14zm-1 4h16v4h-16z"/></svg>
                ${helpLabel}
              </span>
              <span class="header-help" data-help="FrontierExt:__section__"><svg style="opacity:0.8; pointer-events:none" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><g fill="currentColor"><g opacity="0.2"><path d="M12.739 17.213a2 2 0 1 1-4 0a2 2 0 0 1 4 0"/><path fill-rule="evenodd" d="M10.71 5.765c-.67 0-1.245.2-1.65.486c-.39.276-.583.597-.639.874a1.45 1.45 0 0 1-2.842-.574c.227-1.126.925-2.045 1.809-2.67c.92-.65 2.086-1.016 3.322-1.016c2.557 0 5.208 1.71 5.208 4.456c0 1.59-.945 2.876-2.169 3.626a1.45 1.45 0 1 1-1.514-2.474c.57-.349.783-.794.783-1.152c0-.574-.715-1.556-2.308-1.556" clip-rule="evenodd"/><path fill-rule="evenodd" d="M10.71 9.63c.8 0 1.45.648 1.45 1.45v1.502a1.45 1.45 0 1 1-2.9 0V11.08c0-.8.649-1.45 1.45-1.45" clip-rule="evenodd"/><path fill-rule="evenodd" d="M14.239 8.966a1.45 1.45 0 0 1-.5 1.99l-2.284 1.367a1.45 1.45 0 0 1-1.49-2.488l2.285-1.368a1.45 1.45 0 0 1 1.989.5" clip-rule="evenodd"/></g><path d="M11 16.25a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 0 1 2.5 0"/><path fill-rule="evenodd" d="M9.71 4.065c-.807 0-1.524.24-2.053.614c-.51.36-.825.826-.922 1.308a.75.75 0 1 1-1.47-.297c.186-.922.762-1.696 1.526-2.236c.796-.562 1.82-.89 2.919-.89c2.325 0 4.508 1.535 4.508 3.757c0 1.292-.768 2.376-1.834 3.029a.75.75 0 0 1-.784-1.28c.729-.446 1.118-1.093 1.118-1.749c0-1.099-1.182-2.256-3.008-2.256m0 5.265a.75.75 0 0 1 .75.75v1.502a.75.75 0 1 1-1.5 0V10.08a.75.75 0 0 1 .75-.75" clip-rule="evenodd"/><path fill-rule="evenodd" d="M12.638 8.326a.75.75 0 0 1-.258 1.029l-2.285 1.368a.75.75 0 1 1-.77-1.287l2.285-1.368a.75.75 0 0 1 1.028.258" clip-rule="evenodd"/></g></svg></span>
            </div>`;
        }

        // Fill our listing: divider + 7 tiles.
        hoennListing.innerHTML = "";
        hoennListing.appendChild(buildDivider());
        for (const facility of FACILITIES) {
          hoennListing.appendChild(buildTile(facility));
        }
      } catch (e) {
        console.error("[frontier-ext] updateHoennBF failed:", e);
      }
    };

    // Prime the Hoenn tab button immediately so it's visible on first load
    // even before the player clicks any VS sub-tab.
    ensureHoennTabButton();
  }

  // ─── 8. BOOTSTRAP ─────────────────────────────────────────────────────────
  function bootstrap() {
    // Inject CSS FIRST — before any hook. Previously injectStyles() ran
    // only inside the updateFrontier wrap, which meant that if the player
    // refreshed the page and opened the team menu before ever visiting
    // the Frontier tab, our .frontier-ext-team-lock-banner class had no
    // matching rule and the banner rendered as plain text. Injecting up
    // front makes every style available the moment the DOM is ready.
    try { injectStyles(); } catch (e) { console.error("[frontier-ext] injectStyles failed:", e); }
    installInjection();
    installFactoryRestrictedBypass();
    installHelpTooltip();
    installCombatHook();
    installEnemyIvHpHook();
    installExitPkmnTeamBlock();
    installExitRedirect();
    installVSLeakFilter();
    installPalaceMoveHook();
    installPalaceEnemyHook();
    installArenaCombatHooks();
    installArenaSwapFreeze();
    installArenaShouldCombatStopHook();
    installArenaSwitchBlock();
    installTeamSanitizerHooks();
    installDomeTeamFilter();
    installPikePyramidHpRestoreHook();
    installPyramidEquipSync();
    installPyramidItemMaxLevel();
    installPyramidStatusStickHook();
    installRunLockTooltipHook();
    installMenuLockDuringRun();
    installTeamMenuLockHook();
    installTeamMenuObserver();
    installTeamLockEventFilter();
    installFrontierRightClickBlock();
    installLivePillHooks();
    // Attempt a corrupt-team recovery on boot. Safe if nothing to recover.
    try {
      ensureSaveSlot();
      sanitizeNullSlots();
      recoverCorruptedDomeTeam();
    } catch (e) { /* ignore — saved may not be ready yet */ }

    // F5 / language toggle / page reload mid-run = defeat. Rationale:
    // the whole point of "Repos" is to give the player a safe exit
    // path; if they F5'd instead, the team lock couldn't have been
    // preserved anyway (DOM classes don't survive reload) and the run
    // was already compromised. Paused runs (pausedRuns[]) are untouched
    // — they're the legit "saved for later" state. Wrapped in a
    // retry because `saved` can load async after script boot.
    const forfeitOnBoot = () => {
      try {
        if (!saved || !saved.frontierExt) return false;
        const run = saved.frontierExt.activeRun;
        if (!run) return true;
        // Strip the transient `healJustApplied` glow flag off every
        // surviving team slot. The flag is meant to drive a one-shot
        // animation on the NEXT render after a heal — it serializes
        // into the save like everything else on run.pikeTeam, so
        // without this scrub an F5 mid-run would replay a phantom
        // glow on the first HP summary render of the reloaded
        // session. Cosmetic only, but wrong.
        if (run.pikeTeam) {
          for (const sl of ["slot1", "slot2", "slot3"]) {
            if (run.pikeTeam[sl]) run.pikeTeam[sl].healJustApplied = false;
          }
        }
        // If the active run is flagged `roundJustCleared` at boot, the
        // player had won a round and the auto-save captured them
        // between the Round-Cleared modal and any Rest/Continue click.
        // Promote that state to a paused run instead of forfeiting —
        // mirrors what they almost certainly intended and avoids
        // losing a long streak just because F5 happened within the
        // 60s auto-save window. Active run without roundJustCleared
        // (mid-combat reload) still forfeits as before.
        if (run.roundJustCleared) {
          if (!saved.frontierExt.pausedRuns) saved.frontierExt.pausedRuns = {};
          saved.frontierExt.pausedRuns[run.facilityId] = run;
          saved.frontierExt.activeRun = null;
          try { restoreEnemyRuntimeStats(run); } catch (e) { /* ignore */ }
          const facP = FACILITIES.find((f) => f.id === run.facilityId);
          if (facP && isFactoryFacility(facP)) {
            try { cleanupFactoryRun(run); } catch (e) { /* ignore */ }
          }
          // Pyramid-mirrored held items would otherwise outlive the
          // forfeit and stay glued to the user's preview team forever.
          if (facP && isPyramidFacility(facP)) {
            try { cleanupPyramidPreviewItems(run); } catch (e) { /* ignore */ }
          }
          try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
          return true;
        }
        const finalRound = run.round || 0;
        if (finalRound > (saved.frontierExt.maxStreaks[run.facilityId] || 0)) {
          saved.frontierExt.maxStreaks[run.facilityId] = finalRound;
        }
        saved.frontierExt.streaks[run.facilityId] = 0;
        saved.frontierExt.activeRun = null;
        try { restoreEnemyRuntimeStats(run); } catch (e) { /* ignore */ }
        const fac = FACILITIES.find((f) => f.id === run.facilityId);
        if (fac && isFactoryFacility(fac)) {
          try { cleanupFactoryRun(run); } catch (e) { /* ignore */ }
        }
        if (fac && isPyramidFacility(fac)) {
          try { cleanupPyramidPreviewItems(run); } catch (e) { /* ignore */ }
        }
        try { removeFrontierTeamLock(); } catch (e) { /* ignore */ }
        return true;
      } catch (e) { return false; }
    };
    let forfeitAttempts = 0;
    const forfeitRetry = () => {
      if (forfeitOnBoot()) return;
      if (++forfeitAttempts < 10) setTimeout(forfeitRetry, 250);
    };
    forfeitRetry();

    // Canonical save-load integrity check. Our guardrails (rest, abandon,
    // victory, defeat, eager saveGame on each) make it IMPOSSIBLE for
    // activeRun to legitimately persist across a page reload without
    // roundJustCleared=true. If loadGame pulls in an activeRun that
    // violates that invariant, it can only have come from a mid-combat
    // F5 / tab-close — treat as a forfeit.
    //
    // Pokechill invokes loadGame() from a window "load" event handler
    // (explore.js) AFTER our DOMContentLoaded bootstrap runs. The
    // initial forfeitRetry above therefore races against a still-empty
    // `saved`; hooking loadGame catches the state AFTER it's been
    // written. The setTimeout defers the forfeit until the rest of the
    // "load" handler (team restoration, etc.) finishes, so saveGame
    // serialises a fully-initialised runtime rather than mid-init
    // state.
    const installLoadGameIntegrityHook = () => {
      if (typeof window.loadGame !== "function") {
        setTimeout(installLoadGameIntegrityHook, 150);
        return;
      }
      if (window.__frontierExtLoadGameHooked) return;
      window.__frontierExtLoadGameHooked = true;
      const orig = window.loadGame;
      window.loadGame = function () {
        const res = orig.apply(this, arguments);
        setTimeout(() => {
          try {
            const processed = forfeitOnBoot();
            if (processed && typeof saveGame === "function") {
              // Persist the forfeit so a second F5 within the 60s
              // auto-save window can't resurrect the run.
              saveGame();
            }
            try { refreshActiveFrontierView(); } catch (e) { /* ignore */ }
          } catch (e) { /* ignore */ }
        }, 50);
        return res;
      };
    };
    installLoadGameIntegrityHook();
    // Saved may load asynchronously after script runs — retry the
    // sanitizer a few times over the first couple seconds so the fix
    // lands regardless of the game's init ordering.
    let attempts = 0;
    const retry = () => {
      attempts++;
      try {
        const healed = sanitizeNullSlots();
        if (healed > 0 && typeof updatePreviewTeam === "function") {
          // Refresh the team-editor UI if it's already open.
          try { updatePreviewTeam(); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      if (attempts < 6) setTimeout(retry, 500);
    };
    setTimeout(retry, 300);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  // Expose for debugging from DevTools.
  window.__frontierExt = {
    facilities: FACILITIES,
    SILVER_ROUND,
    GOLD_ROUND,
    RUN_AREA_ID,
    ensureSaveSlot,
    buildTile,
    openFacilityPreview,
    fillHoennSectionHelp,
    generateTrainer,
    pickMovesetFor,
    pickFromPool,
    GENETIC_MOVES_FOR_ALL,
    handleRunAction,
    launchCombat,
    buildEphemeralRunArea,
    onRunVictory,
    onRunDefeat,
    isUnlocked,
    // Palace rule debug
    classifyMoveId,
    pickSlotByNature,
    pickSlotByNatureGeneric,
    simulateNatureFor,
    isInPalaceRun,
    NATURE_STYLE_WEIGHTS,
    // Pyramid debug
    isPyramidFacility,
    isInPyramidRun,
    generatePyramidFloor,
    openPyramidFloorMap,
    pyramidMovePlayerTo,
    pyramidResolveTile,
    pyramidAdvanceFloor,
    pyramidAfterEvent,
    PYR_TILES,
    PYR_GRID_SIZE,
    // Factory debug
    isFactoryFacility,
    generateFactoryRentalPool,
    openFactoryRentalSelection,
    toggleFactorySelection,
    confirmFactorySelection,
    openFactorySwapModal,
    confirmFactorySwap,
    applyFactoryMoves,
    restoreFactoryMoves,
    enterFactoryPreviewSlot,
    restoreFactoryPreviewSlot,
    cleanupFactoryRun,
    FACTORY_POOL_SIZE,
    FACTORY_TEAM_SIZE,
    FACTORY_PREVIEW_SLOT,
    // Arena debug
    isArenaFacility,
    isInArenaRun,
    arenaGetState,
    arenaResetState,
    arenaRenderJudge,
    arenaCheckJudge,
    arenaReadHpRatios,
    showArenaVerdict,
    arenaBiasPoolBySpeed,
    arenaBiasNature,
    ARENA_TURNS_PER_SIDE,
    // Dome debug
    isDomeFacility,
    ensureBracketForDome,
    openDomeBracketPreview,
    openDomePokemonSelection,
    applyDomeSelection,
    restoreDomeSelection,
    installDomeTeamFilter,
    recoverCorruptedDomeTeam,
    sanitizeNullSlots,
    DOME_BRACKET_SIZE,
    DOME_ACTIVE_SIZE,
    // Pike debug
    isPikeFacility,
    openPikeRoomPreview,
    rollPikeDoors,
    rollSinglePikeDoor,
    applyPikeDoor,
    applyPikeHealRatio,
    applyPikeTrap,
    pikeAdvanceAfterEvent,
    snapshotPikePyramidHp,
    applyPikePyramidHpState,
    initPikePyramidTeamFromPreview,
    migratePikeState,
    migratePikePyramidTeam,
    normalizePikePyramidStatus,
    // Round-cleared modal (universal across facilities)
    showRoundClearedModal,
    // Team-menu lock
    applyFrontierTeamLock,
    removeFrontierTeamLock,
    isFrontierRunActive,
    isFrontierTiedSlotActive,
    isFrontierMidRound,
    // Flip window.__frontierExt.pikeDebug = true to log every snapshot/apply.
    pikeDebug: false,
    PIKE_ROOM_COUNT,
    PIKE_DOOR_COUNT,
    PIKE_PYRAMID_STATUSES,
    PIKE_PYRAMID_STATUS_TURNS,
    CURTAIN_SVG,
    difficultyMultiplier,
    getBossRoundInfo,
    silverRoundFor,
    goldRoundFor,
    postGoldEveryFor,
    nextGoalRoundFor,
    battlesPerRound,
    // Unified difficulty spec — inspect for a given round in DevTools:
    // __frontierExt.computeRunDifficulty(15, __frontierExt.FACILITIES[0])
    tierForRound,
    computeRunDifficulty,
    applyEnemyRuntimeStats,
    restoreEnemyRuntimeStats,
    pickMovesetFor,
    simulateNatureFor,
    buildMoveCategories,
    weatherFromAbility,
    FACILITIES,
    // Pool debug
    getPool,
    getPoolForFacility,
    resetPoolCache,
    resetActiveRun,
    bstTotal,
    TIER_BST,
    debugPool,
    // quick helper to reset all runs/symbols for testing
    resetAll: () => {
      if (typeof saved === "object" && saved) saved.frontierExt = null;
      ensureSaveSlot();
      refreshActiveFrontierView();
    } };
})();
