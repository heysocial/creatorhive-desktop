import type { CSSProperties } from "react";

const COLORS = ["#5B5BD6", "#1F8A70", "#C2334D", "#7E3AF2", "#C2571A", "#B4461E", "#4F46E5", "#0E7490", "#BE185D", "#3F6212", "#9333EA", "#B45309", "#0F766E", "#DB2777", "#475569", "#2563EB"];

function colorFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "?";

export function Avatar({ name, src, size = 32, radius = "50%", online = false, seed }: {
  name: string;
  src?: string | null;
  size?: number;
  radius?: string;
  online?: boolean;
  seed?: string;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    fontSize: Math.round(size * 0.38),
    background: src ? "var(--card-3)" : colorFor(seed ?? name),
  };
  return (
    <span className="av" style={style} aria-hidden>
      {src ? <img src={src} alt="" loading="lazy" /> : initials(name)}
      {online ? <span className="presence" /> : null}
    </span>
  );
}

/** A count for a badge: 1–99, then 99+. */
export const countLabel = (n: number) => (n > 99 ? "99+" : String(n));

/** Channel names are stored with their "# " (e.g. "# General Chat"); the icon already shows it. */
export const channelName = (name: string) => name.replace(/^#\s*/, "");
