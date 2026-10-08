// GENERATED from kit/admin/community.ts (kit 1.0.1) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
/**
 * The `community` block of every plugin dictionary: "Add your store", the
 * setup prompt and help on Discord. The same words in every Koda Plus
 * plugin, so they live in the kit; `en.ts` and `pl.ts` of a package take
 * them as `community: communityEn` and `community: communityPl`.
 */

export const communityEn = {
  addStore: {
    button: "Add your store",
    title: "Does your store run on this integration?",
    text: "Tell us about it. Once we check it, the store joins this list with a link and its rating.",
    name: "Store name",
    url: "Store address",
    note: "A few words about the setup (optional)",
    send: "Send the request",
    copy: "Copy the text",
    copied: "Request copied, paste it into a mail to hello@koda.plus",
    hint: "Your mail app opens with the message to {{email}} ready to send.",
    subject: "A store for {{integration}}",
    greeting: "Hello, my store runs on {{integration}}. Please add it to the list of stores.",
  },
  prompt: {
    button: "Copy prompt",
    title: "Add this integration to your store",
    text: "Paste it into Claude Code, Cursor or another AI agent opened in your Medusa project. The agent installs this version of the plugin, sets it up like here and shows you its notes before it saves them.",
    copy: "Copy",
    copied: "Prompt copied",
    failed: "Could not copy. Select the text and copy it by hand.",
  },
  discord: {
    button: "Help on Discord",
    title: "Join the Koda Plus server on Discord",
  },
}

export const communityPl: typeof communityEn = {
  addStore: {
    button: "Dodaj swój sklep",
    title: "Twój sklep działa na tej integracji?",
    text: "Daj nam znać. Po sprawdzeniu dodamy go do tej listy z linkiem i oceną.",
    name: "Nazwa sklepu",
    url: "Adres sklepu",
    note: "Kilka słów o wdrożeniu (opcjonalnie)",
    send: "Wyślij zgłoszenie",
    copy: "Kopiuj treść",
    copied: "Treść skopiowana, wklej ją w mail do hello@koda.plus",
    hint: "Otworzy się Twoja poczta z gotową wiadomością do {{email}}.",
    subject: "Zgłoszenie sklepu: {{integration}}",
    greeting: "Dzień dobry, mój sklep działa na integracji {{integration}}. Proszę o dodanie go do listy sklepów.",
  },
  prompt: {
    button: "Kopiuj prompt",
    title: "Dodaj tę integrację do swojego sklepu",
    text: "Wklej go w Claude Code, Cursorze albo innym agencie AI otwartym w projekcie Twojej Medusy. Agent zainstaluje tę wersję wtyczki, ustawi ją tak jak tutaj i pokaże Ci notatki, zanim je zapisze.",
    copy: "Kopiuj",
    copied: "Prompt skopiowany",
    failed: "Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.",
  },
  discord: {
    button: "Pomoc na Discordzie",
    title: "Dołącz do serwera Koda Plus na Discordzie",
  },
}
