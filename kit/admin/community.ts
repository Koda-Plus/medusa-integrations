/**
 * The `community` block of every plugin dictionary: the setup prompt and
 * help on Discord. The same words in every Koda Plus
 * plugin, so they live in the kit; `en.ts` and `pl.ts` of a package take
 * them as `community: communityEn` and `community: communityPl`.
 */

export const communityEn = {
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
  featured: {
    badge: "Medusa featured integration",
    title: "Featured in the Medusa integrations catalog. Opens its page there in a new tab.",
  },
}

export const communityPl: typeof communityEn = {
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
  featured: {
    badge: "Wyróżniona przez Medusę",
    title: "Wyróżniona w katalogu integracji Medusy. Otwiera jej stronę w katalogu w nowej karcie.",
  },
}
