---
title: Snare planner v1
tags: [spec]
status: done
updated: 2026-11-13
---

# Snare planner v1

**Objective.** A better quantum snare planner than SnarePlan and similar sites: static (GitHub Pages), data straight from the game files via sc-gamedata, no backend.

**Scope agreed with the user.** Multi-origin solver with coverage, 2D map, snare picker from game data, Stanton/Pyro/Nyx, shareable URL, plus: `/showlocation` check, target ETA by drive, 3D view, route changes.

**Commands.** `npm run dev | test | build | data`.

**Structure.** See [architecture](../../architecture.md).

**Testing.** Vitest on the pure libraries, including checks against the baked game data. UI verified by headless Chromium screenshots.

**Boundaries.** Reading game files stays in sc-gamedata. No backend, no accounts, no tracking. No game assets shipped.

**Not done in v1.** Exact two-stage quantum acceleration; locations nested two containers deep; surface locations; an adversarial spec review (skipped, see changelog entry's effort note).
