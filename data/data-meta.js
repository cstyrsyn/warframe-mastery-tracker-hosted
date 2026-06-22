// ═══════════════════════════════════════════════════════════════
// WARFRAME MASTERY TRACKER — GAME METADATA
// ═══════════════════════════════════════════════════════════════
// Contains game-wide constants not tied to a specific item category:
//   MASTERY         — MR rank table
//   SC_*            — Star Chart planets, junctions, and XP values
//   ARCHON_SHARDS   — Shard colours, tauforged buffs
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

// ── STAR CHART ────────────────────────────────────────────────────
// Add new planets/junctions here as they're added to the game.
// Planets tracked separately for regular and Steel Path completions.
const SC_PLANETS = [
  "Mercury","Venus","Earth","Lua","Mars","Deimos","Phobos","Ceres",
  "Jupiter","Europa","Saturn","Uranus","Neptune","Pluto","Sedna",
  "Eris","Kuva Fortress","Void","Zariman","Duviri",
];
const SC_SP_PLANETS = [...SC_PLANETS]; // Steel Path versions (same list, tracked separately)
const SC_JUNCTIONS = [
  "Mercury","Venus","Mars","Phobos","Ceres","Jupiter","Europa",
  "Saturn","Uranus","Neptune","Pluto","Sedna","Eris",
];
const SC_SP_JUNCTIONS = [...SC_JUNCTIONS]; // Steel Path junction versions

const SC_PLANET_XP = {
  "Mercury": 49, "Venus": 319, "Earth": 308, "Lua": 0, "Mars": 777,
  "Deimos": 0, "Phobos": 1356, "Ceres": 1956, "Jupiter": 718,
  "Europa": 1656, "Saturn": 709, "Uranus": 803, "Neptune": 572,
  "Pluto": 561, "Sedna": 2274, "Eris": 2511,
  "Kuva Fortress": 0, "Void": 0, "Zariman": 0, "Duviri": 0,
};
const SC_JUNCTION_XP = 1000; // XP per junction

// ── ARCHON SHARDS ─────────────────────────────────────────────────
// Each buff entry: [normal, tauforged]
const ARCHON_SHARDS = {
  Crimson: { hex: '#c84040', buffs: [
    ['+25% Melee Critical Damage',     '+37.5% Melee Critical Damage'],
    ['+25% Primary Status Chance',     '+37.5% Primary Status Chance'],
    ['+25% Secondary Critical Chance', '+37.5% Secondary Critical Chance'],
    ['+10% Ability Strength',          '+15% Ability Strength'],
    ['+10% Ability Duration',          '+15% Ability Duration'],
  ]},
  Amber: { hex: '#c88020', buffs: [
    ['+30% Energy filled on Spawn',          '+45% Energy filled on Spawn'],
    ['+100% Effectiveness on Health Orbs',   '+150% Effectiveness on Health Orbs'],
    ['+50% Effectiveness on Energy Orbs',    '+75% Effectiveness on Energy Orbs'],
    ['+25% Casting Speed',                   '+37.5% Casting Speed'],
    ['+15% Parkour Velocity',                '+22.5% Parkour Velocity'],
  ]},
  Azure: { hex: '#4a86d8', buffs: [
    ['+150 Max Health',          '+225 Max Health'],
    ['+150 Shield Capacity',     '+225 Shield Capacity'],
    ['+50 Energy Max',           '+75 Energy Max'],
    ['+150 Armor',               '+225 Armor'],
    ['+5 Health/s Regenerated',  '+7.5 Health/s Regenerated'],
  ]},
  Emerald: { hex: '#30a850', buffs: [
    ['Toxin Status deals +30% more damage',     'Toxin Status deals +45% more damage'],
    ['+2 Health per Toxin Status hit',          '+3 Health per Toxin Status hit'],
    ['+10% Ability Damage vs Corrosion Status', '+15% Ability Damage vs Corrosion Status'],
    ['+2 max Corrosion Status stacks',          '+3 max Corrosion Status stacks'],
  ]},
  Topaz: { hex: '#c86020', buffs: [
    ['+1 Max HP per Blast kill (max 300)',      '+2 Max HP per Blast kill (max 450)'],
    ['+5 Shield per Blast kill',                '+7.5 Shield per Blast kill'],
    ['+1% Sec Crit per Heat kill (max 50%)',   '+1.5% Sec Crit per Heat kill (max 75%)'],
    ['+10% Ability Damage vs Radiation Status', '+15% Ability Damage vs Radiation Status'],
  ]},
  Violet: { hex: '#8040c8', buffs: [
    ['+10% Ability Damage vs Electricity Status',       '+15% Ability Damage vs Electricity Status'],
    ['+30% Primary Electricity Damage',                 '+45% Primary Electricity Damage'],
    ['+25% Melee Crit Damage (2x when >500 Energy)',   '+37.5% Melee Crit Damage (2x when >500 Energy)'],
    ['+20% Health/Energy cross-pickup',                 '+30% Health/Energy cross-pickup'],
  ]},
};
