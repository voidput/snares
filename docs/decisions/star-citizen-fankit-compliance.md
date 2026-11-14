---
title: Star Citizen Fankit compliance
tags: [decision, legal, branding, star-citizen]
updated: 2026-11-13
---

# Star Citizen Fankit compliance

**Status:** accepted — 2026-11-13

## Context

Snares is a public Star Citizen fan site built on data read from the game's files, so it touches CIG's trademarks. CIG's Fankit Agreement and Guidelines set out what a fan site must display. The same call was already made for Bindscape (scsticks, `docs/decisions/star-citizen-fankit-compliance.md`); this note applies it here rather than re-deciding it.

## Decision

- Ship `src/brand/MadeByTheCommunity_White.png`, byte-identical to the fankit original (sha256 `1a146fa2…a50b`), and scale it with CSS only.
- Show it in a persistent site footer bar at 40 px, full opacity, with no filter, shadow, border or transform, beside a one-line trademark notice at 14 px (above the 10pt floor).
- CIG's full disclaimer, verbatim, is one click away in the footer's Legal panel, also at 14 px. The mark and the short notice never move into the panel.
- `NOTICE.md` carves the mark out of any source licence and lists the conditions a fork inherits.
- No other fankit content.
- `src/brand/fankit.test.ts` fails the build if the mark's bytes change, the disclaimer is reworded, a size drops below its floor, the mark gains a CSS effect, or the footer is unwired. CI runs it before every deploy.

## Tip link and referral code

The page carries a Buy Me a Coffee link and an RSI referral code, as Bindscape and StarOrg.tools do. Recorded honestly, as there: the agreement allows no compensation *for access or use*. A voluntary tip that buys nothing is outside that wording but is the grey edge of "non-commercial", and CIG may see it differently. If asked, remove the tip link first. The referral code uses CIG's own programme.

## Consequences

- The footer is load-bearing; `SiteFooter.tsx` and `fankit.ts` say so in comments.
- The site can never be monetised while it carries fankit content.
- Whoever publishes it must send CIG the URL (`legal_notices@cloudimperiumgames.com`). Owner's task, not automated.
