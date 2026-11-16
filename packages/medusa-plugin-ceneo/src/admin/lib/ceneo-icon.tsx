import type { SVGProps } from "react"

/**
 * The Ceneo "C" in Ceneo orange #FF6400 on a white tile with a thin border
 * (rounded square, rx 40 on a 192 viewBox, like the other Koda Plus icons),
 * as Ceneo shows it in its own favicon. The path is the first letter of the
 * logo served on ceneo.pl (logo-ceneo-simple-orange.svg), unchanged, centred
 * on the tile at 60% of its height. Since 2026-11-16 it replaces our own
 * price-tag drawing, like the OLX and DPD tiles.
 *
 * Ceneo and the Ceneo logo are trademarks of their owner, used here only to
 * identify the price comparison service this integration connects to.
 */
export const CENEO_COLOR = "#FF6400"

const C_PATH =
  "M18.2,25.1c0,0.9-3.1,2.6-7.1,2.6l0,0c-7.4,0-11-4.5-11-13.7c0-9,3.9-14,11-14l0,0c1.4,0,3.1,0.4,4.7,1.2c1.1,0.5,2.4,1.3,2.4,1.8c0,0.2,0,0.4-0.3,0.7l-1.6,2.1c-0.1,0.2-0.4,0.4-0.6,0.4c-0.3,0-0.6-0.2-1.1-0.6c-0.8-0.5-1.8-1.2-3.2-1.2c-3.6,0-5.1,2.4-5.1,8.6c0,3.6,0.3,6,1,7.5c0.8,1.8,2.1,2.7,4.1,2.7c1.4,0,2.6-0.5,3.4-0.9c0.5-0.3,1-0.5,1.3-0.5s0.6,0.5,0.6,0.5l1.3,2.2C18.1,24.7,18.2,24.9,18.2,25.1z"

export function CeneoIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill="#FFFFFF" />
      <rect x="0.75" y="0.75" width="190.5" height="190.5" rx="39.25" fill="none" stroke="#000000" strokeOpacity="0.1" strokeWidth="1.5" />
      <path fill={CENEO_COLOR} transform="translate(57.6 37.8) scale(4.2)" d={C_PATH} />
    </svg>
  )
}
