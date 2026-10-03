/**
 * Deterministic Dutch phrase rules shared by intent classification and fact
 * extraction (BUILD_02.md par. 1, 2, 7). Every rule has a stable identifier so
 * classification and extraction decisions are explainable and testable.
 * Matching is exact and word-bounded: no fuzzy or probabilistic interpretation.
 */
import type { SecurityIndicator } from './facts';

export interface PhraseRule {
  readonly ruleId: string;
  readonly pattern: RegExp;
}

/** Canonical symptom values concluded per rule (symptom is a derived fact). */
export const SYMPTOM_RULE_VALUES: Readonly<Record<string, string>> = {
  symptom_not_working: 'not_working',
  symptom_no_connection: 'no_connection',
  symptom_login_block: 'unavailable',
  symptom_erratic: 'erratic_behavior',
};

export const SYMPTOM_PHRASE_RULES: readonly PhraseRule[] = [
  {
    ruleId: 'symptom_not_working',
    pattern: /\bdoet het[^.!?]*\bniet\b|\bwerkt niet\b|\bdoet niets\b|\breageert niet\b|\bprint niet\b|\bgaat niet\b/,
  },
  { ruleId: 'symptom_no_connection', pattern: /\bgeen verbinding\b/ },
  { ruleId: 'symptom_login_block', pattern: /\bniet meer in\b|\bkan niet inloggen\b/ },
  { ruleId: 'symptom_erratic', pattern: /\bdoet raar\b|\braar gedrag\b/ },
];

export interface SecurityPhraseRule extends PhraseRule {
  readonly indicator: SecurityIndicator;
}

/**
 * Conservative security signals (BUILD_02.md par. 7). The word "mail" alone is
 * deliberately NOT a signal: every rule requires an explicit suspicious action
 * or state. An Outlook availability problem can therefore never become
 * phishing merely because email is involved.
 */
export const SECURITY_PHRASE_RULES: readonly SecurityPhraseRule[] = [
  {
    ruleId: 'sec_suspicious_message',
    pattern: /\bverdachte mail\b|\bvreemde mail\b|\bphishing\b|\bspam\b/,
    indicator: 'suspicious_message_received',
  },
  {
    ruleId: 'sec_link_clicked',
    pattern: /\bop een link geklikt\b|\bgeklikt op een link\b|\blink aangeklikt\b|\bop een link gedrukt\b/,
    indicator: 'suspicious_link_clicked',
  },
  {
    ruleId: 'sec_credentials_entered',
    pattern: /\bwachtwoord ingevuld\b|\bwachtwoord ingevoerd\b|\binloggegevens ingevuld\b/,
    indicator: 'credentials_entered_after_suspicious_link',
  },
  {
    ruleId: 'sec_account_compromise',
    pattern: /\bgehackt\b|\baccount overgenomen\b|\bin gebroken\b/,
    indicator: 'suspected_account_compromise',
  },
];

export const REQUEST_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'req_phrase_want', pattern: /\bik wil\b|\bkan ik\b|\bgraag\b|\baanvragen\b|\breserveren\b/ },
  { ruleId: 'req_phrase_access', pattern: /\btoegang\b/ },
  { ruleId: 'req_phrase_install', pattern: /\blaten installeren\b|\binstalleren\b/ },
  { ruleId: 'req_phrase_forgotten', pattern: /\bvergeten\b/ },
  { ruleId: 'req_phrase_new', pattern: /\bnieuw\b|\bnieuwe\b/ },
];

/** Explicit phrase-mapped facts: the value is the employee's own wording. */
export const TIME_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_start_time', pattern: /\bsinds [a-z0-9]+\b/ },
];

export const LOCATION_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_location_office', pattern: /\bop kantoor\b|\bop het kantoor\b/ },
  { ruleId: 'fact_location_home', pattern: /\bthuis\b/ },
];

export const IMPACT_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_impact_cannot_work', pattern: /\bkan niet werken\b|\bkan mijn werk niet doen\b/ },
];

export const URGENCY_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_urgency_urgent', pattern: /\bspoed\b|\burgent\b|\bdirect\b/ },
];

export const AFFECTED_USERS_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_affected_colleagues', pattern: /\bcollega\w*\b|\biedereen\b|\bhele afdeling\b/ },
];

export const ATTEMPTED_SOLUTIONS_PHRASE_RULES: readonly PhraseRule[] = [
  { ruleId: 'fact_attempted_restart', pattern: /\bal geprobeerd\b|\bherstart\w*\b|\bopnieuw opgestart\w*\b/ },
];

/**
 * Correction markers (BUILD_02.md par. 3): they may strengthen/confirm
 * correction detection but are NEVER required for a correction to apply.
 */
export const CORRECTION_MARKER_PATTERN = /\bsorry\b|\btrouwens\b|\bik bedoel\b/;
