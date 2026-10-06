/**
 * RecognitionCatalog domain contract (BUILD_02.md par. 4).
 *
 * The Conversation Core depends only on this abstraction, never on TOPdesk
 * HTTP/API details. Build 02 ships a deliberately small fictional/generic
 * catalogue for development and testing; a later build may supply vocabulary
 * from an appropriate authoritative/configured source. This is NOT a copy of
 * the LV/TOPdesk service catalogue.
 */

export interface CatalogEntry {
  /** Canonical value stored in facts. */
  readonly canonical: string;
  /** Normalized aliases (including casing variants). */
  readonly aliases: readonly string[];
}

export interface RecognitionCatalog {
  readonly applications: readonly CatalogEntry[];
  readonly devices: readonly CatalogEntry[];
}

/**
 * Fictional/generic development and test catalogue. No real LV or TOPdesk
 * catalogue content.
 */
export const FICTIONAL_RECOGNITION_CATALOG: RecognitionCatalog = {
  applications: [
    { canonical: 'Outlook', aliases: ['outlook', 'mail', 'e-mail'] },
    { canonical: 'Teams', aliases: ['teams'] },
    { canonical: 'Mailbox', aliases: ['mailbox', 'gedeelde mailbox'] },
    { canonical: 'Account', aliases: ['account', 'inloggen', 'wachtwoord'] },
  ],
  devices: [
    { canonical: 'laptop', aliases: ['laptop', 'notebook'] },
    { canonical: 'telefoon', aliases: ['telefoon', 'mobiel', 'smartphone'] },
    { canonical: 'printer', aliases: ['printer'] },
    { canonical: 'desktop', aliases: ['pc', 'computer', 'werkstation'] },
    { canonical: 'muis', aliases: ['muis'] },
  ],
};

/** A subject recognized in normalized input via the catalogue. */
export interface RecognizedSubject {
  readonly canonical: string;
  readonly kind: 'application' | 'device';
  /** The alias that matched (concise evidence). */
  readonly matched: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministically recognize catalogue subjects in normalized input.
 * Word-bounded exact alias matching; first matching alias per entry wins.
 */
export function recognizeSubjects(normalizedInput: string, catalog: RecognitionCatalog): readonly RecognizedSubject[] {
  const subjects: RecognizedSubject[] = [];
  for (const kind of ['application', 'device'] as const) {
    const entries = kind === 'application' ? catalog.applications : catalog.devices;
    for (const entry of entries) {
      for (const alias of entry.aliases) {
        const pattern = new RegExp('\\b' + escapeRegExp(alias) + '\\b');
        if (pattern.test(normalizedInput)) {
          subjects.push({ canonical: entry.canonical, kind, matched: alias });
          break;
        }
      }
    }
  }
  return subjects;
}
