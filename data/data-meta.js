// ═══════════════════════════════════════════════════════════════
// WARFRAME MASTERY TRACKER — DATA FILE
// ═══════════════════════════════════════════════════════════════
//
// HOW TO ADD NEW CONTENT
// ──────────────────────
// Each item is up to a 7-element array:
//   ["Name", "Category", "How to obtain", maxRank, xpPerLevel, tradable, compFor]
//   tradable: 1 if tradeable between players, 0 or omit if not.
//   compFor:  semicolon-separated list of weapons this item is used to craft (omit if none).
//
// XP rules (from the game):
//   200 xpPerLevel → Warframes, Companions, Archwings, K-Drives,
//                    Plexus, Necramechs
//   100 xpPerLevel → All weapons (primary, secondary, melee,
//                    companion weapons, arch-weapons, amps)
//  1500 xpPerLevel → Intrinsics (Railjack + Drifter skills)
//
// Max rank values:
//    30 → Standard items
//    40 → Kuva, Tenet, Coda weapons; Necramechs; Paracesis
//    10 → Intrinsics
//
// Example — adding a new warframe:
//   ["Styanax Prime", "Prime", "Relics", 30, 200],
//
// Example — adding a new Kuva weapon:
//   ["Kuva Zarr", "Kuva", "Kuva Lich", 40, 100],
//
// Star chart: edit SC_PLANETS, SC_JUNCTIONS, or their SP
// counterparts if new planets or junctions are ever added.
// ═══════════════════════════════════════════════════════════════

// ── MASTERY RANKS ────────────────────────────────────────────────
// {r: rank label, t: title, xp: cumulative XP required}
const MASTERY = [
  {r:"MR0",t:"Unranked",xp:0},{r:"MR1",t:"Initiate",xp:2500},
  {r:"MR2",t:"Silver Initiate",xp:10000},{r:"MR3",t:"Gold Initiate",xp:22500},
  {r:"MR4",t:"Novice",xp:40000},{r:"MR5",t:"Silver Novice",xp:62500},
  {r:"MR6",t:"Gold Novice",xp:90000},{r:"MR7",t:"Disciple",xp:122500},
  {r:"MR8",t:"Silver Disciple",xp:160000},{r:"MR9",t:"Gold Disciple",xp:202500},
  {r:"MR10",t:"Seeker",xp:250000},{r:"MR11",t:"Silver Seeker",xp:302500},
  {r:"MR12",t:"Gold Seeker",xp:360000},{r:"MR13",t:"Hunter",xp:422500},
  {r:"MR14",t:"Silver Hunter",xp:490000},{r:"MR15",t:"Gold Hunter",xp:562500},
  {r:"MR16",t:"Eagle",xp:640000},{r:"MR17",t:"Silver Eagle",xp:722500},
  {r:"MR18",t:"Gold Eagle",xp:810000},{r:"MR19",t:"Tiger",xp:902500},
  {r:"MR20",t:"Silver Tiger",xp:1000000},{r:"MR21",t:"Gold Tiger",xp:1102500},
  {r:"MR22",t:"Dragon",xp:1210000},{r:"MR23",t:"Silver Dragon",xp:1322500},
  {r:"MR24",t:"Gold Dragon",xp:1440000},{r:"MR25",t:"Sage",xp:1562500},
  {r:"MR26",t:"Silver Sage",xp:1690000},{r:"MR27",t:"Gold Sage",xp:1822500},
  {r:"MR28",t:"Master",xp:1960000},{r:"MR29",t:"Middle Master",xp:2102500},
  {r:"MR30",t:"True Master",xp:2250000},{r:"LR1",t:"Legendary 1",xp:2397500},
  {r:"LR2",t:"Legendary 2",xp:2545000},{r:"LR3",t:"Legendary 3",xp:2692500},
  {r:"LR4",t:"Legendary 4",xp:2840000},{r:"LR5",t:"Legendary 5",xp:2987500},
  {r:"LR6",t:"Legendary 6",xp:3135000},
];

