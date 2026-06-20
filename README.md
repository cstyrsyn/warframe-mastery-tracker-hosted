# Warframe Mastery Tracker

A personal web app for tracking Mastery Rank progress in Warframe. Logs ranks for every warframe, weapon, companion, amp, mod, arcane, and more — with cloud sync via Supabase.

## Features

- **MR progress tracking** across all item categories: warframes, primary/secondary/melee weapons, companions, vehicles, arch-weapons, amps, mods, arcanes, intrinsics, and conclave
- **Potential MR display** — shows what MR you'd reach if you maxed everything you already own
- **Star Chart & Steel Path** completion tracking with per-planet XP
- **The Circuit** — current week indicator for both the incarnon genesis rotation (9-week cycle) and warframe rotation (11-week cycle), updating every Monday UTC
- **Incarnon Genesis** tracking per weapon, with current week highlighted
- **Crafting checklist** — add items to a list, log resources you own, and mark items done when crafted
- **Ducat calculator** — shows ducat value for your unowned prime parts
- **Kitgun & Zaw builder** — stat comparison for modular weapon components
- **Build planner** — save and manage mod loadouts per item, with optional import from [Overframe](https://overframe.gg) community builds
- **Cloud sync** via Supabase (optional) — progress syncs across devices when signed in
- **Auto-backup** — optionally writes a JSON backup to a local file on every save
- **Import / export** — JSON round-trip; also accepts `.xlsx`/`.xlsm` files and Google Sheets

## Getting Started

### Without cloud sync (local only)

Open `index.html` directly in a browser. Progress is saved to `localStorage`.

### With cloud sync (Supabase)

1. Create a [Supabase](https://supabase.com) project.
2. Copy `config.example.js` to `config.js` and fill in your project URL and publishable key.
3. Serve the files from any static host (or `localhost`).

`config.js` is gitignored — never commit your keys.

### Local development (Overframe builds proxy)

The Builds panel fetches data from the Overframe API. In production this goes through a Cloudflare Pages Function (`functions/of-proxy/`). For local dev, run the proxy server first:

```bash
node dev/Archive/overframe_proxy.js   # starts on port 3001
```

Then open `index.html` via `localhost` and the app will route API calls through the proxy automatically.

## Project Structure

```
index.html              Main page — all CSS inline, loads scripts
app.js                  All UI and application logic
data/
  data-meta.js          Mastery rank XP table
  data-items.js         Item arrays, circuit schedules, star chart data
  data-blueprints.js    Incarnon requirements, currencies, crafting blueprints
  data-mods.js          Mod data and descriptions
  data-arcanes.js       Arcane data and descriptions
  data-kitguns.js       Kitgun and Zaw component stats
  data-overframe.js     Overframe item ID map, default polarities
  data-overframe-mods.js  Overframe mod ID map
relics.js               Relic drop tables
weapon-mr.js            Supplemental weapon MR data
config.example.js       Supabase credentials template
config.js               Your credentials (gitignored)
functions/of-proxy/     Cloudflare Pages Function for Overframe API proxy
dev/                    Data maintenance scripts (scrapers, importers, updaters)
```

## Data Updates

Item data is maintained by scripts in `dev/`. These scrape the [Warframe Wiki](https://wiki.warframewiki.com) and other sources to keep weapon stats, blueprints, mod drains, and arcane details current:

| Script | Updates |
|--------|---------|
| `dev/update-weapons.js` | Primary, secondary, melee, arch-weapon data |
| `dev/update-warframes.js` | Warframe data |
| `dev/update-mods.js` | Mod list and descriptions |
| `dev/update-arcanes.js` | Arcane list and descriptions |
| `dev/update-blueprints.js` | Crafting blueprint costs |
| `dev/update-relics.js` | Relic drop tables |

## Deployment

The app is a static site with no build step. Deploy `index.html`, `app.js`, the `data/` folder, `relics.js`, `weapon-mr.js`, and `functions/` to any static host. Cloudflare Pages is recommended as the `functions/of-proxy/` directory is picked up automatically as a Pages Function.
