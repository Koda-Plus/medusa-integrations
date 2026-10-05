import type { SVGProps } from "react"

/**
 * A simple mark for the sidebar, the page and the widgets: a white lowercase
 * "b" on a blue rounded square, drawn for this plugin as a vector so it stays
 * sharp at sidebar size. Not a copy of any logo.
 *
 * BaseLinker and Base are trademarks of their owner, named here only to
 * identify the service this independent integration connects to.
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
      <rect width="192" height="192" rx="40" fill="#3B3FD8" />
      <path d="M62 46v100" stroke="#FFFFFF" strokeWidth="20" strokeLinecap="round" />
      <circle cx="98" cy="110" r="34" stroke="#FFFFFF" strokeWidth="20" />
    </svg>
  )
}
