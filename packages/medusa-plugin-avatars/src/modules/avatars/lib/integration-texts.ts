import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (the manifest problems and the
 * board counters), in the `integration` subtree of the admin dictionaries.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  attention: {
    presentations_failed: "Presentations where a step failed",
    presentations_review: "Scripts waiting for approval",
    avatars_without_consent: "Avatars without a signed consent",
  },
  problem: {
    demo: "Demo mode: a sample avatar and presentation, nothing is sent out",
    not_configured: "No API keys: the script and the render are off",
    tavus_missing: "No Tavus key: avatars cannot be rendered",
    claude_missing: "No Anthropic key: scripts cannot be written",
    gemini_missing: "No Gemini key: no transcription and no voice",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  attention: {
    presentations_failed: "Prezentacje z błędem w jednym z kroków",
    presentations_review: "Scenariusze czekające na akceptację",
    avatars_without_consent: "Awatary bez podpisanej zgody",
  },
  problem: {
    demo: "Tryb demo: przykładowy awatar i prezentacja, nic nie wychodzi na zewnątrz",
    not_configured: "Brak kluczy API: scenariusz i render są wyłączone",
    tavus_missing: "Brak klucza Tavus: awatarów nie da się wyrenderować",
    claude_missing: "Brak klucza Anthropic: scenariusze nie powstaną",
    gemini_missing: "Brak klucza Gemini: bez transkrypcji i głosu",
  },
}

const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
