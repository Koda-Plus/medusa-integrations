import type { SVGProps } from "react"

/**
 * A simple mark for the Subiekt nexo integration (blue square, white "S"),
 * drawn as a vector so it stays sharp at sidebar size. Shown next to the
 * other extensions in the admin sidebar, on the Subiekt page and in the
 * order widget.
 *
 * Subiekt nexo and InsERT are trademarks of InsERT S.A., named here only to
 * identify the ERP this integration connects to. This mark is not their logo.
 */
export function SubiektIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
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
      <rect width="192" height="192" rx="40" fill="#1F5FBF" />
      <path
        d="M131 66C121 53 107 48 93 48C73 48 58 59 58 75C58 111 134 92 134 122C134 138 118 146 98 146C82 146 67 140 58 128"
        stroke="#FFFFFF"
        strokeWidth="19"
        strokeLinecap="round"
      />
    </svg>
  )
}
