import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText, XMark } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, Table, Text, clx, toast } from "@medusajs/ui"
import { announce } from "../../lib/packaging-kit"
import { usePageView } from "../../lib/packaging-guide"
import { GuideView } from "../../lib/packaging-guide-view"
import { usePackagingStatus, useSavePackaging, useSscc } from "../../lib/packaging-api"
import { PackagingIcon } from "../../lib/packaging-icon"
import { EmptyLine, SampleBadge, StatTile } from "../../lib/packaging-ui"
import type { ProductDto, StatusResponse } from "../../../modules/packaging/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "packaging", name: "Packaging", adminPath: "/packaging", Icon: PackagingIcon })

/**
 * Packaging by Koda Plus. One page: the catalog products with their ladders
 * (piece, box, pallet), the MOQ and the step, an editor per product and the
 * SSCC label tool.
 */

const PackagingPage = () => {
  const { t } = useTranslation("packaging")
  const [view, setView] = usePageView()
  const status = usePackagingStatus()
  const s = status.data
  const [editing, setEditing] = useState<string | null>(null)
  const editingProduct = (s?.products ?? []).find((p) => p.product_id === editing) ?? null

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-x-3">
            <span className="flex items-center">
              <PackagingIcon width={28} height={28} />
            </span>
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{t("title")}</Heading>
                {s?.demo ? <SampleBadge /> : null}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("by")} / {t("subtitle")}
              </Text>
            </div>
          </div>
          <div role="tablist" className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={view === "panel"}
              onClick={() => setView("panel")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "panel" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.panel")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "guide"}
              onClick={() => setView("guide")}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                view === "guide" ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t("view.guide")}
            </button>
          </div>
        </div>
      </Container>

      {view === "guide" ? <GuideView /> : null}

      {view === "panel" && status.isError ? (
        <Container className="p-0">
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            {t("error", { message: String(status.error) })}
          </Text>
        </Container>
      ) : null}

      {view === "panel" ? (
        <>
          <Container className="p-0">
            <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
              <StatTile label={t("stats.products")} value={s?.counts.products ?? "-"} />
              <StatTile label={t("stats.moq")} value={s?.counts.with_moq ?? "-"} tone="blue" />
              <StatTile label={t("stats.sscc")} value={s?.counts.with_sscc ?? "-"} tone="green" />
              <StatTile label={t("stats.units")} value={s?.counts.units ?? "-"} />
            </div>
          </Container>

          <SsccCard status={s} />

          <Container className="divide-y p-0">
            <div className="flex flex-col gap-1 px-6 py-4">
              <Heading level="h2">{t("products.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("products.subtitle")}
              </Text>
            </div>
            {!s || s.products.length === 0 ? (
              <EmptyLine>{t("products.empty")}</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("products.sku")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("products.product")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("products.ladder")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("products.moq")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("products.step")}</Table.HeaderCell>
                      <Table.HeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {s.products.map((p) => (
                      <Table.Row key={p.product_id} className="cursor-pointer" onClick={() => setEditing(editing === p.product_id ? null : p.product_id)}>
                        <Table.Cell className="font-mono txt-compact-xsmall">
                          <Link to={`/products/${p.product_id}`} onClick={(e) => e.stopPropagation()} className="hover:text-ui-fg-interactive">
                            {p.sku ?? "-"}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="flex items-center gap-x-2">
                            <span className="txt-compact-small-plus text-ui-fg-base">{p.title ?? p.product_id}</span>
                            {p.demo ? <SampleBadge /> : null}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-ui-fg-subtle">
                          {p.units.length === 0
                            ? t("products.unset")
                            : [...p.units]
                                .sort((a, b) => a.pieces - b.pieces)
                                .map((u) => `${u.name} ${u.pieces}`)
                                .join(" / ")}
                        </Table.Cell>
                        <Table.Cell className="tabular-nums">{p.moq > 0 ? p.moq : "-"}</Table.Cell>
                        <Table.Cell className="tabular-nums">{p.step > 0 ? p.step : "-"}</Table.Cell>
                        <Table.Cell className="text-right text-ui-fg-subtle">{t("products.edit")}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
            {editingProduct ? <ProductEditor product={editingProduct} onDone={() => setEditing(null)} /> : null}
          </Container>
        </>
      ) : null}
    </div>
  )
}

function SsccCard({ status }: { status: StatusResponse | undefined }) {
  const { t } = useTranslation("packaging")
  const [serial, setSerial] = useState("")
  const sscc = useSscc(serial, serial.replace(/\D/g, "").length >= 3)
  return (
    <Container className="p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("sscc.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("sscc.subtitle", { prefix: status?.gs1Prefix ?? "-" })}
        </Text>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-6 pb-4">
        <div className="min-w-[14rem] flex-1">
          <Input size="small" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={t("sscc.placeholder")} />
        </div>
      </div>
      {sscc.data ? (
        <div className="mx-6 mb-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
          <div className="flex items-center gap-x-2">
            <DocumentText className="text-ui-fg-subtle" />
            <Text size="large" weight="plus" className="font-mono tabular-nums text-ui-fg-base">
              {sscc.data.formatted}
            </Text>
          </div>
          <Text size="xsmall" className="mt-2 text-ui-fg-muted">
            {t("sscc.payload")}: <span className="font-mono">{sscc.data.payload}</span>
          </Text>
        </div>
      ) : null}
    </Container>
  )
}

function ProductEditor({ product, onDone }: { product: ProductDto; onDone: () => void }) {
  const { t } = useTranslation("packaging")
  const save = useSavePackaging()
  const [moq, setMoq] = useState(String(product.moq || ""))
  const [step, setStep] = useState(String(product.step || ""))
  const [boxPieces, setBoxPieces] = useState(String(product.units.find((u) => u.name === "karton")?.pieces ?? ""))
  const [boxEan, setBoxEan] = useState(product.units.find((u) => u.name === "karton")?.ean ?? "")
  const [palletPieces, setPalletPieces] = useState(String(product.units.find((u) => u.name === "paleta")?.pieces ?? ""))
  const [ssccPrefix, setSsccPrefix] = useState(product.units.find((u) => u.name === "paleta")?.sscc_prefix ?? "")

  const n = (v: string) => {
    const x = Number(v.replace(",", "."))
    return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0
  }

  const submit = () => {
    const units: Array<{ name: string; pieces: number; ean: string | null; sscc_prefix: string | null }> = [{ name: "szt.", pieces: 1, ean: null, sscc_prefix: null }]
    const box = n(boxPieces)
    if (box > 0) units.push({ name: "karton", pieces: box, ean: boxEan || null, sscc_prefix: null })
    const pallet = n(palletPieces)
    if (pallet > 0) units.push({ name: "paleta", pieces: pallet, ean: null, sscc_prefix: ssccPrefix || null })
    save.mutate(
      { id: product.product_id, body: { moq: n(moq), step: n(step), units } },
      { onSuccess: () => { toast.success(t("toast.saved")); onDone() }, onError: (e) => toast.error(t("toast.error", { error: e.message })) },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <Heading level="h3" className="text-ui-fg-base">
          {product.sku ?? product.product_id} / {product.title}
        </Heading>
      </div>
      <div>
        <Label size="xsmall">{t("editor.moq")}</Label>
        <Input size="small" value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="0" />
      </div>
      <div>
        <Label size="xsmall">{t("editor.step")}</Label>
        <Input size="small" value={step} onChange={(e) => setStep(e.target.value)} placeholder="0" />
      </div>
      <div />
      <div>
        <Label size="xsmall">{t("editor.box")}</Label>
        <Input size="small" value={boxPieces} onChange={(e) => setBoxPieces(e.target.value)} placeholder="12" />
      </div>
      <div>
        <Label size="xsmall">{t("editor.boxEan")}</Label>
        <Input size="small" value={boxEan} onChange={(e) => setBoxEan(e.target.value)} placeholder="590..." maxLength={14} />
      </div>
      <div>
        <Label size="xsmall">{t("editor.pallet")}</Label>
        <Input size="small" value={palletPieces} onChange={(e) => setPalletPieces(e.target.value)} placeholder="120" />
      </div>
      <div>
        <Label size="xsmall">{t("editor.ssccPrefix")}</Label>
        <Input size="small" value={ssccPrefix} onChange={(e) => setSsccPrefix(e.target.value)} placeholder="590123456789" maxLength={10} />
      </div>
      <div className="flex items-end gap-x-2">
        <Button size="small" variant="primary" onClick={submit} disabled={save.isPending}>
          {t("editor.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          <XMark />
          {t("editor.cancel")}
        </Button>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "packaging",
  icon: PackagingIcon,
})

export default PackagingPage
