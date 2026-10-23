// ELVIE 2.0 — BASE-01 Route B — fixture capture script (TEMPORARY, verification-only)
// Pinned baseline: 6a0ccb2f705decee6cb8c572ec14df26ad33c9c6 (tree 591faae3ea84fcb12f63c6fd4dd18848ee5319e1)
//
// SCOPE / SAFETY
// - Strict read-only towards the baseline: only existing PUBLIC exports are
//   imported (all verified on the pinned blobs); the engine is driven only via
//   its public API (start / handleEmployeeInput / currentState); the baseline
//   workmap is never written. Evidence goes to ./evidence, diagnostics to
//   ./diagnostics (both outside baseline/).
// - All test data is FICTIONAL baseline test data ('Test Medewerker',
//   SIM-references, and the fictional PII-guard probe 'mijn BSN is 123456789'
//   taken verbatim from conversation-engine.test.ts). No real personal data,
//   no secrets, no network access.
//
// CORRECTION 4: every step is validated DURING the flow — expected fragments,
// forbidden fragments, engine state, first message role, knowledge-query
// counts and submit-call counts — not only end states. All expected fragments
// below are quoted from the existing baseline tests on the pinned SHA:
//   conversation-engine.test.ts, conversation-engine-build02.test.ts,
//   resolution-flow.test.ts, ticket-submission.test.ts.
//
// CORRECTION 5: same-key recovery is proven via the mock's own contract
// (submitCallCount stays 1 and submittedDrafts stays 0 after recovery) and
// resolveAsSubmitted() is called WITHOUT an argument, so the reference comes
// from the mock's own documented default — this script assumes no fixed
// ticket reference anywhere.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

import { ConversationEngine } from '../baseline/src/services/conversation-engine.ts';
import { MockIdentityProvider } from '../baseline/src/mocks/mock-identity.ts';
import { MockKnowledgeProvider } from '../baseline/src/mocks/mock-knowledge.ts';
import { MockTicketProvider } from '../baseline/src/mocks/mock-ticket.ts';
import { InMemoryAuditLogger } from '../baseline/src/mocks/in-memory-audit-logger.ts';
import { consoleOperationalLogger } from '../baseline/src/mocks/console-operational-logger.ts';
import { unconfiguredIdentity } from '../baseline/src/ports/identity.ts';

const PINNED_SHA = '6a0ccb2f705decee6cb8c572ec14df26ad33c9c6';
const PINNED_TREE = '591faae3ea84fcb12f63c6fd4dd18848ee5319e1';
const PINNED_REPO = 'dhagemeijer/Elvie-2.0';
// Deterministic clock: the engine's public deps interface accepts `now`
// (used by resolution-flow.test.ts), so all emitted timestamps are fixed.
const FIXED_NOW = '2026-10-07T09:00:00.000Z';

// Fictional PII-guard probe, verbatim from conversation-engine.test.ts.
const FICTIONAL_PII_PROBE = 'mijn BSN is 123456789 en het print niet';
// Sensitive-scan allowlist: values that are PROVABLY fictional test inputs
// from the baseline tests and may therefore appear in the evidence.
const FICTIONAL_ALLOWLIST = ['123456789', 'Test Medewerker', 'mock-employee-0001'];

// ---------------------------------------------------------------------------
// Preflight (CORRECTION 7): verify every required public export exists.
// A missing export already fails the vite bundle step; this makes it explicit.
// ---------------------------------------------------------------------------
function preflight() {
  const required = { ConversationEngine, MockIdentityProvider, MockKnowledgeProvider, MockTicketProvider, InMemoryAuditLogger, consoleOperationalLogger, unconfiguredIdentity };
  const missing = Object.entries(required).filter(([, v]) => typeof v !== 'function').map(([k]) => k);
  if (missing.length) throw new Error(`Missing public exports: ${missing.join(', ')}`);
  const t = new MockTicketProvider({});
  for (const p of ['setFailureMode', 'resolveAsSubmitted']) {
    if (typeof t[p] !== 'function') throw new Error(`MockTicketProvider.${p} missing`);
  }
  if (typeof t.submitCallCount !== 'number') throw new Error('MockTicketProvider.submitCallCount missing (getter)');
  if (!Array.isArray(t.submittedDrafts)) throw new Error('MockTicketProvider.submittedDrafts missing (getter)');
  if (!Array.isArray(new MockKnowledgeProvider({}).capturedSearchQueries)) throw new Error('MockKnowledgeProvider.capturedSearchQueries missing (getter)');
}

// ---------------------------------------------------------------------------
// Deterministic normalization + hashing
// ---------------------------------------------------------------------------
const normalizeRules = [
  { pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', replacement: '<SESSION-ID>', reason: 'makeId() = crypto.randomUUID() (per instance)' },
  { pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z', replacement: '<ISO-TIMESTAMP>', reason: 'nowIso() wall clock (fixed via the public `now` dep; rule kept as belt-and-braces)' },
  { pattern: 'SIM-(incident|request|security)-\\d{4}', replacement: '<SIM-REF>', reason: 'mock ticket counter is per-instance state' },
];
const compiled = normalizeRules.map(r => ({ ...r, re: new RegExp(r.pattern, 'g') }));
function normalize(text) { let out = text; for (const { re, replacement } of compiled) out = out.replace(re, replacement); return out; }
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// Engine factory — public constructor contract only
// ---------------------------------------------------------------------------
function makeEngine({ failureMode = 'success', knowledgeMode = 'ok', unconfigured = false } = {}) {
  const identity = unconfigured ? unconfiguredIdentity() : new MockIdentityProvider();
  const knowledge = new MockKnowledgeProvider({ mode: knowledgeMode });
  const ticket = new MockTicketProvider({ failureMode });
  const audit = new InMemoryAuditLogger();
  const engine = new ConversationEngine({ identity, knowledge, ticket, operational: consoleOperationalLogger(), audit, now: () => FIXED_NOW });
  return { engine, knowledge, ticket, audit };
}

// ---------------------------------------------------------------------------
// Step runner with per-step validation (CORRECTION 4)
// ---------------------------------------------------------------------------
function fail(flow, step, msg) { throw new Error(`[${flow}] stap ${step.no} "${step.label}": ${msg}`); }

async function runStep(flowName, ctx, spec) {
  const no = ctx.steps.length + 1;
  const step = { no, label: spec.label, input: spec.input ?? null };
  const messages = await ctx.engine.handleEmployeeInput(spec.input);
  step.messages = messages.map(m => ({ role: m.role, text: normalize(m.text) }));
  const raw = messages.map(m => m.text).join('\n'); // assertions on RAW text
  for (const f of spec.all ?? []) if (!raw.includes(f)) fail(flowName, step, `verwacht fragment ontbreekt: "${f}"`);
  if (spec.any !== undefined && !spec.any.some(g => raw.includes(g)))
    fail(flowName, step, `verwacht één van [${spec.any.map(g => `"${g}"`).join(', ')}]`);
  for (const f of spec.none ?? []) if (raw.includes(f)) fail(flowName, step, `verboden fragment aanwezig: "${f}"`);
  if (spec.regex !== undefined && !new RegExp(spec.regex).test(raw)) fail(flowName, step, `verwacht patroon /${spec.regex}/ ontbreekt`);
  if (spec.firstRole !== undefined && messages[0]?.role !== spec.firstRole)
    fail(flowName, step, `verwachte eerste rol ${spec.firstRole}, gevonden ${messages[0]?.role}`);
  const state = ctx.engine.currentState;
  step.stateAfter = state;
  if (spec.expectState !== undefined && state !== spec.expectState) fail(flowName, step, `verwachte status ${spec.expectState}, gevonden ${state}`);
  if (spec.knowledgeQueryCount !== undefined && ctx.knowledge.capturedSearchQueries.length !== spec.knowledgeQueryCount)
    fail(flowName, step, `verwacht ${spec.knowledgeQueryCount} kennisquery's, gevonden ${ctx.knowledge.capturedSearchQueries.length}`);
  if (spec.expectSubmitCallCount !== undefined && ctx.ticket.submitCallCount !== spec.expectSubmitCallCount)
    fail(flowName, step, `verwacht submitCallCount ${spec.expectSubmitCallCount}, gevonden ${ctx.ticket.submitCallCount}`);
  if (spec.expectSubmittedDrafts !== undefined && ctx.ticket.submittedDrafts.length !== spec.expectSubmittedDrafts)
    fail(flowName, step, `verwacht ${spec.expectSubmittedDrafts} ingediende drafts, gevonden ${ctx.ticket.submittedDrafts.length}`);
  ctx.steps.push(step);
  return step;
}

async function runFlow(name, makeAcc, specs, startOpts) {
  const acc = makeAcc();
  const ctx = { engine: acc.engine, knowledge: acc.knowledge, ticket: acc.ticket, steps: [] };
  if (startOpts?.start) {
    const no = ctx.steps.length + 1;
    const messages = await ctx.engine.start();
    const raw = messages.map(m => m.text).join('\n');
    const step = { no, label: 'start()', input: null, messages: messages.map(m => ({ role: m.role, text: normalize(m.text) })) };
    for (const f of startOpts.all ?? []) if (!raw.includes(f)) fail(name, step, `verwacht fragment ontbreekt: "${f}"`);
    for (const f of startOpts.none ?? []) if (raw.includes(f)) fail(name, step, `verboden fragment aanwezig: "${f}"`);
    if (startOpts.firstRole !== undefined && messages[0]?.role !== startOpts.firstRole)
      fail(name, step, `verwachte eerste rol ${startOpts.firstRole}, gevonden ${messages[0]?.role}`);
    step.stateAfter = ctx.engine.currentState;
    ctx.steps.push(step);
  }
  for (const s of specs) {
    if (s.repeatUntil) {
      let reached = false;
      for (let i = 0; i < s.repeatUntil.max && !reached; i++) {
        const step = await runStep(name, ctx, { label: `${s.label} (ronde ${i + 1})`, input: s.input, ...s.stepExpect });
        reached = step.messages.some(m => m.text.includes(s.repeatUntil.fragment));
      }
      const last = ctx.steps[ctx.steps.length - 1];
      for (const f of s.repeatUntil.finalAll ?? []) {
        if (!last.messages.some(m => m.text.includes(f))) fail(name, last, `verwacht fragment "${f}" in de afrondbare stap`);
      }
      if (!reached) fail(name, { no: ctx.steps.length, label: s.label }, `verwacht fragment "${s.repeatUntil.fragment}" niet bereikt binnen ${s.repeatUntil.max} rondes`);
      continue;
    }
    if (s.hook) {
      s.hook(ctx);
      ctx.steps.push({ no: ctx.steps.length + 1, label: s.label, input: null, note: s.note ?? null });
      continue;
    }
    await runStep(name, ctx, s);
  }
  return {
    flow: name, pinnedSha: PINNED_SHA,
    finalState: ctx.engine.currentState,
    submitCallCount: ctx.ticket.submitCallCount,
    knowledgeSearchCount: ctx.knowledge.capturedSearchQueries.length,
    steps: ctx.steps,
  };
}

// ---------------------------------------------------------------------------
// Flows — inputs and expected fragments quoted from the baseline tests
// ---------------------------------------------------------------------------
const WIFI_LAPTOP = 'Mijn laptop op kantoor maakt sinds vanochtend geen verbinding met wifi.';

const FLOWS = [
  () => runFlow('conversation-start-happy', () => makeEngine(), [
    { label: 'ontbrekend apparaat wordt één keer gevraagd', input: 'Mijn Outlook doet het niet.', all: ['Op welk apparaat'] },
    { label: 'apparaat aangevuld: nooit opnieuw vragen, door naar kennisflow', input: 'op mijn laptop', none: ['Op welk apparaat'], all: ['opgelost'] },
  ], { start: true, all: ['Test Medewerker'] }),

  () => runFlow('conversation-start-fail-closed', () => makeEngine({ unconfigured: true }), [
    { label: 'input geweigerd zonder sessie (error-rol)', input: 'hallo', firstRole: 'error' },
  ], { start: true, firstRole: 'error', none: ['Test Medewerker'] }),

  () => runFlow('conversation-routing-never-ask-twice', () => makeEngine(), [
    { label: 'apparaat en symptoom al bekend: geen apparaatvraag, kennisflow', input: WIFI_LAPTOP, none: ['Op welk apparaat'], all: ['opgelost'] },
  ], { start: true }),

  () => runFlow('conversation-routing-unknown', () => makeEngine(), [
    { label: 'onbekende vraag blijft in UNDERSTAND, geen kenniszoektocht', input: 'Kun je me helpen?', all: ['begrijp'], expectState: 'UNDERSTAND', knowledgeQueryCount: 0 },
  ], { start: true }),

  () => runFlow('conversation-pii-guard', () => makeEngine(), [
    { label: 'symptoom bekend', input: 'printer print niet' },
    { label: 'kennis afgewezen', input: 'niet opgelost' },
    { label: 'gevoelige gegevens geblokkeerd, geen ticket', input: FICTIONAL_PII_PROBE, all: ['gevoelige gegevens'], expectSubmitCallCount: 0, expectSubmittedDrafts: 0 },
  ], { start: true }),

  () => runFlow('knowledge-resolve-done', () => makeEngine(), [
    { label: 'kennisartikel aangeboden', input: 'wachtwoord vergeten', all: ['Wachtwoord'] },
    { label: 'bevestigde oplossing → DONE', input: 'ja', all: ['Fijn'], expectState: 'DONE' },
  ], { start: true }),

  () => runFlow('knowledge-series-intake-ticket', () => makeEngine(), [
    { label: 'symptoom bekend', input: 'printer print niet', all: ['Printer'] },
    { label: 'serie afbouwen tot intake/preview', repeatUntil: { fragment: 'Bevestig om de simulatie af te ronden', max: 5, finalAll: ['simulatie', 'niets naar TOPdesk verzonden'] }, input: 'niet opgelost' },
    { label: 'expliciete versturen → SIM-referentie, CONFIRM', input: 'versturen', regex: 'SIM-incident-\\d{4}', all: ['simulatie', 'géén echte TOPdesk-melding'], expectState: 'CONFIRM', expectSubmitCallCount: 1, expectSubmittedDrafts: 1 },
  ], { start: true }),

  () => runFlow('knowledge-dependency-failure', () => makeEngine({ knowledgeMode: 'unavailable' }), [
    { label: 'kennisafhankelijkheid niet beschikbaar', input: WIFI_LAPTOP, all: ['niet beschikbaar'] },
    { label: "'opgelost' na zoekfout is géén resolutie", input: 'opgelost', none: ['Fijn'], all: ['opnieuw'], expectState: 'KNOWLEDGE_SEARCH' },
  ], { start: true }),

  () => runFlow('security-phishing', () => makeEngine(), [
    { label: 'phishing → beveiligingsmelding zonder kennisraadpleging', input: 'Ik heb op een link geklikt en daarna mijn wachtwoord ingevuld.', all: ['niet registreren of versturen', 'simulatie', 'beveiligingsmelding'], knowledgeQueryCount: 0, expectSubmittedDrafts: 0 },
    { label: 'klaar → preview', input: 'klaar', all: ['beveiligingsmelding', 'simulatie', 'niets naar TOPdesk verzonden'] },
    { label: 'versturen → SIM-security-referentie, CONFIRM', input: 'versturen', regex: 'SIM-security-\\d{4}', expectState: 'CONFIRM', expectSubmitCallCount: 1, expectSubmittedDrafts: 1 },
  ], { start: true }),

  () => runFlow('ticket-fail-rejected-retry', () => makeEngine({ failureMode: 'fail_rejected' }), [
    { label: 'printer-symptoom', input: 'printer print niet' },
    { label: 'serie afbouwen tot preview', repeatUntil: { fragment: 'Bevestig om de simulatie af te ronden', max: 5, finalAll: ['simulatie', 'niets naar TOPdesk verzonden'] }, input: 'niet opgelost' },
    { label: 'afwijzing → PREVIEW, niets vastgelegd', input: 'versturen', all: ['versturen is niet gelukt', 'niets vastgelegd of verzonden'], expectState: 'PREVIEW', expectSubmitCallCount: 1, expectSubmittedDrafts: 0 },
    { label: 'mock omgeschakeld naar success (gedocumenteerde testhelper)', hook: ctx => ctx.ticket.setFailureMode('success'), note: 'setFailureMode is de gedocumenteerde mock-testhelper' },
    { label: 'nieuwe expliciete poging → CONFIRM', input: 'versturen', regex: 'SIM-incident-\\d{4}', expectState: 'CONFIRM', expectSubmitCallCount: 2, expectSubmittedDrafts: 1 },
  ], { start: true }),

  () => runFlow('ticket-timeout-same-key-recovery', () => makeEngine({ failureMode: 'timeout' }), [
    { label: 'printer-symptoom', input: 'printer print niet' },
    { label: 'serie afbouwen tot preview', repeatUntil: { fragment: 'Bevestig om de simulatie af te ronden', max: 5, finalAll: ['simulatie', 'niets naar TOPdesk verzonden'] }, input: 'niet opgelost' },
    { label: 'timeout → onzeker, nooit opnieuw versturen', input: 'versturen', all: ['niet zeker of de simulatie', 'niets opnieuw verstuurd'], expectState: 'PREVIEW', expectSubmitCallCount: 1 },
    { label: 'herhaald versturen = alleen statuscheck, geen tweede submit', input: 'versturen', all: ['niet zeker'], expectState: 'PREVIEW', expectSubmitCallCount: 1 },
    { label: 'mock bevestigt later via status (zelfde key)', hook: ctx => ctx.ticket.resolveAsSubmitted(), note: 'resolveAsSubmitted() zonder argument: referentie komt uit de eigen gedocumenteerde mock-default' },
    { label: 'herstel via statuscheck → CONFIRM, nog steeds één submit', input: 'versturen', all: ['géén echte TOPdesk-melding'], regex: 'SIM-incident-\\d{4}', expectState: 'CONFIRM', expectSubmitCallCount: 1, expectSubmittedDrafts: 0 },
  ], { start: true }),
];

// ---------------------------------------------------------------------------
// Sensitive-value scan (CORRECTION 6): evidence must contain only fictional data.
// ---------------------------------------------------------------------------
function sensitiveScan(files) {
  const findings = [];
  for (const { name, content } of files) {
    for (const seq of content.match(/\b\d{9}\b/g) ?? []) {
      if (!FICTIONAL_ALLOWLIST.includes(seq)) findings.push(`${name}: onverwachte 9-cijferige reeks "${seq}"`);
    }
    for (const m of content.match(/[\w.+-]+@[\w-]+\.\w{2,}/g) ?? []) findings.push(`${name}: e-mailadres "${m}"`);
    if (/bsn/i.test(content) && !content.includes(FICTIONAL_PII_PROBE)) {
      findings.push(`${name}: 'BSN' buiten de gedocumenteerde fictieve proefinvoer`);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main: capture, validate, hash, manifest. Failure → diagnostics + exit 1.
// ---------------------------------------------------------------------------
async function main() {
  preflight();
  mkdirSync('evidence', { recursive: true });
  try {
    const fixtures = [];
    for (const flow of FLOWS) fixtures.push(await flow());
    const files = [];
    for (const fixture of fixtures) {
      const name = `fixture-${fixture.flow}.json`;
      const content = serialize(fixture);
      writeFileSync(`evidence/${name}`, content);
      files.push({ name, sha256: sha256(content) });
    }
    // Sensitive scan over the raw serialized evidence BEFORE manifest success.
    const findings = sensitiveScan(files.map(f => ({ name: f.name, content: readFileSync(`evidence/${f.name}`, 'utf8') })));
    if (findings.length) throw new Error(`Sensitive-value scan mislukt:\n${findings.join('\n')}`);
    const manifest = {
      title: 'BASE-01 fixture evidence manifest',
      repo: PINNED_REPO, pinnedSha: PINNED_SHA, pinnedTree: PINNED_TREE,
      generatedBy: 'tooling/capture-fixtures.mjs (tijdelijke BASE-01-verificatie, Route B)',
      determinism: {
        fixedNow: FIXED_NOW,
        normalizationRules,
        serialization: 'JSON.stringify(value, null, 2) + "\\n" (hashes over deze exacte bytes)',
        note: 'stapvalidaties gebeuren op de ruwe tekst vóór normalisatie; de evidence bevat genormaliseerde tekst',
      },
      testdata: { policy: 'uitsluitend fictieve testdata uit de bestaande baselinetests', fictionalAllowlist: FICTIONAL_ALLOWLIST, piiProbe: FICTIONAL_PII_PROBE },
      sameKeyRecoveryEvidence: 'ticket-timeout-same-key-recovery: submitCallCount blijft 1 en submittedDrafts blijft 0 na herstel; resolveAsSubmitted() zonder argument (mock-eigen default)',
      files, // hash of the manifest itself is intentionally NOT self-referential
    };
    writeFileSync('evidence/BASE-01-MANIFEST.json', serialize(manifest));
    console.log(`BASE-01 fixture capture geslaagd: ${fixtures.length} fixtures, ${files.length} gehashte bestanden, sensitive scan schoon.`);
  } catch (error) {
    mkdirSync('diagnostics', { recursive: true });
    writeFileSync('diagnostics/capture-failure.txt',
      `BASE-01 fixture capture MISLUKT.\n${error?.stack ?? String(error)}\n`);
    writeFileSync('diagnostics/partial-fixtures-note.txt',
      'Gedeeltelijke fixtures zijn GEEN geldig bewijs. Alleen het evidence-artifact van een geslaagde run telt voor BASE-01.\n');
    console.error(error);
    process.exitCode = 1;
  }
}

main();
