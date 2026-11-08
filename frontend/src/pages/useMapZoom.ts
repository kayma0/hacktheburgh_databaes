import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/* Map zoom: +/− buttons, pinch, Ctrl/⌘ + scroll and double-click zoom; drag pans once
   zoomed in. Works by changing the SVG's viewBox. */

type MapView = { x: number; y: number; w: number; h: number };
export const MAX_ZOOM = 10;

export function useMapZoom(W: number, H: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<MapView>({ x: 0, y: 0, w: W, h: H });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, dist: 0, sx: 0, sy: 0 });

  const clampView = (v: MapView): MapView => {
    const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w));
    const h = (w * H) / W;
    return {
      x: Math.min(W - w, Math.max(0, v.x)),
      y: Math.min(H - h, Math.max(0, v.y)),
      w,
      h,
    };
  };

  /** Screen point -> map units, matching the SVG's default "xMidYMid meet" fit. */
  const toMap = (cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const v = viewRef.current;
    const s = Math.min(r.width / v.w, r.height / v.h);
    const ox = (r.width - v.w * s) / 2;
    const oy = (r.height - v.h * s) / 2;
    return { x: v.x + (cx - r.left - ox) / s, y: v.y + (cy - r.top - oy) / s, s };
  };

  /** Zoom by `factor` (>1 = in) keeping the point under (cx, cy) fixed. */
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const v = viewRef.current;
    let px = v.x + v.w / 2;
    let py = v.y + v.h / 2;
    if (cx !== undefined && cy !== undefined) {
      const p = toMap(cx, cy);
      if (p) ({ x: px, y: py } = p);
    }
    const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w / factor));
    const f = w / v.w;
    const next = clampView({ x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: (w * H) / W });
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Plain scrolling keeps scrolling the page; Ctrl/⌘ + scroll (and trackpad pinch,
    // which browsers report as Ctrl + wheel) zooms the map.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1)
      gesture.current = { moved: false, dist: 0, sx: e.clientX, sy: e.clientY };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      // Pinch: zoom by the change in finger distance, around the midpoint.
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0) zoomAt(d / g.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.dist = d;
      g.moved = true;
      return;
    }
    const v = viewRef.current;
    if (v.w >= W) return; // nothing to pan when fully zoomed out
    if (!g.moved && Math.hypot(cur.x - g.sx, cur.y - g.sy) < 5) return;
    if (!g.moved) {
      g.moved = true;
      // Capture only once dragging, so an ordinary tap still reaches the country.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const s = toMap(cur.x, cur.y)?.s ?? 1;
    const next = clampView({ ...v, x: v.x - (cur.x - prev.x) / s, y: v.y - (cur.y - prev.y) / s });
    viewRef.current = next;
    setView(next);
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.dist = 0;
  };

  const zoom = W / view.w;
  return {
    svgRef,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoom,
    zoomIn: () => zoomAt(1.6),
    zoomOut: () => zoomAt(1 / 1.6),
    reset: () => {
      const full = { x: 0, y: 0, w: W, h: H };
      viewRef.current = full;
      setView(full);
    },
    /** True right after a drag or pinch, so it isn't treated as a tap. */
    wasDrag: () => gesture.current.moved,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onDoubleClick: (e: ReactMouseEvent<SVGSVGElement>) => zoomAt(2, e.clientX, e.clientY),
    },
  };
}
