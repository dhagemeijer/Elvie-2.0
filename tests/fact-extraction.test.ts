import { describe, expect, it } from 'vitest';
import { extractFacts } from '../src/domain/fact-extraction';
import { normalizeInput } from '../src/domain/normalisation';
import { FICTIONAL_RECOGNITION_CATALOG } from '../src/domain/recognition-catalog';

function extract(raw: string, intent: 'incident' | 'request' | 'phishing' | 'unknown' = 'incident') {
  return extractFacts(normalizeInput(raw), FICTIONAL_RECOGNITION_CATALOG, 1, intent);
}

function factOf(result: ReturnType<typeof extract>, category: string) {
  return result.facts.find((f) => f.category === category)?.record;
}

describe('fact extraction (BUILD_02.md par. 2)', () => {
  it('extracts explicit application/device/startTime and a derived symptom with evidence', () => {
    const result = extract('Ik kan sinds vanmorgen op mijn laptop niet meer in Outlook.');
    expect(factOf(result, 'serviceOrApplication')).toEqual(
      expect.objectContaining({ value: 'Outlook', kind: 'explicit', capturedAtTurn: 1 }),
    );
    expect(factOf(result, 'device')).toEqual(
      expect.objectContaining({ value: 'laptop', kind: 'explicit' }),
    );
    expect(factOf(result, 'startTime')).toEqual(
      expect.objectContaining({ value: 'sinds vanmorgen', kind: 'explicit' }),
    );
    const symptom = factOf(result, 'symptom');
    expect(symptom).toEqual(
      expect.objectContaining({ value: 'unavailable', kind: 'derived', sourceRuleId: 'symptom_login_block' }),
    );
    expect(symptom?.evidence?.[0]).toBe('niet meer in');
  });

  it('does not extract Teams as the broken application when it is stated to be working', () => {
    const result = extract('Outlook werkt niet maar Teams wel.');
    expect(factOf(result, 'serviceOrApplication')?.value).toBe('Outlook');
  });

  it('recognizes a printer and a location/start-time/symptom in the wifi example', () => {
    const result = extract('Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.');
    expect(factOf(result, 'device')?.value).toBe('laptop');
    expect(factOf(result, 'location')?.value).toBe('op kantoor');
    expect(factOf(result, 'startTime')?.value).toBe('sinds vanochtend');
    expect(factOf(result, 'symptom')).toEqual(
      expect.objectContaining({ value: 'no_connection', kind: 'derived', sourceRuleId: 'symptom_no_connection' }),
    );
  });

  it('marks multi-device input as ambiguous and sets no device fact', () => {
    const result = extract('Het probleem speelt op mijn laptop en telefoon.');
    const ambiguity = result.ambiguities.find((a) => a.category === 'device');
    expect(ambiguity?.values).toEqual(['laptop', 'telefoon']);
    expect(factOf(result, 'device')).toBeUndefined();
  });

  it('extracts security indicators with safe rule-id evidence', () => {
    const result = extract('Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.', 'phishing');
    const indicators = factOf(result, 'securityIndicators');
    expect(indicators?.kind).toBe('derived');
    expect(indicators?.value).toContain('suspicious_link_clicked');
    expect(indicators?.value).toContain('credentials_entered_after_suspicious_link');
    expect(indicators?.evidence).toContain('sec_link_clicked');
    expect(indicators?.evidence).toContain('sec_credentials_entered');
  });

  it('does not extract subject facts for phishing intent (mail/wachtwoord mentions are not context)', () => {
    const result = extract('Ik heb op een link in een vreemde mail geklikt en daarna mijn wachtwoord ingevuld.', 'phishing');
    expect(factOf(result, 'serviceOrApplication')).toBeUndefined();
    expect(factOf(result, 'device')).toBeUndefined();
  });

  it('extracts the requested resource for requests, and leaves it unknown when nothing is recognized', () => {
    const muis = extract('Ik wil een nieuwe muis.', 'request');
    expect(factOf(muis, 'requestedResource')).toEqual(
      expect.objectContaining({ value: 'muis', kind: 'explicit' }),
    );
    const mailbox = extract('Kan ik toegang krijgen tot de gedeelde mailbox Financiën?', 'request');
    expect(factOf(mailbox, 'requestedResource')?.value).toBe('Mailbox');
    const software = extract('Ik wil graag software laten installeren.', 'request');
    expect(factOf(software, 'requestedResource')).toBeUndefined();
  });

  it('extracts impact, urgency, affected users and attempted solutions deterministically', () => {
    const result = extract(
      'Ik kan sinds vanochtend niet werken, collega’s hebben er ook last van, ik heb al een herstart geprobeerd en het is urgent.',
    );
    expect(factOf(result, 'impact')?.value).toBe('kan niet werken');
    expect(factOf(result, 'affectedUsers')?.sourceRuleId).toBe('fact_affected_colleagues');
    expect(factOf(result, 'attemptedSolutions')?.value).toBe('al geprobeerd');
    expect(factOf(result, 'urgency')?.value).toBe('urgent');
  });

  it('invents nothing for unknown input', () => {
    const result = extract('Kun je me helpen?', 'unknown');
    expect(result.facts).toEqual([]);
    expect(result.ambiguities).toEqual([]);
  });

  it('recognizes an account subject without inventing a device', () => {
    const result = extract('Ik kan niet inloggen met mijn account.');
    expect(factOf(result, 'serviceOrApplication')?.value).toBe('Account');
    expect(factOf(result, 'device')).toBeUndefined();
    expect(factOf(result, 'symptom')).toEqual(
      expect.objectContaining({ value: 'unavailable', sourceRuleId: 'symptom_login_block' }),
    );
  });
});
