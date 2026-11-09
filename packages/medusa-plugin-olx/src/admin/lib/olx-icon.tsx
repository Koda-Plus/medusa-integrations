import type { SVGProps } from "react"

/**
 * The OLX wordmark from olx.pl in its own colour (#02282C), on a white tile with a thin border (rounded square, rx 40 on a
 * 192 viewBox, like the other Koda Plus icons). Since 2026-11-09 the original
 * logo replaces the white-on-colour tile of the Medusa integrations directory,
 * which did not look like the real brand. Shown in the admin sidebar, on the
 * plugin's page and in its widgets.
 *
 * OLX and the OLX logo are trademarks of their owner, used here only to
 * identify the marketplace this integration connects to.
 */
const TILE = "<rect width=\"192\" height=\"192\" rx=\"40\" fill=\"#FFFFFF\"/><rect x=\"0.75\" y=\"0.75\" width=\"190.5\" height=\"190.5\" rx=\"39.25\" fill=\"none\" stroke=\"#000000\" stroke-opacity=\"0.1\" stroke-width=\"1.5\"/><path fill=\"#02282C\" fill-rule=\"evenodd\" transform=\"translate(32.00 34.31) scale(0.125)\" d=\"M672.073 786.477H533.036V200.534h139.037zM483.019 493.596c0 133.44-108.16 241.419-241.419 241.419S0 626.855 0 493.596s108.16-241.419 241.419-241.419 241.6 107.98 241.6 241.419m-168.289 0c0-40.447-32.683-73.13-73.13-73.13s-73.13 32.683-73.13 73.13 32.683 73.13 73.13 73.13 73.13-32.683 73.13-73.13m708.909-146.802h-92.27l-54.17 54.17-54.17-54.17h-92.27v93.895l53.448 53.448-53.448 53.448v92.631h93.715l52.906-52.906 52.906 52.906h93.715v-92.631l-53.448-53.448 53.448-53.448v-93.895z\"/>"

export function OlxIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 192 192"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
      dangerouslySetInnerHTML={{ __html: TILE }}
    />
  )
}
