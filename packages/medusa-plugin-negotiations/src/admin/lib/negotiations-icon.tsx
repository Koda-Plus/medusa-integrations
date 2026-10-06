import type { SVGProps } from "react"

/**
 * The Negotiations mark of Koda Plus: two white speech bubbles with three
 * dots on violet, on the same 192 grid and rounded square as the integration
 * icons next to it in the sidebar. The same mark the Koda Plus website and
 * the demo admin (medusa.koda.plus) already show for this module.
 */
export const NEGOTIATIONS_COLOR = "#7C3AED"

export function NegotiationsIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={NEGOTIATIONS_COLOR} />
      <path fill="#FFFFFF" d="M56 40H118A18 18 0 0 1 136 58V90A18 18 0 0 1 118 108H80L56 130L60 108H56A18 18 0 0 1 38 90V58A18 18 0 0 1 56 40Z" />
      <circle cx="68" cy="74" r="7" fill={NEGOTIATIONS_COLOR} />
      <circle cx="87" cy="74" r="7" fill={NEGOTIATIONS_COLOR} />
      <circle cx="106" cy="74" r="7" fill={NEGOTIATIONS_COLOR} />
      <path
        fill="#FFFFFF"
        stroke={NEGOTIATIONS_COLOR}
        strokeWidth="10"
        strokeLinejoin="round"
        d="M114 90H140A16 16 0 0 1 156 106V124A16 16 0 0 1 142 139.9L148 156L128 140H114A16 16 0 0 1 98 124V106A16 16 0 0 1 114 90Z"
      />
    </svg>
  )
}
