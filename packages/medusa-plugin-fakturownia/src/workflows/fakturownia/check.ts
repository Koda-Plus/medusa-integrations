/**
 * "CHECK CONNECTION": harmless reads only. `GET /departments.json` proves the
 * token and the account, and lists the companies of the account, so the
 * admin can tell whether `departmentId` and every department of
 * `departmentsBySalesChannel` exist; with `categoryId`, `GET
 * /categories.json` does the same for the category. Nothing is created or
 * changed. The result is kept per process for the admin.
 */

import type { CheckResult } from "../../modules/fakturownia/lib/contract"
import { describeError } from "../../modules/fakturownia/lib/errors"
import { clientFor, exclusive, fakturowniaService, rememberCheck, type Scope } from "./runtime"

type RemoteRecord = Record<string, unknown>

function named(list: RemoteRecord[]): Array<{ id: string; name: string }> {
  return list
    .map((d) => ({ id: String(d.id ?? "").trim(), name: String(d.name ?? d.shortcut ?? "").trim() }))
    .filter((d) => /^\d+$/.test(d.id))
}

/** Departments and categories against the configured ids. Pure. */
export function describeAccount(args: {
  departments: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }> | null
  departmentId: number | null
  categoryId: number | null
  channelDepartments?: ReadonlyArray<readonly [string, number]>
}): Pick<CheckResult, "departmentFound" | "departmentName" | "categoryFound" | "categoryName" | "channelDepartments"> {
  const department = args.departmentId !== null ? args.departments.find((d) => d.id === String(args.departmentId)) ?? null : null
  const category = args.categoryId !== null && args.categories ? args.categories.find((c) => c.id === String(args.categoryId)) ?? null : null
  return {
    departmentFound: args.departmentId === null ? null : Boolean(department),
    departmentName: department?.name ?? null,
    categoryFound: args.categoryId === null || !args.categories ? null : Boolean(category),
    categoryName: category?.name ?? null,
    channelDepartments: (args.channelDepartments ?? []).map(([salesChannelId, departmentId]) => {
      const found = args.departments.find((d) => d.id === String(departmentId)) ?? null
      return { salesChannelId, departmentId, found: Boolean(found), name: found?.name ?? null }
    }),
  }
}

export async function checkConnection(scope: Scope): Promise<CheckResult | null> {
  return exclusive("check", async () => {
    const svc = fakturowniaService(scope)
    const o = svc.getOptions()
    const mode = o.demo ? "demo" : "live"
    const checkedAt = new Date().toISOString()
    let result: CheckResult
    try {
      if (o.demo) {
        /* The simulated account has the configured departments, named after the store's sales channels when mapped. */
        const departments = [
          { id: String(o.departmentId ?? 1), name: "Demo sp. z o.o." },
          ...o.departmentsBySalesChannel
            .filter(([, id]) => id !== (o.departmentId ?? 1))
            .map(([channel, id]) => ({ id: String(id), name: `Demo sp. z o.o., ${channel}` })),
        ]
        result = {
          ok: true,
          mode,
          error: null,
          checkedAt,
          departments,
          ...describeAccount({
            departments,
            categories: o.categoryId === null ? null : [{ id: String(o.categoryId), name: "Sklep internetowy" }],
            departmentId: o.departmentId,
            categoryId: o.categoryId,
            channelDepartments: o.departmentsBySalesChannel,
          }),
        }
      } else {
        const client = clientFor(svc)
        const departments = named(await client.listDepartments())
        const categories = o.categoryId !== null ? named(await client.listCategories()) : null
        result = {
          ok: true,
          mode,
          error: null,
          checkedAt,
          departments,
          ...describeAccount({ departments, categories, departmentId: o.departmentId, categoryId: o.categoryId, channelDepartments: o.departmentsBySalesChannel }),
        }
      }
    } catch (err) {
      result = {
        ok: false,
        mode,
        error: svc.mask(describeError(err).message),
        checkedAt,
        departments: [],
        departmentFound: null,
        departmentName: null,
        categoryFound: null,
        categoryName: null,
        channelDepartments: [],
      }
    }
    rememberCheck(result)
    return result
  })
}
