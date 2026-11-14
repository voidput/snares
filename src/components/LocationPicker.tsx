import { useId, useMemo, useRef, useState } from "react";

import type { Body, BodyKind } from "../lib/types";

const KIND_LABEL: Record<BodyKind, string> = {
  star: "Star",
  planet: "Planet",
  city: "City",
  surface: "Surface",
  moon: "Moon",
  lagrange: "Lagrange",
  station: "Station",
  jump: "Jump point",
  asteroid: "Asteroid",
  other: "Other",
};

interface Props {
  bodies: Body[];
  /** Ids to leave out of the list: already picked, or the other end. */
  exclude?: string[];
  placeholder: string;
  onPick(body: Body): void;
}

/** A type-to-filter list of locations. Picking one clears the box. */
export function LocationPicker({ bodies, exclude, placeholder, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const excluded = (exclude ?? []).join("|");

  const matches = useMemo(() => {
    const skip = new Set(excluded.split("|"));
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const list = Array.isArray(bodies) ? bodies : [];
    const names = new Map(list.map((b) => [b.id, b.name]));
    return list
      .filter((b) => !skip.has(b.id))
      .filter((b) => {
        const hay = `${b.name} ${KIND_LABEL[b.kind]}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      // With nothing typed, asteroid bases would bury everything else.
      .filter((b) => q.length > 0 || (b.kind !== "asteroid" && b.kind !== "surface"))
      // Markers the in-game star map hides sort after the ones a pilot can pick.
      .sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden))
      .slice(0, 60)
      .map((b) => ({ body: b, on: b.on ? names.get(b.on) : undefined }));
  }, [bodies, excluded, query]);

  const pick = (body: Body) => {
    onPick(body);
    setQuery("");
    setCursor(0);
    input.current?.focus();
  };

  return (
    <div className="picker">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(matches.length - 1, c + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter" && open && matches[cursor]) {
            e.preventDefault();
            pick(matches[cursor].body);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="picker-list">
          {matches.length === 0 && <li className="picker-empty">No location matches</li>}
          {Array.isArray(matches) &&
            matches.map(({ body, on }, index) => (
              <li
                key={body.id}
                role="option"
                aria-selected={index === cursor}
                className={index === cursor ? "active" : undefined}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(body);
                }}
                onMouseEnter={() => setCursor(index)}
              >
                <span className={`dot kind-${body.kind}`} />
                <span className="picker-name">{body.name}</span>
                <span className="picker-kind">
                  {KIND_LABEL[body.kind]}
                  {body.refinery ? " · refinery" : ""}
                  {body.deadEnd ? " · dead end" : ""}
                  {on ? ` · on ${on}` : ""}
                  {body.hidden ? " · off-map" : ""}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
