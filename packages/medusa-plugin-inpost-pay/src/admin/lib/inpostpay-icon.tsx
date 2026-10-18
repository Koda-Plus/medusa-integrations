import type { SVGProps } from "react"

/**
 * The mark of this Koda Plus plugin: a phone with a tick (a purchase
 * confirmed in an app), on the same 192 grid and rounded square as the
 * other Koda Plus icons in the sidebar. A generic mark drawn for this plugin:
 * it is NOT InPost's logo and copies none of InPost's artwork or colours.
 */
export const INPOSTPAY_COLOR = "#4F46E5"

export function InpostPayIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={INPOSTPAY_COLOR} />
      <rect x="62" y="30" width="68" height="132" rx="14" stroke="#FFFFFF" strokeWidth="12" />
      <path d="M78 98L92 112L118 84" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="96" cy="146" r="6" fill="#FFFFFF" />
    </svg>
  )
}
