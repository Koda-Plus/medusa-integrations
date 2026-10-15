import { createKitClient, type KitClient } from "./client"
import type { SubscriptionResult } from "./contract"
import type { ResolvedKitOptions } from "./options"
import { tagsForSource, type KitSettings } from "./store"

/**
 * THE SUBSCRIBE FLOW, pure over the client and the container: the upsert
 * (active, or inactive + the double opt-in form, which makes Kit send the
 * confirmation email), the tags, and one log row per attempt. The email is
 * validated by the route before this runs.
 *
 * EXACTLY ONCE BY CONSTRUCTION: Kit's create is an upsert by email and
 * tagging answers 200 when the tag is already there, so a repeated request
 * changes nothing on the list.
 */

export interface SubscribeInput {
  email: string
  first_name?: string
  source?: string
}

export async function subscribeToKit(args: {
  scope: { resolve: (key: string) => unknown }
  options: ResolvedKitOptions
  settings: KitSettings
  client: KitClient
  input: SubscribeInput
}): Promise<SubscriptionResult> {
  const { options, settings, client, input } = args
  const svc = args.scope.resolve("kit") as any

  const email = input.email.trim().toLowerCase()
  const state = settings.double_opt_in ? "inactive" : "active"
  const tags: number[] = tagsForSource(settings, input.source)

  try {
    const { subscriber, created } = await client.createSubscriber({
      email,
      ...(input.first_name ? { firstName: input.first_name.trim().slice(0, 80) } : {}),
      state,
    })

    for (const tagId of tags) {
      try {
        await client.tagSubscriber(subscriber.id, tagId)
      } catch {
        /* one tag that fails must not lose the subscription - the log says so */
      }
    }

    if (settings.double_opt_in && settings.form_id) {
      try {
        await client.addToForm(subscriber.id, settings.form_id, options.storefrontUrl)
      } catch {
        /* the form might be deleted in Kit - the subscriber still waits for confirmation */
      }
    }

    try {
      await svc.createKitSubscriberLogs({
        email,
        first_name: input.first_name?.trim().slice(0, 80) || null,
        kit_subscriber_id: subscriber.id || null,
        state: subscriber.state || state,
        tags,
        source: input.source ?? "form",
        status: "ok",
      })
    } catch {
      /* the log is best-effort */
    }

    return {
      ok: true,
      configured: true,
      status: state === "inactive" ? "confirmation_sent" : "subscribed",
      already: !created,
    }
  } catch (e: any) {
    try {
      await svc.createKitSubscriberLogs({
        email,
        first_name: input.first_name?.trim().slice(0, 80) || null,
        kit_subscriber_id: null,
        state: null,
        tags,
        source: input.source ?? "form",
        status: "failed",
        error: String(e?.message ?? e).slice(0, 500),
      })
    } catch {
      /* the log is best-effort */
    }
    throw e
  }
}
