/** The same support links the other tools carry. */
export const BUYMEACOFFEE_URL = "https://buymeacoffee.com/zedwil";
export const PATREON_URL = "https://www.patreon.com/cw/StarOrgTools";
export const REFERRAL = { name: "Zedwil", id: "STAR-9KJY-9C9H" };
export const enlistUrl = (id: string) => `https://www.robertsspaceindustries.com/enlist?referral=${id}`;

/** Where bugs and ideas go: the project's public issue tracker. */
export const REPO_URL = "https://github.com/voidput/snares";
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;

/** "v0.2.0", with the commit when the build knows it. */
export const versionLabel = (version: string, commit: string) => `v${version}${commit ? ` · ${commit}` : ""}`;
export const APP_VERSION = versionLabel(
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
  typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "",
);
