/**
 * The mark of Kit, drawn for both admin themes (a paper plane). The plugin
 * ships no raster logos: the icon follows the currentColor.
 */
export function KitIcon({ width = 20, height = 20, className }: { width?: number; height?: number; className?: string }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path
        d="M20.8 3.2 3.6 10.6c-.9.4-.9 1.6 0 2l5.2 2.3 2.3 5.2c.4.9 1.6.9 2 0l7.4-16.2c.3-.7-.4-1.4-1.1-1.1Z"
        fill="currentColor"
      />
      <path d="m9 15 4.2-4.2" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
}
