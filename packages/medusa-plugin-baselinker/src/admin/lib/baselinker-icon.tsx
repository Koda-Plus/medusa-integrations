import type { SVGProps } from "react"

/**
 * The Base (BaseLinker) app icon: a white "b." on Base blue, redrawn as a
 * vector from the official icon on base.com so it stays sharp at sidebar size.
 * Shown in the admin sidebar, on the BaseLinker page and in the widgets.
 *
 * BaseLinker, Base and their logos are trademarks of their owner, used here
 * only to identify the service this integration connects to.
 */
export function BaseLinkerIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
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
      <rect width="192" height="192" rx="40" fill="#4284F3" />
      <path
        fill="#FFFFFF"
        fillRule="evenodd"
        d="M42.75 95.25L42.75 141.38 51.75 141.38 60.75 141.38 60.75 138.56C60.75 137.02 60.85 135.75 60.97 135.75 61.09 135.75 61.9 136.35 62.75 137.09 64.74 138.8 69.6 141.13 72.75 141.89 83.56 144.49 95.37 141.31 103.56 133.58 114.94 122.84 117.62 104.09 109.84 89.66 104.6 79.94 94.97 73.53 83.86 72.38 77.6 71.73 70.52 73.06 65.73 75.8 64.65 76.42 63.67 77.08 63.55 77.27 62.76 78.55 62.63 76.48 62.63 63.38L62.63 49.13 52.69 49.13 42.75 49.13 42.75 95.25M73.4 91.16C70.01 91.96 66.42 94.51 64.51 97.49 62.68 100.34 61.88 103.36 61.88 107.4 61.88 117.68 67.94 124.13 77.62 124.13 82.99 124.13 86.71 122.63 89.76 119.23 96.39 111.85 95.04 98.66 87.12 93.41 83.6 91.08 77.79 90.12 73.4 91.16M128.43 111.67C123.94 113.23 120.76 116.06 118.75 120.31 117.64 122.65 117.56 123.08 117.57 126.94 117.57 130.83 117.64 131.2 118.8 133.58 121.15 138.4 125.51 141.66 130.83 142.57 139.2 144.01 147.31 138.15 148.92 129.52 150.32 121.99 145.46 114.02 138.08 111.74 135.07 110.82 131 110.79 128.43 111.67"
      />
    </svg>
  )
}
