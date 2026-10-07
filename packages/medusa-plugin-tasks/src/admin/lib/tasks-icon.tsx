import type { SVGProps } from "react"

/**
 * The Tasks mark: three board columns of different heights on Koda Plus
 * green, in the same frame as the integration icons next to it in the
 * sidebar (a 192 grid, a rounded square, a white glyph). Shown in the
 * sidebar, on the Tasks page and in the widgets.
 */
export const TASKS_COLOR = "#26D07C"

export function TasksIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={TASKS_COLOR} />
      <rect x="44" y="46" width="30" height="100" rx="10" fill="#FFFFFF" />
      <rect x="81" y="46" width="30" height="66" rx="10" fill="#FFFFFF" />
      <rect x="118" y="46" width="30" height="84" rx="10" fill="#FFFFFF" />
    </svg>
  )
}
