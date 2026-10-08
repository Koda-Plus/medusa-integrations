import type { SVGProps } from "react"

/**
 * The Packaging mark of Koda Plus: stacked boxes, on the same 192 grid and
 * rounded square as the other Koda Plus icons in the sidebar.
 */
export const PACKAGING_COLOR = "#059669"

export function PackagingIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={PACKAGING_COLOR} />
      <path fill="#FFFFFF" d="M42 108L96 138L150 108V74L96 44L42 74V108Z" />
      <path fill={PACKAGING_COLOR} d="M96 44L150 74L96 104L42 74L96 44Z" />
      <path fill="#FFFFFF" d="M42 74L96 104V138L42 108V74Z" />
      <rect x="60" y="128" width="72" height="26" rx="5" fill="#D97706" />
    </svg>
  )
}
