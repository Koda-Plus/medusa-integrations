import type { SVGProps } from "react"

/**
 * The VAT Whitelist tile as shown on the plugin's page in the Medusa
 * integrations directory (medusajs.com/integrations): a white shield with a
 * check on a violet gradient. Since 2026-10-28 the admin uses the same tile,
 * so the sidebar and this plugin's page match the directory listing. Colours
 * sampled from the directory's tile (top left #8D2CE2 to bottom right
 * #4A00E0, the check in #5E0DE1); the shield and the check are redrawn on the
 * 192 grid and rounded square (rx 40) of the other Koda Plus icons.
 */
export const WHITELIST_COLOR = "#5E0DE1"

export function WhitelistIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="kp-whitelist-tile" x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8D2CE2" />
          <stop offset="1" stopColor="#4A00E0" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="40" fill="url(#kp-whitelist-tile)" />
      <path
        fill="#FFFFFF"
        d="M96 45L135.5 56.4Q141 58 141 63.6V101Q141 128.5 96 146Q51 128.5 51 101V63.6Q51 58 56.5 56.4Z"
      />
      <path d="M80 100L90 109.5L112.5 80.5" stroke={WHITELIST_COLOR} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
