import { useId } from "react";
import type { ReactNode } from "react";
import type { StockStatus } from "../api";
import { clamp, fmtDays, groupLabel } from "../format";

/** One blood group as an SVG blood bag: the level is the median days of stock as a share
 *  of the national target, so a full bag means the target is met. */
export default function BloodBag({
  type,
  days,
  status,
  target,
  ghost = false,
  caption,
}: {
  type: string;
  /** Median days of stock. */
  days: number;
  status: StockStatus;
  /** National reserve target in days: the full mark. */
  target: number;
  /** Placeholder while loading. */
  ghost?: boolean;
  caption?: ReactNode;
}) {
  const clip = useId().replace(/:/g, "");
  const top = 34;
  const bottom = 146;
  const h = bottom - top;
  const level = bottom - clamp(days / target, 0, 1) * h;
  const label = groupLabel(type);

  return (
    <figure className={`bag bag-${status} ${ghost ? "is-ghost" : ""}`}>
      <svg
        viewBox="0 0 100 176"
        role="img"
        aria-label={`${label}: ${fmtDays(days)} days`}
      >
        <defs>
          <clipPath id={clip}>
            <rect x="14" y="32" width="72" height="116" rx="15" />
          </clipPath>
        </defs>
        <circle
          cx="50"
          cy="12"
          r="6"
          className="bag-line"
          fill="none"
          strokeWidth="4"
        />
        <rect
          x="43"
          y="18"
          width="14"
          height="14"
          rx="2"
          className="bag-solid"
        />
        <rect
          x="14"
          y="32"
          width="72"
          height="116"
          rx="15"
          className="bag-glass"
        />
        <g clipPath={`url(#${clip})`}>
          <g
            className="bag-level"
            style={{ transform: `translateY(${level}px)` }}
          >
            <path
              className="bag-wave"
              d="M-60 0 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V140 H-60 Z"
            />
          </g>
        </g>
        {/* The full mark: the national target. */}
        <line x1="14" x2="86" y1={top} y2={top} className="bag-target" />
        <rect
          x="14"
          y="32"
          width="72"
          height="116"
          rx="15"
          className="bag-line"
          fill="none"
          strokeWidth="5"
        />
        <path
          d="M30 148 q20 10 40 0"
          className="bag-line"
          fill="none"
          strokeWidth="6"
        />
        <rect x="46" y="152" width="8" height="12" className="bag-solid" />
        <text x="50" y="84" textAnchor="middle" className="bag-type">
          {label}
        </text>
      </svg>
      <figcaption>
        <span className="bag-days">{ghost ? "–" : fmtDays(days)}</span>
        <span className="bag-unit">days</span>
        {!ghost && caption}
      </figcaption>
    </figure>
  );
}

