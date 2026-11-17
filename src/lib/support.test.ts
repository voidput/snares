import { describe, expect, it } from "vitest";

import { ISSUES_URL, PATREON_URL, versionLabel } from "./support";

describe("support links", () => {
  it("labels a release, with the commit when known", () => {
    expect(versionLabel("0.2.0", "")).toBe("v0.2.0");
    expect(versionLabel("0.2.0", "1edb521")).toBe("v0.2.0 · 1edb521");
  });

  it("sends reports to the issue chooser", () => {
    expect(ISSUES_URL).toBe("https://github.com/voidput/snares/issues/new/choose");
  });

  it("links the StarOrg.tools Patreon", () => {
    expect(PATREON_URL).toBe("https://www.patreon.com/cw/StarOrgTools");
  });
});
