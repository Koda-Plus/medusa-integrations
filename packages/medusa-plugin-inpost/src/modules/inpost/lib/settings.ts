import { isEmail, normalizePhone, normalizePostCode } from "./address"
import type { LabelSize, ParcelSize } from "./constants"
import { labelSize, parcelSize, senderAddressComplete, senderComplete, type ResolvedInpostOptions, type ResolvedSender } from "./options"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN: the sender, the default parcel size
 * and the label size. The options give the defaults; a saved setting wins
 * over them. One row per mode (`demo:settings`, `live:settings`), so trying
 * the demo never changes the live sender.
 *
 * The sender is optional on purpose: without it ShipX uses the
 * organization's own data from InPost Manager, which is what InPost
 * recommends. It is sent only when it has an e-mail and a phone, and a
 * courier pickup needs its address as well.
 */

export interface StoredSettings {
  sender?: ResolvedSender | null
  defaultParcelSize?: ParcelSize | null
  labelFormat?: LabelSize | null
}

export interface EffectiveSettings {
  sender: ResolvedSender
  /** The sender goes to ShipX (an e-mail and a phone). */
  senderSent: boolean
  /** The sender has a full address (needed for a courier pickup). */
  senderAddress: boolean
  defaultParcelSize: ParcelSize
  labelFormat: LabelSize
  source: { sender: "admin" | "option" | "none"; defaultParcelSize: "admin" | "option"; labelFormat: "admin" | "option" }
}

export function settingsKey(demo: boolean): string {
  return `${demo ? "demo" : "live"}:settings`
}

const EMPTY_SENDER: ResolvedSender = {
  companyName: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  street: "",
  buildingNumber: "",
  flatNumber: "",
  city: "",
  postCode: "",
}

function hasAny(s: ResolvedSender | null | undefined): boolean {
  return Boolean(s && Object.values(s).some((v) => typeof v === "string" && v.trim() !== ""))
}

/** A stored value, cleaned the same way as the options. Unknown fields are dropped. */
export function readStoredSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const v = value as Record<string, unknown>
  const out: StoredSettings = {}
  if (v.sender && typeof v.sender === "object") {
    const s = v.sender as Record<string, unknown>
    out.sender = {
      ...EMPTY_SENDER,
      companyName: String(s.companyName ?? "").trim().slice(0, 100),
      firstName: String(s.firstName ?? "").trim().slice(0, 60),
      lastName: String(s.lastName ?? "").trim().slice(0, 60),
      email: isEmail(s.email) ? String(s.email).trim() : "",
      phone: normalizePhone(s.phone) ?? "",
      street: String(s.street ?? "").trim().slice(0, 100),
      buildingNumber: String(s.buildingNumber ?? "").trim().slice(0, 20),
      flatNumber: String(s.flatNumber ?? "").trim().slice(0, 20),
      city: String(s.city ?? "").trim().slice(0, 60),
      postCode: normalizePostCode(s.postCode),
    }
  } else if (v.sender === null) {
    out.sender = null
  }
  const size = parcelSize(v.defaultParcelSize)
  if (size) out.defaultParcelSize = size
  const label = labelSize(v.labelFormat)
  if (label) out.labelFormat = label
  return out
}

/**
 * What the admin sends to POST /admin/inpost/settings, checked field by
 * field. A phone that is not nine Polish digits and a broken e-mail are
 * errors here (the person is typing them), not silently dropped.
 */
export function validateSettingsInput(body: unknown): { ok: true; value: StoredSettings } | { ok: false; errors: string[] } {
  if (!body || typeof body !== "object") return { ok: false, errors: ["body"] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  if (b.sender !== undefined && b.sender !== null) {
    if (typeof b.sender !== "object") errors.push("sender")
    else {
      const s = b.sender as Record<string, unknown>
      if (String(s.email ?? "").trim() && !isEmail(s.email)) errors.push("sender.email")
      if (String(s.phone ?? "").trim() && !normalizePhone(s.phone)) errors.push("sender.phone")
      const post = String(s.postCode ?? "").trim()
      if (post && !/^\d{2}-?\d{3}$/.test(post)) errors.push("sender.postCode")
    }
  }
  if (b.defaultParcelSize !== undefined && b.defaultParcelSize !== null && !parcelSize(b.defaultParcelSize)) errors.push("defaultParcelSize")
  if (b.labelFormat !== undefined && b.labelFormat !== null && !labelSize(b.labelFormat)) errors.push("labelFormat")
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: readStoredSettings(b) }
}

/** The settings in force: a saved value of the mode, else the option, else the default. */
export function effectiveSettings(o: ResolvedInpostOptions, stored: StoredSettings | null | undefined): EffectiveSettings {
  const s = stored ?? {}
  const adminSender = s.sender && hasAny(s.sender) ? s.sender : null
  const optionSender = hasAny(o.sender) ? o.sender : null
  const sender = adminSender ?? optionSender ?? EMPTY_SENDER
  return {
    sender,
    senderSent: senderComplete(sender),
    senderAddress: senderAddressComplete(sender),
    defaultParcelSize: s.defaultParcelSize ?? o.defaultParcelSize,
    labelFormat: s.labelFormat ?? o.labelFormat,
    source: {
      sender: adminSender ? "admin" : optionSender ? "option" : "none",
      defaultParcelSize: s.defaultParcelSize ? "admin" : "option",
      labelFormat: s.labelFormat ? "admin" : "option",
    },
  }
}
