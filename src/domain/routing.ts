/**
 * ELVIE 2.0 — BUILD 04A — Functional routing domain
 * (BUILD_04_v1.2.1 §5, §15.1, §16).
 *
 * Deterministic, TOPdesk-independent classification of a conversation into
 * an internal functional route. This module NEVER changes conversation
 * state: the Build 01 lifecycle and the Build 02/03 decision flow stay
 * authoritative. The route is an internal aid for later intake/preview
 * builds (04B/04C); in 04A the engine only computes and exposes it.
 *
 * Normative decisions implemented here:
 * - Security-first (§15.1): active security indicators or an effective
 *   `phishing` intent force the safe `security` path; an ordinary subject
 *   never downgrades a security-sensitive case (R-06).
 * - One effective ticket category, derived once by this module; an unknown
 *   intent never becomes a guessed category (R-07).
 * - Route rules evaluate CURRENT validated facts, prioritizing what is
 *   failing over incidental device or product mentions (§5.2.4); route-level
 *   recognition phrases are the versioned 04A rule catalogue (§16), never a
 *   guessed TOPdesk group (R-09).
 * - At most ONE targeted routing clarification per unchanged material
 *   situation; an answer that adds no material evidence never resets the
 *   budget (R-04/R-05/R-10, §15.3).
 * - Evidence references are composite (FactCategory, capturedAtTurn,
 *   optional sourceRuleId) and are checked against the currently active
 *   fact record; stale references never count (§5.3, D04-14).
 */
import type { ConversationContext } from './conversation-context';
import { getFact } from './conversation-context';
import type { FactCategory } from './facts';
import { normalizeInput } from './normalisation';

/** Internal functional routes (§5.1); never a TOPdesk group or category. */
export type FunctionalRoute =
  | 'workplace'
  | 'application'
  | 'access'
  | 'connectivity'
  | 'communication'
  | 'security'
  | 'unknown';

/** Internal ticket category (§4); distinct from the Build 02 intent. */
export type TicketCategory = 'incident' | 'request' | 'security';

/**
 * Composite routing evidence reference (§5.3, D04-14): identifies the
 * currently active fact record by category + logical capture turn, plus the
 * optional concluding rule. No new fact id is introduced.
 */
export interface RoutingEvidenceRef {
  readonly category: FactCategory;
  readonly capturedAtTurn: number;
  readonly sourceRuleId?: string;
}

/**
 * Deterministic routing outcome (§5.3, behavioral sketch made concrete).
 * The `unknown` variant may carry category 'unresolved': when no ticket
 * category could be derived, no category is invented (R-07).
 */
export type RoutingResult =
  | {
      readonly status: 'determined';
      readonly category: TicketCategory;
      readonly route: Exclude<FunctionalRoute, 'unknown'>;
      readonly ruleIds: readonly string[];
      readonly evidenceRefs: readonly RoutingEvidenceRef[];
    }
  | {
      readonly status: 'clarification_required';
      readonly category: TicketCategory;
      readonly route: 'unknown';
      readonly questionCode: string;
      readonly ambiguityCode: string;
    }
  | {
      readonly status: 'unknown';
      readonly category: TicketCategory | 'unresolved';
      readonly route: 'unknown';
      readonly reasonCode: 'category_unresolved' | 'insufficient_routing_evidence' | 'clarification_budget_exhausted';
    };

/**
 * Route-level recognition phrases (04A rule catalogue, §16). These extend
 * the baseline recognition ONLY at routing level: the shared Build 02
 * symptom/intent rules are deliberately untouched so baseline behavior and
 * tests remain unchanged. F-01 requires the account-login phrasing to be
 * recognized as access evidence.
 */
export interface RoutingPhraseRule {
  readonly ruleId: string;
  readonly pattern: RegExp;
}

export const ROUTING_PHRASE_RULES: readonly RoutingPhraseRule[] = [
  // F-01 recognition-rule extension: account/login phrasing as access evidence.
  { ruleId: 'route_login_blocked', pattern: /\bkan niet inloggen\b|\bkan niet bij\b|\binloggen lukt niet\b|\bniet meer in\b/ },
  // Power/start-up failure phrasing as workplace evidence (device required).
  { ruleId: 'route_power_failure', pattern: /\bstart niet\b|\bgaat niet aan\b|\bzet niet aan\b|\bstart niet op\b/ },
  // Explicit network vocabulary supporting the connectivity route.
  { ruleId: 'route_network_failure', pattern: /\bwifi\b|\bnetwerk\b|\bvpn\b/ },
];

/**
 * Fictional catalogue values treated as communication services (§5.1).
 * A malfunction of one of these is genuinely ambiguous between the
 * communication service and the application itself, which is exactly the
 * §5.1 guardrail case resolved by one targeted clarification (R-04).
 */
const COMMUNICATION_APPLICATIONS: readonly string[] = ['Outlook', 'Teams', 'Mailbox'];

/** Stable route rule identifiers (versioned with this catalogue, §16). */
export const ROUTE_RULE_IDS = {
  securityIndicators: 'R-SEC-INDICATORS',
  accessLogin: 'R-ACCESS-LOGIN',
  connectivityNetwork: 'R-CONNECTIVITY-NETWORK',
  applicationMalfunction: 'R-APPLICATION-MALFUNCTION',
  workplacePower: 'R-WORKPLACE-POWER',
  workplaceHardware: 'R-WORKPLACE-HARDWARE',
} as const;

/** Controlled clarification question codes and their distinguishing questions (§5.2.6). */
export const ROUTING_CLARIFICATION_QUESTIONS: Readonly<Record<string, string>> = {
  routing_app_or_communication:
    "Geeft de applicatie zelf een foutmelding of crasht hij, of lukt het versturen of bereiken van berichten niet? Antwoord met 'applicatie' of 'berichten'.",
};

/**
 * One-question-per-unchanged-situation bookkeeping (§5.2.7, §15.3). The
 * material fingerprint is a canonical projection of the routing-relevant
 * context state; recording a clarification question itself never changes it.
 */
export interface RoutingClarificationBookkeeping {
  readonly questionCode?: string;
  readonly materialFingerprint: string;
}

/** Canonical projection of routing-relevant context state (§15.3). */
export function routingMaterialFingerprint(context: ConversationContext): string {
  const app = getFact(context, 'serviceOrApplication')?.value ?? '-';
  const device = getFact(context, 'device')?.value ?? '-';
  const symptom = getFact(context, 'symptom')?.value ?? '-';
  const indicators = getFact(context, 'securityIndicators')?.value ?? '-';
  const intent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  return [intent, app, device, symptom, indicators].join('|');
}

/** True when a routing clarification may be asked for the current situation. */
export function canAskRoutingClarification(
  bookkeeping: RoutingClarificationBookkeeping,
  context: ConversationContext,
): boolean {
  if (bookkeeping.questionCode === undefined) {
    return true;
  }
  return bookkeeping.materialFingerprint !== routingMaterialFingerprint(context);
}

/**
 * Evidence staleness check (§5.3): a reference only counts as current when
 * the category has an active fact record captured at the same logical turn.
 */
export function isRoutingEvidenceCurrent(context: ConversationContext, ref: RoutingEvidenceRef): boolean {
  const record = getFact(context, ref.category);
  return record !== undefined && record.capturedAtTurn === ref.capturedAtTurn;
}

/**
 * Effective ticket category, derived ONCE and security-first (§15.1):
 * 1. active security indicators or an effective `phishing` intent => security;
 * 2. otherwise incident/request follow the effective intent;
 * 3. an unknown intent stays unresolved: no guessed category (R-07).
 * Declassification of a security case is out of 04A scope and never happens
 * on a single negating phrase; conservative security handling wins.
 */
export function deriveEffectiveCategory(context: ConversationContext): TicketCategory | 'unresolved' {
  const indicators = getFact(context, 'securityIndicators');
  const effectiveIntent = context.intentClassification?.value ?? context.intent ?? 'unknown';
  if (effectiveIntent === 'phishing' || (indicators !== undefined && indicators.value.length > 0)) {
    return 'security';
  }
  if (effectiveIntent === 'incident') {
    return 'incident';
  }
  if (effectiveIntent === 'request') {
    return 'request';
  }
  return 'unresolved';
}

export interface RoutingOptions {
  /**
   * Raw employee input of the turn being processed (optional). Used ONLY
   * for the route-level 04A recognition phrases after deterministic
   * normalisation; route rules otherwise evaluate validated facts (§5.2.4).
   */
  readonly rawInput?: string;
  /** One-question budget bookkeeping; omit when no clarification was asked yet. */
  readonly clarification?: RoutingClarificationBookkeeping;
}

function factRef(context: ConversationContext, category: FactCategory, sourceRuleId?: string): RoutingEvidenceRef | undefined {
  const record = getFact(context, category);
  if (record === undefined) {
    return undefined;
  }
  return { category, capturedAtTurn: record.capturedAtTurn, sourceRuleId };
}

function matchedPhrase(normalizedInput: string | undefined, ruleId: string): boolean {
  if (normalizedInput === undefined) {
    return false;
  }
  const rule = ROUTING_PHRASE_RULES.find((candidate) => candidate.ruleId === ruleId);
  return rule !== undefined && rule.pattern.test(normalizedInput);
}

/**
 * Compute the functional routing for the current context, deterministically:
 * identical context, input and rule catalogue produce an identical result
 * (R-01). Never mutates the context and never touches conversation state.
 */
export function computeRouting(context: ConversationContext, options: RoutingOptions = {}): RoutingResult {
  const category = deriveEffectiveCategory(context);

  // §15.1.3: an unresolved category never becomes a guessed one. Routing is
  // not attempted until the category is derived (R-07, F-02/F-03).
  if (category === 'unresolved') {
    return { status: 'unknown', category: 'unresolved', route: 'unknown', reasonCode: 'category_unresolved' };
  }

  const appFact = getFact(context, 'serviceOrApplication');
  const deviceFact = getFact(context, 'device');
  const symptomFact = getFact(context, 'symptom');
  const normalizedInput = options.rawInput === undefined ? undefined : normalizeInput(options.rawInput);

  // 1. Security-first (§15.1.2, §5.2.1): a security-sensitive case stays on
  // the safe security path even when its ordinary subject is unclear (R-06).
  if (category === 'security') {
    const refs: RoutingEvidenceRef[] = [];
    const indicatorRef = factRef(context, 'securityIndicators');
    if (indicatorRef !== undefined) {
      refs.push(indicatorRef);
    }
    return {
      status: 'determined',
      category: 'security',
      route: 'security',
      ruleIds: [ROUTE_RULE_IDS.securityIndicators],
      evidenceRefs: refs,
    };
  }

  const loginEvidence =
    matchedPhrase(normalizedInput, 'route_login_blocked') || symptomFact?.sourceRuleId === 'symptom_login_block';

  // 2. Access (R-02, F-01): login/account evidence wins over incidental
  // device mentions ("laptop login blocked" is access, not workplace).
  if (loginEvidence && (appFact !== undefined || deviceFact !== undefined)) {
    const refs: RoutingEvidenceRef[] = [];
    const symptomRef = factRef(context, 'symptom', symptomFact?.sourceRuleId);
    if (symptomRef !== undefined) {
      refs.push(symptomRef);
    }
    const subjectRef = factRef(context, appFact !== undefined ? 'serviceOrApplication' : 'device');
    if (subjectRef !== undefined) {
      refs.push(subjectRef);
    }
    return {
      status: 'determined',
      category,
      route: 'access',
      ruleIds: [ROUTE_RULE_IDS.accessLogin],
      evidenceRefs: refs,
    };
  }

  // 3. Connectivity (§5.1 guardrail): a generic "cannot reach a service" is
  // only network-related with concrete network evidence (no-connection
  // symptom plus a device or explicit network vocabulary).
  const networkEvidence =
    symptomFact?.sourceRuleId === 'symptom_no_connection' &&
    (deviceFact !== undefined || matchedPhrase(normalizedInput, 'route_network_failure'));
  if (networkEvidence) {
    const refs: RoutingEvidenceRef[] = [];
    const symptomRef = factRef(context, 'symptom', 'symptom_no_connection');
    if (symptomRef !== undefined) {
      refs.push(symptomRef);
    }
    return {
      status: 'determined',
      category,
      route: 'connectivity',
      ruleIds: [ROUTE_RULE_IDS.connectivityNetwork],
      evidenceRefs: refs,
    };
  }

  // 4. Application vs communication (§5.1 guardrail): a malfunction of a
  // communication service may instead be an application issue. Material
  // competing routes yield ONE targeted clarification (R-04), then a safe
  // unknown fallback once the budget for this situation is spent (R-05/R-10).
  if (appFact !== undefined && symptomFact !== undefined) {
    if (COMMUNICATION_APPLICATIONS.includes(appFact.value)) {
      if (options.clarification !== undefined && !canAskRoutingClarification(options.clarification, context)) {
        return {
          status: 'unknown',
          category,
          route: 'unknown',
          reasonCode: 'clarification_budget_exhausted',
        };
      }
      return {
        status: 'clarification_required',
        category,
        route: 'unknown',
        questionCode: 'routing_app_or_communication',
        ambiguityCode: 'application_or_communication',
      };
    }
    const refs: RoutingEvidenceRef[] = [];
    const appRef = factRef(context, 'serviceOrApplication');
    if (appRef !== undefined) {
      refs.push(appRef);
    }
    const symptomRef = factRef(context, 'symptom', symptomFact.sourceRuleId);
    if (symptomRef !== undefined) {
      refs.push(symptomRef);
    }
    return {
      status: 'determined',
      category,
      route: 'application',
      ruleIds: [ROUTE_RULE_IDS.applicationMalfunction],
      evidenceRefs: refs,
    };
  }

  // 5. Workplace (R-03, F-02): the device itself is failing. A device
  // mention alone is never sufficient (§5.1 guardrail): hardware-failure
  // evidence (a symptom or the 04A power phrase) is required.
  const powerFailureCandidate = matchedPhrase(normalizedInput, 'route_power_failure');
  if (deviceFact !== undefined && appFact === undefined && (symptomFact !== undefined || powerFailureCandidate)) {
    const powerFailure = powerFailureCandidate && symptomFact === undefined;
    const refs: RoutingEvidenceRef[] = [];
    const deviceRef = factRef(context, 'device');
    if (deviceRef !== undefined) {
      refs.push(deviceRef);
    }
    const symptomRef = symptomFact === undefined ? undefined : factRef(context, 'symptom', symptomFact.sourceRuleId);
    if (symptomRef !== undefined) {
      refs.push(symptomRef);
    }
    return {
      status: 'determined',
      category,
      route: 'workplace',
      ruleIds: [powerFailure ? ROUTE_RULE_IDS.workplacePower : ROUTE_RULE_IDS.workplaceHardware],
      evidenceRefs: refs,
    };
  }

  // 6. Safe fallback (F-03): no invented route, no guessed TOPdesk group (R-09).
  return { status: 'unknown', category, route: 'unknown', reasonCode: 'insufficient_routing_evidence' };
}
