/**
 * ELVIE 2.0 — BUILD 04C — Canonical validated ticket content (§7.2/§15.6).
 *
 * One canonical, validated ticket-content object rendered into BOTH the
 * employee preview and the submitted draft, so the preview can never
 * diverge from the draft. Only validated values enter the content:
 * structured facts (with provenance) and typed concrete answer outcomes;
 * raw unclassified answers are never copied (§15.6).
 */
import type { ConversationContext, IntakeType } from './conversation-context';
import { getFact } from './conversation-context';
import type { FactCategory } from './facts';
import { getAnswerOutcome } from './answer-outcome';
import { UNKNOWN_LABEL, type IntakeValidationResult } from './intake-policy';
import type { SubmissionKey, TicketDraft } from '../ports/ticket';

export interface TicketContent {
  readonly category: IntakeType;
  /** Functional route ('unknown' while undetermined). */
  readonly route: string;
  readonly summary: string;
  readonly description: string;
  /** Validated context values, incl. 'apparaat' and 'functionele_route'. */
  readonly context: Readonly<Record<string, string>>;
  /** Provenance per context key: 'expliciet' | 'afgeleid' | 'medewerker-antwoord'. */
  readonly provenance: Readonly<Record<string, string>>;
  /** Required fields with an accepted explicit unknown (P-02/I-15). */
  readonly unknownFields: readonly FactCategory[];
}

/** Logical question keys mapped onto their requirement field. */
const FIELD_TO_QUESTION_KEYS: Readonly<Partial<Record<FactCategory, readonly string[]>>> = {
  symptom: ['symptom_description'],
};

export function validatedFieldValue(
  context: ConversationContext,
  field: FactCategory,
): { readonly value: string; readonly provenance: string } | undefined {
  const fact = getFact(context, field);
  if (fact !== undefined) {
    return { value: fact.value, provenance: fact.kind === 'derived' ? 'afgeleid' : 'expliciet' };
  }
  const direct = getAnswerOutcome(context, field);
  if (direct !== undefined && direct.kind === 'concrete') {
    return { value: direct.value, provenance: 'medewerker-antwoord' };
  }
  for (const key of FIELD_TO_QUESTION_KEYS[field] ?? []) {
    const mapped = getAnswerOutcome(context, key);
    if (mapped !== undefined && mapped.kind === 'concrete') {
      return { value: mapped.value, provenance: 'medewerker-antwoord' };
    }
  }
  return undefined;
}

export function buildTicketContent(
  context: ConversationContext,
  category: IntakeType,
  route: string,
  validation: IntakeValidationResult,
): TicketContent {
  const subjectSource = validatedFieldValue(context, 'serviceOrApplication') ?? validatedFieldValue(context, 'device');
  const device = validatedFieldValue(context, 'device');
  const symptom = validatedFieldValue(context, 'symptom');
  const requestedResource = validatedFieldValue(context, 'requestedResource');
  const location = validatedFieldValue(context, 'location');
  const indicators = validatedFieldValue(context, 'securityIndicators');

  const summaryParts: string[] = [category];
  if (subjectSource !== undefined) {
    summaryParts.push(subjectSource.value);
  } else if (requestedResource !== undefined) {
    summaryParts.push(requestedResource.value);
  }
  if (symptom !== undefined) {
    summaryParts.push(symptom.value);
  }

  const ticketContext: Record<string, string> = {
    intent: context.intentClassification?.value ?? context.intent ?? 'unknown',
  };
  const provenance: Record<string, string> = {};
  const put = (key: string, source: { value: string; provenance: string } | undefined): void => {
    if (source !== undefined) {
      ticketContext[key] = source.value;
      provenance[key] = source.provenance;
    }
  };
  put('onderwerp', subjectSource);
  put('apparaat', device);
  put('symptoom', symptom);
  put('aanvraag', requestedResource);
  put('locatie', location);
  put('beveiligingsindicatoren', indicators);
  ticketContext['functionele_route'] = route;

  return {
    category,
    route,
    summary: summaryParts.join(' — '),
    description: 'Vastgelegd door Elvie op basis van bekende gespreksfeiten (simulatie).',
    context: ticketContext,
    provenance,
    unknownFields: validation.unknownFields,
  };
}

export function buildDraftFromContent(content: TicketContent, key: SubmissionKey): TicketDraft {
  return {
    category: content.category,
    summary: content.summary,
    description: content.description,
    context: { ...content.context },
    submissionKey: key,
  };
}
