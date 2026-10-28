import type { SVGProps } from "react"

/**
 * The OLX tile as shown on the plugin's page in the Medusa integrations
 * directory (medusajs.com/integrations): the white wordmark on #002F34.
 * Since 2026-10-28 the admin uses the same tile, so the sidebar, this plugin's
 * page and its widget match the directory listing. The wordmark is the
 * directory's own artwork (https://cdn.sanity.io/images/5a711ubd/production/db6b75fb756077c02cc2265eecc45414b307d2db-512x512.svg,
 * a 512 px PNG inside an SVG), scaled to 192 px and clipped to the rounded
 * square of the other Koda Plus icons (rx 40 on a 192 viewBox).
 *
 * OLX and the OLX logo are trademarks of their owner, used here only to
 * identify the marketplace this integration connects to.
 */
const TILE =
  "data:image/png;base64,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"

export function OlxIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <clipPath id="kp-olx-tile">
          <rect width="192" height="192" rx="40" />
        </clipPath>
      </defs>
      <rect width="192" height="192" rx="40" fill="#002F34" />
      <image href={TILE} width="192" height="192" clipPath="url(#kp-olx-tile)" />
    </svg>
  )
}
