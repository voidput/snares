/** A distance in metres, in the unit a pilot would read it in. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  const abs = Math.abs(metres);
  if (abs >= 1e9) return `${trim(metres / 1e9, abs >= 1e10 ? 2 : 3)} Gm`;
  if (abs >= 1e6) return `${Math.round(metres / 1e3).toLocaleString("en-US")} km`;
  if (abs >= 1e3) return `${trim(metres / 1e3, abs >= 1e5 ? 0 : 1)} km`;
  return `${Math.round(metres)} m`;
}

const trim = (value: number, digits: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export const formatPercent = (fraction: number) =>
  `${(Math.floor(fraction * 1000) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

/** Kilometres with thousands separators, for coordinates. */
export const formatKm = (metres: number) => Math.round(metres / 1000).toLocaleString("en-US");
