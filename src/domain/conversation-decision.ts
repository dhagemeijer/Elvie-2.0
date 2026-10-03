/**
 * Typed deterministic ConversationDecision (BUILD_02.md par. 6).
 *
 * This is NOT an alternative state machine: the Build 01 ConversationState
 * lifecycle remains authoritative. A decision only describes what
 * information/action is appropriate within the current state; state
 * transitions happen exclusively via the existing state machine.
 */
import type { ConversationContext } from './conversation-context';
import { getFact } from './conversation-context';
import type { Ambiguity } from './fact-extraction';
import type { FactCategory } from './facts';
import type { MissingInformationCalculation } from './requirements';

export type ConversationDecision =
  | { readonly kind: 'sufficient_understanding' }
  | {
      readonly kind: 'missing_information';
      readonly missingFacts: readonly FactCategory[];
      readonly nextQuestion: { readonly category: FactCategory; readonly text: string };
    }
  | { readonly kind: 'clarification_required'; readonly fact: FactCategory; readonly reason: string; readonly text: string }
  | { readonly kind: 'security_sensitive_route'; readonly indicators: readonly string[] }
  | { readonly kind: 'unknown_understanding'; readonly text: string };

/**
 * Deterministic Dutch question templates per fact category. Used only for
 * genuinely missing facts: a category with a reliable known fact is never
 * asked again (see requirements.ts).
 */
export const FACT_QUESTIONS: Readonly<Record<FactCategory, string>> = {
  symptom: 'Wat gebeurt er precies?',
  serviceOrApplication: 'Om welke applicatie of dienst gaat het?',
  device: 'Op welk apparaat gebeurt dit (bijvoorbeeld laptop, telefoon of printer)?',
  requestedResource: 'Wat wil je precies aanvragen?',
  securityIndicators: 'Kun je vertellen wat er precies gebeurd is?',
  startTime: 'Sinds wanneer speelt dit?',
  location: 'Op welke locatie ben je op dit moment?',
  impact: 'Wat kun je daardoor niet doen?',
  urgency: 'Is dit urgent, of kan het wachten?',
  affectedUsers: 'Hebben meer collega\u2019s hier last van?',
  attemptedSolutions: 'Wat heb je al geprobeerd?',
};

const UNKNOWN_UNDERSTANDING_TEXT =
  'Ik begrijp nog niet precies waar ik je mee kan helpen. Kun je je probleem of vraag kort beschrijven?';

function activeIndicators(context: ConversationContext): readonly string[] {
  const value = getFact(context, 'securityIndicators')?.value;
  if (value === undefined || value.length === 0) {
    return [];
  }
  return value.split(', ');
}

/**
 * Decide, deterministically, what the Conversation Core recommends next.
 * Evaluation order: unknown intent -> genuine ambiguity on a required fact ->
 * missing information -> security-sensitive route -> sufficient understanding.
 */
export function decide(
  context: ConversationContext,
  calculation: MissingInformationCalculation,
  ambiguities: readonly Ambiguity[],
): ConversationDecision {
  const intent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  if (intent === 'unknown') {
    return { kind: 'unknown_understanding', text: UNKNOWN_UNDERSTANDING_TEXT };
  }

  // Genuine ambiguity for a fact the active rules actually require.
  const ambiguousRequired = ambiguities.find((ambiguity) => calculation.required.includes(ambiguity.category));
  if (ambiguousRequired !== undefined) {
    return {
      kind: 'clarification_required',
      fact: ambiguousRequired.category,
      reason: 'multiple_values_supplied',
      text:
        'Je noemt meerdere mogelijkheden. ' +
        FACT_QUESTIONS[ambiguousRequired.category] +
        ' Geef er graag precies een aan.',
    };
  }

  if (calculation.missing.length > 0) {
    const category = calculation.missing[0];
    if (category !== undefined) {
      return {
        kind: 'missing_information',
        missingFacts: calculation.missing,
        nextQuestion: { category, text: FACT_QUESTIONS[category] },
      };
    }
  }

  const indicators = activeIndicators(context);
  if (intent === 'phishing' || indicators.length > 0) {
    return { kind: 'security_sensitive_route', indicators };
  }

  return { kind: 'sufficient_understanding' };
}
