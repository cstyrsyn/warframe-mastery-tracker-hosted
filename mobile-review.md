# Mobile Friendliness Review — WF_TRACK_V3

Reviewed 2026-06-05. No changes made yet.

---

## Already Good

- Viewport meta tag set correctly (`width=device-width, initial-scale=1.0`)
- Tabs (`#tabs`) use `overflow-x: auto` with `-webkit-overflow-scrolling: touch`
- Main grid uses `auto-fill, minmax(300px, 1fr)` — collapses to one column naturally
- Checklist layout has `@media (max-width: 720px)` single-column fallback
- Modals use `width: 90%; max-width: Xpx` — responsive

---

## Issues to Fix

### 1. List view (`.list-row`) — high impact

The list row has `min-width: 220px` on the name column and `width: 200px` on the rank slider row. On a phone this forces horizontal scrolling across the whole page.

**Proposed fix:** Hide the list-view toggle on mobile (≤600px), or give the list row `flex-wrap: wrap` so name and controls stack vertically.

---

### 2. `#ctrl-row2` has no `flex-wrap`

The Tile / List / Group / Art toggle buttons sit in `display: flex` with no wrapping. With 4–5 visible buttons, they overflow on a 360px screen.

**Proposed fix:** Add `flex-wrap: wrap` to `#ctrl-row2`.

---

### 3. Header (`#hdr`) gets cramped on small screens

At 360px wide, the MR badge + potential badge + XP block + progress bar + header buttons all try to share one flex row before wrapping. The `margin-left: auto` on `#hdr-btns` can look broken on a wrapped layout.

**Proposed fix:** `@media (max-width: 540px)` rule to reduce header padding and optionally hide the potential badge / XP label when there isn't enough room.

---

### 4. Checklist resource row (`.cl-res-row`) — medium impact

Grid is `1fr 70px 30px 72px 80px` (~252px fixed + 1fr name). In the right column at ~320–340px wide (after padding), the Have input and Need text get very tight.

**Proposed fix:** `@media (max-width: 480px)` inside the resources column to collapse each resource to two rows — name + total on top, Have input + Need on the bottom.

---

### 5. Dropdown panels (`.sdd-panel`) can overflow the viewport

Panels anchor at `left: 0` of the trigger. If the trigger is near the right edge of a narrow screen, the 180px+ panel clips off-screen.

**Proposed fix:** Add `max-width: calc(100vw - 24px)` to `.sdd-panel`. For rightmost dropdowns consider anchoring `right: 0` instead of `left: 0`.

---

### 6. Touch target sizes — minor

`.qbtn` has `padding: 2px 7px` — under 44px tall, hard to tap reliably. The rank slider is `height: 3px`, very thin to interact with on touch.

**Proposed fix:** A `@media (hover: none)` rule to increase `.qbtn` padding and slider height for touch devices. Larger refactor — do separately.

---

## Summary

| Area | Change | Effort |
|------|--------|--------|
| `#ctrl-row2` | Add `flex-wrap: wrap` | Trivial |
| `.sdd-panel` | Add `max-width: calc(100vw - 24px)` | Trivial |
| Checklist `.cl-res-row` | Stack to 2 rows at ≤480px | Small |
| `#hdr` | Reduce padding, hide some elements at ≤540px | Small |
| List view on mobile | Hide toggle or wrap rows at ≤600px | Medium |
| Touch targets (`.qbtn`, sliders) | Increase tap area via `@media (hover: none)` | Medium |
