// The site footer: an always-visible bar with a "Legal" panel that opens upward.
//
// Star Citizen Fankit compliance (docs/decisions/star-citizen-fankit-compliance.md).
// What must never be hidden behind the panel, restyled below its floor, or removed:
// - the Made By The Community mark: unaltered, legible, at least 50% opacity. It
//   sits in the bar at 40px, full opacity, with no filter, shadow or other effect;
// - a trademark notice of at least 10pt: the bar carries one line at 14px, and the
//   full disclaimer is one click away in the panel, also at 14px.
import { useEffect, useRef, useState } from "react";

import { DISCLAIMER, MARK_ALT, MARK_SIZE, NOTICE_SIZE, SHORT_NOTICE } from "../brand/fankit";
import brandMark from "../brand/MadeByTheCommunity_White.png";

export function SiteFooter({ build }: { build: string }) {
  const [open, setOpen] = useState(false);
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

  return (
    <footer
      ref={footer}
      className="site-footer"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      {open && (
        <div id="legal-panel" className="legal-panel" style={{ fontSize: NOTICE_SIZE }}>
          <p>{DISCLAIMER}</p>
          <p>
            Positions, radii, armistice and monitored zones, and ship and drive figures are read from the game's own files
            (build {build}) for planning only. No game code, art or audio is included. Free to use: no paid features, no
            ads, no accounts, no tracking.
          </p>
        </div>
      )}
      <div className="footer-bar">
        <img className="fankit-mark" src={brandMark} alt={MARK_ALT} width={MARK_SIZE} height={MARK_SIZE} />
        <p className="footer-notice" style={{ fontSize: NOTICE_SIZE }}>
          {SHORT_NOTICE}
        </p>
        <button ref={toggle} className="ghost" aria-expanded={open} aria-controls="legal-panel" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Legal"}
        </button>
      </div>
    </footer>
  );
}
