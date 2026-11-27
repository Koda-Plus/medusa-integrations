import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AvatarDto, PresentationDetailDto, PresentationDto, StatusResponse } from "../../modules/avatars/lib/contract"
import type { Script, ScriptIssue } from "../../modules/avatars/lib/script"
import { KitRequestError, authHeaders, backendUrl, kitFetch, kitRequestInit } from "./avatars-kit"

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The problem codes of a refused write (the server sends them in `problems`). */
export function problemsOf(err: unknown): string[] {
  if (err instanceof KitRequestError) {
    const body = err.body as { problems?: unknown } | null
    if (body && Array.isArray(body.problems)) return body.problems.filter((p): p is string => typeof p === "string")
    if (err.code) return [err.code]
  }
  return []
}

export const avatarsKeys = {
  all: ["avatars"] as const,
  status: ["avatars", "status"] as const,
}

export function useAvatarsStatus() {
  return useQuery<StatusResponse>({
    queryKey: avatarsKeys.status,
    queryFn: () => kitFetch<StatusResponse>("/admin/avatars"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient()
  return useMutation<O, Error, I>({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: avatarsKeys.all }),
  })
}

const id = (v: string) => encodeURIComponent(v)

export type AvatarInput = { name: string; face_id: string; voice?: string }
export type ConsentInput = { file_url: string; signed_by: string; signed_at: string; note?: string }
export type PresentationInput = {
  title: string
  lang: string
  source_kind: "text" | "recording"
  source_text?: string
  source_file_url?: string
  target_minutes: number
  avatar_id?: string
}

export const useCreateAvatar = () => useWrite((body: AvatarInput) => kitFetch<{ avatar: AvatarDto }>("/admin/avatars/avatars", { method: "POST", body }))
export const useDeleteAvatar = () => useWrite((avatarId: string) => kitFetch(`/admin/avatars/avatars/${id(avatarId)}`, { method: "DELETE" }))
export const useRecordConsent = () =>
  useWrite(({ avatarId, body }: { avatarId: string; body: ConsentInput }) => kitFetch<{ avatar: AvatarDto }>(`/admin/avatars/avatars/${id(avatarId)}/consent`, { method: "POST", body }))
export const useRevokeConsent = () => useWrite((avatarId: string) => kitFetch(`/admin/avatars/avatars/${id(avatarId)}/consent`, { method: "DELETE" }))
export const useCreatePresentation = () => useWrite((body: PresentationInput) => kitFetch<{ presentation: PresentationDto }>("/admin/avatars/presentations", { method: "POST", body }))
export const useDeletePresentation = () => useWrite((presentationId: string) => kitFetch(`/admin/avatars/presentations/${id(presentationId)}`, { method: "DELETE" }))
export function usePresentation(presentationId: string) {
  return useQuery<{ presentation: PresentationDetailDto }>({
    queryKey: ["avatars", "presentation", presentationId],
    queryFn: () => kitFetch(`/admin/avatars/presentations/${id(presentationId)}`),
    /* While a step runs in the background job, look again every few seconds. */
    refetchInterval: (q) => (["transcribing", "scripting", "rendering"].includes(q.state.data?.presentation.state ?? "") ? 5000 : false),
  })
}

export const useStartScript = () => useWrite((presentationId: string) => kitFetch<{ presentation: PresentationDto }>(`/admin/avatars/presentations/${id(presentationId)}/start`, { method: "POST" }))
export const useSaveScript = () =>
  useWrite(({ presentationId, script, baseHash }: { presentationId: string; script: Script; baseHash: string | null }) =>
    kitFetch<{ presentation: PresentationDetailDto; issues: ScriptIssue[] }>(`/admin/avatars/presentations/${id(presentationId)}/script`, { method: "POST", body: { script, base_hash: baseHash ?? "" } }),
  )
export const useApproveScript = () =>
  useWrite(({ presentationId, scriptHash }: { presentationId: string; scriptHash: string }) =>
    kitFetch<{ presentation: PresentationDto }>(`/admin/avatars/presentations/${id(presentationId)}/approve`, { method: "POST", body: { script_hash: scriptHash } }),
  )

/** The issues of a refused script save (shape problems), when the server sent them. */
export function issuesOf(err: unknown): ScriptIssue[] {
  if (err instanceof KitRequestError) {
    const body = err.body as { issues?: unknown } | null
    if (body && Array.isArray(body.issues)) return body.issues as ScriptIssue[]
  }
  return []
}

/** One narration as speech: a WAV blob URL to play (revoke it when done). */
export async function previewAudio(presentationId: string, item: string, text: string): Promise<string> {
  const res = await fetch(`${backendUrl()}/admin/avatars/presentations/${id(presentationId)}/preview`, kitRequestInit({ method: "POST", body: { item, text } }))
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { code?: unknown } | null
    throw new Error(typeof json?.code === "string" ? json.code : `HTTP ${res.status}`)
  }
  return URL.createObjectURL(await res.blob())
}

export const useSeedDemo = () => useWrite(() => kitFetch<{ created: boolean }>("/admin/avatars/demo/seed", { method: "POST" }))

/**
 * One file through Medusa's own POST /admin/uploads (the store's file
 * provider: R2, S3 or local). Returns the URL to keep next to the consent
 * or the presentation.
 */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData()
  form.append("files", file)
  const res = await fetch(`${backendUrl()}/admin/uploads`, { method: "POST", credentials: "include", headers: { Accept: "application/json", ...authHeaders() }, body: form })
  const json = (await res.json().catch(() => null)) as { files?: Array<{ url?: unknown }>; message?: unknown } | null
  if (!res.ok) throw new Error(typeof json?.message === "string" ? json.message : `HTTP ${res.status}`)
  const url = json?.files?.[0]?.url
  if (typeof url !== "string" || !url) throw new Error("upload_without_url")
  return url
}
