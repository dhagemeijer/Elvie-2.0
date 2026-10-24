import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, setFactRecord } from '../src/domain/conversation-context';
import { processEmployeeMessage } from '../src/domain/conversation-core';
import {
  canAskRoutingClarification,
  computeRouting,
  deriveEffectiveCategory,
  isRoutingEvidenceCurrent,
  routingMaterialFingerprint,
  type RoutingClarificationBookkeeping,
  type RoutingResult,
} from '../src/domain/routing';

function newContext(): ConversationContext {
  return createConversationContext('session-routing-test', '2026-10-24T12:00:00.000Z');
}

/** The engine owns the logical turn counter; tests simulate its increment. */
function turn(context: ConversationContext, input: string): RoutingResult {
  context.currentTurn += 1;
  processEmployeeMessage(context, input);
  return computeRouting(context, { rawInput: input });
}

describe('BUILD 04A — effective ticket category (security-first, no guesses)', () => {
  it('derives security from a phishing report before anything else', () => {
    const context = newContext();
    turn(context, 'Ik heb een verdachte mail gekregen.');
    expect(deriveEffectiveCategory(context)).toBe('security');
  });

  it('derives incident and request from the effective intent', () => {
    const incident = newContext();
    turn(incident, 'Mijn Outlook doet het niet.');
    expect(deriveEffectiveCategory(incident)).toBe('incident');

    const request = newContext();
    turn(request, 'Ik wil een nieuwe muis.');
    expect(deriveEffectiveCategory(request)).toBe('request');
  });

  it('keeps an unknown intent unresolved instead of inventing a category (R-07)', () => {
    const context = newContext();
    turn(context, 'Kun je me helpen?');
    expect(deriveEffectiveCategory(context)).toBe('unresolved');
  });
});

describe('BUILD 04A — routing acceptance matrix R-01..R-10', () => {
  it('R-01: identical facts and rules produce an identical route and explanation codes', () => {
    const input = 'Ik kan niet inloggen op mijn account.';
    const results: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const context = newContext();
      const result = turn(context, input);
      results.push(JSON.stringify(result));
    }
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  it('R-02: laptop login blocked routes to access, not workplace', () => {
    const context = newContext();
    const result = turn(context, 'Ik kan niet inloggen op mijn laptop.');
    expect(result).toMatchObject({ status: 'determined', category: 'incident', route: 'access' });
    if (result.status === 'determined') {
      expect(result.ruleIds).toContain('R-ACCESS-LOGIN');
      expect(result.evidenceRefs.length).toBeGreaterThan(0);
    }
  });

  it('R-03: a laptop that will not power on routes to workplace', () => {
    const context = newContext();
    const result = turn(context, 'Mijn laptop gaat niet aan.');
    expect(result).toMatchObject({ status: 'determined', category: 'incident', route: 'workplace' });
  });

  it('R-04: a materially ambiguous issue yields exactly one targeted clarification', () => {
    const context = newContext();
    const result = turn(context, 'Mijn Outlook doet het niet.');
    expect(result).toMatchObject({
      status: 'clarification_required',
      category: 'incident',
      questionCode: 'routing_app_or_communication',
      ambiguityCode: 'application_or_communication',
    });
  });

  it('R-05: an unresolved clarification falls back to a safe unknown route', () => {
    const context = newContext();
    turn(context, 'Mijn Outlook doet het niet.');
    // The clarification was asked; record its one-question budget.
    const bookkeeping: RoutingClarificationBookkeeping = {
      questionCode: 'routing_app_or_communication',
      materialFingerprint: routingMaterialFingerprint(context),
    };
    // The answer adds no material routing evidence.
    const afterBudget = computeRouting(context, { rawInput: 'weet niet', clarification: bookkeeping });
    expect(afterBudget).toMatchObject({ status: 'unknown', reasonCode: 'clarification_budget_exhausted' });
  });

  it('R-06: a security signal with an ordinary subject stays on the security path', () => {
    const context = newContext();
    // Fixture phrasing follows the approved Build 02 security catalog (sec_link_clicked).
    const result = turn(context, 'Ik heb op een link geklikt en mijn Outlook doet het niet.');
    expect(result).toMatchObject({ status: 'determined', category: 'security', route: 'security' });
    if (result.status === 'determined') {
      expect(result.ruleIds).toEqual(['R-SEC-INDICATORS']);
    }
  });

  it('R-07: an unknown ticket intent never invents a category or route', () => {
    const context = newContext();
    const result = turn(context, 'Kun je me helpen?');
    expect(result).toEqual({
      status: 'unknown',
      category: 'unresolved',
      route: 'unknown',
      reasonCode: 'category_unresolved',
    });
  });

  it('R-08: an explicit correction recalculates the route and updates the evidence', () => {
    const context = newContext();
    const before = turn(context, 'Mijn laptop doet het niet.');
    expect(before).toMatchObject({ status: 'determined', route: 'workplace' });

    const after = turn(context, 'Sorry, het is geen laptopprobleem, ik kan niet bij mijn account.');
    expect(after).toMatchObject({ status: 'determined', route: 'access' });
    if (after.status === 'determined') {
      const accountRef = after.evidenceRefs.find((ref) => ref.category === 'serviceOrApplication');
      if (accountRef !== undefined) {
        expect(accountRef.capturedAtTurn).toBe(2);
        expect(isRoutingEvidenceCurrent(context, accountRef)).toBe(true);
      }
      for (const ref of after.evidenceRefs) {
        expect(isRoutingEvidenceCurrent(context, ref)).toBe(true);
      }
    }
  });

  it('R-09: routing never invents TOPdesk groups, categories or priorities', () => {
    const context = newContext();
    const result = turn(context, 'Ik kan niet inloggen op mijn account.');
    expect(result.status).toBe('determined');
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('topdesk');
    expect(serialized).not.toContain('operator');
    expect(serialized).not.toContain('groep');
    if (result.status === 'determined') {
      // Lexicographic sort: 'route' sorts before 'ruleIds'.
      expect(Object.keys(result).sort()).toEqual(['category', 'evidenceRefs', 'route', 'ruleIds', 'status']);
    }
  });

  it('R-10: a repeated answer without material evidence never re-asks the routing question', () => {
    const context = newContext();
    turn(context, 'Mijn Outlook doet het niet.');
    const bookkeeping: RoutingClarificationBookkeeping = {
      questionCode: 'routing_app_or_communication',
      materialFingerprint: routingMaterialFingerprint(context),
    };
    expect(canAskRoutingClarification(bookkeeping, context)).toBe(false);
    // Repeating the same non-distinguishing answer changes nothing material.
    turn(context, 'geen idee');
    const stillBudgeted = computeRouting(context, { rawInput: 'geen idee', clarification: bookkeeping });
    expect(stillBudgeted).toMatchObject({ status: 'unknown', reasonCode: 'clarification_budget_exhausted' });
  });
});

describe('BUILD 04A — normative fixtures F-01, F-02, F-03, F-08', () => {
  it('F-01: account-login phrasing routes to access (04A recognition-rule extension)', () => {
    const context = newContext();
    const result = turn(context, 'Ik kan niet inloggen op mijn account.');
    expect(result).toMatchObject({ status: 'determined', category: 'incident', route: 'access' });
    if (result.status === 'determined') {
      expect(result.ruleIds).toContain('R-ACCESS-LOGIN');
    }
  });

  it('F-01 security screening: a suspicious link with login trouble stays security', () => {
    const context = newContext();
    const result = turn(context, 'Ik heb op een link geklikt en kan niet inloggen op mijn account.');
    expect(result).toMatchObject({ status: 'determined', category: 'security', route: 'security' });
  });

  it('F-02: a laptop power issue is a workplace candidate once the category is classified', () => {
    const unresolved = newContext();
    const result = turn(unresolved, 'Mijn laptop start niet.');
    // "start niet" alone does not classify an incident yet: no invented category.
    expect(result).toMatchObject({ status: 'unknown', category: 'unresolved', reasonCode: 'category_unresolved' });

    const classified = newContext();
    const withSymptom = turn(classified, 'Mijn laptop start niet en doet niets.');
    expect(withSymptom).toMatchObject({ status: 'determined', category: 'incident', route: 'workplace' });
  });

  it('F-03: an unknowable cause yields no invented functional route', () => {
    const context = newContext();
    const result = turn(context, 'Ik weet niet waar het aan ligt.');
    expect(result).toMatchObject({
      status: 'unknown',
      category: 'unresolved',
      route: 'unknown',
      reasonCode: 'category_unresolved',
    });
  });

  it('F-08: correcting the subject to an account problem re-evaluates the route to access', () => {
    const context = newContext();
    turn(context, 'Mijn laptop doet het niet.');
    const result = turn(context, 'Het is geen laptopprobleem, ik kan niet bij mijn account.');
    expect(result).toMatchObject({ status: 'determined', route: 'access' });
  });
});

describe('BUILD 04A — route catalogue guardrails', () => {
  it('routes a failing printer to workplace (what is failing wins)', () => {
    const context = newContext();
    const result = turn(context, 'De printer doet het niet.');
    expect(result).toMatchObject({ status: 'determined', route: 'workplace' });
  });

  it('routes an explicit wifi/network failure to connectivity', () => {
    const context = newContext();
    const input = 'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.';
    const result = turn(context, input);
    expect(result).toMatchObject({ status: 'determined', route: 'connectivity' });
    if (result.status === 'determined') {
      expect(result.ruleIds).toEqual(['R-CONNECTIVITY-NETWORK']);
    }
  });

  it('does not treat a generic service-unreachable report as connectivity without network evidence', () => {
    const context = newContext();
    const result = turn(context, 'Mijn Outlook maakt geen verbinding.');
    expect(result.status).not.toBe('determined');
    expect(result.route).toBe('unknown');
  });

  it('does not derive a route from an application mention alone', () => {
    const context = newContext();
    const result = turn(context, 'wachtwoord vergeten');
    expect(result).toMatchObject({ status: 'unknown', route: 'unknown' });
  });

  it('never routes on a device mention alone (workplace needs failure evidence)', () => {
    const context = newContext();
    const result = turn(context, 'Ik heb een vraag over mijn laptop.');
    expect(result).toMatchObject({ status: 'unknown', route: 'unknown' });
  });

  it('recognizes the 04A power-failure phrase as workplace evidence with a device fact', () => {
    const context = newContext();
    context.currentTurn = 1;
    context.intentClassification = { value: 'incident', confidence: 'high', evidence: [] };
    context.intent = 'incident';
    setFactRecord(context, 'device', { value: 'laptop', kind: 'explicit', capturedAtTurn: 1 });
    const result = computeRouting(context, { rawInput: 'hij start niet' });
    expect(result).toMatchObject({ status: 'determined', route: 'workplace' });
    if (result.status === 'determined') {
      expect(result.ruleIds).toEqual(['R-WORKPLACE-POWER']);
    }
  });
});

describe('BUILD 04A — evidence and clarification bookkeeping', () => {
  it('rejects stale evidence references against the currently active fact', () => {
    const context = newContext();
    turn(context, 'Mijn laptop doet het niet.');
    const deviceFact = context.facts['device'];
    expect(deviceFact).toBeDefined();
    if (deviceFact !== undefined) {
      expect(isRoutingEvidenceCurrent(context, { category: 'device', capturedAtTurn: deviceFact.capturedAtTurn })).toBe(true);
      expect(isRoutingEvidenceCurrent(context, { category: 'device', capturedAtTurn: 99 })).toBe(false);
    }
  });

  it('resets the clarification budget only after a material change', () => {
    const context = newContext();
    turn(context, 'Mijn Outlook doet het niet.');
    const fingerprintBefore = routingMaterialFingerprint(context);
    const bookkeeping: RoutingClarificationBookkeeping = {
      questionCode: 'routing_app_or_communication',
      materialFingerprint: fingerprintBefore,
    };
    expect(canAskRoutingClarification(bookkeeping, context)).toBe(false);

    // A material correction changes the fingerprint and resets the budget.
    turn(context, 'Sorry, het is mijn Account, ik kan er niet bij.');
    expect(routingMaterialFingerprint(context)).not.toBe(fingerprintBefore);
    expect(canAskRoutingClarification(bookkeeping, context)).toBe(true);
  });

  it('produces identical fingerprints for identical material situations', () => {
    const a = newContext();
    turn(a, 'Mijn Outlook doet het niet.');
    const b = newContext();
    turn(b, 'Mijn Outlook doet het niet.');
    expect(routingMaterialFingerprint(a)).toBe(routingMaterialFingerprint(b));
  });
});
