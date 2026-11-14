import crypto from "node:crypto";
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { DISCLAIMER, MARK_SIZE, NOTICE_SIZE, SHORT_NOTICE } from "./fankit";

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), "utf-8");

describe("fankit compliance", () => {
  it("ships the Made By The Community mark byte for byte", () => {
    const mark = fs.readFileSync(new URL("./MadeByTheCommunity_White.png", import.meta.url));
    expect(crypto.createHash("sha256").update(mark).digest("hex")).toBe(
      "1a146fa257b648baa58840fe17149b7cce06c446d8861586a4749d813372a50b",
    );
  });

  it("keeps CIG's disclaimer verbatim", () => {
    expect(DISCLAIMER).toBe(
      "This site is not endorsed by or affiliated with the Cloud Imperium or Roberts Space Industries group of companies. All game content and materials are copyright Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd.. Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. All rights reserved.",
    );
    expect(SHORT_NOTICE).toContain("Star Citizen® is a trademark of Cloud Imperium Rights LLC");
  });

  it("stays above the size floors", () => {
    // 10pt is 13.33 CSS px.
    expect(NOTICE_SIZE).toBeGreaterThanOrEqual(14);
    expect(MARK_SIZE).toBeGreaterThanOrEqual(40);
  });

  it("renders the mark and the notice in the always-visible bar, outside the panel", () => {
    const source = read("../components/SiteFooter.tsx");
    const bar = source.slice(source.indexOf('className="footer-bar"'));
    expect(bar).toContain("fankit-mark");
    expect(bar).toContain("SHORT_NOTICE");
    // The panel is the only part rendered conditionally.
    const panel = source.slice(source.indexOf("{open && ("), source.indexOf('className="footer-bar"'));
    expect(panel).not.toContain("fankit-mark");
  });

  it("applies no effect to the mark", () => {
    const css = read("../styles.css");
    const rule = css.slice(css.indexOf(".fankit-mark {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toMatch(/filter|opacity|box-shadow|transform|mix-blend|border|outline/);
  });

  it("is wired into the app", () => {
    expect(read("../App.tsx")).toContain("<SiteFooter");
  });
});
