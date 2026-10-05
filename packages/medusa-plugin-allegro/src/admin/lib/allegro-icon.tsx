import type { SVGProps } from "react"

/**
 * An Allegro app mark (orange square, white lowercase "a"), drawn as a simple
 * vector so it stays sharp at sidebar size. Shown next to the other
 * extensions in the admin sidebar, on the Allegro page and in the widget.
 *
 * Allegro and the Allegro logo are trademarks of their owner, used here only
 * to identify the marketplace this integration connects to.
 */
export function AllegroIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
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
      <rect width="192" height="192" rx="40" fill="#FF5A00" />
      <circle cx="90" cy="104" r="34" stroke="#FFFFFF" strokeWidth="20" />
      <path d="M124 70v68" stroke="#FFFFFF" strokeWidth="20" strokeLinecap="round" />
    </svg>
  )
}
