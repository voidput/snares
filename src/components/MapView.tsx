import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { formatDistance } from "../lib/format";
import { mapRank, pickNearest } from "../lib/pick";
import { arrivalOf, type Approach, type Leg } from "../lib/plan";
import type { Body, BodyKind } from "../lib/types";
import { add, distance, scale, sub, type Vec3 } from "../lib/vec";

export interface MapHandle {
  fitPlan(): void;
  fitSystem(): void;
  focusSnare(): void;
  topDown(): void;
}

interface Props {
  ref?: Ref<MapHandle>;
  bodies: Body[];
  legs: Leg[];
  activeLeg: number;
  /** Dampener range, metres: drawn inside the snare, where pulled ships stay stuck. */
  dampen: number;
  /** The fleet's other ships on the active leg: drawn, but not the one in focus. */
  others?: { leg: Leg; label: string }[];
  /** Name over the ship in focus, when it is one of several. */
  focusLabel?: string;
  /** Draw armistice zones. */
  showArmistice: boolean;
  /** Draw monitored zones: where crime is seen. */
  showMonitored: boolean;
  player?: Vec3;
  approach?: Approach;
  /** Changes whenever the view should re-fit: system or picked locations. */
  fitKey: string;
  onPick(body: Body, anchor: { x: number; y: number }): void;
}

interface Camera {
  center: Vec3;
  /** Pixels per metre. */
  ppm: number;
  yaw: number;
  /** 0 looks straight down the system's pole; toward PI/2 looks along the plane. */
  pitch: number;
}

const COLORS: Record<BodyKind, string> = {
  star: "#ffd27a",
  planet: "#7fb4ff",
  city: "#ffe08a",
  surface: "#c9a27a",
  moon: "#a9b6cc",
  lagrange: "#8f7bff",
  station: "#5fe0c0",
  jump: "#ff7ad9",
  asteroid: "#77828f",
  marker: "#8ea2b8",
  other: "#77828f",
};
/** Orbital markers appear once they sit this many pixels from their body. */
const MARKER_ZOOM_PX = 60;
const ROUTE = "#3cc8ff";
const SNARE = "#ffb547";
const DAMPEN = "#c48cff";
const BAD = "#ef4444";
const PLAYER = "#3ddc97";

export function MapView({ ref, bodies, legs, activeLeg, dampen, others, focusLabel, showArmistice, showMonitored, player, approach, fitKey, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera>({ center: [0, 0, 0], ppm: 1e-9, yaw: 0, pitch: 0 });
  const size = useRef({ w: 1, h: 1 });
  const frame = useRef(0);
  const hover = useRef<Body | undefined>(undefined);
  const [cursor, setCursor] = useState<string>("grab");
  const [readout, setReadout] = useState("");

  // Latest props for the draw loop, which outlives any one render.
  const scene = useRef({ bodies, legs, activeLeg, dampen, others, focusLabel, showArmistice, showMonitored, player, approach });
  scene.current = { bodies, legs, activeLeg, dampen, others, focusLabel, showArmistice, showMonitored, player, approach };

  const project = useCallback((p: Vec3): [number, number] => {
    const c = camera.current;
    const [x, y, z] = sub(p, c.center);
    const rx = x * Math.cos(c.yaw) - y * Math.sin(c.yaw);
    const ry = x * Math.sin(c.yaw) + y * Math.cos(c.yaw);
    return [
      size.current.w / 2 + rx * c.ppm,
      size.current.h / 2 - (ry * Math.cos(c.pitch) + z * Math.sin(c.pitch)) * c.ppm,
    ];
  }, []);

  /** World displacement, within the view plane, for a screen displacement. */
  const unprojectDelta = useCallback((dx: number, dy: number): Vec3 => {
    const c = camera.current;
    const rx = dx / c.ppm;
    const up = -dy / c.ppm;
    // View-plane up is (0, cos pitch, sin pitch) before the yaw is undone.
    const ry = up * Math.cos(c.pitch);
    const z = up * Math.sin(c.pitch);
    return [rx * Math.cos(c.yaw) + ry * Math.sin(c.yaw), -rx * Math.sin(c.yaw) + ry * Math.cos(c.yaw), z];
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = size.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const s = scene.current;
    const c = camera.current;
    const byId = new Map(s.bodies.map((b) => [b.id, b]));
    const onScreen = ([x, y]: [number, number], pad = 40) => x > -pad && y > -pad && x < w + pad && y < h + pad;

    const ring = (center: Vec3, r: number, style: string, dash: number[] = []) => {
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const [x, y] = project(add(center, [Math.cos(a) * r, Math.sin(a) * r, 0]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Orbits: planets about the star, moons about their planet.
    for (const body of s.bodies) {
      if (body.kind !== "planet" && body.kind !== "moon") continue;
      const parent = body.parent ? byId.get(body.parent) : undefined;
      const about: Vec3 = body.kind === "moon" && parent ? parent.pos : [0, 0, 0];
      const d = sub(body.pos, about);
      const r = Math.hypot(d[0], d[1]);
      if (r * c.ppm < 12 || r * c.ppm > 40 * Math.max(w, h)) continue;
      ring(about, r, body.kind === "planet" ? "rgba(127,180,255,0.16)" : "rgba(169,182,204,0.12)");
    }

    // Jammer dead zones: a dashed green ring where monitoring is cancelled.
    if (s.showMonitored) {
      for (const body of s.bodies) {
        if (!body.jammer || body.on) continue;
        const r = body.jammer * c.ppm;
        if (r < 6 || r > 30000) continue;
        const [x, y] = project(body.pos);
        if (x + r < 0 || y + r < 0 || x - r > w || y - r > h) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(61,220,151,0.06)";
        ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "rgba(61,220,151,0.7)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        if (r > 60) {
          ctx.font = "600 10px Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(61,220,151,0.9)";
          ctx.fillText("COMM DEAD ZONE", x - 46, y - r + 14);
        }
      }
    }

    // The law: monitored zones as a faint wash, armistice zones as a hard ring.
    if (s.showMonitored) {
      for (const body of s.bodies) {
        if (!body.monitored || body.on) continue;
        const r = body.monitored * c.ppm;
        // Too small to see, or so large the whole view is inside it.
        if (r < 3) continue;
        const [x, y] = project(body.pos);
        if (x + r < 0 || y + r < 0 || x - r > w || y - r > h) continue;
        ctx.beginPath();
        ctx.arc(x, y, Math.min(r, 30000), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(234,179,8,0.035)";
        ctx.fill();
        if (r < 30000) {
          ctx.setLineDash([2, 6]);
          ctx.strokeStyle = "rgba(234,179,8,0.28)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    if (s.showArmistice) {
      for (const body of s.bodies) {
        if (!body.armistice || body.on) continue;
        const r = body.armistice * c.ppm;
        if (r < 4 || r > 30000) continue;
        const [x, y] = project(body.pos);
        if (x + r < 0 || y + r < 0 || x - r > w || y - r > h) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(239,68,68,0.10)";
        ctx.fill();
        ctx.strokeStyle = "rgba(239,68,68,0.75)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        if (r > 40) {
          ctx.font = "700 10px Orbitron, Inter, sans-serif";
          ctx.fillStyle = "rgba(239,68,68,0.9)";
          ctx.textBaseline = "middle";
          ctx.fillText("ARMISTICE", x - 28, y + r - 10);
        }
      }
    }

    // Routes: every leg faintly, the active one in full.
    s.legs.forEach((leg, index) => {
      const active = index === s.activeLeg;
      const blocked = new Set(leg.blocked.map((b) => b.routeId));
      const [dx, dy] = project(leg.dest.pos);
      for (const route of leg.routes) {
        const [ox, oy] = project(route.origin);
        const bad = blocked.has(route.id);
        const spreadPx = route.spread * c.ppm;

        if (active && spreadPx > 1.5) {
          // The cone of possible departure points, narrowing to the destination.
          const len = Math.hypot(ox - dx, oy - dy) || 1;
          const nx = (-(oy - dy) / len) * spreadPx;
          const ny = ((ox - dx) / len) * spreadPx;
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.lineTo(ox + nx, oy + ny);
          ctx.lineTo(ox - nx, oy - ny);
          ctx.closePath();
          ctx.fillStyle = bad ? "rgba(255,93,93,0.10)" : "rgba(60,200,255,0.10)";
          ctx.fill();
        }

        if (route.via && route.from) {
          // The jumps before the last one: out to each orbital marker in turn.
          ctx.beginPath();
          const [fx, fy] = project(route.from);
          ctx.moveTo(fx, fy);
          for (const stop of route.via) {
            const [vx, vy] = project(stop.pos);
            ctx.lineTo(vx, vy);
          }
          ctx.setLineDash([6, 5]);
          ctx.strokeStyle = ROUTE;
          ctx.globalAlpha = active ? 0.5 : 0.2;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(dx, dy);
        ctx.setLineDash(bad ? [6, 5] : []);
        ctx.strokeStyle = bad ? BAD : ROUTE;
        ctx.globalAlpha = active ? 0.85 : 0.25;
        ctx.lineWidth = active ? 1.4 : 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    });

    // How to get there: the quantum line to drop out of.
    if (s.approach) {
      const [ax, ay] = project(s.approach.from.pos);
      const [bx, by] = project(s.approach.to.pos);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = PLAYER;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Bodies: true size when it shows, a dot otherwise.
    const labels: { x: number; y: number; text: string; color: string; rank: number; bold: boolean }[] = [];
    const picked = new Set<string>();
    for (const leg of s.legs) {
      picked.add(leg.dest.id);
      if (leg.index === 0) for (const r of leg.routes) picked.add(r.id);
      for (const r of leg.routes) for (const stop of r.via ?? []) picked.add(stop.id);
    }
    const parents = new Map(s.bodies.map((b) => [b.id, b]));
    for (const body of s.bodies) {
      // A surface location shares its body's spot; it is drawn only once picked.
      if (body.on && !picked.has(body.id)) continue;
      const p = project(body.pos);
      if (!onScreen(p, 200)) continue;
      if (body.kind === "marker" && !picked.has(body.id)) {
        // Six to a body: shown once zoomed in far enough to tell them apart.
        const parent = parents.get(body.parent ?? "");
        if (body.hidden || !parent || distance(body.pos, parent.pos) * c.ppm < MARKER_ZOOM_PX) continue;
      }
      const color = COLORS[body.kind];
      const trueR = (body.obstruction ?? 0) * c.ppm;
      const isPicked = picked.has(body.id);
      const dot = body.kind === "star" ? 5 : body.kind === "planet" ? 4 : isPicked ? 3.5 : body.kind === "asteroid" ? 1.5 : 2.5;

      if (trueR > dot && (body.kind === "star" || body.kind === "planet" || body.kind === "moon")) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.min(trueR, 20000), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(p[0], p[1], dot, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      const arrivalPx = arrivalOf(body) * c.ppm;
      if (arrivalPx > 8 && arrivalPx < 20000) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], arrivalPx, 0, Math.PI * 2);
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (isPicked) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], dot + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      labels.push({
        x: p[0] + Math.max(dot, Math.min(trueR, 40)) + 5,
        y: p[1],
        text: body.name,
        color: isPicked || body === hover.current ? "#fff" : color,
        rank: isPicked || body === hover.current ? -1 : mapRank(body.kind, body.weight),
        bold: isPicked,
      });
    }

    const leg = s.legs[s.activeLeg];
    if (leg && leg.routes.length > 0) {
      // The corridor: every point of it covers every route.
      if (leg.corridor.feasible && leg.mode === "snare") {
        const [x1, y1] = project(add(leg.dest.pos, scale(leg.corridor.direction, leg.corridor.minDistance)));
        const [x2, y2] = project(add(leg.dest.pos, scale(leg.corridor.direction, leg.corridor.maxDistance)));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = SNARE;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.lineCap = "butt";
        ctx.globalAlpha = 1;
      }

      const [sx, sy] = project(leg.snare);
      const r = leg.reach * c.ppm;
      const tone = leg.mode === "dampen" ? DAMPEN : SNARE;

      if (leg.mode === "dampen") {
        // Where each route drops out: the points the dampener has to reach.
        leg.drops.forEach((drop, index) => {
          const [px, py] = project(drop.point);
          const held = leg.evaluation.routes[index].coverage >= 1;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(3, drop.spread * c.ppm), 0, Math.PI * 2);
          ctx.fillStyle = held ? "rgba(79,214,127,0.35)" : "rgba(255,93,93,0.35)";
          ctx.fill();
          ctx.strokeStyle = held ? "#4fd67f" : BAD;
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      } else if (s.dampen * c.ppm > 6) {
        // Inside this, a ship the snare pulled out cannot spool again.
        ctx.beginPath();
        ctx.arc(sx, sy, s.dampen * c.ppm, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = DAMPEN;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(r, 2), 0, Math.PI * 2);
      ctx.fillStyle = leg.mode === "dampen" ? "rgba(196,140,255,0.16)" : "rgba(255,181,71,0.18)";
      ctx.fill();
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (r < 9) {
        // Too small to see at this zoom: a reticle marks the spot.
        ctx.beginPath();
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(sx + ux * 7, sy + uy * 7);
          ctx.lineTo(sx + ux * 14, sy + uy * 14);
        }
        ctx.stroke();
      }
      labels.push({
        x: sx + 10,
        y: sy - Math.max(r, 14) - 8,
        text: s.focusLabel ?? (leg.mode === "dampen" ? "DAMPENER" : "SNARE"),
        color: tone,
        rank: -2,
        bold: true,
      });
    }

    // The rest of the fleet: each ship's routes, thin, and its sphere.
    for (const other of s.others ?? []) {
      const tone = other.leg.mode === "dampen" ? DAMPEN : SNARE;
      const [ox, oy] = project(other.leg.snare);
      const [dx, dy] = project(other.leg.dest.pos);
      if (other.leg.mode === "snare") {
        for (const route of other.leg.routes) {
          const [rx, ry] = project(route.origin);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(dx, dy);
          ctx.strokeStyle = ROUTE;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      const or = other.leg.reach * c.ppm;
      ctx.beginPath();
      ctx.arc(ox, oy, Math.max(or, 3), 0, Math.PI * 2);
      ctx.fillStyle = other.leg.mode === "dampen" ? "rgba(196,140,255,0.10)" : "rgba(255,181,71,0.10)";
      ctx.fill();
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      labels.push({ x: ox + 10, y: oy + Math.max(or, 14) + 10, text: other.label, color: tone, rank: -2, bold: true });
    }

    if (s.approach) {
      const [px, py] = project(s.approach.point);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = PLAYER;
      ctx.fill();
    }
    if (s.player) {
      const [px, py] = project(s.player);
      ctx.beginPath();
      ctx.moveTo(px, py - 8);
      ctx.lineTo(px + 6, py + 6);
      ctx.lineTo(px - 6, py + 6);
      ctx.closePath();
      ctx.fillStyle = PLAYER;
      ctx.fill();
      labels.push({ x: px + 10, y: py, text: "YOU", color: PLAYER, rank: -2, bold: true });
    }

    // Labels by priority, skipping any that would overlap one already drawn.
    labels.sort((a, b) => a.rank - b.rank);
    const taken: [number, number, number, number][] = [];
    ctx.textBaseline = "middle";
    for (const label of labels) {
      if (!onScreen([label.x, label.y], 0)) continue;
      ctx.font = `${label.bold ? "600 " : ""}12px Inter, system-ui, sans-serif`;
      const width = ctx.measureText(label.text).width;
      const box: [number, number, number, number] = [label.x - 2, label.y - 8, label.x + width + 2, label.y + 8];
      if (label.rank > -2 && taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(2,6,23,0.9)";
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    }

    // Scale bar: a round distance near 110 px.
    const target = 110 / c.ppm;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const barPx = nice * c.ppm;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, h - 22);
    ctx.lineTo(16, h - 16);
    ctx.lineTo(16 + barPx, h - 16);
    ctx.lineTo(16 + barPx, h - 22);
    ctx.stroke();
    ctx.font = '12px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(formatDistance(nice), 16, h - 32);
  }, [project]);

  const invalidate = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(
    (points: Vec3[], minSpan = 0) => {
      if (points.length === 0) return;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const p of points) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      }
      const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], minSpan, 1);
      camera.current.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      camera.current.ppm = (Math.min(size.current.w, size.current.h) * 0.78) / span;
      invalidate();
    },
    [invalidate],
  );

  const fitSystem = useCallback(() => fit(scene.current.bodies.map((b) => b.pos)), [fit]);
  const fitPlan = useCallback(() => {
    const s = scene.current;
    const points = s.legs.flatMap((l) => [l.dest.pos, l.snare, ...l.routes.map((r) => r.from ?? r.origin)]);
    if (points.length < 2) fitSystem();
    else fit(points);
  }, [fit, fitSystem]);
  const focusSnare = useCallback(() => {
    const s = scene.current;
    const leg = s.legs[s.activeLeg];
    if (leg) fit([leg.snare], leg.reach * 12);
  }, [fit]);

  useImperativeHandle(
    ref,
    () => ({
      fitPlan,
      fitSystem,
      focusSnare,
      topDown() {
        camera.current.yaw = 0;
        camera.current.pitch = 0;
        invalidate();
      },
    }),
    [fitPlan, fitSystem, focusSnare, invalidate],
  );

  // Size the backing store to the element, at device resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const first = size.current.w <= 1;
      size.current = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (first) fitPlan();
      else invalidate();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [fitPlan, invalidate]);

  useEffect(() => {
    if (size.current.w > 1) fitPlan();
  }, [fitKey, fitPlan]);

  // Any prop change repaints.
  useEffect(invalidate);

  // Wheel zoom keeps the point under the cursor fixed. Registered natively:
  // React's wheel listener is passive and cannot stop the page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dx = event.clientX - rect.left - size.current.w / 2;
      const dy = event.clientY - rect.top - size.current.h / 2;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const c = camera.current;
      const before = unprojectDelta(dx, dy);
      c.ppm = Math.min(1, Math.max(1e-12, c.ppm * factor));
      const after = unprojectDelta(dx, dy);
      c.center = add(c.center, sub(before, after));
      invalidate();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [invalidate, unprojectDelta]);

  const nearest = (x: number, y: number): Body | undefined => {
    const picked = new Set<string>();
    for (const leg of scene.current.legs) {
      picked.add(leg.dest.id);
      for (const r of leg.routes) picked.add(r.id);
      for (const r of leg.routes) for (const stop of r.via ?? []) picked.add(stop.id);
    }
    const parents = new Map(scene.current.bodies.map((b) => [b.id, b]));
    // An orbital marker can be picked only while it is drawn.
    const shown = (body: Body) => {
      if (body.kind !== "marker" || picked.has(body.id)) return true;
      const parent = parents.get(body.parent ?? "");
      return !body.hidden && !!parent && distance(body.pos, parent.pos) * camera.current.ppm >= MARKER_ZOOM_PX;
    };
    return pickNearest(
      scene.current.bodies
        .filter((body) => !body.on && shown(body))
        .map((body) => {
          const [px, py] = project(body.pos);
          // Same order the labels are placed in, so the pick is the name already on screen.
          return { item: body, distance: Math.hypot(px - x, py - y), rank: picked.has(body.id) ? -1 : mapRank(body.kind, body.weight) };
        }),
      hover.current,
    );
  };

  const drag = useRef<{ x: number; y: number; rotate: boolean; moved: boolean } | undefined>(undefined);

  return (
    <div className="map">
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, rotate: e.button === 2 || e.shiftKey, moved: false };
          setCursor("grabbing");
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            const c = camera.current;
            if (d.rotate) {
              c.yaw += dx * 0.006;
              c.pitch = Math.min(Math.PI / 2, Math.max(0, c.pitch - dy * 0.006));
            } else {
              c.center = sub(c.center, unprojectDelta(dx, dy));
            }
            d.x = e.clientX;
            d.y = e.clientY;
            invalidate();
            return;
          }
          const body = nearest(x, y);
          if (body !== hover.current) {
            hover.current = body;
            setCursor(body ? "pointer" : "grab");
            invalidate();
          }
          const world = add(camera.current.center, unprojectDelta(x - size.current.w / 2, y - size.current.h / 2));
          setReadout(
            body
              ? `${body.name} · ${body.pos.map((v) => Math.round(v / 1000).toLocaleString("en-US")).join(", ")} km`
              : camera.current.pitch < 0.01
                ? `${world.slice(0, 2).map((v) => Math.round(v / 1000).toLocaleString("en-US")).join(", ")} km`
                : "",
          );
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = undefined;
          setCursor(hover.current ? "pointer" : "grab");
          if (d && !d.moved && e.button === 0) {
            const rect = e.currentTarget.getBoundingClientRect();
            const body = nearest(e.clientX - rect.left, e.clientY - rect.top);
            if (body) onPick(body, { x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        }}
        onPointerLeave={() => {
          hover.current = undefined;
          setReadout("");
          invalidate();
        }}
      />
      <div className="map-readout">{readout}</div>
      <div className="map-hint">drag pan · wheel zoom · shift-drag / right-drag rotate · click a location</div>
    </div>
  );
}
