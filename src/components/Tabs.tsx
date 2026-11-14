import type { ComponentType, KeyboardEvent, ReactNode } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  /** Small count or state mark shown beside the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

interface Props<T extends string> {
  /** Names the set for assistive tech, and prefixes the tab and panel ids. */
  name: string;
  label: string;
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const tabId = (name: string, id: string) => `${name}-tab-${id}`;
export const panelId = (name: string, id: string) => `${name}-panel-${id}`;

/**
 * A tab strip: one tab stop, arrow keys move between tabs, Home and End jump to the ends.
 * The rail look follows SC-ORG-BOT's sidebar nav item: icon over label, accent fill when current.
 */
export function TabList<T extends string>({ name, label, tabs, value, onChange, orientation = "horizontal", className }: Props<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const open = tabs.filter((t) => !t.disabled);
    const at = open.findIndex((t) => t.id === value);
    const [back, forward] = orientation === "vertical" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    let next: number | undefined;
    if (event.key === forward || (orientation === "vertical" && event.key === "ArrowRight")) next = (at + 1) % open.length;
    else if (event.key === back || (orientation === "vertical" && event.key === "ArrowLeft")) next = (at - 1 + open.length) % open.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = open.length - 1;
    if (next === undefined || !open[next]) return;
    event.preventDefault();
    onChange(open[next].id);
    document.getElementById(tabId(name, open[next].id))?.focus();
  };

  return (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className={className} onKeyDown={onKeyDown}>
      {Array.isArray(tabs) &&
        tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            id={tabId(name, tab.id)}
            aria-selected={tab.id === value}
            aria-controls={panelId(name, tab.id)}
            tabIndex={tab.id === value ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <tab.icon size={18} aria-hidden />}
            <span className="tab-label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && <span className="tab-badge">{tab.badge}</span>}
          </button>
        ))}
    </div>
  );
}

export function TabPanel({ name, id, className, children }: { name: string; id: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(name, id)} aria-labelledby={tabId(name, id)} className={className}>
      {children}
    </div>
  );
}
