import { cleanZone } from "../../modules/coupons/lib/when"

/*
 * The store's time zone (option timeZone), remembered once the list or the
 * creator's lookups are read; the admin's own zone until then and in a
 * store without the option. Days and times of coupons are shown and typed
 * in it.
 */
let storeZone: string | undefined

export function setStoreTimeZone(zone: string | null | undefined): void {
  const z = cleanZone(zone)
  if (z) storeZone = z
}

export function storeTimeZone(): string | undefined {
  return storeZone
}
