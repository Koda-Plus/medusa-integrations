/**
 * ONE BATCH COMMAND ON ALLEGRO: PUT with our own UUID, wait for the report,
 * read the tasks. Used by the stock push (quantities, ends) and the price
 * push. The PUT is idempotent by its UUID (a repeat answers 409 "Command id
 * was already used"), so it is retried on network errors and 5xx; the
 * reports are plain reads.
 */

import { randomUUID } from "node:crypto"
import type AllegroModuleService from "../../modules/allegro/service"
import { apiGet, apiSend } from "../../modules/allegro/lib/connection"
import { AllegroApiError } from "../../modules/allegro/lib/client"
import { COMMAND_POLL_ATTEMPTS, COMMAND_POLL_INTERVAL_MS } from "../../modules/allegro/lib/constants"
import { parseReport, parseTasks, type TaskResult } from "../../modules/allegro/lib/commands"
import type { WriterKey } from "../../modules/allegro/lib/writers"
import { errorText } from "./runtime"

export interface CommandSpec {
  /** `/sale/offer-quantity-change-commands`, `/sale/offer-publication-commands` or `/sale/offer-price-change-commands`. */
  path: string
  body: Record<string, unknown>
  offerIds: string[]
}

export interface CommandResult {
  commandId: string
  tasks: TaskResult[]
  /** Set when the command itself failed (not one of its offers). */
  error: string | null
  /** The PUT may or may not have reached Allegro: the offers are re-read next run. */
  unclear: boolean
  /** 429: stop the run, try later. */
  rateLimited: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runCommand(svc: AllegroModuleService, writer: WriterKey, armed: ReadonlySet<string>, spec: CommandSpec): Promise<CommandResult> {
  const commandId = randomUUID()
  try {
    await apiSend(svc, { method: "PUT", path: `${spec.path}/${commandId}`, json: spec.body, idempotent: true, writer, armed })
  } catch (err) {
    const status = err instanceof AllegroApiError ? err.status : 0
    if (status !== 409) {
      return {
        commandId,
        tasks: [],
        error: errorText(svc, err),
        unclear: status === 0 || status >= 500,
        rateLimited: status === 429,
      }
    }
    /* 409: a repeat of a command Allegro already registered. Read its report. */
  }
  for (let attempt = 0; attempt < COMMAND_POLL_ATTEMPTS; attempt += 1) {
    await sleep(COMMAND_POLL_INTERVAL_MS)
    try {
      if (parseReport(await apiGet<unknown>(svc, `${spec.path}/${commandId}`, {})).done) break
    } catch {
      /* The tasks read below decides; a failed report read is not a failed command. */
    }
  }
  try {
    const tasks = parseTasks(await apiGet<unknown>(svc, `${spec.path}/${commandId}/tasks`, { limit: "1000", offset: "0" }))
    return { commandId, tasks, error: null, unclear: false, rateLimited: false }
  } catch (err) {
    return { commandId, tasks: [], error: `The command was sent, its report could not be read: ${errorText(svc, err)}`, unclear: true, rateLimited: false }
  }
}

/** The demo answer to a command: every offer succeeds, against the simulation. */
export function simulatedCommand(spec: CommandSpec): CommandResult {
  return {
    commandId: randomUUID(),
    tasks: spec.offerIds.map((offerId) => ({ offerId, status: "SUCCESS" as const, message: null })),
    error: null,
    unclear: false,
    rateLimited: false,
  }
}
