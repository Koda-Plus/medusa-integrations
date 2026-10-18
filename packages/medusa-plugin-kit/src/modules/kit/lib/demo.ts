import type { KitAccount, KitBroadcast, KitBroadcastStats, KitClient, KitEmailStats, KitForm, KitGrowth, KitSubscriber, KitTag } from "./client"

/**
 * DEMO MODE: the same client as the live one, over a sample Kit account kept
 * in memory. Nothing leaves the server: sign-ups, tags and forms change only
 * this process's copy (gone after a restart), the list in numbers and the
 * broadcasts are fixed sample values. Only on the `demo` option.
 */

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const SAMPLE_TAGS: KitTag[] = [
  { id: 9100001, name: "Newsletter sklepu", subscriber_count: 1184 },
  { id: 9100002, name: "Powiadomienie o dostawie", subscriber_count: 236 },
  { id: 9100003, name: "Klient", subscriber_count: 612 },
  { id: 9100004, name: "Bought: Zestaw startowy", subscriber_count: 88 },
]

const SAMPLE_FORMS: KitForm[] = [
  { id: 8200001, name: "Newsletter w stopce", type: "embed", status: "active", is_double_opt_in: true },
  { id: 8200002, name: "Pop-up z rabatem", type: "embed", status: "active", is_double_opt_in: true },
]

const SAMPLE_BROADCASTS: Array<KitBroadcast & { stats: KitBroadcastStats }> = [
  { id: 7300005, subject: "Nowa kolekcja jest już w sklepie", status: "completed", public: true, public_url: null, published_at: ago(3), send_at: ago(3), created_at: ago(5), stats: { recipients: 1162, open_rate: 48.2, click_rate: 6.9, unsubscribes: 4, unsubscribe_rate: 0.3, total_clicks: 131, status: "completed" } },
  { id: 7300004, subject: "Darmowa dostawa tylko do niedzieli", status: "completed", public: false, public_url: null, published_at: ago(11), send_at: ago(11), created_at: ago(12), stats: { recipients: 1140, open_rate: 44.7, click_rate: 8.1, unsubscribes: 6, unsubscribe_rate: 0.5, total_clicks: 158, status: "completed" } },
  { id: 7300003, subject: "Jak dobrać produkt do potrzeb: krótki poradnik", status: "completed", public: true, public_url: null, published_at: ago(24), send_at: ago(24), created_at: ago(26), stats: { recipients: 1109, open_rate: 51.3, click_rate: 5.4, unsubscribes: 2, unsubscribe_rate: 0.2, total_clicks: 92, status: "completed" } },
  { id: 7300006, subject: "Szkic: zapowiedź wyprzedaży", status: "draft", public: false, public_url: null, published_at: null, send_at: null, created_at: ago(1), stats: { recipients: 0, open_rate: 0, click_rate: 0, unsubscribes: 0, unsubscribe_rate: 0, total_clicks: 0, status: "draft" } },
]

export function createDemoKitClient(source: string): KitClient {
  const tags = SAMPLE_TAGS.map((t) => ({ ...t }))
  const subscribers = new Map<string, KitSubscriber>()
  let nextId = 5400001
  const seed = (email: string, first: string, state: string, days: number) => {
    subscribers.set(email, { id: nextId++, first_name: first, email_address: email, state, created_at: ago(days), fields: {} })
  }
  seed("anna.przyklad@example.com", "Anna", "active", 40)
  seed("jan.testowy@example.com", "Jan", "active", 12)
  seed("ola.demo@example.com", "Ola", "inactive", 1)

  const growth = (starting: string, ending: string): KitGrowth => {
    const days = Math.max(1, Math.round((Date.parse(ending) - Date.parse(starting)) / DAY))
    const fresh = Math.round(days * 4.3)
    const gone = Math.round(days * 0.6)
    return { subscribers: 1184 + subscribers.size - 3, new_subscribers: fresh, cancellations: gone, net_new_subscribers: fresh - gone, starting, ending }
  }

  return {
    apiKey: "",
    source,
    async account(): Promise<KitAccount> {
      return { id: "demo", name: "Konto demo (przykładowe dane)", plan_type: "creator", primary_email_address: "newsletter@example.com" }
    },
    async tags(): Promise<KitTag[]> {
      return tags.map((t) => ({ ...t }))
    },
    async forms(): Promise<KitForm[]> {
      return SAMPLE_FORMS.map((f) => ({ ...f }))
    },
    async createSubscriber(input) {
      const key = input.email.toLowerCase()
      const found = subscribers.get(key)
      if (found) {
        if (input.state === "active") found.state = "active"
        return { subscriber: { ...found }, created: false }
      }
      const s: KitSubscriber = { id: nextId++, first_name: input.firstName ?? null, email_address: key, state: input.state, created_at: new Date().toISOString(), fields: input.fields ?? {} }
      subscribers.set(key, s)
      return { subscriber: { ...s }, created: true }
    },
    async tagSubscriber(_subscriberId: number, tagId: number) {
      const t = tags.find((x) => x.id === tagId)
      if (t) t.subscriber_count = (t.subscriber_count ?? 0) + 1
    },
    async addToForm() {
      /* Kit would send the confirmation e-mail here; the demo sends nothing. */
    },
    async subscriberByEmail(email: string) {
      const s = subscribers.get(email.toLowerCase())
      return s ? { ...s } : null
    },
    async emailStats(): Promise<KitEmailStats> {
      return { sent: 4520, opened: 2131, clicked: 312, open_rate: 47.1, click_rate: 6.9, unsubscribe_rate: 0.3, bounce_rate: 0.4 }
    },
    async growth(starting: string, ending: string) {
      return growth(starting, ending)
    },
    async subscriberCount() {
      return 1184 + subscribers.size - 3
    },
    async broadcasts(perPage: number): Promise<KitBroadcast[]> {
      return SAMPLE_BROADCASTS.slice(0, Math.max(1, perPage)).map(({ stats: _s, ...b }) => ({ ...b }))
    },
    async broadcastStats(id: number): Promise<KitBroadcastStats> {
      const b = SAMPLE_BROADCASTS.find((x) => x.id === id)
      return b ? { ...b.stats } : { recipients: 0, open_rate: 0, click_rate: 0, unsubscribes: 0, unsubscribe_rate: 0, total_clicks: 0, status: null }
    },
    async createTag(name: string): Promise<KitTag> {
      const found = tags.find((t) => t.name === name)
      if (found) return { ...found }
      const t = { id: 9100000 + tags.length + 1, name, subscriber_count: 0 }
      tags.push(t)
      return { ...t }
    },
  }
}
