import { useCallback, useEffect, useRef, useState } from "react";

/*
  The sidebar's width and whether it's showing, as in Slack: drag its right
  edge to resize (drag it most of the way closed and it collapses), and
  ⇧⌘D or the top-bar button hides it completely. Both are remembered.
*/
const MIN = 200, MAX = 440, DEFAULT = 268, COLLAPSE_BELOW = 140;
const RAIL = 76;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
const clamp = (width: number) => Math.min(MAX, Math.max(MIN, width));

export function useSidebarLayout() {
  const [open, setOpen] = useState(() => read("ch.sidebar.open") !== "0");
  const [width, setWidth] = useState(() => clamp(Number(read("ch.sidebar.width")) || DEFAULT));
  const [dragging, setDragging] = useState(false);
  useEffect(() => write("ch.sidebar.open", open ? "1" : "0"), [open]);
  useEffect(() => write("ch.sidebar.width", String(width)), [width]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return { open, setOpen, width, setWidth, dragging, setDragging, toggle };
}

export function SidebarResizer({ layout }: { layout: ReturnType<typeof useSidebarLayout> }) {
  const { open, setOpen, width, setWidth, setDragging } = layout;
  const start = useRef<{ x: number; width: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: open ? width : 0 };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const next = start.current.width + e.clientX - start.current.x;
    // Closed by dragging: it reopens at the width it had before the drag.
    if (next < COLLAPSE_BELOW) { setOpen(false); if (start.current.width) setWidth(start.current.width); return; }
    setOpen(true);
    setWidth(clamp(next));
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    start.current = null;
    setDragging(false);
  }

  return (
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
      title="Drag to resize · double-click to reset"
      style={{ left: RAIL + (open ? width : 0) - 4 }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={() => { setOpen(true); setWidth(DEFAULT); }} />
  );
}
