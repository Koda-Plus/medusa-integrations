import { model } from "@medusajs/framework/utils"

/**
 * Connection to the Allegro seller account. ONE ROW with a fixed id
 * (`CONNECTION_ID`): one account per store, and the row carries both the
 * tokens and the state of a device login in progress.
 *
 * The `*_enc` columns NEVER leave the module: AES-256-GCM with the
 * `encryptionKey` option. `user_code` is plain: a person types it at
 * allegro.pl, and without our client secret it is worth nothing.
 *
 * `environment` says where the tokens come from. After switching the plugin
 * from sandbox to production, sandbox tokens must not pass for a production
 * connection, so a row from the other environment counts as not connected.
 *
 * `version` counts writes; a process that waited for another one's refresh
 * reads the new token when the version moved. Parallel refreshes are
 * prevented by the token queue inside a process and by the refresh lease
 * (`refresh_lease_until`, `refresh_lease_owner`) across processes.
 */
const AllegroConnection = model.define("allegro_connection", {
  id: model.id().primaryKey(),
  environment: model.text(),
  refresh_token_enc: model.text().nullable(),
  access_token_enc: model.text().nullable(),
  access_expires_at: model.dateTime().nullable(),
  refreshed_at: model.dateTime().nullable(),
  connected_at: model.dateTime().nullable(),
  disconnected_at: model.dateTime().nullable(),
  scope: model.text().nullable(),
  device_code_enc: model.text().nullable(),
  user_code: model.text().nullable(),
  device_expires_at: model.dateTime().nullable(),
  device_interval_s: model.number().nullable(),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
  refresh_lease_until: model.dateTime().nullable(),
  refresh_lease_owner: model.text().nullable(),
  version: model.number().default(0),
})

export default AllegroConnection
