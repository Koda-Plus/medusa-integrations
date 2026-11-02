import { STATE_TEXTS } from "./kit-contract"

/**
 * The words of the koda.integration/1 answers (the manifest problems and the
 * board counters), in the `integration` subtree of the admin dictionaries.
 * Railway has no order, product or customer lines: the plugin is about the
 * hosting, so it answers the `integration` scope only.
 *
 * Plain text here: the Polish dictionary goes through typeset() as a whole.
 */

export const integrationEn = {
  ...STATE_TEXTS.en,
  attention: {
    deploys_failing: "Services whose last deployment failed or crashed",
    resources_high: "Services near their memory or volume limit",
    errors_high: "Services with many errors in the last hour",
  },
  problem: {
    not_configured: "No Railway token: nothing is read",
    demo: "Demo mode: a sample Railway project",
    project_id: "An account token needs the projectId option",
  },
}

export const integrationPl = {
  ...STATE_TEXTS.pl,
  attention: {
    deploys_failing: "Usługi z nieudanym lub padniętym wdrożeniem",
    resources_high: "Usługi przy limicie pamięci lub wolumenu",
    errors_high: "Usługi z wieloma błędami w ostatniej godzinie",
  },
  problem: {
    not_configured: "Brak tokenu Railway: nic nie jest czytane",
    demo: "Tryb demo: przykładowy projekt Railway",
    project_id: "Token konta wymaga opcji projectId",
  },
}

const samePolishKeys: typeof integrationEn = integrationPl
void samePolishKeys
