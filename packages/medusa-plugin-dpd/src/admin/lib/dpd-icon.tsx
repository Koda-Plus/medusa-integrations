import { TruckFast } from "@medusajs/icons"
import { clx } from "@medusajs/ui"

/**
 * The icon of the plugin: a generic delivery truck from @medusajs/icons, on
 * purpose. The DPD logo is a trademark of its owner and is not drawn here.
 *
 * `DpdIcon` is the plain glyph (the sidebar entry, the card registry);
 * `DpdMark` puts it on a tile for the page header and the order card, in the
 * colours of the admin theme (light and dark).
 */
export function DpdIcon({ width = 15, height = 15, className }: { width?: number; height?: number; className?: string }) {
  return <TruckFast width={width} height={height} className={className} aria-hidden />
}

/** `page`: 28 px for the page header; `card`: 20 px for the order card. */
export function DpdMark({ size = "page", className }: { size?: "page" | "card"; className?: string }) {
  return (
    <span
      aria-hidden
      className={clx(
        "inline-flex shrink-0 items-center justify-center bg-ui-bg-component text-ui-fg-base shadow-borders-base",
        size === "page" ? "h-7 w-7 rounded-lg" : "h-5 w-5 rounded-md",
        className,
      )}
    >
      <TruckFast width={size === "page" ? 18 : 14} height={size === "page" ? 18 : 14} />
    </span>
  )
}
