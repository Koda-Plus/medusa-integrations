import type { SVGProps } from "react"

/**
 * The Ceneo tile of the Koda Plus plugins: a rounded square (rx 40 on the
 * 192 grid, like the other icons) in an orange gradient with a white price
 * tag. It is our own drawing, not the Ceneo logo (TRADEMARKS.md): the
 * service's name stays in the text, the mark only tells the pages apart.
 */
export const CENEO_COLOR = "#E8590C"

export function CeneoIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="kp-ceneo-tile" x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF8A3D" />
          <stop offset="1" stopColor="#D9480F" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="40" fill="url(#kp-ceneo-tile)" />
      <path fill="#FFFFFF" d="M58 50H101Q106 50 109.5 53.5L143 87Q150 94 143 101L104 140Q97 147 90 140L56.5 106.5Q53 103 53 98V55Q53 50 58 50Z" />
      <circle cx="80" cy="77" r="10" fill={CENEO_COLOR} />
    </svg>
  )
}
