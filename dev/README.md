# Dev & Setup

## Running locally

### Local only (no cloud sync)

Open `index.html` directly in a browser. Progress saves to `localStorage`.

### With cloud sync (Supabase)

1. Create a [Supabase](https://supabase.com) project.
2. Copy `config.example.js` to `config.js` and fill in your project URL and publishable key.
3. Serve the files from any static host or `localhost`.

`config.js` is gitignored — never commit your keys.

### Overframe builds proxy

The Builds panel fetches community builds from the Overframe API. In production this goes through a Cloudflare Pages Function (`functions/of-proxy/`). For local dev, run the proxy first:

```bash
node dev/Archive/overframe_proxy.js   # port 3001
```

Open `index.html` via `localhost` and the app routes API calls through it automatically.

## Deployment

Static site, no build step. Deploy `index.html`, `app.js`, `data/`, `relics.js`, `weapon-mr.js`, and `functions/` to any static host. Cloudflare Pages is recommended — it picks up `functions/of-proxy/` as a Pages Function automatically.

## Data maintenance

Scripts in `dev/` scrape the Warframe Wiki and other sources to keep item data current:

| Script | Updates |
|--------|---------|
| `update-weapons.js` | Primary, secondary, melee, arch-weapon data |
| `update-warframes.js` | Warframe data |
| `update-mods.js` | Mod list and descriptions |
| `update-arcanes.js` | Arcane list and descriptions |
| `update-blueprints.js` | Crafting blueprint costs |
| `update-relics.js` | Relic drop tables |

Run any of these from the repo root:

```bash
node dev/update-weapons.js
```

Output is written directly into the relevant `data/data-*.js` file.

## Project structure

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
