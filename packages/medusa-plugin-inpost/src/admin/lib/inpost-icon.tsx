import type { SVGProps } from "react"

/**
 * The InPost mark (the yellow crescent with its five rays), on InPost's dark
 * tile, in the frame of the other Koda Plus integration icons (a rounded
 * square, rx 40 on a 192 viewBox). The six paths are the mark of InPost's own
 * logo as served in the header of inpost.pl
 * (https://inpost.pl/themes/custom/inpost/logo.svg, the same geometry as the
 * 2024 logo pack on inpost.pl/do-pobrania), moved and scaled into this frame
 * without changing a curve; colours from the same file (#FFCC05 on #1D1D1D,
 * the pairing of InPost's logo on a black background). Shown in the admin
 * sidebar, on the InPost page and in the order widget.
 *
 * InPost and the InPost logo are trademarks of their owner, used here only to
 * identify the carrier this integration connects to.
 */
export function InpostIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill="#1D1D1D" />
      <g fill="#FFCC05">
        <path d="M82.49 96.08C82.49 96.08 74.44 99.2 64.51 99.2C54.59 99.2 46.54 96.08 46.54 96.08C46.54 96.08 54.59 92.97 64.51 92.97C74.44 92.97 82.49 96.08 82.49 96.08Z" />
        <path d="M107.33 50.27C107.33 50.27 100.2 45.45 94.65 37.38C89.1 29.29 87.23 21 87.23 21C87.23 21 94.36 25.8 99.91 33.89C105.47 41.98 107.33 50.27 107.33 50.27Z" />
        <path d="M89.13 70.03C89.13 70.03 80.54 69.08 71.78 64.5C63.01 59.92 57.39 53.46 57.39 53.46C57.39 53.46 65.98 54.42 74.75 58.99C83.52 63.57 89.13 70.03 89.13 70.03Z" />
        <path d="M107.33 141.73C107.33 141.73 100.2 146.55 94.65 154.62C89.1 162.7 87.23 171 87.23 171C87.23 171 94.36 166.2 99.91 158.11C105.47 150.03 107.33 141.73 107.33 141.73Z" />
        <path d="M89.13 121.97C89.13 121.97 80.54 122.92 71.78 127.5C63.01 132.08 57.39 138.54 57.39 138.54C57.39 138.54 65.98 137.58 74.75 133.01C83.52 128.43 89.13 121.97 89.13 121.97Z" />
        <path d="M110 111.09C116.47 127.67 126.87 139.55 145.45 142.37C143.33 142.66 141.18 142.83 138.98 142.84C112.65 142.95 91.2 122.09 91.09 96.24C90.97 70.38 112.22 49.32 138.55 49.21C140.89 49.2 143.2 49.36 145.46 49.67C124.17 52.33 109.98 68.85 107.17 89.88C106.27 102.7 121.2 107.03 121.2 107.03C121.2 107.03 115.09 111.02 110 111.1Z" />
      </g>
    </svg>
  )
}
