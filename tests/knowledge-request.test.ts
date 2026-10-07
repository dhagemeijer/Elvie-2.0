import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/domain/conversation-context';
import { createConversationContext, recordAnswer, setFactRecord } from '../src/domain/conversation-context';
import type { FactCategory, FactRecord } from '../src/domain/facts';
import type { KnowledgeSearchQuery } from '../src/ports/knowledge';
import { ALLOWED_QUERY_SYMPTOMS, buildKnowledgeQuery } from '../src/domain/knowledge-request';

function newContext(): ConversationContext {
  return createConversationContext('session-kr', '2026-10-07T09:00:00.000Z');
}

function setExplicit(context: ConversationContext, category: FactCategory, value: string): void {
  const record: FactRecord = { value, kind: 'explicit', capturedAtTurn: 1 };
  setFactRecord(context, category, record);
}

function setDerivedSymptom(context: ConversationContext, value: string): void {
  const record: FactRecord = {
    value,
    kind: 'derived',
    confidence: 'medium',
    sourceRuleId: 'symptom_no_connection',
    evidence: ['geen verbinding'],
    capturedAtTurn: 1,
  };
  setFactRecord(context, 'symptom', record);
}

describe('knowledge query construction (BUILD_03.md par. 6)', () => {
  it('builds an allowlist-only query from structured facts', () => {
    const context = newContext();
    context.intent = 'incident';
    setExplicit(context, 'device', 'laptop');
    setDerivedSymptom(context, 'no_connection');
    const query = buildKnowledgeQuery(context);
    expect(query.intent).toBe('incident');
    expect(query.subject).toBe('laptop');
    expect(query.symptom).toBe('no_connection');
    expect(query.requestedResource).toBeUndefined();
    expect(query.keywords).toEqual(['laptop']);
  });

  it('includes the requested resource for requests', () => {
    const context = newContext();
    context.intent = 'request';
    setExplicit(context, 'requestedResource', 'Mailbox');
    const query = buildKnowledgeQuery(context);
    expect(query.intent).toBe('request');
    expect(query.requestedResource).toBe('Mailbox');
    expect(query.keywords).toEqual(['Mailbox']);
  });

  it('allows exactly the controlled Build 02 symptom values', () => {
    expect(ALLOWED_QUERY_SYMPTOMS).toEqual(['not_working', 'no_connection', 'unavailable', 'erratic_behavior']);
  });

  it('drops symptom values that are not on the allowlist', () => {
    const context = newContext();
    context.intent = 'incident';
    setDerivedSymptom(context, 'iets_heel_anders');
    const query = buildKnowledgeQuery(context);
    expect(query.symptom).toBeUndefined();
  });

  it('drops manipulative or non-allowlisted subject values', () => {
    const context = newContext();
    context.intent = 'incident';
    setExplicit(context, 'serviceOrApplication', "Outlook'); DROP TABLE knowledge; --");
    const query = buildKnowledgeQuery(context);
    expect(query.subject).toBeUndefined();
    expect(query.keywords).toEqual([]);
    expect(JSON.stringify(query)).not.toContain('DROP TABLE');
  });

  it('never forwards raw employee input or recorded answers', () => {
    const context = newContext();
    context.intent = 'unknown';
    recordAnswer(context, 'initial_question', 'mijn laptop doet raar bij de VPN van kantoor 12');
    recordAnswer(context, 'symptom_description', 'geen verbinding sinds vanochtend thuis');
    const query = buildKnowledgeQuery(context);
    const serialized = JSON.stringify(query);
    expect(query.subject).toBeUndefined();
    expect(query.symptom).toBeUndefined();
    expect(query.keywords).toEqual([]);
    expect(serialized).not.toContain('laptop');
    expect(serialized).not.toContain('VPN');
    expect(serialized).not.toContain('kantoor');
  });

  it('omits facts with employee-authored wording that are not query fields', () => {
    const context = newContext();
    context.intent = 'incident';
    setExplicit(context, 'device', 'laptop');
    setExplicit(context, 'location', 'thuis, achterhaalstraat 12');
    const query = buildKnowledgeQuery(context);
    expect(JSON.stringify(query)).not.toContain('achterhaalstraat');
  });

  it('is deterministic: the same context produces the same query', () => {
    const build = (): KnowledgeSearchQuery => {
      const context = newContext();
      context.intent = 'incident';
      setExplicit(context, 'device', 'laptop');
      setDerivedSymptom(context, 'no_connection');
      return buildKnowledgeQuery(context);
    };
    expect(build()).toEqual(build());
  });
});
