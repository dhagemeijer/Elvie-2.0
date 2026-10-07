/**
 * Context-based knowledge query construction (BUILD_03.md par. 6).
 *
 * Dataminimalisation: the search question is built EXCLUSIVELY from
 * controlled, explicitly allowlisted values (Build 02 recognition
 * catalogue canonicals and Build 02 symptom values). The existing
 * PII detection is a safety net, not a guarantee, so raw employee input
 * (for example the initial question) NEVER reaches the knowledge port.
 * Unknown, non-allowlisted or manipulative values are dropped, never
 * forwarded.
 */
import type { KnowledgeSearchQuery } from '../ports/knowledge';
import type { ConversationContext } from './conversation-context';
import { getFact } from './conversation-context';
import { SYMPTOM_RULE_VALUES } from './language-patterns';
import { FICTIONAL_RECOGNITION_CATALOG, type RecognitionCatalog } from './recognition-catalog';

/**
 * Controlled symptom values allowed in a knowledge query (the derived
 * symptom values of the Build 02 phrase rules).
 */
export const ALLOWED_QUERY_SYMPTOMS: readonly string[] = [...new Set(Object.values(SYMPTOM_RULE_VALUES))];

/**
 * The allowlist of subject/resource values: canonical recognition
 * catalogue values only.
 */
export function querySubjectAllowlist(
  catalog: RecognitionCatalog = FICTIONAL_RECOGNITION_CATALOG,
): ReadonlySet<string> {
  return new Set([...catalog.applications, ...catalog.devices].map((entry) => entry.canonical));
}

function allowlistedValue(value: string | undefined, allowlist: ReadonlySet<string>): string | undefined {
  return value !== undefined && allowlist.has(value) ? value : undefined;
}

/**
 * Build the knowledge search query from the structured conversation
 * context. Deterministic: identical context produces an identical query.
 * Only allowlisted values are included; everything else is omitted.
 */
export function buildKnowledgeQuery(
  context: ConversationContext,
  catalog: RecognitionCatalog = FICTIONAL_RECOGNITION_CATALOG,
): KnowledgeSearchQuery {
  const subjectAllowlist = querySubjectAllowlist(catalog);
  const symptomAllowlist = new Set(ALLOWED_QUERY_SYMPTOMS);

  const subject =
    allowlistedValue(getFact(context, 'serviceOrApplication')?.value, subjectAllowlist) ??
    allowlistedValue(getFact(context, 'device')?.value, subjectAllowlist);
  const symptom = allowlistedValue(getFact(context, 'symptom')?.value, symptomAllowlist);
  const requestedResource = allowlistedValue(getFact(context, 'requestedResource')?.value, subjectAllowlist);

  const keywords: string[] = [];
  for (const category of ['serviceOrApplication', 'device', 'requestedResource'] as const) {
    const value = allowlistedValue(getFact(context, category)?.value, subjectAllowlist);
    if (value !== undefined && !keywords.includes(value)) {
      keywords.push(value);
    }
  }

  const intent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  return { intent, subject, symptom, requestedResource, keywords };
}
