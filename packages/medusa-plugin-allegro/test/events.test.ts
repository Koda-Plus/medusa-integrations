/**
 * The plugin's Medusa events: a writer the circuit breaker disarms says so on
 * the event bus (ids, a masked message and the mode, no buyer data), and a
 * bus that fails never breaks the run that raised the event.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ALLEGRO_EVENTS, bindEventBus, emitAllegroEvent } from "../src/modules/allegro/lib/notify.ts"
import { resolveOptions } from "../src/modules/allegro/lib/options.ts"
import { recordOutcome } from "../src/workflows/allegro/writers.ts"

function fakeSvc() {
  const writers = new Map<string, Record<string, unknown>>()
  const logs: string[] = []
  const o = resolveOptions({ demo: true, breakerThreshold: 2 })
  return {
    logs,
    writers,
    getOptions: () => o,
    isDemo: () => true,
    isConfigured: () => true,
    mask: (s: string) => s.replace(/tok_[a-z0-9]+/g, "***"),
    getLogger: () => ({ info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }),
    listAllegroWriters: async (filter: { id?: string }) => (filter?.id ? [writers.get(filter.id)].filter(Boolean) : [...writers.values()]),
    createAllegroWriters: async (row: Record<string, unknown>) => {
      writers.set(String(row.id), { ...row })
      return row
    },
    updateAllegroWriters: async (patch: Record<string, unknown>) => {
      writers.set(String(patch.id), { ...(writers.get(String(patch.id)) ?? {}), ...patch })
      return patch
    },
  }
}

test("events: the three names the README documents", () => {
  assert.deepEqual([...ALLEGRO_EVENTS], ["allegro.writer.tripped", "allegro.import.held", "allegro.outbox.failed"])
})

test("events: a writer disarmed by the circuit breaker emits allegro.writer.tripped, once", async () => {
  const svc = fakeSvc()
  svc.writers.set("stock", { id: "stock", armed: true, failure_streak: 0 })
  const sent: Array<{ name: string; data: any }> = []
  bindEventBus(svc, { emit: async (m: { name: string; data: unknown }) => void sent.push(m as never) })
  assert.equal(await recordOutcome(svc as never, "stock", { kind: "systemic", message: "503 with tok_abc123" }), false)
  assert.equal(sent.length, 0)
  assert.equal(await recordOutcome(svc as never, "stock", { kind: "systemic", message: "503 with tok_abc123" }), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].name, "allegro.writer.tripped")
  assert.equal(sent[0].data.writer, "stock")
  assert.equal(sent[0].data.demo, true)
  assert.doesNotMatch(sent[0].data.message, /tok_abc123/)
})

test("events: a failing bus is logged and never throws", async () => {
  const svc = fakeSvc()
  bindEventBus(svc, {
    emit: async () => {
      throw new Error("bus down")
    },
  })
  await emitAllegroEvent(svc, "allegro.import.held", { import_id: "algimp_1", checkout_form_id: "f", reason_code: "stock", demo: true })
  assert.match(svc.logs.join("\n"), /could not emit allegro\.import\.held/)
})
