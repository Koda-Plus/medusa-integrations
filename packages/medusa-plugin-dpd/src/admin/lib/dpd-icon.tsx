import { useId, type SVGProps } from "react"
import { clx } from "@medusajs/ui"

/**
 * The DPD tile, in the frame of the other Koda Plus integration icons (a
 * rounded square, rx 40 on a 192 viewBox, like the InPost and Allegro
 * tiles): DPD's cube in white on DPD red, the red gradient of DPD's own
 * logo (#A90034 to #DC0032). The cube path is the mark of the logo served
 * in the header of dpd.com/pl (DPD_logo_redgrad_rgb_responsive.svg),
 * unchanged, centred on the tile at 60% of its height.
 *
 * DPD and the DPD logo are trademarks of their owner, used here only to
 * identify the carrier this integration connects to.
 */
const CUBE =
  "M199.681,385.541c-0.787,0.459-2.021,0.423-2.789-0.052l-4.522-2.688c-0.368-0.228-0.706-0.593-0.961-1.032c-0.015-0.025-0.03-0.051-0.045-0.077c-0.289-0.471-0.453-0.968-0.47-1.424l-0.115-5.272c-0.034-0.888,0.552-1.971,1.342-2.432l54.362-31.67l-76.285-41.577c-0.84-0.466-1.948-0.691-3.057-0.693c-1.11-0.002-2.22,0.229-3.061,0.693l-76.286,41.578l85.46,49.75c0.792,0.433,1.394,1.461,1.394,2.389v72.576c0,0.911-0.652,1.958-1.45,2.384l-4.599,2.554c-0.382,0.203-0.868,0.312-1.376,0.312c-0.029,0-0.059,0-0.088,0c-0.552,0.013-1.065-0.096-1.467-0.312l-4.614-2.555c-0.784-0.417-1.425-1.469-1.425-2.383l0.001-64.698c-0.041-0.474-0.388-1.052-0.768-1.27l-75.292-43.829v85.848c-0.001,1.921,1.354,4.291,3.014,5.262l77.543,45.732c0.829,0.486,1.921,0.728,3.012,0.724c1.092-0.003,2.184-0.231,3.011-0.723l77.555-45.733c1.654-0.981,3.005-3.338,3.003-5.262v-85.847L199.681,385.541z"

/* The cube spans x 83.6 to 247.6 and y 293.5 to 499.5 in the logo's coordinates. */
const CUBE_FIT = "translate(96 96) scale(0.56) translate(-165.6 -396.5)"

/** The plain tile: the sidebar entry, the card registry, the page header. */
export function DpdIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  /* One gradient id per rendered icon: two icons on a page must not share one. */
  const id = `dpd-red-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={id} x1="0" y1="192" x2="192" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A90034" />
          <stop offset="0.27" stopColor="#BB0033" />
          <stop offset="0.72" stopColor="#D30032" />
          <stop offset="1" stopColor="#DC0032" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="40" fill={`url(#${id})`} />
      <path d={CUBE} fill="#FFFFFF" transform={CUBE_FIT} />
    </svg>
  )
}

/** `page`: 28 px for the page header; `card`: 20 px for the order card. */
export function DpdMark({ size = "page", className }: { size?: "page" | "card"; className?: string }) {
  const px = size === "page" ? 28 : 20
  return <DpdIcon width={px} height={px} className={clx("shrink-0", size === "page" ? "rounded-lg" : "rounded-md", className)} />
}
