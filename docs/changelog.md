---
title: Changelog
tags: [changelog]
updated: 2026-11-14
---

# Changelog

## 2026-11-14 — Orbital markers and routes round a body

Type: Added, Changed. Effort: L2.

- Orbital markers ([architecture](architecture.md)): OM-1 to OM-6 around every planet and moon, derived at load (`src/lib/markers.ts`). The game files carry the rule (Planet and Moon types spawn `NavPoint_SubPoint`, the `CardinalPoint` record) but no positions. Radius is a fit to player-measured distances: `√2 × obstruction radius + 7,177 m` for moons, `+ 10,000 m` for planets and stars. Exact for most Stanton moons, ArcCorp and microTech; unchecked in Pyro and Nyx.
- Markers can be picked as origin, destination or start (type "om" in a picker), show on the map once zoomed in, and count as lines to fly in on.
- Blocked routes are now plotted the way the game does it ([architecture](architecture.md)): a jump with a star, planet or moon in the way stops at that body's markers, so the last run into the destination comes from the marker (`src/lib/routing.ts`). Before, such a route was only flagged. About a quarter of Stanton's station-to-station routes are affected.
- The route table names the marker and offers "catch it there": the same plan aimed at the marker, where the target drops out 1 km short with no armistice zone.
- The scout counts places that come in round a body; it used to leave them out.
- The route planner itself is not in the game files. The model is the shortest chain of clear jumps over the markers of the bodies in the way.

## 2026-11-14 — Fleet planning and the Mantis dampener readout

Type: Added. Effort: L3.

- Fleet ([architecture](architecture.md)): up to five ships beside the lead, each with a role and its own interdictor. Split divides routes one spot cannot cover between nets; Hold puts a dampener where a net's catch comes to rest; Backstop lines a second net up behind another. While dampening, every extra ship is another dampener.
- Each ship has a leg of its own, so Spot, Fly in, Verify and Timing work per ship. The verdict becomes the fleet's; a switch over the result picks the ship in focus; the map draws them all.
- Snare and dampener together: a snare spot now says whether the ship's own dampener reaches what it pulls out (a Mantis: targets stop about 20 km out, 8 km beyond its 12 km dampener) and offers a holding ship.
- Fleet travels in the link (`f`) and in saved plans.

## 2026-11-14 — Comm dead zones, steadier map picking, priority by traffic

Type: Added, Fixed. Effort: L2.

- Jammer dead zones ([architecture](architecture.md)): Grim HEX carries a `MonitorZoneJammer` in the game files (35 km) that cancels monitoring around it. A spot inside reads Dark; the map draws the zone; a watched spot heading for a jammed station says how far outside it sits. The scout judges such destinations by the planned spot, not the station.
- Whole archive searched: five jammers exist, and only Grim HEX's is in open space (three are prison caves, one a mission instance).
- Fixed: hovering a spot where several places stack (a planet, its moons and stations when zoomed out) picked the nearest dot, so the label changed name as the pointer moved. A stack now gives up its most important member, and equals keep the one already held (`src/lib/pick.ts`).
- Labels and picks rank by traffic weight after stars and planets: cities and core stations come before comm arrays and mining bases.

## 2026-11-14 — Privacy policy and terms

Type: Added. Effort: L1.

- Footer panel gains About, Privacy and Terms views; a Privacy button sits in the always-visible row. Text in `src/components/Policies.tsx`, mirrored in `PRIVACY.md` and `TERMS.md`.
- Claims checked against the live site: one host contacted, no cookies set.

## 2026-11-14 — Footer after RSI+'s

Type: Changed. Effort: L1.

- Footer is one slim row: Fankit mark, the unofficial line, game build, Coffee, More. More unfolds the full CIG disclaimer and the referral code (copy, Enlist). Mark and notice keep their sizes and stay in the always-visible row ([decision](decisions/star-citizen-fankit-compliance.md)).
- Buy me a coffee and the game build leave the header; the Support section leaves the Plans tab. Links live in `src/lib/support.ts`.

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
