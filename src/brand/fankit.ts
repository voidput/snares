/**
 * Star Citizen Fankit chrome: what the site footer must show.
 *
 * Cloud Imperium's Fankit Agreement lets a fan site use the Made By The
 * Community mark on conditions this file and `SiteFooter` exist to meet:
 *
 * - the mark stays unaltered (no recolouring, flipping, distortion, outline,
 *   shadow or effect), at a legible size and no less than 50% opacity;
 * - a trademark notice and disclaimer sit in a prominent, always-reachable
 *   place at no less than 10pt;
 * - the site is non-commercial.
 *
 * Do not restyle either below those floors, reword the disclaimer, or move the
 * mark or the notice out of the always-visible bar. See NOTICE.md and
 * docs/decisions/star-citizen-fankit-compliance.md.
 */

/** CIG's disclaimer, verbatim, including its doubled full stop. */
export const DISCLAIMER =
  "This site is not endorsed by or affiliated with the Cloud Imperium or Roberts Space " +
  "Industries group of companies. All game content and materials are copyright Cloud " +
  "Imperium Rights LLC and Cloud Imperium Rights Ltd.. Star Citizen®, Squadron 42®, " +
  "Roberts Space Industries®, and Cloud Imperium® are registered trademarks of Cloud " +
  "Imperium Rights LLC. All rights reserved.";

/** The line that is always on screen, next to the mark. */
export const SHORT_NOTICE =
  "Unofficial fan site, not affiliated with the Cloud Imperium group of companies. Star Citizen® is a trademark of Cloud Imperium Rights LLC.";

export const MARK_ALT = "Star Citizen - Made By The Community";

/** Rendered size of the mark in the footer bar, CSS pixels. Proportional scaling only. */
export const MARK_SIZE = 40;

/** Size of the notice text, CSS pixels. 14px is 10.5pt, above the 10pt floor. */
export const NOTICE_SIZE = 14;
