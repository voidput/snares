// The privacy policy and terms shown from the footer. Every claim here is about what the
// code does: change the code, change this. PRIVACY.md and TERMS.md carry the same text.
export const POLICY_DATE = "14 November 2026";

export function PrivacyPolicy() {
  return (
    <article className="policy">
      <h3>Privacy policy</h3>
      <p className="policy-date">Last updated {POLICY_DATE}</p>
      <p>
        Short version: Snares has no accounts, no cookies, no analytics, no ads and no trackers. Your plans never leave
        your browser unless you share them yourself.
      </p>

      <h4>What stays in your browser</h4>
      <ul>
        <li>
          <b>Saved plans.</b> Plans you save, and whether the result panel is open, are kept in your browser's local
          storage. They are not sent anywhere. Delete a plan in the Plans tab, or clear this site's data in your browser,
          and they are gone.
        </li>
        <li>
          <b>The plan on screen.</b> It is written into the page address after the <code>#</code>. Browsers do not send
          that part to any server. Anyone you give the link to can see the plan in it.
        </li>
        <li>
          <b>Exports and imports.</b> An exported file is made on your device. An imported file is read on your device
          and is not uploaded.
        </li>
        <li>
          <b>Pasted positions.</b> A <code>/showlocation</code> line you paste is used on the page and is not stored or
          sent.
        </li>
        <li>
          <b>Clipboard.</b> The site writes to your clipboard only when you press a copy button. It never reads it.
        </li>
      </ul>

      <h4>What the host sees</h4>
      <p>
        The site is static files served by GitHub Pages. Like any web host, GitHub receives your IP address and browser
        details when the pages load, and may log them under its own privacy statement. The site's author has no access
        to those logs. Fonts and game data are served from this same site; the page contacts no other server.
      </p>

      <h4>Links that leave the site</h4>
      <p>
        Coffee opens Buy Me a Coffee, Patreon opens patreon.com, and Enlist opens robertsspaceindustries.com, each in a new tab. Nothing is sent to
        them until you click, and what happens there falls under their policies.
      </p>

      <h4>Children, sale of data, your rights</h4>
      <p>
        The site collects no personal data, so there is none to sell, share, correct or delete on a server, and nothing
        is collected from children. Everything the site keeps is in your own browser, under your control.
      </p>

      <h4>Changes</h4>
      <p>If the site starts to handle data differently, this page changes first and the date above with it.</p>
    </article>
  );
}

export function Terms() {
  return (
    <article className="policy">
      <h3>Terms of use</h3>
      <p className="policy-date">Last updated {POLICY_DATE}</p>
      <ul>
        <li>
          <b>Free fan tool.</b> Snares is free and non-commercial: no paid features, no ads. Tips are voluntary and buy
          nothing.
        </li>
        <li>
          <b>Unofficial.</b> It is not made, endorsed or supported by the Cloud Imperium group of companies. See the
          trademark notice under About.
        </li>
        <li>
          <b>No warranty.</b> Positions, timings and zone sizes are worked out from the game's files and from models of
          how quantum travel behaves. The game changes between patches and the models are estimates, so results can be
          wrong. The site is provided as is, and its author is not liable for anything lost by relying on it, in game or
          out.
        </li>
        <li>
          <b>Your conduct is yours.</b> How you play is between you and the game's terms of service and rules of
          conduct. This tool plans positions; it does not touch the game client.
        </li>
        <li>
          <b>Availability.</b> The site may change, break or go away without notice. Export plans you want to keep.
        </li>
      </ul>
    </article>
  );
}
