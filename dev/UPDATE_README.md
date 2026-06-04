# update.js — Data Update Script

Validates one or more CSV files and appends new items to `data.js`. Dry-run by default — nothing is written unless `--apply` is passed.

---

## Prerequisites

Node.js (any recent version). No npm dependencies — uses only built-in modules.

---

## Usage

```
node update.js [--section <id> [id ...]] [--apply] [--override]
```

| Flag | Effect |
|---|---|
| *(no flags)* | Dry-run all sections |
| `--section <id> [id ...]` | Process only the named section(s) |
| `--apply` | Write changes to `data.js` and download images |
| `--override` | Bypass blocking validation errors (unknown category / polarity / rank) |

### Examples

```
node update.js                                    # preview everything
node update.js --section warframes                # preview one section
node update.js --section warframes primary melee  # preview several
node update.js --section primary --apply          # write primary weapons
node update.js --apply                            # write all sections
node update.js --section mods --apply --override  # write mods, skip unknown-category errors
```

---

## Sections

| Section ID | Source CSV | `data.js` array |
|---|---|---|
| `warframes` | `Source/warframes.csv` | `WARFRAMES` |
| `companions` | `Source/companions.csv` | `COMPANIONS` |
| `vehicles` | `Source/vehicles.csv` | `VEHICLES` |
| `primary` | `Source/weapons_primary.csv` | `PRIMARY` |
| `secondary` | `Source/weapons_secondary.csv` | `SECONDARY` |
| `melee` | `Source/weapons_melee.csv` | `MELEE` |
| `archWeapons` | `Source/weapons_vehicles.csv` | `ARCH_WEAPONS` |
| `compWeapons` | `Source/weapons_companions.csv` | `COMP_WEAPONS` |
| `amps` | `Source/weapons_amps.csv` | `AMPS` |
| `intrinsics` | `Source/intrinsics.csv` | `INTRINSICS` |
| `mods` | `warframe_mods_v3.csv` | `MODS` + `MOD_DESC` |
| `arcanes` | `Source/arcanes.csv` | `ARCANES` + `ARCANE_DESC` |

All paths are relative to the `dev/` folder.

---

## CSV Formats

Template files for each section are in `dev/Templates/`. Copy the relevant template rows into the appropriate source CSV, fill in your new items, then run the script.

### Warframes

```
Name, Category, Method to Obtain, Tradable, Vaulted, Circuit Available
```

| Field | Required | Valid values |
|---|---|---|
| Name | Yes | Item name (must match wiki exactly for image/link checks) |
| Category | Yes | Must match an existing category in `data.js` e.g. `Base`, `Prime`, `Umbra` |
| Method to Obtain | Yes | Free text |
| Tradable | No | `Yes` / `No` / blank |
| Vaulted | No | `Yes` / `No` / blank — see [Vaulted override](#vaulted-override) |
| Circuit Available | No | Not used by the script — informational only |

### Weapons (Primary / Secondary / Melee)

```
Name, Category, Method to Obtain, Tradable, Component for, Max Rank
```

| Field | Required | Notes |
|---|---|---|
| Name | Yes | |
| Category | Yes | e.g. `Rifles`, `Shotguns`, `Single`, `Dual`, `Swords/Nikanas`, `Heavy Blades` |
| Method to Obtain | Yes | |
| Tradable | No | `Yes` / `No` |
| Component for | No | Only for weapons that are crafting components (e.g. Umbra weapons). Semicolon-separated if multiple. |
| Max Rank | No | Defaults to `30` if blank |

### Companions / Vehicles / Arch-Weapons / Comp. Weapons / Amps

```
Name, Category, Method to Obtain, Tradable, Max Rank
```

Same as weapons but without `Component for`. Max Rank defaults to `30`.

### Intrinsics

```
Name, Category, Method to Obtain, Max Rank
```

| Field | Notes |
|---|---|
| Category | `Railjack` or `Drifter` — determines the image filename convention |
| Max Rank | Max `10` |

### Mods

```
Name, Description, BaseDrain, Max Rank, Polarity, IsExilus, Rarity, Type, Category, Sub-Type, Use, Acquisition, Tradable
```

| Field | Required | Notes |
|---|---|---|
| Name | Yes | |
| Description | No | Shown as tooltip |
| BaseDrain | No | Base mod capacity cost |
| Max Rank | Yes | `0`–`15` |
| Polarity | Yes | `Naramon`, `Madurai`, `Vazarin`, `Zenurik`, `Unairu`, `Penjaga`, `Umbra`, `Universal`, or blank |
| IsExilus | No | `TRUE` / blank |
| Rarity | No | `Common`, `Uncommon`, `Rare`, `Legendary` |
| Type | No | Warframe or weapon the mod belongs to e.g. `Trinity`, `Primary` |
| Category | Yes | e.g. `Warframe Augment`, `Rifle`, `Exilus` |
| Sub-Type | No | Semicolon-separated |
| Use | No | Semicolon-separated |
| Acquisition | No | Semicolon-separated sources |
| Tradable | No | `TRUE` / `FALSE` |

Mods with `Category = Unobtainable` are silently ignored.

### Arcanes

```
Name, Description, Max Rank, Rarity, Type, Acquisition, Tradable
```

| Field | Required | Notes |
|---|---|---|
| Name | Yes | |
| Type | Yes | What it applies to e.g. `Warframe`, `Primary`, `Secondary`, `Melee` |
| Max Rank | Yes | `0`–`10` |
| Acquisition | No | Semicolon-separated sources |
| Tradable | No | `TRUE` / `FALSE` |

---

## Check Behaviour

### Blocking errors — item is not added

These prevent the item from being written. Use `--override` to bypass the category, polarity, and rank checks when adding items with genuinely new values.

| Check | Condition |
|---|---|
| Missing required field | Name, Category / Type, or Method to Obtain is empty |
| Unknown category | Category not found in the existing `data.js` section |
| Max Rank out of range | Outside the expected range for the section (see table below) |
| Unknown polarity | Mods only — value not in the known polarity list |

**Max Rank ranges:**

| Section | Range |
|---|---|
| Warframes, Companions, Vehicles, all Weapons, Amps | 1–40 |
| Intrinsics | 1–10 |
| Mods | 0–15 |
| Arcanes | 0–10 |

### Skipped — item not added, alert shown

| Check | Note |
|---|---|
| Duplicate name in CSV | Second occurrence is skipped |
| Already in `data.js` | Item is already present — no action needed |
| Tradable name needs `MARKET_SLUG_MAP` entry | Name contains characters (`&`, `/`, etc.) that break the market URL slug. Add a manual entry to `MARKET_SLUG_MAP` in `warframe-mastery-tracker.html` first, then re-run. |

### Warnings — item is still added

These are soft failures. The item is queued normally; the warning is noted for manual follow-up.

| Check | Note |
|---|---|
| Wiki link returns 404 | Page may not exist yet, or the name doesn't match the wiki title |
| Market link returns redirect | Item may not be listed on warframe.market yet |
| Image download fails | Image couldn't be fetched from the wiki. Provide an override image manually in `Images/<folder>/` |

### Auto-fixed — noted in output

| Check | Action |
|---|---|
| Leading / trailing whitespace in Name | Trimmed automatically |
| Image already exists locally | Download skipped, noted in output |

---

## Workflow

1. **Add new items** to the relevant source CSV (or use a template from `dev/Templates/` as a reference).
2. **Dry-run** to preview what would happen:
   ```
   node update.js --section primary
   ```
3. **Fix any blocking errors** shown in the output (red ✗ lines).
4. **Apply** once the preview looks correct:
   ```
   node update.js --section primary --apply
   ```
5. Refresh `warframe-mastery-tracker.html` in the browser.

---

## Special Cases

### Vaulted override (Warframes only)

The `Vaulted` column in `warframes.csv` controls the `VAULTED_WF` set in `data.js`, which drives the Vaulted / Resurgence badge on warframe cards.

- **`Vaulted = Yes`** — adds the warframe to `VAULTED_WF`
- **`Vaulted = No`** — removes the warframe from `VAULTED_WF` (use this when a prime is unvaulted)
- **Blank** — no change to `VAULTED_WF`

This works for **existing** warframes too — you can update vault status without adding a new item. For example, to batch-update after a Prime Resurgence rotation, add rows for the relevant primes with only the `Name` and `Vaulted` columns filled in and run with `--apply`.

### MARKET_SLUG_MAP

The market URL for tradable items is generated automatically as `name_set` (e.g. `ash_prime_set`). Some items have slugs that don't follow this pattern — these are stored in `MARKET_SLUG_MAP` inside `warframe-mastery-tracker.html`.

If a new tradable item has `&`, `/`, or other special characters in its name, the script will skip it and tell you to add a `MARKET_SLUG_MAP` entry first. Once added, re-run the script.

### `--override`

Use this when adding items with a genuinely new category or polarity value — for example, a new weapon class, a new companion type, or a mod from a new system. The override flag turns those blocking errors into warnings and still writes the item.

After using `--override`, check that the new category renders correctly in the tracker UI (the category pill on cards).

---

## Output Key

```
  ✓   Item queued / image downloaded / change applied
  ⚠   Warning or auto-fix (item still processed)
  ✗   Blocking error (item not added)
  ·   Informational (already present, dry-run note, etc.)
```
