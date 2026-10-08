import type { SVGProps } from "react"

/**
 * The EU Compliance mark of Koda Plus: a shield with a check, on the same 192
 * grid and rounded square as the other Koda Plus module icons in the sidebar.
 */
export const COMPLIANCE_COLOR = "#0D9488"

export function ComplianceIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={COMPLIANCE_COLOR} />
      <path
        fill="#FFFFFF"
        d="M96 36L146 52V90C146 122 124 142 96 156C68 142 46 122 46 90V52L96 36Z"
      />
      <path
        d="M76 94L89 107L118 76"
        stroke={COMPLIANCE_COLOR}
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
