/**
 * A fake request container: the plugin's service over in-memory rows, with
 * the generated CRUD names the code calls from outside the service.
 */
import { resolveOptions, type AvatarsPluginOptions } from "../src/modules/avatars/lib/options.ts"
import { configuredServices } from "../src/modules/avatars/lib/options.ts"

type Row = Record<string, unknown> & { id: string }

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

function where(rows: Row[], filters: Record<string, unknown> = {}): Row[] {
  return rows.filter((r) => r.deleted_at == null && Object.entries(filters).every(([k, v]) => matches(r[k], v)))
}

let seq = 0

function table(rows: Row[], prefix: string) {
  return {
    list: async (filters: Record<string, unknown> = {}, config: { take?: number } = {}) => where(rows, filters).slice(0, config.take ?? 10_000),
    create: async (data: unknown) => {
      const list = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[]
      const created = list.map((d) => ({ id: `${prefix}_${++seq}`, created_at: new Date(), updated_at: new Date(), ...d }) as Row)
      rows.push(...created)
      return created
    },
    update: async (data: unknown) => {
      const list = (Array.isArray(data) ? data : [data]) as Row[]
      return list.map((d) => {
        const row = rows.find((r) => r.id === d.id)
        if (!row) throw new Error(`no row ${d.id}`)
        Object.assign(row, d, { updated_at: new Date() })
        return row
      })
    },
    softDelete: async (ids: string | string[]) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        const row = rows.find((r) => r.id === id)
        if (row) row.deleted_at = new Date()
      }
    },
  }
}

export function fakeScope(input: { avatars?: Row[]; presentations?: Row[]; jobs?: Row[]; options?: AvatarsPluginOptions } = {}) {
  const rows = { avatars: input.avatars ?? [], presentations: input.presentations ?? [], jobs: input.jobs ?? [] }
  const options = resolveOptions(input.options ?? {})
  const a = table(rows.avatars, "avt")
  const p = table(rows.presentations, "avp")
  const j = table(rows.jobs, "avr")
  const svc = {
    getOptions: () => options,
    isDemo: () => options.demo,
    configured: () => configuredServices(options),
    listAvatarsAvatars: a.list,
    createAvatarsAvatars: a.create,
    updateAvatarsAvatars: a.update,
    softDeleteAvatarsAvatars: a.softDelete,
    listAvatarsPresentations: p.list,
    createAvatarsPresentations: p.create,
    updateAvatarsPresentations: p.update,
    softDeleteAvatarsPresentations: p.softDelete,
    listAvatarsRenderJobs: j.list,
    createAvatarsRenderJobs: j.create,
    updateAvatarsRenderJobs: j.update,
    softDeleteAvatarsRenderJobs: j.softDelete,
  }
  const scope = { resolve: (key: string) => (key === "avatars" ? svc : undefined) } as never
  return { scope, rows, svc }
}
