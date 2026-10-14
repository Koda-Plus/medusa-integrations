import type { SVGProps } from "react"

/**
 * The Coupons mark of Koda Plus: a ticket with a percent sign, on the same
 * 192 grid and rounded square as the other Koda Plus icons in the sidebar.
 */
export const COUPONS_COLOR = "#E11D48"

export function CouponsIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={COUPONS_COLOR} />
      <path
        fill="#FFFFFF"
        d="M36 52C36 45.4 41.4 40 48 40H144C150.6 40 156 45.4 156 52V76C144.95 76 136 84.95 136 96C136 107.05 144.95 116 156 116V140C156 146.6 150.6 152 144 152H48C41.4 152 36 146.6 36 140V116C47.05 116 56 107.05 56 96C56 84.95 47.05 76 36 76V52Z"
      />
      <circle cx="78" cy="76" r="11" fill={COUPONS_COLOR} />
      <circle cx="114" cy="116" r="11" fill={COUPONS_COLOR} />
      <path d="M118 66L74 126" stroke={COUPONS_COLOR} strokeWidth="12" strokeLinecap="round" />
    </svg>
  )
}
