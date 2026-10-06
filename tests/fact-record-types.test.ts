import { describe, expectTypeOf, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, setFactRecord } from '../src/domain/conversation-context';
import type {
  DerivedFactRecord,
  ExplicitFactRecord,
  FactRecord,
  QualitativeConfidence,
} from '../src/domain/facts';

/**
 * Compile-time regression coverage for the hardened FactRecord contract.
 * The @ts-expect-error directives make the TypeScript compiler the
 * acceptance gate: if a derived record without confidence (or an explicit
 * record with inferred confidence) ever compiles again, typecheck fails with
 * "Unused '@ts-expect-error' directive". Runtime behaviour is unchanged.
 */
describe('FactRecord compile-time contract (hardened domain types)', () => {
  it('is a discriminated union of exactly explicit and derived records', () => {
    expectTypeOf<FactRecord>().toEqualTypeOf<ExplicitFactRecord | DerivedFactRecord>();
    expectTypeOf<ExplicitFactRecord['kind']>().toEqualTypeOf<'explicit'>();
    expectTypeOf<DerivedFactRecord['kind']>().toEqualTypeOf<'derived'>();
  });

  it('requires confidence, sourceRuleId and evidence on derived records', () => {
    expectTypeOf<DerivedFactRecord['confidence']>().toEqualTypeOf<QualitativeConfidence>();
    expectTypeOf<DerivedFactRecord['sourceRuleId']>().toEqualTypeOf<string>();
    expectTypeOf<DerivedFactRecord['evidence']>().toEqualTypeOf<readonly string[]>();
  });

  it('rejects a derived record without confidence at compile time', () => {
    // @ts-expect-error derived facts must carry qualitative confidence
    const derivedNoConfidence: FactRecord = { kind: 'derived', value: 'not_working', sourceRuleId: 'symptom_not_working', evidence: ['doet het niet'], capturedAtTurn: 1 };
    expectTypeOf(derivedNoConfidence).not.toBeNever();
  });

  it('rejects a derived record without sourceRuleId and evidence at compile time', () => {
    // @ts-expect-error derived facts must carry sourceRuleId and evidence
    const derivedNoMetadata: FactRecord = { kind: 'derived', value: 'not_working', confidence: 'medium', capturedAtTurn: 1 };
    expectTypeOf(derivedNoMetadata).not.toBeNever();
  });

  it('rejects an explicit record with an inferred confidence at compile time', () => {
    // @ts-expect-error explicit facts never carry an inferred confidence
    const explicitWithConfidence: FactRecord = { kind: 'explicit', value: 'Outlook', confidence: 'high', capturedAtTurn: 1 };
    expectTypeOf(explicitWithConfidence).not.toBeNever();
  });

  it('still accepts representative explicit and derived records', () => {
    const context: ConversationContext = createConversationContext('session-types', '2026-10-06T12:00:00.000Z');
    setFactRecord(context, 'serviceOrApplication', { kind: 'explicit', value: 'Outlook', evidence: ['outlook'], capturedAtTurn: 1 });
    setFactRecord(context, 'symptom', {
      kind: 'derived',
      value: 'not_working',
      confidence: 'medium',
      sourceRuleId: 'symptom_not_working',
      evidence: ['doet het niet'],
      capturedAtTurn: 1,
    });
    expectTypeOf(context.facts.symptom).toEqualTypeOf<FactRecord | undefined>();
  });
});
