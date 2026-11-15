---
title: Architecture
tags: [architecture, solver, data]
updated: 2026-11-14
---

# Architecture

Static single-page app (Vite, React, TypeScript). No backend. Deployed to GitHub Pages.

## Data flow

1. **sc-gamedata** reads the installed game: DataCore star map records plus the solar system object containers (`*.socpak`), which are the only source of positions. Output: `game-starmap.json` with `position` and `quantum` per location.
2. **`scripts/build-data.mjs`** bakes `public/data/universe.json`: per system the placed bodies (id, name, kind, position in metres, arrival and obstruction radii), the snare devices that project a sphere, quantum drives, global quantum rules. About 90 kB, committed.
3. The app fetches that file once and solves everything client-side.

## Modules

| Path | Role |
|------|------|
| `src/lib/solver.ts` | Corridor and coverage maths. Pure, no game knowledge. |
| `src/lib/plan.ts` | Picked locations to solved legs: spreads, route changes, obstruction, approach lines. |
| `src/lib/kinematics.ts` | Quantum travel time estimate. |
| `src/lib/share.ts` | Plan state to and from the URL hash. |
| `src/lib/plans.ts` | Saved plans: `localStorage` list, JSON export file, import with validation (`sanitizeState` runs every plan through the link codec, so a file gets the same limits as a link). |
| `src/lib/pick.ts` | What the pointer is on (`pickNearest`) and the order labels and picks follow (`mapRank`). |
| `src/lib/markers.ts` | Orbital markers (OM-1..6): `markersOf` a body, `withMarkers` for a system. Derived at load, not baked. |
| `src/lib/routing.ts` | `obstructions` on a straight line, and `findPath`: the markers a blocked jump stops at. |
| `src/lib/fleet.ts` | Several ships on one leg: `planFleet` gives each a role and a `Leg`; `entryPoints` and `ownHold` say where a snare leaves its catch and whether a dampener reaches it. |
| `src/components/Tabs.tsx` | `TabList` / `TabPanel`: the left rail and the result tabs. One tab stop, arrow keys move. |
| `src/lib/showlocation.ts` | Parse pasted in-game coordinates. |
| `src/components/MapView.tsx` | Canvas 2D map with an orthographic camera (pan, zoom, yaw, pitch). |
| `src/components/LocationPicker.tsx` | Type-to-filter location list. |
| `src/App.tsx` | State, layout, result panels. |

## Solver model

- A route is the straight line from an origin to the destination centre. Ships drop out at the destination's arrival radius.
- A target leaves from within `spread` of its origin, so the route is a cone narrowing to the destination: `spread * t / L` wide at distance `t` from the destination on a route of length `L`.
- A snare of radius `R` at point `S` fully covers a route when `offset + coneRadius <= R`, with `offset` the distance from `S` to the route axis.
- Both terms scale linearly with distance from the destination. So: find unit direction `u` minimising `phi(u) = max_i (sin(theta_i) + spread_i / L_i * cos(theta_i))`, then full coverage holds for distances up to `R / phi`. Minimised by a minimum-enclosing-ball iteration and a pattern-search polish.
- Near limit: `arrival + R`. If the far limit is below it, no full-coverage position exists; the solver then searches for the direction at the near limit with the highest mean coverage (area of each cone cross-section inside the snare).
- Route change legs start on the previous destination's arrival sphere, on the side the target came from, with `spread` set to the drift distance.

## Routes round a body

The game will not plot a jump through a star, planet or moon; it plots several jumps by that body's orbital markers. `findPath` models that as the shortest chain of clear jumps over the markers of whatever is in the way (Dijkstra over a handful of points, widened up to three times when a hop is itself blocked). `plotted` in `plan.ts` then restarts the route from the last marker: `origin` becomes the marker, `spread` the drift, and `via` and `from` keep the stops and the true start for the map and the route table. `solvePlan` and the scout both go through it, so a place behind a planet counts with the direction it really arrives from. Without markers in the body list nothing is rerouted and the route is flagged as blocked, as before.

Marker positions are derived (`markers.ts`): six per body on the system axes, OM-1 and OM-2 over the poles, at `√2 × obstruction radius` plus a margin. The files hold the spawn rule and the 1 km arrival radius only; the radius is fitted to measured distances and the routing itself is a model, not game data.

## Dampen mode

A dampener pulls nothing out of quantum; it stops ships in range from spooling. Each route drops out at one point on the destination's arrival sphere, so the plan is the centre of the smallest ball enclosing those points, feasible when its radius is within the dampener range. When it is not, the candidate (the centre, each point, each close pair's midpoint) holding the most is used. `solver.ts: dampenPosition`.

## Best catch

Given only a destination, `plan.ts: bestCatches` grows groups of origins one snare position covers in full: greedy from each candidate, adding the route nearest the group's centre line while the group stays coverable. Ranked by non-asteroid-base count. Heuristic, not a proven optimum.

## Fleet

`planFleet(base, lead, members, ctx)` takes the leg solved for one ship and returns one `Leg` per ship, in the order ships were added. Because every ship is a leg, nothing downstream knows about fleets: the UI swaps the focused ship's leg in for `leg`.

- **Split**: greedy. The lead takes the largest group of routes it covers in full, the next net the largest group of what is left, and so on. Not proven optimal.
- **Hold**: a dampen-mode leg whose drop points are the snare's entry points, the first point each route's line meets the snare sphere. Assumes a pulled ship stops where it enters the sphere.
- **Backstop**: same routes as the ship ahead, one snare width plus 2 km nearer the destination, clamped to its corridor.

## Law

`armistice` and `monitored` radii per body come from sc-gamedata: armistice from `GreenZone` entities in a station's own container, monitored from `MonitoredZone` objects, whose reach is the entity record's default (50,000 km). `plan.ts: effectiveArrival` pushes the planning radius out to `armistice + standoff`; `Leg.security` reports the nearest armistice gap and who monitors the spot. Planets and moons are excluded: their containers hold surface zones only.

A jammer (`jammer` on a body, metres) is a dead zone: `monitoredAt` returns nothing inside one, and `jammedAt` names it. The data comes from `MonitorZoneJammer` entities in a station's container, a monitored zone of negative strength.

## Layout

Left is what you set, right is what you get. A rail picks one setup panel (Scout, Route, Ship and law, Plans). The result panel keeps the verdict visible and tabs the rest (Spot, Fly in, Verify, Timing), so editing a route never hides the answer. 

`useLayoutMode` in `src/App.tsx` picks the arrangement from two media queries and sets `layout-wide`, `layout-docked` or `layout-stacked` on `.app`:

| Mode | Width | Arrangement |
|---|---|---|
| wide | 1600px and up | Rail, setup panel, map, result panel. Panel widths grow with the screen. |
| docked | 821 to 1599px | One sidebar. The rail carries setup and result tabs; the verdict stays pinned above whichever is open. |
| stacked | 820px and under | Column: map, result, setup. |

The same three blocks (`setupContent`, `verdictHead`, `resultContent`) are arranged by each mode, so no content is written twice.

## Design language

Tokens and conventions follow SC-ORG-BOT (Deep Space surfaces, Orbitron labels, JetBrains Mono numerics, glow, tactical grid, chamfered primary action, status colours for status only) and rsi-plus (cyan accent, hairline borders, dense 13px controls). Fonts are self-hosted through `@fontsource`. See the comment at the top of `src/styles.css`.

## Map

Canvas 2D rather than WebGL: the scene spans 20 km to 60 Gm, which doubles handle and 32-bit GPU floats do not. The camera is orthographic with yaw and pitch, so top-down is the 2D view and rotating gives 3D.

## Decisions

- **Positions extracted in sc-gamedata, not here.** Keeps one tool responsible for reading game files; this repo only consumes its JSON.
- **Baked JSON committed.** Pages CI needs no game install.
- **Plan state in the URL hash.** Shareable without a server; `replaceState` so it does not flood history.
