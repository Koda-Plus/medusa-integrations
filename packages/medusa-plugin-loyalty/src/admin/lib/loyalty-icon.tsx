import type { SVGProps } from "react"

/**
 * The Loyalty mark of Koda Plus: a star made of points, on the same 192
 * grid and rounded square as the other Koda Plus icons in the sidebar.
 */
export const LOYALTY_COLOR = "#F59E0B"

export function LoyaltyIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={LOYALTY_COLOR} />
      <path
        fill="#FFFFFF"
        d="M96 34L118 76L164 83L131 115L139 161L96 138L53 161L61 115L28 83L74 76L96 34Z"
      />
      <circle cx="96" cy="98" r="10" fill={LOYALTY_COLOR} />
    </svg>
  )
}
