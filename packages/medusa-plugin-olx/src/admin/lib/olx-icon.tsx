import type { SVGProps } from "react"

/**
 * The OLX app icon (cyan square, dark "o|x" mark), redrawn as a vector from
 * the official icon so it stays sharp at sidebar size. Shown next to the
 * other extensions in the admin sidebar, on the OLX page and in the widget.
 *
 * OLX and the OLX logo are trademarks of their owner, used here only to
 * identify the marketplace this integration connects to.
 */
export function OlxIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 192 192"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect width="192" height="192" rx="40" fill="#23E5DB" />
      <circle cx="58.5" cy="96" r="20.9" stroke="#002F34" strokeWidth="21.8" />
      <rect x="98" y="57" width="18" height="78" fill="#002F34" />
      {/* The two strokes of the "x" as separate shapes: drawn as one path they wound in opposite
          directions and the crossing came out empty. */}
      <path fill="#002F34" d="M133.76 77 163 105.67V115h-9.76L124 86.34V77z" />
      <path fill="#002F34" d="M153.24 77 124 105.67V115h9.76L163 86.34V77z" />
    </svg>
  )
}
