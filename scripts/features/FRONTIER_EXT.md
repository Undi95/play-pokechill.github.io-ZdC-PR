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

## Testing

Playwright probes (not shipped in this patch — available in the
development fork) cover:

| Probe | What it covers |
|---|---|
| `_probe_full_tour.js` | Smoke-test every facility: start → launch → abandon cycle |
| `_probe_cheat_and_gold.js` | Exploit attempts (streak injection, duplicate-run, save-editor symbol flip, theme-index overflow, Arena switch block) + silver/gold grant per facility |
| `_probe_arena_live.js` | Live Arena combat — verifies judge fires exactly once per matchup, no rAF-loop leaks |
| `_probe_arena_ko_reset.js` | Verifies arena counters reset when a player Pokémon dies outside a verdict |
| `_probe_arena_noswitch.js` | Voluntary switches blocked mid-matchup; post-KO auto-switch allowed |
| `_probe_factory_flow.js` | Factory rental pool generation + modal flow |
| `_probe_pause_flow.js` | Rest / Resume / F5 survival |
| `_probe_close_lock.js` | × button + backdrop-click locked during active runs |

Run any probe with:

```bash
python -m http.server 8765         # from repo root
node _probe_<name>.js              # separate terminal
```

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
