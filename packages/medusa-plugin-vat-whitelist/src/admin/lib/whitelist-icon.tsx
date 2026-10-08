import type { SVGProps } from "react"

/**
 * The VAT Whitelist mark of Koda Plus: a document with a check, on the same
 * 192 grid and rounded square as the other Koda Plus icons in the sidebar.
 */
export const WHITELIST_COLOR = "#D97706"

export function WhitelistIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={WHITELIST_COLOR} />
      <path fill="#FFFFFF" d="M58 34H134A16 16 0 0 1 150 50V158A16 16 0 0 1 134 174H58A16 16 0 0 1 42 158V50A16 16 0 0 1 58 34Z" />
      <rect x="58" y="62" width="52" height="12" rx="6" fill={WHITELIST_COLOR} />
      <rect x="58" y="88" width="76" height="12" rx="6" fill={WHITELIST_COLOR} />
      <rect x="58" y="114" width="40" height="12" rx="6" fill={WHITELIST_COLOR} />
      <circle cx="126" cy="122" r="22" fill="#0D9488" />
      <path d="M115 122L122 129L137 113" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
