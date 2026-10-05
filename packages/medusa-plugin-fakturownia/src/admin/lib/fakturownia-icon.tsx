import type { SVGProps } from "react"

/**
 * The Fakturownia app icon: a white card with the blue "F" and the red and
 * blue airmail stripes along its top and bottom edge. Redrawn as a vector
 * from the official mark, so it stays sharp at sidebar size: the "F" path,
 * the stripe pitch, slant and colours (#0872B9 blue, #EE1D25 red) are taken
 * from the logo on fakturownia.pl and laid out like its app icon, where the
 * card fills the whole tile. The hairline edge stands in for the card's soft
 * shadow, so the white tile stays visible on a light sidebar.
 *
 * Source images (kept in docs/brand-source/ of this package):
 *   https://fs.siteor.com/radgost/files/marketing-2023/img/fakturownia-logo.svg
 *   https://fs.siteor.com/radgost/files/marketing-2023/favicon/favicon-160x160.png
 *   https://fs.siteor.com/radgost/files/marketing-2023/favicon/apple-touch-icon-152x152.png
 * (linked from the head and the header of https://fakturownia.pl, fetched 2026-10-05)
 *
 * Fakturownia and its logo are trademarks of their owner, used here only to
 * identify the service this integration connects to.
 */
export function FakturowniaIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 192 192"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect width="192" height="192" rx="40" fill="#FFFFFF" />
      <rect x="2" y="2" width="188" height="188" rx="38" fill="none" stroke="#000000" strokeOpacity="0.1" strokeWidth="4" />
      <path
        fill="#EE1D25"
        d="M14.16 21H23.34L25.84 16H16.66ZM48.08 21H57.26L59.76 16H50.58ZM82 21H91.18L93.68 16H84.5ZM115.92 21H125.1L127.6 16H118.42ZM149.83 21H159.01L161.51 16H152.33ZM14.16 176H23.34L25.84 171H16.66ZM48.08 176H57.26L59.76 171H50.58ZM82 176H91.18L93.68 171H84.5ZM115.92 176H125.1L127.6 171H118.42ZM149.83 176H159.01L161.51 171H152.33Z"
      />
      <path
        fill="#0872B9"
        d="M31.12 21H40.3L42.8 16H33.62ZM65.04 21H74.22L76.72 16H67.54ZM98.96 21H108.14L110.64 16H101.46ZM132.88 21H142.05L144.55 16H135.38ZM166.79 21H175.97L178.47 16H169.29ZM31.12 176H40.3L42.8 171H33.62ZM65.04 176H74.22L76.72 171H67.54ZM98.96 176H108.14L110.64 171H101.46ZM132.88 176H142.05L144.55 171H135.38ZM166.79 176H175.97L178.47 171H169.29Z"
      />
      <path
        fill="#0872B9"
        d="M72.7 42.98C72.7 42.98 72.83 42.32 73.49 41.66C74.16 41 75.21 41 75.21 41H135.53C135.53 41 138.97 41.79 138.97 46.29C138.97 50.79 135.53 51.05 135.53 51.05H84.34V91.27H129.85C129.85 91.27 133.42 91.53 133.42 96.69C133.42 101.85 129.85 101.98 129.85 101.98H84.34V146.16C84.34 146.16 84.61 150 78.65 150C72.83 150 72.7 146.16 72.7 146.16V42.98Z"
      />
    </svg>
  )
}
