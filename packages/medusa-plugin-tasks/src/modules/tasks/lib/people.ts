/**
 * NAMED PEOPLE: faces for names that are free text on the board. Pure,
 * tested with `node --test`.
 *
 * Assignees and comment authors are often free text: rows of the KODA Panel
 * module ("Anna", "AI helper"), scripts that name a role ("frontend"), AI
 * agents that sign with their own name. The `people` option gives such
 * names a photo, a role line and a kind (`agent` for an AI agent or an
 * automation); the admin shows them next to the store's admin users and
 * matches free text names to them without case. Nobody's photo ships with
 * the plugin: the store passes its own.
 *
 * LENIENT ON PURPOSE, like the references: a typo here must never stop
 * Medusa from starting. Entries without a name are dropped, broken parts of
 * an entry are dropped (an avatar that is neither an image data URI nor an
 * https URL, a role that is not text), the first entry of a name wins.
 */

import { localized, referenceIcon, type LocalizedText } from "./references"

export interface PersonOption {
  /** The name as it appears on the board, e.g. "Anna" or "AI helper". Compared without case. */
  name: string
  /** A photo or a mark: a `data:image/...;base64,` URI (at most about 64 KB) or an https URL. Without one the admin shows initials. */
  avatar?: string
  /** A line under the name, e.g. "Backend and integrations": one text, or `{ en, pl }`. */
  role?: string | LocalizedText
  /** `agent` for an AI agent or an automation; `person` by default. */
  kind?: "person" | "agent"
}

export interface NamedPerson {
  name: string
  avatar: string | null
  role: LocalizedText | null
  kind: "person" | "agent"
}

const MAX_PEOPLE = 50
const NAME_MAX = 80

/** The `people` option, cleaned. Never throws. */
export function normalizePeople(input: unknown): NamedPerson[] {
  if (!Array.isArray(input)) return []
  const out: NamedPerson[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= MAX_PEOPLE) break
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const r = raw as Record<string, unknown>
    const name = typeof r.name === "string" || typeof r.name === "number" ? String(r.name).replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim() : ""
    if (!name) continue
    const key = personKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      avatar: referenceIcon(r.avatar),
      role: localized(r.role, 120),
      kind: r.kind === "agent" ? "agent" : "person",
    })
  }
  return out
}

/** How names are compared: trimmed, single spaces, lower case. */
export function personKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase()
}

/** The configured person a free text name stands for, or null. */
export function findPerson(people: readonly NamedPerson[], name: string | null | undefined): NamedPerson | null {
  if (!name || !name.trim()) return null
  const key = personKey(name)
  return people.find((p) => personKey(p.name) === key) ?? null
}
