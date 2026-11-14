// The site footer, after RSI+'s: one slim always-visible row (Fankit mark, the "unofficial"
// line, game build, Coffee, More) and a panel that unfolds upward with the full trademark
// notice and the referral code.
//
// Star Citizen Fankit compliance (docs/decisions/star-citizen-fankit-compliance.md).
// What must never be hidden behind the panel, restyled below its floor, or removed:
// - the Made By The Community mark: unaltered, legible, at least 50% opacity. It
//   sits in the bar at 40px, full opacity, with no filter, shadow or other effect;
// - a trademark notice of at least 10pt: the bar carries one line at 14px, and the
//   full disclaimer is one click away in the panel, also at 14px.
import { Check, ChevronDown, ChevronUp, Coffee, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DISCLAIMER, MARK_ALT, MARK_SIZE, NOTICE_SIZE, SHORT_NOTICE } from "../brand/fankit";
import brandMark from "../brand/MadeByTheCommunity_White.png";
import { BUYMEACOFFEE_URL, enlistUrl, REFERRAL } from "../lib/support";
import { PrivacyPolicy, Terms } from "./Policies";

type View = "about" | "privacy" | "terms";
const VIEWS: { id: View; label: string }[] = [
  { id: "about", label: "About" },
  { id: "privacy", label: "Privacy" },
  { id: "terms", label: "Terms" },
];

export function SiteFooter({ build, extracted }: { build: string; extracted?: string }) {
  const [view, setView] = useState<View>();
  const open = view !== undefined;
  const setOpen = (next: boolean) => setView(next ? "about" : undefined);
  const [copied, setCopied] = useState(false);
  const footer = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // A click outside folds the panel again.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!footer.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCode = () => {
    // When the clipboard is blocked the code is still on screen to select.
    void navigator.clipboard?.writeText(REFERRAL.id).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <footer
      ref={footer}
      className="site-footer"
      aria-label="About Snares"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      {open && (
        <div id="footer-more" className="footer-more">
          <nav className="footer-views" aria-label="About Snares">
            {VIEWS.map((v) => (
              <button key={v.id} className="footer-action" aria-current={v.id === view ? "page" : undefined} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </nav>
          {view === "about" && (
            <div className="footer-about">
              <div className="footer-legal" style={{ fontSize: NOTICE_SIZE }}>
                <p>{DISCLAIMER}</p>
                <p>
                  Positions, radii, armistice and monitored zones, and ship and drive figures are read from the game's own files
                  (build {build}) for planning only. No game code, art or audio is included. Free to use: no paid features, no
                  ads, no accounts, no tracking.
                </p>
              </div>
              <div className="footer-referral">
                <span className="footer-label">Referral code</span>
                <div className="footer-referral-row">
                  <code>{REFERRAL.id}</code>
                  <button
                    className="ghost icon"
                    onClick={copyCode}
                    title={copied ? "Copied" : "Copy the code"}
                    aria-label={copied ? "Referral code copied" : "Copy referral code"}
                  >
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  </button>
                  <a className="footer-link" href={enlistUrl(REFERRAL.id)} target="_blank" rel="noopener noreferrer">
                    Enlist <ExternalLink size={12} aria-hidden />
                  </a>
                </div>
                <span className="footer-blurb">
                  New to Star Citizen? A referral code earns bonus starting credits after buying a game package. Courtesy of{" "}
                  {REFERRAL.name}.
                </span>
              </div>
            </div>
          )}
          {view === "privacy" && <PrivacyPolicy />}
          {view === "terms" && <Terms />}
        </div>
      )}
      <div className="footer-bar">
        <img className="fankit-mark" src={brandMark} alt={MARK_ALT} width={MARK_SIZE} height={MARK_SIZE} />
        <p className="footer-notice" style={{ fontSize: NOTICE_SIZE }}>
          {SHORT_NOTICE}
        </p>
        <span className="footer-build" title={extracted ? `Game data extracted ${extracted.slice(0, 10)}` : undefined}>
          game build {build}
        </span>
        <span className="footer-actions">
          <a className="footer-action coffee" href={BUYMEACOFFEE_URL} target="_blank" rel="noopener noreferrer">
            <Coffee size={14} aria-hidden /> Coffee
          </a>
          <button
            className="footer-action"
            aria-expanded={view === "privacy"}
            aria-controls="footer-more"
            onClick={() => setView(view === "privacy" ? undefined : "privacy")}
          >
            <ShieldCheck size={14} aria-hidden /> Privacy
          </button>
          <button
            ref={toggle}
            className="footer-action"
            aria-expanded={open}
            aria-controls="footer-more"
            aria-label={open ? "Less about Snares" : "More about Snares"}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />} {open ? "Less" : "More"}
          </button>
        </span>
      </div>
    </footer>
  );
}
