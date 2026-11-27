import type { SVGProps } from "react"

/**
 * The AI Avatars mark of Koda Plus: a presenter on a screen, on the same 192
 * grid and rounded square as the other Koda Plus icons in the sidebar.
 */
export const AVATARS_COLOR = "#7C3AED"

export function AvatarsIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={AVATARS_COLOR} />
      <rect x="34" y="40" width="124" height="88" rx="12" fill="#FFFFFF" />
      <circle cx="96" cy="74" r="16" fill={AVATARS_COLOR} />
      <path fill={AVATARS_COLOR} d="M64 128C64 108 78 96 96 96C114 96 128 108 128 128H64Z" />
      <rect x="70" y="140" width="52" height="12" rx="6" fill="#FFFFFF" />
    </svg>
  )
}
