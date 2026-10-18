import type { SVGProps } from "react"

/**
 * The mark of this Koda Plus plugin: a shopping bag with a tick (an offer
 * sold on a marketplace), on the same 192 grid and rounded square as the
 * other Koda Plus icons in the sidebar. A generic mark drawn for this
 * plugin: it is NOT InPost's or Von Halsky's logo and copies none of their
 * artwork or colours.
 */
export const VONHALSKY_COLOR = "#0F766E"

export function VonHalskyIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={VONHALSKY_COLOR} />
      <path d="M50 72H142L134 150H58L50 72Z" stroke="#FFFFFF" strokeWidth="12" strokeLinejoin="round" />
      <path d="M74 72V62C74 49.85 83.85 40 96 40C108.15 40 118 49.85 118 62V72" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" />
      <path d="M78 110L91 123L116 98" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
