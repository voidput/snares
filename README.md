# Snares

Quantum interdiction planner for Star Citizen. Pick where targets come from and
where they are going; it finds where to park a snare so every route passes
through it, and tells you how to get there.

Static site: no backend, all maths in the browser, game data baked into one JSON
file. Runs on GitHub Pages.

## What it does

- **Snare position** for any number of origins into one destination, with the
  full stretch of positions that work and how much room for error each leaves.
- **Scout a system**: one click ranks every destination in the system by how
  many places a single snare (or dampener) spot takes traffic from.
- **Best catch**: give only a destination and it picks the origins, listing the
  largest sets of places one snare or dampener position covers in full.
- **Ships**: Mantis, Scorpius Antares, Sabre Raven EX, Guardian QI, Cutlass
  Blue, with snare radius and dampener range from the game files, or custom.
- **Dampen mode**: for ships with a dampener and no snare. Finds where to wait
  so targets drop out inside your range and cannot spool again.
- **Armistice zones**: radii read from the game files, drawn on the map. The
  snare is kept a stand-off distance clear of the destination's zone, and the
  plan says how long a pulled target needs to run back into one.
- **Monitored space**: comm arrays and stations see crime within their reach.
  Each spot is marked watched or dark, and the scout marks watched spots down.
  Both checks can be switched off.
- **Priorities**: give any place its own weight (an event, a hotspot) or 0 to
  ignore it; saved in the link.
- **Coverage** per route, including partial cover when no spot catches them all.
- **Departure spread**: a target leaves from somewhere around its origin, not
  its centre, so each route is a cone. Planets spread by their orbit, stations
  by a little, or set it yourself.
- **Cities and outposts** (Lorville, Orison, ...) are pickable and count as the
  planet or moon they sit on.
- **Route changes**: up to two re-routes (drop out at a waypoint, drift, spool
  again), each leg solved on its own.
- **Getting there**: which quantum line to fly and how far out to cut the drive.
- **Position check**: paste `/showlocation` output to see if you are in place.
- **Target timing** by quantum drive, as an estimate.
- **Map**: pan, zoom from system scale down to the 20 km snare, rotate into 3D.
- **Blocked routes** plotted round the body by its orbital markers, as the game does, with the marker offered as a place to catch.
- **Orbital markers** (OM-1 to OM-6) as origins, destinations and lines to fly in on.
- **Turning places**: stations in low orbit and cities ride their planet's rotation. Set the turn, see how long a spot holds, and which marker a city's traffic stops at.
- The plan lives in the URL, so a link is a share.
- Save plans by name in the browser and switch between them; export and import them as JSON.
- Plan for a fleet: split routes between ships, post a dampener on the catch, line up a backstop.

Stanton, Pyro and Nyx. Positions, arrival and obstruction radii, snare radius
and drive stats all come from the game's own files, by way of
[sc-gamedata](../sc-gamedata).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # solver, planner, kinematics, links, baked data
npm run build      # typecheck + static site in dist/
```

## Refresh the game data after a patch

```bash
(cd ../sc-gamedata && make all)   # extract + parse from the installed game
npm run data                      # bake public/data/universe.json
npm test
```

`public/data/universe.json` is committed, so CI and Pages need no game files.
`npm run data -- --data <dir>` or `SC_GAMEDATA_DIR` points at another
sc-gamedata output directory.

## Deploy

`.github/workflows/pages.yml` tests, builds and deploys on every push to `main`.
One-time setup in the GitHub repo: Settings → Pages → Source: **GitHub Actions**.
The build uses relative asset paths, so it works under any repo name.

## Contributing and releases

- Bugs and ideas: [open an issue](https://github.com/voidput/snares/issues/new/choose). The site footer links there too.
- `main` is protected: changes land by pull request, squashed, once the `check` job (typecheck, tests, build) is green. Org admins can bypass.
- Pull request titles are conventional commits (`feat: ...`, `fix: ...`, `docs: ...`); the title becomes the commit.
- Versions follow semver and are cut by [release-please](https://github.com/googleapis/release-please): it keeps a release pull request open that bumps `package.json` and writes `CHANGELOG.md` from the commits (`fix` → patch, `feat` → minor, `!` → breaking; before 1.0 a breaking change bumps the minor). Merging it tags `vX.Y.Z` and publishes a GitHub Release. The footer shows the version and commit the page was built from.
- `docs/changelog.md` stays the hand-written record of what changed for users; `CHANGELOG.md` is generated.
- Other workflows: `ci.yml` (pull requests), `pr-title.yml`, `codeql.yml`, and Dependabot for npm and actions, weekly.

## How the position is found

Ships in quantum fly a straight line to the centre of their destination, so
every route into one destination meets there. Measured from the destination,
all distances scale together, which splits the problem in two: find the
direction that keeps the worst route closest (a minimum enclosing cone), then
the snare covers everything along that direction out to `radius / spread`. The
near limit is the destination's arrival radius plus the snare radius. See
`src/lib/solver.ts`; details in [docs/architecture.md](docs/architecture.md).

## Known limits

- Timing uses a drive's mean acceleration, not the game's two-stage curve.
- Surface locations have no position (they turn with their planet); use the
  planet with the Auto spread.
- Delamar (Nyx) has no placement in the game's containers, so it is not on the
  map; Levski, which it holds, is.
- PTU data (the PTU button, `npm run data:ptu`) is whatever the last PTU
  extract held; in 5.0.202 Nyx II and III are not placed.
- The `/showlocation` format is parsed leniently (labelled x/y/z, or any three
  numbers); it assumes metres in the system frame.

## Legal

Privacy policy: [PRIVACY.md](PRIVACY.md). Terms of use: [TERMS.md](TERMS.md). Both are shown on the site from the footer.

Unofficial, non-commercial fan site, not affiliated with the Cloud Imperium group
of companies. It carries the Star Citizen Fankit's Made By The Community mark and
CIG's disclaimer in a persistent footer; those are a condition of the Fankit
Agreement, guarded by `src/brand/fankit.test.ts`. See [NOTICE.md](NOTICE.md) and
[the decision note](docs/decisions/star-citizen-fankit-compliance.md) before
touching the footer.
