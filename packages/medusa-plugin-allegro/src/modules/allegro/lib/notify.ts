/**
 * MEDUSA EVENTS OF THE PLUGIN, for a store that wants a ping (Discord, an
 * e-mail, a board) without polling the admin page:
 *
 *   allegro.writer.tripped  { writer, failures, message, demo }
 *   allegro.import.held     { import_id, checkout_form_id, reason_code, demo }
 *   allegro.outbox.failed   { outbox_id, writer, checkout_form_id, order_id, demo }
 *
 * Ids, codes and a masked message only, never buyer data. Best effort: an
 * emit that fails is logged and never stops the run that raised it. The bus
 * is bound to the module service by `allegroOf()` (the workflows' runtime),
 * the same way as the database connection. Zero imports.
 */

export type AllegroEventName = "allegro.writer.tripped" | "allegro.import.held" | "allegro.outbox.failed"

export const ALLEGRO_EVENTS: readonly AllegroEventName[] = ["allegro.writer.tripped", "allegro.import.held", "allegro.outbox.failed"]

interface EventBusLike {
  emit(message: { name: string; data: unknown } | Array<{ name: string; data: unknown }>): Promise<unknown>
}

interface WithLogger {
  getLogger(): { warn(message: string): void }
}

const buses = new WeakMap<object, EventBusLike>()

export function bindEventBus(svc: object, bus: unknown): void {
  if (bus && typeof (bus as EventBusLike).emit === "function") buses.set(svc, bus as EventBusLike)
}

export async function emitAllegroEvent(svc: WithLogger, name: AllegroEventName, data: Record<string, unknown>): Promise<void> {
  const bus = buses.get(svc)
  if (!bus) return
  try {
    await bus.emit({ name, data })
  } catch (err) {
    svc.getLogger().warn(`[allegro] could not emit ${name}: ${err instanceof Error ? err.name : "error"}`)
  }
}
