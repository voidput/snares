# Notices and attributions

Snares is an unofficial, non-commercial fan tool: free to use, with no paid
features, ads, accounts or tracking. The page carries an optional tip link and an
RSI referral code. It is not affiliated with, endorsed by, or sponsored by the
parties below. All trademarks belong to their respective owners.

## Star Citizen — Cloud Imperium Games / Roberts Space Industries

Star Citizen®, Squadron 42®, Roberts Space Industries® and Cloud Imperium® are
registered trademarks of Cloud Imperium Rights LLC.

`public/data/universe.json` holds facts read from the game's own files by
[sc-gamedata](https://github.com/voidput/sc-gamedata-extractor): location names
and positions, quantum arrival and obstruction radii, armistice and monitored
zone radii, which services a location offers, and the names and figures of
quantum drives and quantum enforcement devices. They are used to compute
positions and nothing else. No game code, art, audio or descriptive text is
included.

### Fankit asset and required notices

`src/brand/MadeByTheCommunity_White.png` is taken, byte for byte, from the
official Star Citizen Fankit. It is the property of Cloud Imperium and is used
under the CIG Fankit Agreement. It is not covered by any licence granted for
this project's source code, and the Fankit Agreement is neither sublicensable
nor transferable: anyone who clones this repository uses that file under their
own acceptance of the Fankit Agreement, from
<https://robertsspaceindustries.com/en/fankit>.

Conditions this project is bound by, and that any fork inherits:

- The mark must appear at a legible size and no less than 50% opacity. It must
  not be recoloured, flipped, distorted, outlined, shadowed, or have effects
  applied. The footer in `src/components/SiteFooter.tsx` (40 px mark at full
  opacity, no filters; 14 px notice text) exists to satisfy this. Do not remove
  it or restyle it below those limits. `src/brand/fankit.test.ts` guards them.
- The trademark notice and disclaimer must stay in a prominent, always-reachable
  place at no less than 10pt.
- Use is non-commercial only. No revenue, subscriptions, donations tied to
  access, or compensation of any kind may be collected for this tool.
- Identifying, copyright and ownership information inside fankit assets must
  not be removed or altered.
- CIG may withdraw permission at any time; on request, the assets must be
  removed.
- Whoever publishes this tool at a public URL must supply that URL to CIG at
  <legal_notices@cloudimperiumgames.com>, per the Fankit Agreement.

The required notice, reproduced in the site footer:

> This site is not endorsed by or affiliated with the Cloud Imperium or Roberts
> Space Industries group of companies. All game content and materials are
> copyright Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd.. Star
> Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are
> registered trademarks of Cloud Imperium Rights LLC. All rights reserved.

## Fonts

Orbitron, Inter and JetBrains Mono are bundled through `@fontsource` under the
SIL Open Font License 1.1.
