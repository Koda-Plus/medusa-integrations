/**
 * THE SAMPLE TASKS OF THE SANDBOX BOARD. Pure, tested with `node --test`.
 *
 * Nine tasks of an ordinary store week, spread over all six columns, with
 * comments of the store team, the agency and an AI agent, an overdue task,
 * one done and one rejected, and links to a product, an order and a customer
 * of the store itself when it has them. Times are counted back from the seed,
 * so the board always looks like this week.
 *
 * Texts are stored in English and carry both admin languages in
 * `metadata.sample`: the admin shows the one it speaks until someone edits
 * the text. Ids start with `<prefix>_sbx_`, so the sample rows are
 * recognisable in the database; a reset deletes the whole sandbox board and
 * seeds it again.
 */

import { ID_PREFIX, SANDBOX_ID_PREFIX, SANDBOX_SEED_VERSION, type AuthorRole, type LinkType, type TaskPriority, type TaskStatus } from "./constants"
import { utcDay } from "./dates"
import type { SampleText } from "./contract"
import type { ActivityInsert, CommentInsert, LinkInsert, TaskInsert } from "./rows"

export interface SeedViewer {
  id: string
  name: string | null
}

export interface SeedEntities {
  productId?: string | null
  orderId?: string | null
  customerId?: string | null
}

export interface SandboxSeedResult {
  tasks: TaskInsert[]
  comments: CommentInsert[]
  activity: ActivityInsert[]
  links: LinkInsert[]
  marker: { version: string; seeded_at: string; tasks: number; comments: number; links: number }
}

/** Sample people: names that read the same in both languages. */
export const SAMPLE_STORE = "Anna"
export const SAMPLE_AGENCY = "Leo"

type Who = "viewer" | "store" | "agency" | null

interface SampleComment {
  role: AuthorRole
  hoursAgo: number
  body: Required<SampleText>
}

interface SampleTask {
  status: TaskStatus
  priority: TaskPriority
  tags: string[]
  /** Days from the seed to the due day; null for none. */
  dueInDays: number | null
  createdDaysAgo: number
  /** When it reached its column (done and rejected: when it closed). */
  movedDaysAgo?: number
  who: Who
  links: LinkType[]
  title: Required<SampleText>
  description: Required<SampleText>
  comments: SampleComment[]
}

const TASKS: SampleTask[] = [
  {
    status: "backlog",
    priority: "low",
    tags: ["design", "marketing"],
    dueInDays: null,
    createdDaysAgo: 9,
    who: null,
    links: [],
    title: { en: "Plan the winter campaign banners", pl: "Zaplanować banery kampanii zimowej" },
    description: {
      en: "Three sizes: the home page, the category pages and the newsletter. Ideas for the main photo in the comments.",
      pl: "Trzy rozmiary: strona główna, kategorie i newsletter. Pomysły na główne zdjęcie w komentarzach.",
    },
    comments: [],
  },
  {
    status: "backlog",
    priority: "medium",
    tags: ["content"],
    dueInDays: 21,
    createdDaysAgo: 6,
    who: "store",
    links: ["product"],
    title: { en: "Write care instructions for the bestsellers", pl: "Napisać instrukcje pielęgnacji do bestsellerów" },
    description: {
      en: "Customers ask how to wash and store them. A short section on the product page and the same text in the order e-mail.",
      pl: "Klienci pytają, jak je prać i przechowywać. Krótka sekcja na karcie produktu i ten sam tekst w mailu po zamówieniu.",
    },
    comments: [],
  },
  {
    status: "todo",
    priority: "high",
    tags: ["product", "content"],
    dueInDays: 3,
    createdDaysAgo: 5,
    who: "viewer",
    links: ["product"],
    title: { en: "Add a size guide to the product page", pl: "Dodać tabelę rozmiarów na karcie produktu" },
    description: {
      en: "Returns for a wrong size doubled this month. A table with centimetres, how to measure, and a link from the size picker.",
      pl: "Zwroty z powodu złego rozmiaru podwoiły się w tym miesiącu. Tabela w centymetrach, jak mierzyć i link przy wyborze rozmiaru.",
    },
    comments: [
      {
        role: "client",
        hoursAgo: 70,
        body: { en: "The measurements from the supplier are in the shared folder.", pl: "Wymiary od dostawcy są we wspólnym folderze." },
      },
    ],
  },
  {
    status: "todo",
    priority: "medium",
    tags: ["shipping"],
    dueInDays: 10,
    createdDaysAgo: 4,
    who: "agency",
    links: [],
    title: { en: "Set up shipping rates for Germany", pl: "Ustawić stawki wysyłki do Niemiec" },
    description: {
      en: "Parcel up to 5 kg and a pallet option for wholesale orders. Free shipping from the same order value as at home.",
      pl: "Paczka do 5 kg i opcja paletowa dla zamówień hurtowych. Darmowa wysyłka od tej samej kwoty co w kraju.",
    },
    comments: [],
  },
  {
    status: "in_progress",
    priority: "urgent",
    tags: ["orders", "support"],
    dueInDays: -1,
    createdDaysAgo: 2,
    movedDaysAgo: 2,
    who: "store",
    links: ["order", "customer"],
    title: { en: "Customer asks to change the delivery address", pl: "Klient prosi o zmianę adresu dostawy" },
    description: {
      en: "The order is paid and not shipped yet. Change the address before the courier picks it up.",
      pl: "Zamówienie jest opłacone i jeszcze niewysłane. Zmienić adres, zanim kurier je odbierze.",
    },
    comments: [
      {
        role: "client",
        hoursAgo: 40,
        body: { en: "The customer called, the new address is in the order notes.", pl: "Klient dzwonił, nowy adres jest w notatkach zamówienia." },
      },
      {
        role: "claude",
        hoursAgo: 39,
        body: {
          en: "Checked the order: not shipped, no label printed yet. The address can still change.",
          pl: "Sprawdziłem zamówienie: niewysłane, etykieta jeszcze niewydrukowana. Adres można jeszcze zmienić.",
        },
      },
    ],
  },
  {
    status: "in_progress",
    priority: "medium",
    tags: ["payments"],
    dueInDays: 5,
    createdDaysAgo: 3,
    movedDaysAgo: 1,
    who: "agency",
    links: [],
    title: { en: "Check payment webhooks after the update", pl: "Sprawdzić webhooki płatności po aktualizacji" },
    description: {
      en: "After the Medusa update every payment must still be captured and the order marked paid. Test card and one real payment.",
      pl: "Po aktualizacji Medusy każda płatność musi się dalej pobierać, a zamówienie zmieniać na opłacone. Karta testowa i jedna prawdziwa płatność.",
    },
    comments: [
      {
        role: "claude",
        hoursAgo: 20,
        body: {
          en: "Ran the webhook tests: 12 of 12 passed. Waiting for one live payment to confirm.",
          pl: "Testy webhooków przeszły: 12 z 12. Czekam na jedną prawdziwą płatność dla potwierdzenia.",
        },
      },
    ],
  },
  {
    status: "review",
    priority: "high",
    tags: ["checkout", "content"],
    dueInDays: 1,
    createdDaysAgo: 7,
    movedDaysAgo: 1,
    who: "viewer",
    links: [],
    title: { en: "New checkout copy ready for review", pl: "Nowe teksty w koszyku do akceptacji" },
    description: {
      en: "Shorter labels, the delivery time next to every shipping option, and a clear line about returns.",
      pl: "Krótsze etykiety, czas dostawy przy każdej opcji wysyłki i jasne zdanie o zwrotach.",
    },
    comments: [
      {
        role: "agency",
        hoursAgo: 22,
        body: { en: "Deployed to the staging store, please read it on a phone too.", pl: "Wgrane na sklep testowy, przeczytajcie też na telefonie." },
      },
    ],
  },
  {
    status: "done",
    priority: "medium",
    tags: ["seo"],
    dueInDays: -3,
    createdDaysAgo: 12,
    movedDaysAgo: 2,
    who: "agency",
    links: [],
    title: { en: "Product feed for Google Merchant Center", pl: "Feed produktów do Google Merchant Center" },
    description: {
      en: "Every published product with its price, stock and photos, refreshed daily.",
      pl: "Każdy opublikowany produkt z ceną, stanem i zdjęciami, odświeżany codziennie.",
    },
    comments: [],
  },
  {
    status: "rejected",
    priority: "low",
    tags: ["marketing"],
    dueInDays: null,
    createdDaysAgo: 10,
    movedDaysAgo: 8,
    who: null,
    links: [],
    title: { en: "Discount pop-up on the first visit", pl: "Pop-up z rabatem przy pierwszej wizycie" },
    description: {
      en: "A pop-up with 10 percent off for the newsletter.",
      pl: "Wyskakujące okno z rabatem 10 procent za zapis do newslettera.",
    },
    comments: [
      {
        role: "client",
        hoursAgo: 190,
        body: { en: "We keep the store calm: no pop-ups. A line in the footer instead.", pl: "Sklep ma być spokojny, bez wyskakujących okien. Zamiast tego linijka w stopce." },
      },
    ],
  },
]

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const pad = (n: number) => String(n).padStart(2, "0")
const sampleId = (prefix: string, n: number) => `${prefix}_${SANDBOX_ID_PREFIX}_${pad(n)}`

/** The seed for one moment and one viewer. Deterministic: the same input gives the same rows. */
export function buildSandboxSeed(input: { now: Date; viewer: SeedViewer | null; entities?: SeedEntities }): SandboxSeedResult {
  const now = input.now.getTime()
  const at = (ms: number) => new Date(now - ms)
  const entities = input.entities ?? {}
  const linkTarget: Record<LinkType, string | null> = {
    product: entities.productId ?? null,
    order: entities.orderId ?? null,
    customer: entities.customerId ?? null,
  }

  const tasks: TaskInsert[] = []
  const comments: CommentInsert[] = []
  const activity: ActivityInsert[] = []
  const links: LinkInsert[] = []
  const positions = new Map<string, number>()
  let commentSeq = 0
  let activitySeq = 0
  let linkSeq = 0

  const log = (taskId: string, type: string, message: string, actor: string | null, metadata: Record<string, unknown> | null, when: Date) => {
    activitySeq += 1
    activity.push({ id: sampleId(ID_PREFIX.activity, activitySeq), task_id: taskId, type, message, actor, actor_id: null, actor_type: "system", metadata, created_at: when })
  }

  TASKS.forEach((s, index) => {
    const id = sampleId(ID_PREFIX.task, index + 1)
    const created = at(s.createdDaysAgo * DAY)
    const moved = s.movedDaysAgo !== undefined ? at(s.movedDaysAgo * DAY) : created
    const viewer = s.who === "viewer" ? input.viewer : null
    const assignee = s.who === "viewer" ? (viewer?.name ?? SAMPLE_STORE) : s.who === "store" ? SAMPLE_STORE : s.who === "agency" ? SAMPLE_AGENCY : null
    const position = positions.get(s.status) ?? 0
    positions.set(s.status, position + 1)
    const due = s.dueInDays === null ? null : new Date(`${utcDay(new Date(now + s.dueInDays * DAY))}T12:00:00.000Z`)
    const closed = s.status === "done" || s.status === "rejected"

    tasks.push({
      id,
      title: s.title.en,
      description: s.description.en,
      status: s.status,
      priority: s.priority,
      assignee,
      assignee_id: viewer?.id ?? null,
      due_date: due,
      tags: [...s.tags],
      completed_at: closed ? moved : null,
      created_by: SAMPLE_STORE,
      created_by_id: null,
      metadata: { sample: { title: { ...s.title }, description: { ...s.description } } },
      created_at: created,
      updated_at: moved,
      position,
    })

    log(id, "task_created", "Created the task", SAMPLE_STORE, { status: "backlog", priority: s.priority }, created)
    if (assignee) log(id, "assigned", `Assigned to ${assignee}`, SAMPLE_STORE, { from: null, from_id: null, to: assignee, to_id: viewer?.id ?? null }, new Date(created.getTime() + HOUR))
    if (s.status !== "backlog") log(id, "status_changed", `Moved from backlog to ${s.status}`, assignee ?? SAMPLE_STORE, { from: "backlog", to: s.status }, moved)

    for (const type of s.links) {
      const target = linkTarget[type]
      if (!target) continue
      linkSeq += 1
      const when = new Date(created.getTime() + 2 * HOUR)
      links.push({ id: sampleId(ID_PREFIX.link, linkSeq), task_id: id, entity_type: type, entity_id: target, created_by: SAMPLE_STORE, created_by_id: null, created_at: when })
      log(id, "linked", `Linked ${type} ${target}`, SAMPLE_STORE, { link_type: type, entity_id: target }, when)
    }

    for (const c of s.comments) {
      commentSeq += 1
      const cid = sampleId(ID_PREFIX.comment, commentSeq)
      const when = at(c.hoursAgo * HOUR)
      const author = c.role === "client" ? SAMPLE_STORE : c.role === "agency" ? SAMPLE_AGENCY : null
      comments.push({
        id: cid,
        task_id: id,
        body: c.body.en,
        author,
        author_role: c.role,
        author_id: null,
        author_type: c.role === "claude" ? "api-key" : "system",
        metadata: { sample: { body: { ...c.body } } },
        created_at: when,
      })
      log(id, "commented", "Commented", author, { comment_id: cid }, when)
    }
  })

  return {
    tasks,
    comments,
    activity,
    links,
    marker: { version: SANDBOX_SEED_VERSION, seeded_at: input.now.toISOString(), tasks: tasks.length, comments: comments.length, links: links.length },
  }
}

/** True when a sandbox seeded at `seededAt` (ISO) with `version` should be seeded again. */
export function sandboxStale(marker: { version?: unknown; seeded_at?: unknown } | null, resetHours: number, now: Date): boolean {
  if (!marker || marker.version !== SANDBOX_SEED_VERSION || typeof marker.seeded_at !== "string") return true
  const at = new Date(marker.seeded_at).getTime()
  if (!Number.isFinite(at)) return true
  return resetHours > 0 && now.getTime() - at >= resetHours * HOUR
}

/** When an opening seeds the sandbox again; null when only a reset does. */
export function nextSandboxReset(seededAt: string | null, resetHours: number): string | null {
  if (!seededAt || resetHours <= 0) return null
  const at = new Date(seededAt).getTime()
  return Number.isFinite(at) ? new Date(at + resetHours * HOUR).toISOString() : null
}
