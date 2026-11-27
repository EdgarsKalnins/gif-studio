"use client";

import React, { useRef } from "react";

interface BezierCurveEditorProps {
  value: [number, number, number, number];
  onChange: (next: [number, number, number, number], coalesce: boolean) => void;
}

const BEZIER_PRESETS: { label: string; pts: [number, number, number, number] }[] = [
  { label: "Smooth", pts: [0.42, 0, 0.58, 1] },
  { label: "Snappy", pts: [0.2, 1, 0.3, 1] },
  { label: "Spring", pts: [0.34, 1.45, 0.64, 1] },
  { label: "Anticipate", pts: [0.36, -0.3, 0.66, 1.15] },
];

export function BezierCurveEditor({ value, onChange }: BezierCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [x1, y1, x2, y2] = value;

  // Map normalized [0..1] X, [-0.4..1.4] Y into 140x110 SVG box with padding
  const padX = 18;
  const padY = 22;
  const boxW = 104;
  const boxH = 66;

  const toSvgX = (x: number) => padX + x * boxW;
  const toSvgY = (y: number) => padY + (1 - y) * boxH;

  const startHandleDrag = (which: 1 | 2, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const updateFromClient = (cx: number, cy: number, coalesce: boolean) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((cx - rect.left) / Math.max(1, rect.width)) * 140;
      const relY = ((cy - rect.top) / Math.max(1, rect.height)) * 110;
      const nx = Math.max(0, Math.min(1, Number(((relX - padX) / boxW).toFixed(2))));
      const ny = Math.max(-0.4, Math.min(1.45, Number((1 - (relY - padY) / boxH).toFixed(2))));
      if (which === 1) {
        onChange([nx, ny, x2, y2], coalesce);
      } else {
        onChange([x1, y1, nx, ny], coalesce);
      }
    };

    updateFromClient(e.clientX, e.clientY, true);

    const onMove = (ev: PointerEvent) => updateFromClient(ev.clientX, ev.clientY, true);
    const onUp = (ev: PointerEvent) => {
      updateFromClient(ev.clientX, ev.clientY, false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const p0x = toSvgX(0);
  const p0y = toSvgY(0);
  const p1x = toSvgX(x1);
  const p1y = toSvgY(y1);
  const p2x = toSvgX(x2);
  const p2y = toSvgY(y2);
  const p3x = toSvgX(1);
  const p3y = toSvgY(1);

  return (
    <div className="space-y-2 rounded-xl bg-[#efede8] dark:bg-zinc-900/90 p-2.5 ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          Cubic-Bezier Graph
        </span>
        <span className="font-mono studio-accent-text tabular-nums">
          {x1.toFixed(2)}, {y1.toFixed(2)}, {x2.toFixed(2)}, {y2.toFixed(2)}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 140 110"
        className="w-full h-28 rounded-lg bg-white dark:bg-zinc-950 ring-1 ring-black/[0.08] dark:ring-zinc-800 touch-none select-none"
      >
        {/* Subtle 0..1 Bounds Box */}
        <rect
          x={padX}
          y={padY}
          width={boxW}
          height={boxH}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.14}
          strokeDasharray="3 3"
        />
        {/* Linear reference diagonal */}
        <line
          x1={p0x}
          y1={p0y}
          x2={p3x}
          y2={p3y}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
        />
        {/* Handle stems */}
        <line x1={p0x} y1={p0y} x2={p1x} y2={p1y} stroke="#d97706" strokeWidth={1.5} strokeOpacity={0.65} />
        <line x1={p3x} y1={p3y} x2={p2x} y2={p2y} stroke="#0f766e" strokeWidth={1.5} strokeOpacity={0.65} />
        {/* Bezier curve */}
        <path
          d={`M ${p0x} ${p0y} C ${p1x} ${p1y}, ${p2x} ${p2y}, ${p3x} ${p3y}`}
          fill="none"
          stroke="var(--studio-accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {/* Anchor endpoints */}
        <circle cx={p0x} cy={p0y} r={3} fill="currentColor" fillOpacity={0.5} />
        <circle cx={p3x} cy={p3y} r={3} fill="currentColor" fillOpacity={0.5} />
        {/* Draggable Handles */}
        <circle
          cx={p1x}
          cy={p1y}
          r={6}
          fill="#d97706"
          stroke="#ffffff"
          strokeWidth={1.5}
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => startHandleDrag(1, e)}
        />
        <circle
          cx={p2x}
          cy={p2y}
          r={6}
          fill="#0f766e"
          stroke="#ffffff"
          strokeWidth={1.5}
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => startHandleDrag(2, e)}
        />
      </svg>

      <div className="grid grid-cols-4 gap-1">
        {BEZIER_PRESETS.map((bp) => (
          <button
            key={bp.label}
            type="button"
            onClick={() => onChange(bp.pts, false)}
            className="rounded-md bg-white/80 dark:bg-zinc-800 px-1 py-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:bg-[var(--studio-accent-soft)] transition"
          >
            {bp.label}
          </button>
        ))}
      </div>
    </div>
  );
}
