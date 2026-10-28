import type { SVGProps } from "react"

/**
 * The Fakturownia tile as shown on the plugin's page in the Medusa integrations
 * directory (medusajs.com/integrations): the white wordmark on #0872B9.
 * Since 2026-10-28 the admin uses the same tile, so the sidebar, this plugin's
 * page and its widget match the directory listing. The wordmark is the
 * directory's own artwork (https://cdn.sanity.io/images/5a711ubd/production/cefc6c9a27a65f04e8737d1ea0733d70bf189447-512x512.svg,
 * a 512 px PNG inside an SVG), scaled to 192 px and clipped to the rounded
 * square of the other Koda Plus icons (rx 40 on a 192 viewBox).
 *
 * Fakturownia and its logo are trademarks of their owner, used here only to
 * identify the service this integration connects to.
 */
const TILE =
  "data:image/png;base64,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"

export function FakturowniaIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <clipPath id="kp-fakturownia-tile">
          <rect width="192" height="192" rx="40" />
        </clipPath>
      </defs>
      <rect width="192" height="192" rx="40" fill="#0872B9" />
      <image href={TILE} width="192" height="192" clipPath="url(#kp-fakturownia-tile)" />
    </svg>
  )
}
