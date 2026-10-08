import type { SVGProps } from "react"

/**
 * The Trade Credit mark of Koda Plus: a wallet with coins, on the same 192
 * grid and rounded square as the other Koda Plus icons in the sidebar.
 */
export const CREDIT_COLOR = "#4F46E5"

export function CreditIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={CREDIT_COLOR} />
      <path fill="#FFFFFF" d="M42 62H150A14 14 0 0 1 164 76V118A14 14 0 0 1 150 132H42A14 14 0 0 1 28 118V76A14 14 0 0 1 42 62Z" />
      <rect x="36" y="90" width="120" height="12" rx="6" fill={CREDIT_COLOR} />
      <circle cx="150" cy="126" r="24" fill="#0D9488" />
      <circle cx="150" cy="126" r="12" fill="#D97706" />
      <circle cx="150" cy="126" r="5" fill="#FFFFFF" />
    </svg>
  )
}
