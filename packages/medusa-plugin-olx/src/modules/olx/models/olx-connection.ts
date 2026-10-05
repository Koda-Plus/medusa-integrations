import { model } from "@medusajs/framework/utils"

/**
 * Connection to the OLX seller account. ONE ROW with a fixed id
 * (`CONNECTION_ID`): one account per store, and the row carries both the
 * tokens and the state of a connection attempt in progress.
 *
 * The `*_enc` columns NEVER leave the module: AES-256-GCM with the
 * `encryptionKey` option. `state` is plain: a one-time nonce valid for
 * 15 minutes, worthless outside the callback comparison.
 *
 * `version` counts writes for diagnosis; it is NOT a lock. Parallel refreshes
 * are prevented by the token queue in `lib/connection.ts`.
 */
const OlxConnection = model.define("olx_connection", {
  id: model.id().primaryKey(),
  refresh_token_enc: model.text().nullable(),
  access_token_enc: model.text().nullable(),
  access_expires_at: model.dateTime().nullable(),
  refreshed_at: model.dateTime().nullable(),
  connected_at: model.dateTime().nullable(),
  disconnected_at: model.dateTime().nullable(),
  scope: model.text().nullable(),
  state: model.text().nullable(),
  state_expires_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
  version: model.number().default(0),
})

export default OlxConnection
