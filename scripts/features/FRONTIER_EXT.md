# Hoenn Battle Frontier overlay

Overlay implementation of the Gen 3 Pokémon Emerald **Battle Frontier** for
Pokechill. Ships 7 facilities (Tower / Palace / Arena / Dome / Factory /
Pike / Pyramid) as a **single self-contained script** that attaches to the
host game via runtime hooks — no modifications to vanilla source files.

All overlay code lives in
[`scripts/features/frontier-ext.js`](./frontier-ext.js) (~10k lines).
Styling is injected inline via `injectStyles()`.

---

## Table of contents

1. [Design principles](#design-principles)
2. [Architecture](#architecture)
3. [Save-state data model](#save-state-data-model)
4. [Facility catalogue](#facility-catalogue)
5. [Run lifecycle](#run-lifecycle)
6. [Install-hook reference](#install-hook-reference)
7. [Mutation / cleanup contract](#mutation--cleanup-contract)
8. [Extension points](#extension-points)
9. [Testing](#testing)
10. [Known upstream caveats](#known-upstream-caveats)

---

## Design principles

| Principle | How it's enforced |
|---|---|
| **No source-file edits** | All integration via `window.*` function wraps (`injectPreviewTeam`, `updateVS`, `leaveCombat`, `moveBuff`, `switchMember`, `setWildPkmn`, `shouldCombatStop`, `exploreCombatPlayer`, `exploreCombatWild`, `openTooltip`, `closeTooltip`). Each wrap is idempotent (`window.__frontierExtFooHooked` guard) and preserves the original return value. |
| **Overlay-owned state is namespaced** | Every persistent field lives under `saved.frontierExt.*`. Legacy/transitional keys (`run.pikeTeam`) are documented but never leak into `saved.*` at the top level. |
| **Every mutation of shared game state has a restore path** | See [Mutation / cleanup contract](#mutation--cleanup-contract). Six exit paths are enumerated and every write is covered by all six. |
| **Save-editor resistant** | Entry gates (`handleRunAction("start")`, `pikeAdvanceAfterEvent` overflow, Pike/Pyramid room bounds, theme-index modulo) assume hostile input and clamp or refuse. |

---

## Architecture

### File topology

```
frontier-ext.js
├─ 1.   Facility catalogue              FACILITIES[]
├─ 2a.  Difficulty curve                 computeRunDifficulty
├─ 2b.  Access gate                      hasRunTeamState
├─ 2c.  Dome bracket logic               ensureBracketForDome
├─ 3.   Save-state init                  ensureSaveSlot
├─ 3b.  Trainer generator                generateTrainer + pickMovesetFor
├─ 4.   Styles (injected)                injectStyles
├─ 5.   Tile builder                     buildTile / refreshActiveFrontierView
├─ 6.   Modals                           openFacilityPreview, openSimulatedFight,
│                                        openFactoryRentalSelection,
│                                        openPikeRoomPreview,
│                                        openPyramidFloorMap, openDomeBracketPreview,
│                                        showArenaVerdict, …
├─ 6b1. Palace rule                      nature-driven move picker
├─ 6b2a.Arena rule                       3-turn judge, swap freeze
├─ 6b2b.Factory rule                     rental pool + post-win swap
├─ 6b2c.Pyramid rule                     7-floor grid + theme-rotated wilds
│                                        + Combat Bag + held items
├─ 6b3. Pike rule                        14 rooms × 3-door picker + hint
├─ 6c.  Combat launch                    launchCombat + buildEphemeralRunArea
├─ 7.   Install-hook suite               install*Hook functions
└─ 8.   Bootstrap                        DOMContentLoaded + install pass
```

### Bootstrap

```js
document.addEventListener("DOMContentLoaded", () => {
  ensureSaveSlot();
  injectStyles();
  installHoennSection();
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
  installPyramidStatusStickHook();
  installRunLockTooltipHook();
  installTeamMenuLockHook();
  installTeamMenuObserver();
  installCombatHook();
  installEnemyIvHpHook();
  installVSSectionFilter();
  forfeitRetry();
});
```

The overlay is **idempotent** at every level: each install guard, every
state mutation checks `run.facilityId` before acting, every storage init
is a no-op when the slot is already populated.

---

## Save-state data model

All persistent overlay state lives under `saved.frontierExt`:

```js
saved.frontierExt = {
  activeRun:       { …RunState } | null,           // The ONE locked run (max 1)
  pausedRuns:      { [facilityId]: {…RunState} },  // Many can coexist (all unlocked)
  streaks:         { [facilityId]: Number },       // Current run's round count
  maxStreaks:      { [facilityId]: Number },       // Best all-time round count
  symbols:         { [facilityId]: { silver: Boolean, gold: Boolean } },
};
```

### `RunState` shape (common fields)

```js
{
  facilityId:          String,          // e.g. "frontierTowerSecret"
  round:               Number,          // Round count (0-indexed internally, displayed +1)
  battleInRound:       Number,          // 1..perRound; resets on round advance
  upcomingTrainer:     Object | null,   // Cached next opponent spec
  tiedPreviewSlot:     String,          // saved.previewTeams key locked for this run
  roundJustCleared:    Boolean,         // End-of-round unlock signal
}
```

### Facility-specific additions

| Facility | Extra fields |
|---|---|
| Arena | `arenaState: { playerMoves, enemyMoves, playerAttacks, enemyAttacks, playerDamage, enemyDamage, judgeFired, judgeFiring, arenaSwapFreezing, lastPlayerSlot, lastEnemySlot, matchupCount, judgesFired }` |
| Dome | `bracketTrainers: Trainer[]`, `bracketBattle: 1..3`, `bracketRound: Number`, `domeSelection: String[]` (2 Pokémon ids), `domeSelectionConfirmed: Boolean` |
| Factory | `factoryPool: Rental[6]`, `factorySelection: Number[3]`, `factoryTeam: Rental[3]`, `factoryOriginalState: { [id]: {moves, nature, ivs, ability, level, exp, caught} }`, `factoryOriginalPreviewSlot: String`, `pendingFactorySwap: Rental[3] | null`, `factorySwapSelection: [takeIdx, giveIdx]` |
| Pike | `pikeRoom: 1..14`, `pikeDoors: Door[3] | null`, `pikeDoorPicked: Number | null`, `pikeHint: {doorIdx, category, room} | null`, `pikePostBattleHeal: Boolean`, `pikeTeam: {slot1, slot2, slot3}` (HP/status/equipment persistence — also used by Pyramid) |
| Pyramid | `pyramid: PyramidFloorState | null`, `pyramidEncounterKind: "trainer"\|"wild"\|"brain"\|null`, `pyramidRoundComplete: Boolean`, `pyramidThemeIndex: Number`, `combatBag: { items: [{id, count}], cap: 10 }`, `pyramidPendingAfterEvent: Boolean` |
| Pike + Pyramid | `pikeTeam[slot] = { pkmnId, item, hpRatio, status }` (shared persistent HP/status storage despite the name) |

### Historical naming

The storage field `run.pikeTeam` predates the Pyramid rework. Both
facilities use it for identical semantics (per-run HP + status +
equipment persistence across their sub-encounters). The *field* keeps
its legacy name for save compatibility; *functions* that manipulate it
are prefixed `pikePyramid*` to flag the dual-use at call sites.

---

## Facility catalogue

| Id | Name | Rules | Silver round | Gold round |
|---|---|---|---|---|
| `frontierTowerSecret` | Battle Tower | 7-battle streak | 5 | 10 |
| `frontierPalaceSecret` | Battle Palace | Auto-move by nature | 3 | 6 |
| `frontierArenaSecret` | Battle Arena | 3-turn judge; no switching | 4 | 8 |
| `frontierDomeSecret` | Battle Dome | Bracket tournament (4 trainers, pick 2) | 7 | 14 |
| `frontierFactorySecret` | Battle Factory | Rental pool; post-win swap | 3 | 6 |
| `frontierPikeSecret` | Battle Pike | 14 rooms × 3-door picker | 1 | 5 |
| `frontierPyramidSecret` | Battle Pyramid | 7-floor grid dungeon; theme-rotated wilds; Combat Bag | 3 | 10 |

The `FACILITIES` constant is the single source of truth for names, brain
definitions (sprite + silver/gold canonical teams), background, hue shift,
round cadence and boss thresholds. Add a new facility by appending one
object; every downstream helper (`hasRunTeamState`, `battlesPerRound`,
`isXFacility`, `computeRunDifficulty`, …) branches on the `rules` flags
the facility declares.

---

## Run lifecycle

```
┌─────────────┐       start        ┌─────────────┐      launch      ┌──────────┐
│ fresh tile  ├───────────────────▶│ preview     ├─────────────────▶│  combat  │
└─────────────┘                    └─────┬───────┘                  └────┬─────┘
                                         │                                │
                                    rest │         ┌──────────────────────┤
                                         ▼         ▼                      │
                                   ┌───────────┐┌────────────┐      victory│loss
                                   │  paused   ││ round      │             │
                                   │  (stored) ││ cleared    │             │
                                   └─────┬─────┘└──┬─────────┘             │
                                         │         │                       │
                                   resume│         │continue                │
                                         └─────┬───┘                       │
                                               ▼                           ▼
                                         back to preview             defeat → abandon
                                                                     or maxStreak update
```

### The six exit paths (cleanup contract)

| Exit | Handler | What cleans up |
|---|---|---|
| Combat victory | `onRunVictory` (chained from `leaveCombat` hook when `areas[RUN_AREA_ID].defeated === true`) | Advances round, grants symbols, resets per-battle state |
| Combat defeat | `onRunDefeat` (chained from same hook when `defeated === false`) | Clears `activeRun`, captures `maxStreaks`, calls `restoreEnemyRuntimeStats`, `cleanupFactoryRun`, `cleanupPyramidPreviewItems` |
| Abandon | `handleRunAction("abandon")` | Same as defeat + sync `saveGame()` |
| Rest | `handleRunAction("rest")` | Moves `activeRun` → `pausedRuns[facId]`, restores transient overrides (Factory/Enemy), keeps `pikeTeam` HP/status |
| Boot-time F5 forfeit (mid-combat) | `forfeitOnBoot` | Treats `activeRun` without `roundJustCleared` as a defeat; runs all restores |
| Boot-time F5 promote (round cleared) | `forfeitOnBoot` | Moves `activeRun` with `roundJustCleared` → paused (preserves long streaks across autosave gap) |

Every exit is covered by the cheat + gold Playwright probe.

---

## Install-hook reference

Each hook lives in a dedicated `installFooHook()` function, called once
from bootstrap. All are idempotent.

| Hook | Purpose |
|---|---|
| `installCombatHook` | Wraps `leaveCombat` → routes to `onRunVictory`/`onRunDefeat` + redirects back to the Hoenn tab after frontier combats |
| `installVSLeakFilter` | Wraps `updateVS` so the ephemeral run area never leaks into the VS-Trainers listing |
| `installTeamSanitizerHooks` | Runs on combat entry to wash legacy `null` team slots out of save |
| `installPikePyramidHpRestoreHook` | Restores `run.pikeTeam[slot]` HP/status onto runtime `team[slot].buffs` + `pkmn[id].playerHp` post-`setPkmnTeamHp` |
| `installDomeTeamFilter` | Filters `team[]` to the 2 Pokémon the player picked for a Dome match — preview is never mutated |
| `installPalaceMoveHook` / `installPalaceEnemyHook` | Nature-driven move picker for both sides of the Battle Palace |
| `installArenaCombatHooks` | Tallies per-matchup moves/damage/attacks so the 3-turn judge can fire |
| `installArenaSwapFreeze` / `installArenaShouldCombatStopHook` | Freeze the vanilla `animate` rAF loop during verdict + post-swap window (prevents the "triple-kill through judge" bug) |
| `installArenaSwitchBlock` | Forbids voluntary `switchMember` during an Arena matchup (post-KO auto-switch still fires) |
| `installEnemyIvHpHook` | Scales wild HP / max HP by `1.1^ivRating` to mirror player formula on enemies |
| `installPyramidEquipSync` | Copies Pyramid-equipped held items from `pikeTeam[slot].item` onto `team[slot].item` at combat launch |
| `installPyramidStatusStickHook` | Forces status-buff duration to `PIKE_PYRAMID_STATUS_TURNS` (99) inside Pyramid runs so paralysis/poison/burn stick across combat |
| `installRunLockTooltipHook` | Hides the tooltip × + blocks backdrop-click / Escape exits while any run is active |
| `installTeamMenuLockHook` / `installTeamMenuObserver` | Locks the team-menu edit UI to the run's tied preview slot |
| `installVSSectionFilter` | Hides the ephemeral Hoenn combat area from the Overworld travel list |

---

## Mutation / cleanup contract

| Write | Scope | Stash | Restore in |
|---|---|---|---|
| `pkmn[id]` moves / nature / ivs / ability / level / exp / caught | Factory rental override | `run.factoryOriginalState[id]` | `cleanupFactoryRun` on all 6 exits |
| `pkmn[id]` ivs / ability | Enemy runtime stats per-combat | `run.enemyRuntimeState[id]` | `restoreEnemyRuntimeStats` on all 6 exits |
| `saved.previewTeams[FACTORY_PREVIEW_SLOT]` | Private Factory slot | Implicit (slot is overlay-owned) | `restoreFactoryPreviewSlot` via cleanupFactoryRun |
| `saved.previewTeams[tiedSlot][slot].item` | Pyramid equip mirror | None (paired with `run.pikeTeam[slot].item`) | `cleanupPyramidPreviewItems` on defeat / abandon / forfeit |
| `saved.currentPreviewTeam` | Factory preview swap | `run.factoryOriginalPreviewSlot` | cleanupFactoryRun |
| `move[id].restricted` | Factory move-restriction bypass | Stack-local `stash` array | Synchronous `try/finally` in `injectPreviewTeam` wrap |
| `wildPkmnHp` / `wildPkmnHpMax` | Combat globals | Ephemeral | Overwritten by next `setWildPkmn` |
| `areas[RUN_AREA_ID]` | Ephemeral frontier area | Overlay-owned | Overwritten every round |
| `team[slot].*` | Runtime combat team | Ephemeral | Reset by `injectPreviewTeam` every combat |

### Confirmed zero writes

Audited grep-exhaustive. The overlay never touches:

- `pkmn[id].shiny`
- `pkmn[id].evolve`
- `pkmn[id].happiness`
- Any field on `item[id]`
- `saved.weather` / `saved.weatherTimer`
- `saved.bag`
- `saved.money`
- `saved.pokedex`
- `saved.symbols` (vanilla — distinct from `saved.frontierExt.symbols`)

---

## Extension points

### Add a new facility

1. Append a facility object to `FACILITIES` (section 1). Give it a unique
   `id`, a `name`, a `desc`, a `brain` sub-object with `teamSilver` +
   `teamGold` arrays, `rules` flags (see existing ones for inspiration),
   and `battlesPerRound` / `silverRound` / `goldRound`.
2. Optionally declare a custom `rules.myRule: true` flag — inspect it via
   a new `isMyRuleFacility(facility)` helper and branch downstream
   helpers (`computeRunDifficulty`, `openSimulatedFight`, `launchCombat`,
   `onRunVictory`).
3. If the facility persists HP/status across sub-encounters like Pike /
   Pyramid, set `rules.persistHpStatus: true` and the existing
   `pikePyramid*` machinery picks it up automatically.
4. Add the facility tile to the Hoenn section (handled generically by
   `buildTile`).
5. Add any facility-specific modals with their own `open*Preview(facility)`
   function + wire them into `handleRunAction`.

### Add a new Pyramid theme

Append to `PYRAMID_THEMES`. Each entry is
`{ key, label, pool: [speciesId…] }`. If the theme maps to an
inflictable status (paralysis / poison / burn), also add a `key` entry
to `PYRAMID_THEME_PREFERRED_STATUS_MOVES` so wild movesets fish the
status-specific pool first.

### Add a new Pyramid item

Append to `PYRAMID_ITEMS`. Each entry is `{ id, label, kind }` where
`kind` is one of:

- `"cure"` + `cure: "statusKey"` — removes a specific status on one slot
- `"heal"` + `ratio: 0..1` — partial HP heal
- `"heal_full_cure"` — full HP + status clear
- `"revive"` + `ratio: 0..1` — resurrects a fainted slot
- `"held"` — stored in bag, equipable on a slot

For `"held"` items, the `id` must exist in Pokechill's `itemDictionary`
for combat effects to apply — the overlay never fabricates held-item
effects, it delegates to the game's native item logic.

---

## Enemy context clone system

The Frontier runs bosses / rematches / post-Silver rentals with **items,
hidden abilities, natures, and BST inflation** that the vanilla combat
engine does not read off of enemy Pokémon. Rather than patching core
combat, the overlay creates a **shadow clone** of the species entry at
combat launch, mutates the clone, and swaps `saved.currentPkmn` to point
at it. On run end / leave combat / defeat we destroy the clone and the
real `pkmn[id]` species entry is untouched.

### Clone registry

```
pkmn["__zdcEnemy_<realId>_<uid>"] = {
  ...origSpecies,                 // shallow own-copy (keeps function/object refs intact)
  bst:   { ...orig.bst },         // own-copy: we inflate
  type:  [ ...orig.type ],        // own-copy: mega transform may swap
  id:    "__zdcEnemy_...",
  shiny?, ability?, hiddenAbility?, nature?, item?
}

__enemyCloneState[cloneId] = {
  realId, uid,
  item, ability, hiddenAbility, nature, shiny, megaFormId,
  focusSashConsumed, weaknessPolicyConsumed,
  salacBerryConsumed, sitrusBerryConsumed, lumBerryConsumed,
  lifeOrbRecoilPending,
  speedBoostStages,
  gutsApplied,
}
```

### Dispatcher surfaces (what we can drive)

| When | Dispatcher | Covers |
|---|---|---|
| Switch-in (clone takes field) | `dispatchOnSwitchIn` → `__fireAbilityOnSwitchIn` | intimidate, dauntingLook, drought, drizzle, sandStream, snowWarning, somberField, electricSurge, grassySurge, mistySurge, flameOrb / toxicOrb pre-burn |
| `moveBuff(target="wild", buff)` wrap | `installEnemyContextMoveBuffHook` | lumBerry status clear, hydratation status cure in rain, guts `.gutsApplied` flip → re-run BST inflation for +1.5× atk |
| End-turn tick (~500 ms poll) | `dispatchEndTurn` | iceBody / rainDish heal under matching weather, speedBoost +1 spe stage, lifeOrb 10 % max-HP recoil on landed hit |
| On enemy HP decrease | `dispatchOnTakeDamage` | weaknessPolicy +2 atk +2 satk on >25 % max HP hit (approximated super-effective) |
| Pre-battle (BST inflation path) | `applyItemBstInflation` | all damage-calc abilities + all item %-damage mods (see below) |

### Damage-calc abilities (BST inflation, no engine hook)

Pokechill's damage formula lives behind a single `exploreCombatWild`
call — we can't wedge a pre-damage hook onto enemy-only reads. Instead
we pre-inflate `clone.bst.atk/satk/def/sdef/spe/hp` at clone creation
time so the inline formula reads the boosted value transparently.

| Ability | Inflation | Gate |
|---|---|---|
| hugePower | atk ×1.50 | unconditional |
| toughClaws | atk ×1.10 | any contact-proxy move |
| ironFist | atk ×1.12 | any punch/fist-named move |
| strongJaw | atk ×1.12 | any bite/crunch/fang-named move |
| sheerForce | atk&satk ×1.30 | ≥2 moves with `hitEffect`/`bonusBuff`/`bonusDebuff` |
| technician | atk&satk ×1.20 | ≥2 moves with base power ≤60 |
| adaptability | atk&satk ×1.15 | ≥3 STAB moves (conservative vs. canonical 2.0×) |
| skillLink | atk&satk ×1.18 | any multihit move (canonical `move[x].multihit: [min,max]`) |
| aerilate / pixilate / galvanize / glaciate / pyrolate / terralate / toxilate / hydrolate / ferrilate / chrysilate / verdify / gloomilate / espilate / dragonMaw (Pokechill's 14 ate-family converters) | atk&satk ×1.25 | any normal-type attacking move |
| guts | atk ×1.50 | wildBuffs.burn / poisoned / paralysis set (re-runs inflation via moveBuff hook when status lands mid-combat) |
| gorillaTactics | atk ×1.30 | ≥2 physical moves (we skip the move-lock — engine doesn't enforce on enemies) |
| solarPower | satk ×1.20 | `weatherActive === "sunny"` + any special fire move (skipping the canonical -1/8 HP drain) |
| sandForce | atk ×1.10 | any rock/ground/steel attacking move |
| chlorophyll / swiftSwim / sandRush / slushRush / moltShed | bst.spe +3 | `weatherActive === "sunny"/"rainy"/"sandstorm"/"hail"/"foggy"` respectively |
| unburden | bst.spe +2 | flat (many enemy items don't deplete mid-fight; conservative proxy) |
| sandVeil / snowCloak | def&sdef ×1.08 | matching weather (evasion can't be dispatched cleanly; modeled as "harder to finish off") |
| tintedLens | atk&satk ×1.15 | ≥2 attacking moves (conservative universal bump since player types aren't knowable at clone time) |
| megaLauncher | atk&satk ×1.20 | any pulse/auraSphere move (name regex matches Pokechill's movesAffectedByMegaLauncher) |
| metalhead | atk&satk ×1.20 | any head/butt move (name regex) |
| prankster / galeWings / neuroforce | bst.spe +2 | ghost+dark / flying+bug / psychic+fairy moves respectively |
| merciless | atk&satk ×1.10 | ≥2 attacking moves (conservative — player status uptime isn't guaranteed) |
| stamina | bst.hp ×1.10 | flat (fatigue damage halved = bigger effective HP pool) |
| toxicBoost | atk ×1.20 | clone.item === "toxicOrb" (orb pre-sets the status at switch-in) |
| flareBoost | satk ×1.20 | clone.item === "flameOrb" (burn halves atk so we focus satk) |
| protosynthesis | atk&satk ×1.10 | `weatherActive === "sunny"` |
| quarkDrive | atk&satk ×1.10 | `weatherActive === "electricTerrain"` |
| marvelScale | def ×1.30 | any major status on clone (checked at inflation; moveBuff hook re-inflates when status lands mid-combat) |
| livingShield | sdef ×1.30 | any major status on clone (same re-inflation pattern) |
| overgrow / blaze / swarm / torrent | atk&satk ×1.10 | matching grass/fire/bug/water attacking move (conservative uptime proxy for the canonical "+30 % below 50 % HP") |

### Mid-combat dispatch (moveBuff wrap)

In addition to the item/status plumbing described earlier, the wrap
zeroes out specific status buffs the moment they land when the clone's
ability makes it immune. Cancels reliably because the wrap runs after
vanilla's moveBuff has written the flag, so we just stomp the slot
back to 0 and call `updateWildBuffs()` to re-render.

| Ability | Buff blocked |
|---|---|
| insomnia | `sleep` |
| immunity | `poisoned` |
| limber | `paralysis` |
| ownTempo | `confused` |
| magmaArmor | `freeze` |
| waterVeil | `burn` |

### Cosmetic abilities we can't dispatch

These Pokechill abilities exist in the dictionary but **cannot be made
to do anything on the enemy side without rewriting the combat engine**.
Per the design rule **"1:1 Pokechill — if we can't make it work, don't
assign it"**, every ability below was stripped from `__ABILITY_SCORERS`.
If a species' default / hidden ability falls into this list, the clone
is created **with no ability pill on the info row** — that's intentional;
fake ornaments are worse than empty slots.

| Ability | Why we can't dispatch it on enemy |
|---|---|
| **multiscale** | Needs a "damage taken at full HP" hook on the enemy side. Pokechill's damage application (`hpChange(target, -amount)`) applies damage to the target with no conditional pre-damage hook callable from our overlay. |
| **filter / solidRock / prismArmor** | Same shape: "reduce super-effective damage taken by 0.75". No enemy-side damage-taken multiplier hook. |
| **thickFat** | "Halve atk/satk of fire and ice moves used against holder." No move-type-conditional damage modifier hook for incoming moves on the wild slot. |
| **levitate** | "Immune to ground moves." Vanilla checks `team[slot].ability === ability.levitate.id` — the check is player-only and hard-coded to `team[...]`, not `wildPkmn`. |
| **static / flameBody / poisonPoint / cursedBody / effectSpore / stench** | "On contact taken, X% chance inflict Y." Requires us to detect that a specific move HIT the clone and was contact. The `moveBuff` wrap catches status that lands on the wild slot, but not the inverse (status to inflict on the attacker). |
| **contrary** | Flip sign of every stat-change buff landed on the clone. `moveBuff(target="wild", "atkdown1", …)` fires before our wrap returns the real buff; we'd need to replace the buff string before the base function applies it, but we chose to keep the hook read-only (safer). |
| **simple** | Double every stat-change magnitude. Same shape as contrary — requires rewriting the buff string in-flight. |
| **moody** | +2 random / -1 random stat per turn. End-turn tick can fire buffs, but `wildBuffs.atkup2` etc. are player-facing display buffs — pushing random stages on them doesn't reflect in the engine's damage read. |
| **protean / libero** | Change clone's type to the move's type right before using it. Requires a "before move use" hook on the enemy; vanilla's `exploreCombatWild` picks a move and immediately resolves it. |
| **moxie / chillingNeigh / grimNeigh / asOne** | +1 atk/satk stage after a KO. We detect the player Pokémon dying via `team[slot].pkmn.playerHp <= 0`, but there's no hook point between the KO and the next turn where the clone hasn't already picked its next move. |
| **strategist** | Reserved for triple-kill signal in Arena — not dispatchable as an enemy ability without a full move-picker rewrite. |
| **parentalBond** | Doubles every single-target move. We can't intercept the damage event to run it twice. |
| **sereneGrace** | Doubles secondary-effect chances. Those chances are rolled inline in `move.hitEffect?.()`, not through a hookable pipeline. |
| **supremeOverlord** | Scales damage by count of fainted teammates. Solo enemies by default (only Dome-style has a "team" context), and the fainted-count read is player-side. |
| **wonderGuard** | Immune unless super-effective. Same shape as levitate but over every type — needs an enemy-side type-effectiveness gate. |
| **imposter** | Transform into player's active on switch-in. We'd have to rebuild the clone mid-combat with the player's species data — possible in theory, skipped for Phase 1 because it would conflict with the preview team slot and mega-transform path. |
| **powerOfAlchemy / trace / receiver** | Copy an opponent's ability on switch-in. We'd have to re-run `pickAbilityForClone` against the player's ability pool, but the copy target is the *ally* in doubles (Power of Alchemy) — Pokechill has no doubles format, so the ability is a no-op on the player side too. Parked. |
| **fullMetalBody / clearBody / whiteSmoke / hyperCutter** | Prevent stat-drop from opponent. Player-side abilities already read these correctly (`team[...].ability`); for enemies we'd need to intercept the moveBuff call and cancel the write — our wrap is read-only by design. |
| **naturalCure** | Cure status on switch-out. Solo wild enemies don't switch out, so this is inert. |
| **goodAsGold** | Immune to all status moves. Status-move detection exists (`move[x].power === 0`) but we'd need an engine-side "refuse this buff" gate that doesn't exist for the wild slot. |
| **magicBounce / magicGuard** | Reflect / ignore indirect damage. Same shape as filter — no incoming-damage hook. |
| **regenerator** | +33 % HP on switch-out. Solo wilds don't switch, inert. |
| **pressure** | Extra PP drain on moves targeting holder. Pokechill doesn't simulate PP at all, inert. |

**If Phase 2 ever lands** (a proper `exploreCombatPlayer` / damage pipe
wrap that the overlay can hook), most of the defensive/reactive
abilities above become dispatchable and will get added back to the
scorer table. Until then, they're intentionally absent so the player
never sees an ability pill for a non-functional ability.

### Ability gate matrix

The clone gets its abilities from `pickAbilityForClone(realId, moves,
clone, diff, abilityGate)` where `abilityGate` is one of:

| Gate | Set by | Normal slot | Hidden slot |
|---|---|---|---|
| `"default-only"` | pre-Silver / Silver rounds | Scored pick from active table (excluding species hidden id) | `null` — never unlocked |
| `"hidden-allowed"` | post-Gold (ramp via `diff.hiddenAbilityChance`, 0.25 → 0.75 from Silver to Gold round) | Same as above | `hiddenId` if `hasScorer(hiddenId)` and `Math.random() < rate` |
| `"hidden-forced"` | Boss encounters (`isEnemyBoss()` — brain OR round-guardian 7/7) | Same as above | `hiddenId` if `hasScorer(hiddenId)` — unconditional |

A clone may end up with **zero abilities** if neither its default nor
any type-matching scored candidate lives in the active table. That's a
deliberate outcome — see "Cosmetic abilities we can't dispatch" above.

### Item gate matrix

`pickItemForClone` draws from a tiered pool based on `diff.itemPoolTier`:

| Tier | Pool contents |
|---|---|
| `null` | No item at all (pre-Silver) |
| `"basic"` | leftovers, orbs (flame/toxic), quickClaw, mentalHerb, powerHerb, clearAmulet, heavyDutyBoots, all 18 type boosters |
| `"mid"` (adds) | lifeOrb, choiceBand, choiceSpecs, lightClay, laggingTail, metronome, luckyPunch, loadedDice, heatRock, dampRock, smoothRock, icyRock, foggySeed, electricSeed, grassySeed, mistySeed |
| `"full"` (adds) | weaknessPolicy, assaultVest, eviolite, all 18 gems, mega stones (probabilistic via `getMegaStonesForSpecies`) |

Ability-item synergies fire probabilistically **before** the generic
roll, so you see thematic combos (Guts + Flame Orb, Iron Fist + Lucky
Punch, Poison Heal + Toxic Orb, Toxic/Flare Boost + matching Orb)
without the pool degenerating to the same combo every time. Phase B
**lowered every synergy rate** (65 % → 45 % for Guts/Poison Heal,
50 % → 35 % for Iron Fist/Lucky Punch, 60 % → 40 % for multihit/Loaded
Dice, 100 % → 55 % for type-dominant booster/gem) so the full item
catalogue rotates through more evenly.

**Weather-setter + rock/seed synergy (Phase B):** a clone whose
switch-in ability is one of `drought / drizzle / sandStream /
snowWarning / somberField / electricSurge / grassySurge / mistySurge`
has a **15 % chance** to carry the matching duration-extender
(`heatRock / dampRock / smoothRock / icyRock / foggySeed /
electricSeed / grassySeed / mistySeed`). When paired, the overlay's
`dispatchOnSwitchIn` hook reads the clone's item after `changeWeather`
fires and appends the rock's `power()` to `saved.weatherTimer`
(vanilla only reads `team[activeMember].item`). Rare by design — the
next enemy in the round rarely shares the type, so the weather ends
up blocking the *player* more than it helps the enemy's team.

**Profile-based picks** (physCount≥3 → Choice Band, bulky → Leftovers/
Assault Vest, fragile → Mental Herb/Quick Claw, etc.) now fire at
55–65 % instead of deterministically — the remaining rolls fall
through to a flat draw from the generic pool so every item gets
airtime across a long run.

**Per-trainer item dedup (Phase B):** each trainer's 3-Pokémon lineup
now enforces item uniqueness — canonical Battle Frontier trainers
always carry 3 distinct items per team, and our clone system matches
that. The current trainer keeps a `__zdcItemsUsed` array on its own
object; `pickItemForClone` receives it and filters the pool before
rolling. When the trainer is defeated and a fresh one is generated,
the field doesn't carry over (new object), so the dedup list naturally
resets. Falls back to allowing a dupe only if the entire pool would
be emptied by dedup (tiny pools on a 3+ mon team).

### Nature gate

| Facility / tier | Nature applied? |
|---|---|
| Palace (any round) | **Always** — the facility's gimmick (`autoMoveByNature`) collapses to neutral without one |
| Boss (any facility) | **Always** |
| Other facility, pre-Silver | Never |
| Other facility, Silver → Gold | Probabilistic (`diff.natureChance` ramp 0.30 → 1.00) |
| Other facility, post-Gold | Always |

Nature is picked by `simulateNatureFor(realId)` — a stat-profile-aware
helper (adamant/modest/jolly/bold/quiet/relaxed) reused from the
trainer generator for player-facing consistency.

**Enemy-side stat-bump (Phase B audit).** Pokechill's damage formula
reads `attacker.nature` but **only on the player side** — the
`exploreCombatWild` path (enemy's attack turn) pulls the enemy's
`bst.atk`/`satk` directly without nature adjustment, so `clone.nature`
alone would have been purely cosmetic on the enemy. To actually bite,
we pre-bump `clone.bst.*` by the matching +1/-1 star at nature-apply
time. The mapping lifts 1:1 from `tooltip.js:1195-1215` (the
authoritative stat-display logic in vanilla Pokechill):

| Nature | Stat deltas |
|---|---|
| adamant | atk +1 / satk -1 |
| modest | atk -1 / satk +1 |
| quiet | hp +1 / atk -1 / satk -1 |
| jolly | def -1 / sdef -1 / spe +1 |
| bold | hp -1 / def +1 / sdef +1 |
| relaxed | hp +1 / spe -1 |

The engine then reads the already-modified stat, and the on-screen
nature pill on the info row is no longer a lie.

---

## Testing

The overlay was validated against a Playwright probe suite that lives
on a separate **dev-only repo** (the `playground` fork — not part of
this release). Coverage at time of merge:

| Suite | Assertions |
|---|---|
| tierMatrix (7 facilities × 4 tiers × 30 samples) | 810 |
| banned enemy moves (28 combos × 5 spawns × 40 tests) | 5600 |
| level-100 gate | 3 |
| facility-specific rules (Palace nature, Arena judge, Dome bracket, Factory rental, Pike doors, Pyramid floors, Tower streak) | 7 |
| brain fight detection (7 facilities × 2 stages) | 14 |
| mega stone roll + transform | 2 |
| BST monotonicity (pre-silver → silver → gold → boss) | 5 |
| filterBannedEnemyMoves output shape | 4 |
| move-gen sanity (50 species × 50 generations) | 50 |
| ZdC entry gate (Oak tutorial) | 2 |
| applyItemBstInflation (CB / Specs / LO / Lefts / Evio) | 9 |
| type-booster gating (charcoal ≥2 fire moves) | 2 |
| dual ability dispatch on boss (normal + hidden both set) | 3 |
| hidden-ability rate at gold non-boss (~75 % target) | 1 |
| facility backgrounds per tile | 7 |
| zdc.png asset HEAD 200 | 1 |
| **Total** | **6520 / 6520 pass** |

Full-tour / arena-live / cheat-and-gold suites plus legacy pause /
close-lock probes also green. The probe harness was re-run after every
phase (Phase 1 ability activation, Phase B damage-calc expansion) to
confirm no regressions. Probes themselves are intentionally not
shipped — they pull a maintainer-local `save.json` and a running
`python -m http.server` instance, neither of which is part of a
player's install.

---

## Known upstream caveats

These live in vanilla Pokechill (not in the overlay) and surface only
under probe conditions / edge cases:

- **`scripts/teams.js:464`** — `injectPreviewTeam` reads
  `areas[saved.currentArea].fieldEffect?.includes(…)`. The `?.` sits on
  `.fieldEffect` only, not on the area lookup. If `saved.currentArea`
  ever resolves to a key not present in `areas`, the call throws.
  Unreachable in normal UI flow (state invariant); hit by rapid-fire
  probe transitions. Fix:
  `areas[saved.currentArea]?.fieldEffect?.includes(…)`.

---

Pre-merge status: all cross-cutting mutations audited; 0 high-severity
exploits surfaced. See commit history for the full iteration trail.
