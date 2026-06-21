# Warframe Mastery Tracker

A web app for tracking Mastery Rank progress in Warframe. Log ranks for every warframe, weapon, companion, amp, mod, arcane, and more — with optional cloud sync across devices.

## Tracking

- **MR progress** across all item categories: warframes, primary/secondary/melee weapons, companions, vehicles, arch-weapons, amps, mods, arcanes, and intrinsics.
- **Potential MR** — see what rank you'd reach if you maxed everything you already own
- **Star Chart & Steel Path** — completion tracking with per-planet XP
- **Incarnon Genesis** — track which adapters you've acquired, with the current Circuit week highlighted
- **The Circuit** — live week indicator for both the incarnon rotation (9-week cycle) and warframe rotation (11-week cycle), resetting every Monday UTC

## Tools

- **Crafting checklist** — queue items to build, log resources on hand, and mark them done when crafted
- **Build planner** — save mod loadouts per item; import top community builds from [Overframe](https://overframe.gg) as a starting point
- **Kitgun & Zaw builder** — track the components you want and the resources required to build them.
- **Ducat calculator** — see the ducat value of untraded prime parts

## Data & sync

- Progress saves locally to `localStorage` — no account needed
- **Cloud sync** via Supabase — sign in via Discord to sync progress across devices
- **Auto-backup** — optionally mirror saves to a local JSON file automatically
- **Import / export** — JSON round-trip; also accepts `.xlsx`/`.xlsm` and Google Sheets

### Privacy
- Note when using Cloud sync, the only personal information stored about you is the email address linked to your Discord account.

## Local vs. online

The app works in two modes depending on whether it's opened as a plain file or hosted with a Supabase backend configured.

### Local (file opened directly in a browser)

Progress is stored in your browser's `localStorage`. Everything works offline with no account needed. Data stays on that machine and in that browser — it won't follow you to another device, and clearing site data will erase it. The auto-backup feature lets you write a JSON file to disk on every save as an extra safety net.

Note: for a better local expierence, open the app in a local web server. The easiest is to just use Python:
`python -m http.server`

### Online (hosted site with Supabase + Discord)

When the site is deployed with a `config.js` pointing at a Supabase project, a **Sign in** button appears in the menu. Clicking it redirects to Discord for OAuth — no separate password. Once signed in:

- Progress, checklist, build loadouts, and UI preferences are pushed to Supabase after every change and pulled down on sign-in.
- Signing into the same account on any device loads your progress automatically.
- Signing out clears local storage so your data doesn't linger on a shared machine.

If the app is opened without a valid `config.js`, or if Supabase fails to initialise, it silently falls back to local-only mode — the Sign in button is hidden and nothing breaks.

---

For setup, deployment, and data maintenance see [dev/README.md](dev/README.md).
