---
title: Changelog
tags: [changelog]
updated: 2026-11-14
---

# Changelog

## 2026-11-14 — Blank page when the route was emptied

Type: Fixed. Effort: L1.

- Removing the destination while the Spot tab was open crashed the page: the result content was built even with no position to show. It is now built only when there is one. Regression from the layout change earlier the same day.

## 2026-11-14 — Layout follows screen width

Type: Changed. Effort: L2.

- Three arrangements picked from the width on hand ([architecture](architecture.md)): wide (1600px and up) keeps setup left and result right; docked (821 to 1599px) puts both in one sidebar with a single rail and the verdict pinned on top, so the map keeps the width; stacked (820px and under) for phones.
- Panel widths scale with the screen on wide monitors. Switching happens live on resize; the open tab carries over.

## 2026-11-14 — Mode switch labels and law lines

Type: Fixed. Effort: L1.

- Snare / Dampen switch stacks name over what it does, so labels no longer truncate in the narrower setup panel.
- Law lines drop the coloured side stripe: state shows as a dot on the label inside a hairline box.

## 2026-11-14 — Two-panel workspace

Type: Changed. Effort: L2.

- One long sidebar split in two ([architecture](architecture.md)): left rail + tabbed setup panel (Scout, Route, Ship and law, Plans), right result panel with the verdict pinned over Spot, Fly in, Verify and Timing tabs. Map between.
- Result panel collapses; the choice is remembered in the browser. Phone: map, result, then setup tabs as a strip.
- `src/components/Tabs.tsx`: keyboard-navigable tab strip. Rail item look follows SC-ORG-BOT's sidebar nav item; icons from `lucide-react`.

## 2026-11-14 — Saved plans, JSON import/export, reset all

Type: Added. Effort: L2.

- Plans section: save the plan on screen under a name, switch between saved plans, delete them. Kept in `localStorage` (`snares.plans.v1`), this browser only ([architecture](architecture.md)).
- Export all saved plans (or the current one) as a JSON file; import merges without overwriting and skips plans already present.
- Reset all in the header: back to a blank plan in the current system. Saved plans stay. Two presses, as does deleting a plan.

## 2026-11-13 — Fankit mark and disclaimer

Type: Added. Effort: L1.

- Made By The Community mark and CIG's disclaimer in a persistent footer, with guard tests ([decision](decisions/star-citizen-fankit-compliance.md)).
- `NOTICE.md`.

## 2026-11-13 — First version of the snare planner

Type: Added. Effort: L3.

- Solver for multi-origin snare positions with corridor, coverage and room for error ([architecture](architecture.md)).
- Route changes, approach lines, `/showlocation` position check, target timing, 2D/3D map, share links.
- Data bake from sc-gamedata; Stanton, Pyro, Nyx.
- GitHub Pages workflow.
- Spec: [snare-planner](plans/specs/snare-planner.md).
