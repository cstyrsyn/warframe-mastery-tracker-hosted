# Security Review — Warframe Mastery Tracker

**Date:** 2026-06-22
**Reviewer:** Claude (Sonnet 4.6)
**Scope:** Full codebase static analysis (`index.html`, `app.js`, `data/data-*.js`)

---

## Findings

### 1. Unvalidated `baseBuildUrl` stored to localStorage / Supabase

**Severity:** Low | **Confidence:** 8/10

`build.url` from the Overframe API was stored verbatim as `baseBuildUrl` and later rendered into `href` attributes:

```js
href="https://overframe.gg${esc(data.baseBuildUrl || '')}"
```

`esc()` sanitises HTML metacharacters (`<`, `>`, `"`, `&`) but does not validate URL scheme or path structure. The prepended `https://overframe.gg` literal in the template string prevents a `javascript:` scheme from being interpreted by the browser, so the direct XSS risk is low. The real concern is that a crafted value imported via JSON (social engineering) or written directly to Supabase could store an unexpected path that survives into the DOM.

**Fix applied** (`app.js`):

Added `isSafeOfPath()` — accepts only strings matching `/^\/[\w\-\/\.]+$/` (a relative path of safe characters):

```js
function isSafeOfPath(u) {
  return typeof u === 'string' && /^\/[\w\-\/\.]+$/.test(u);
}
```

Added `sanitizeMyBuilds()` — deep-clones a raw `my_builds` object and strips any `baseBuildUrl` value that fails validation:

```js
function sanitizeMyBuilds(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [item, builds] of Object.entries(raw)) {
    if (!Array.isArray(builds)) continue;
    out[item] = builds.map(b => ({
      ...b,
      baseBuildUrl: isSafeOfPath(b?.baseBuildUrl) ? b.baseBuildUrl : null,
    }));
  }
  return out;
}
```

Applied at all data entry points:
- API response (3 sites in `blpLoadOFBuild()`)
- localStorage migration in `loadMyBuilds()` (2 sites)
- Supabase cloud load in `loadFromCloud()` via `sanitizeMyBuilds()`

---

### 2. CSP `script-src 'unsafe-inline'` negated XSS protection

**Severity:** Medium | **Confidence:** 10/10

The original Content-Security-Policy included `'unsafe-inline'` in `script-src`:

```
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.sheetjs.com
```

`'unsafe-inline'` in `script-src` allows any inline `<script>` block and any inline event handler attribute (`onclick=`, `oninput=`, etc.) to execute. This means the CSP provided zero protection against XSS — any injected `<script>` tag would run unchallenged.

**Fix applied** (`index.html`, new `layout.js`):

The fix was split into two parts because `app.js` dynamically generates HTML strings containing 110+ inline `onclick=` attributes with variable content (item names, ranks, IDs). These cannot be statically hashed or easily replaced without a full event-delegation rewrite of the rendering system.

**Part A — Removed inline `<script>` block from `index.html`:**
The 82-line inline script block (layout functions + touch handler) was extracted to `layout.js`, loaded as an external script after `app.js`. All 37 inline event handler attributes in the static HTML were replaced with `addEventListener` calls in `layout.js`.

**Part B — Split CSP into `script-src` and `script-src-attr`:**

```
script-src 'self' https://cdn.jsdelivr.net https://cdn.sheetjs.com
script-src-attr 'unsafe-inline'
```

`script-src` (no `'unsafe-inline'`) blocks injected `<script>` tags and external script loads from unauthorised origins — this is the primary XSS risk vector. `script-src-attr 'unsafe-inline'` specifically allows inline event handler attributes, which the dynamically generated card HTML requires.

**Net result vs original:**

| Attack vector | Before | After |
|---|---|---|
| Injected `<script src="evil.com/x.js">` | Allowed | **Blocked** |
| Injected `<script>stealData()</script>` | Allowed | **Blocked** |
| Inline `onclick=` on dynamically rendered cards | Allowed | Allowed (required) |
| Inline `<script>` blocks in HTML | Allowed | **Blocked** |

---

## What Was Not Changed

- `style-src 'unsafe-inline'` — left in place; CSS injection is a separate, lower-severity concern and removing it would require migrating all inline `style=""` attributes throughout the HTML.
- The 110+ dynamically generated `onclick=` attributes in `app.js` template strings — converting these to event delegation would require a significant architectural refactor of the entire rendering system and is tracked as a future improvement.

---

## Remaining Improvement: Event Delegation

The long-term fix for fully eliminating `script-src-attr 'unsafe-inline'` is to convert `app.js`'s rendering from innerHTML-with-inline-handlers to event delegation. The pattern would be:

1. Replace inline handlers like `onclick="setRank('warframes','${name}',${r})"` with `data-*` attributes: `data-action="setRank" data-tab="warframes" data-name="${esc(name)}" data-rank="${r}"`
2. Attach a single delegated listener on `#grid` (and other containers) that reads `data-action` and routes to the correct function

This would allow `script-src-attr` to be tightened further, or removed entirely if all static HTML handlers in `layout.js` are also converted. This is a non-trivial refactor across the full `app.js` rendering pipeline.
