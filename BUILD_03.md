# Elvie 2.0 — Build 03: Knowledge & Resolution

Status: **geconsolideerde definitieve specificatie (v5.2.1; v5.2 en de
v5.2.1-patch voor §10.1/§11/§12/§14 zijn expliciet goedgekeurd)**

## 0. Leidend uitgangspunt

Elvie begeleidt de medewerker van vraag tot oplossing of, wanneer selfservice
niet helpt, naar een passende ticketregistratie. In Build 03 is die
registratie **uitsluitend een simulatie met fictieve gegevens**; een echte
TOPdesk-registratie bestaat in Build 03 niet en wordt nergens gesuggereerd.
Geen doodlopende gesprekken, geen dubbele vragen. De Build 01 state machine
blijft autoritair en ongewijzigd: geen nieuwe states, geen nieuwe
transities.

## 1. Architectuurgrenzen (niet-onderhandelbaar)

- TOPdesk blijft de autoritatieve bron voor service-deskkennis en -data.
  Elvie bouwt geen eigen persistente kennisbank, cache of tweede catalogus.
- Geen LLM, generatieve AI, externe NLP of internetzoekactie. Alle matching
  is deterministisch en regelgebaseerd met stabiele regel-identificatoren.
- De browser communiceert nooit rechtstreeks met TOPdesk; alle toegang via
  de backend-port. Build 03 kent uitsluitend fictieve mock-adapters.
- Geen echte TOPdesk-, Entra- of SharePoint-integratie in Build 03;
  uitsluitend fictieve testdata. Geen nieuwe runtime-dependencies.
- Alle levenscyclusovergangen uitsluitend via de bestaande Build 01 state
  machine (`applyTransition`); ongeldige transities blijven gooien.
- Determinisme: identieke input, context, catalogus, regels en geïnjecteerde
  klok → identiek resultaat. Geen verborgen wall-clock-afhankelijkheid.
- Dataminimalisatie: zoekvragen, previews en payload-teksten bevatten
  uitsluitend gecontroleerde waarden; gevoelige informatie komt nooit
  ongecontroleerd in queries, previews, logs of mockpayloads terecht.
- Veilig loggen conform AUDIT_LOGGING.md: geen gespreksinhoud, geen
  artikelinhoud, geen gevoelige waarden; alleen veilige id's, regel-ids,
  categorieën en correlation-id's.
- **Simulatie-eerlijkheid:** geen enkele medewerkersmelding, preview of
  succes-/fouttekst in Build 03 wekt de indruk dat een echte
  TOPdesk-registratie is aangemaakt, verzonden of mogelijk is. Waar
  relevant wordt de simulatiestatus expliciet benoemd (§9, §10).
- Bij vermeende noodzaak tot wijziging van ARCHITECTURE.md,
  SECURITY_PRINCIPLES.md of AUDIT_LOGGING.md: stoppen en rapporteren.

## 2. Functionele scope

In scope:

1. KnowledgePort-contract met server-side autorisatiebesluiten en
   fail-closed semantiek (§3).
2. Fictieve mock TOPdesk Knowledge-adapter, inclusief negatieve
   autorisatietests (§3.4).
3. Contextgebaseerde zoekvraagopbouw uitsluitend uit gecontroleerde
   cataloguswaarden (§4).
4. Deterministische gating, ranking met uitlegbare matchregels en
   relevantedrempel (§5).
5. Gecontroleerde presentatie met bronverwijzing; maximaal drie
   verschillende artikelen per oplossingsreeks (§6).
6. Begeleide oplossingsflow met opgelost/niet-opgelost/onduidelijk en de
   interne KnowledgePhase-substatus (§7).
7. Generieke intake met drie interne intake-typen en volledige hergebruik
   van bekende context (§8).
8. Intent-correcte routes via de bestaande lifecycle, inclusief veilige
   security-intake voor phishing (§9).
9. Generieke, TOPdesk-onafhankelijke ticket-simulatie via het TicketPort-
   mockcontract met SubmissionKey, SubmissionStatus en foutveilige,
   idempotente SUBMIT-afhandeling (§10, §11, §12).
10. Engine-fixes met regressietests die op huidige main falen (§13).

Expliciet uit scope (Build 04/06):

- Context-specifieke intake-vereisten die verder gaan dan de bestaande
  Build 02-feitcategorieën.
- TOPdesk-tickettypen, routering, payload-mapping en security-registratie.
- Echte TOPdesk KM- of Incident-API-integratie (Build 06), echte Entra
  (Build 05), SPFx (Build 07).
- Kennisanalyse, dashboards, artikelcreatie, type-ahead, bijlagen.
- Persistente opslag van kennisinhoud, zoeklogs of ticketkopieën.

## 3. Autorisatie en voorkoming van informatielekken

### 3.1 Vertrouwenscontract

Server-side autorisatie is een verplichting van de KnowledgePort-
implementatie (de toekomstige TOPdesk-adapter). Het contract luidt: een
geretourneerd artikel is server-side geautoriseerd voor de gegeven
identiteit, óf de port gooit (afhankelijkheidsfout). Elvies eigen filters
zijn uitsluitend defense-in-depth en vervangen autorisatie nooit.

Elk artikel voert een verplicht, gestructureerd autorisatiebesluit mee:

```ts
export interface KnowledgeAuthorizationDecision {
  readonly decidedBy: 'knowledge-adapter';     // nooit Elvie zelf
  readonly decision: 'granted' | 'denied' | 'inconclusive';
  readonly policyId?: string;                 // verplicht bij granted
  readonly reasonCategory?: 'policy_unavailable' | 'identity_unverifiable'
    | 'policy_denied' | 'metadata_incomplete'; // verplicht bij denied/inconclusive
}
```

Een losse boolean is nooit voldoende bewijs; het besluit is altijd
gestructureerd en controleerbaar.

### 3.2 Fail-closed-regels

1. Alleen `decision === 'granted'` met aanwezig `policyId` maakt een
   artikel aanbiedbaar.
2. `denied`, `inconclusive`, afwezig besluit, of tegenstrijdige gegevens
   (`granted` zonder `policyId`; `denied`/`inconclusive` zonder
   `reasonCategory`) → allemaal niet-aanbiedbaar (fail-closed).
3. Defense-in-depth: onafhankelijk van het adapterbesluit filtert Elvie op
   publicatiestatus, audience-beleid, taal en geldigheid. Beide lagen zijn
   afzonderlijk testbaar.

### 3.3 Geen informatielek naar de medewerker

- Niet-toegankelijke artikelen zijn volledig onzichtbaar: geen resultaten,
  ranks, aanbiedingen of tellingen.
- Een geweigerd artikel is niet herkenbaar als bestaand artikel.
- Uit de reactie kan niet worden afgeleid dat afgeschermde kennis bestaat:
  de tekst bij "geen resultaten" en bij "uitsluitend afgeschermde
  resultaten" is identiek ("Ik heb hiervoor geen passende instructies
  gevonden.") — geen aparte formulering, geen aantallen, geen
  toegang-hints.
- Intern worden autorisatie-weigeringen en "geen resultaten" afzonderlijk
  gelogd als veilige categorieën (`authorization_denied`, `no_results`,
  `authorization_inconclusive`) — zonder artikel-titels, reden-details of
  inhoud. Dit onderscheid is uitsluitend operationeel, nooit zichtbaar in
  de medewerkersinterface.
- Onderscheid geweigerd artikel vs. algemene storing: een
  autorisatie-weigering is géén storing (de zoekactie slaagt; overige
  artikelen worden normaal verwerkt); een algemene storing van de
  kennisvoorziening is een afhankelijkheidsfout met vaste veilige fouttekst.
  Beide paden verschillen expliciet in gedrag, tekst en logcategorie; geen
  van beide vermeldt afgeschermde artikelen.

### 3.4 Mock-adapter en negatieve autorisatietests

De fictieve mock bevat minimaal: granted-artikelen voor de BUILD_02-
corpusonderwerpen (Outlook, printer, laptop/wifi, wachtwoord/account,
mailboxtoegang); één draft; één verlopen; één artikel met niet-passend
audience-beleid; één artikel onder de kwaliteitsdrempel; één `denied`
(policy_denied); één `inconclusive` (policy_unavailable); één
`granted`-zonder-policyId (tegenstrijdig); één granted-artikel met
niet-passende defense-in-depth-audience. De mock retourneert volledige
metadata zonder vooraf te filteren.

## 4. Zoekvraagopbouw (dataminimalisatie, allowlist)

Puure, deterministische functie `buildKnowledgeQuery(context, catalog)`:

- `subject`: uitsluitend bij exacte voorkoming in de RecognitionCatalog
  (canonieke waarde of alias; exact, niet-fuzzy). Onbekende waarden vallen
  weg.
- `symptom`: uitsluitend canonieke symptoomwaarden uit de vaste Build 02
  SYMPTOM_RULE_VALUES-verzameling.
- `requestedResource`: uitsluitend bij exacte catalogusmatch.
- `keywords`: afgeleid uitsluitend uit de goedgekeurde canonieke
  cataloguswaarden (canonieke naam + aliases). Geen vrije gebruikersinvoer,
  geen berichttekst, geen andere contextvelden.
- `intent`: de actuele effectieve intent-classificatiewaarde.
- Validatie vóór port-aanroep is een expliciete, geteste stap; afgewezen
  waarden worden gelogd met veilig label (categorie, nooit de waarde).
- De bestaande PII-detectie blijft vroege gebruikerswaarschuwing maar is
  geen garantie; de allowlist is de eigenlijke control.
- Negatieve port-aanroep-asserties: niet-catalogus-subject,
  niet-gecontroleerde symptoomtekst, manipulatieve injectie (bijv. via
  correctieflow), en geen enkel contextveld buiten
  subject/symptom/requestedResource/intent bereiken de poort.

## 5. Deterministische gating en ranking

`rankArticles(query, articles, now)`, puur en deterministisch:

- **Gating vóór ranking, vaste volgorde:** `status === 'published'`; geldig
  granted-autorisatiebesluit (§3.2); defense-in-depth audience;
  `language === 'nl'`; geldigheid `validFrom <= now` en (`validUntil`
  afwezig of `now < validUntil`); `minimumQualityMet === true`.
- **Kwaliteitsdrempel:** adapter-berekend (mock: titel aanwezig,
  bronverwijzing aanwezig, ≥1 stap). Onder-drempelartikelen gedragen zich
  als niet-matchend.
- **Matchregels** (ids definitief bij implementatiegoedkeuring):
  `rank_subject_exact` (hoogst), `rank_symptom_match` (hoog),
  `rank_resource_match` (hoog), `rank_keyword_match` (middel). Score is een
  geordende regel-tuple, lexicografisch; tie-break op artikel-id oplopend;
  nooit randomness, nooit een pseudo-statistisch getal.
- **Relevantedrempel:** uitsluitend `rank_keyword_match` met één keyword
  en geen verdere regels is onder de drempel.
- Elk gerangschikt artikel draagt een explanation-record (regel-ids +
  matchende termen); geen reasoning-trace.
- `now` is een geïnjecteerde klok-invoer.

## 6. Presentatie van kennisartikelen

- Per stap maximaal één artikel; maximaal drie verschillende artikelen per
  oplossingsreeks.
- Vast formaat: titel + geordende stappen + "Bron: TOPdesk Kennisbank —
  <sourceReference>". (De bronvermelding benoemt de fictieve bron van het
  mock-artikel; het is een catalogusverwijzing, géén registratie-claim.)
- Artikelinhoud komt nooit in operationele/auditlogs; alleen veilige
  artikel-ids en regel-ids.
- Fout- en afwijzingspaden geven nooit hints over gefilterde artikelen.

## 7. Begeleide oplossingsflow en KnowledgePhase

Drie-wegfeedback binnen KNOWLEDGE_SEARCH; geen nieuwe transities:

- Elvie biedt het best geklasseerde geschikte artikel aan en stelt de vaste
  driewegvraag: "Lost dit je probleem op? Antwoord 'opgelost', 'niet
  opgelost' of 'onduidelijk'." ('ja'/'yes' → opgelost; 'nee'/'no' → niet
  opgelost; aliaslijsten vast.)
- **Opgelost** → DONE uitsluitend na deze expliciete bevestiging:
  `KNOWLEDGE_SEARCH → RESOLVE → DONE`. Feedback opgeslagen in `answers`
  (`resolution_feedback`).
- **Niet opgelost** → eerst het volgende geschikte artikel (zelfde loop,
  maximaal drie verschillende artikelen); bij uitputting de generieke
  intake-route (§8).
- **Onduidelijk** → één vaste verduidelijkingsvraag; geen automatische
  afwijzing. Op het antwoord: herkend → overeenkomstige route; opnieuw
  onduidelijk/onherkend → artikel als niet-beoordeeld sluiten, volgend
  artikel of intake-route.
- **Onherkend:** één keer herhalen, daarna als onduidelijk.
- **Loop-veiligheid:** maximaal 1 verduidelijkingsronde per artikel,
  maximaal 3 artikelen per reeks, elke stap vereist medewerkersinvoer.

### KnowledgePhase-substatus (intern, in ConversationContext)

| Substatus | Betekenis | Toegestane invoer | Acties | Retries | Transities |
|---|---|---|---|---|---|
| `searching` | query/rank/aanbod | — (geen invoer geïnterpreteerd) | query, poort, gate/rank, aanbod | poort-fout → `dependency_error`, geen transitie | aanbod → `awaiting_feedback`; geen resultaat → intake-route |
| `awaiting_feedback` | artikel aangeboden | driewegtermen + aliassen; onherkend | drieweginterpretatie | 1× herhalen, dan onduidelijk | opgelost → RESOLVE → DONE; niet-opgelost → volgend artikel; onduidelijk → `clarifying` |
| `clarifying` | verduidelijking actief | vrij antwoord; herkende termen | interpreteren; geen artikelwijziging | geen tweede ronde per artikel | herkend → route; opnieuw onduidelijk → volgend artikel of intake |
| `dependency_error` | poort-fout | uitsluitend expliciete herstelbeurt | geen feedbackinterpretatie | 1 poging per beurt; herhaling blijft in `dependency_error` | geslaagd → reguliere flow; anders veilige fouttekst, geen transitie |
| `exhausted` | reeks afgelopen | intent-afsluiting | geen nieuw artikel | geen | altijd intake-route |

Invoer na een zoekfout wordt nooit als oplossingsfeedback geïnterpreteerd;
onwettige invoer per substatus wordt afgewezen met vaste herhaaldvraging.

## 8. Generieke intake

`KNOWLEDGE_SEARCH → INTAKE` is de standaardroute wanneer geen passend
artikel beschikbaar is, resultaten onder de drempel blijven, de reeks is
uitgeput, of de oplossingen niet helpen — voor elke intent die tot
kennisraadpleging is gekomen.

### 8.1 Interne intake-typen

INTAKE is generiek; drie interne typen (label in ConversationContext;
geen lifecycle-state): `incident`, `request`, `security`. Het type stuurt
uitsluitend de vragen en bewoording; het is géén TOPdesk-tickettype- of
routeringsbeslissing.

### 8.2 Hergebruik en never-ask-twice

Intake-handlers hergebruiken álle betrouwbaar bekende gegevens
(explicit facts, derived facts met confidence, answers) via de bestaande
Build 02 missing-information-berekening, behandelen explicit/derived
volgens de bestaande Build 02-regels (voorrang, correcties), en vragen
uitsluitend nog ontbrekende informatie (positieve + negatieve tests).
Intake-antwoorden overschrijven bekende feiten van andere categorieën
nooit.

### 8.3 Verdere lifecycle

Na INTAKE ongewijzigd: `COMPLETE_CONTEXT → PREVIEW → SUBMIT → CONFIRM`.
Alle intake-typen doorlopen dezelfde lifecycle; alleen vragen en
bewoording verschillen.

## 9. Intent-specifieke routes en medewerkersmeldingen

Alle transities bestaan in `STATE_TRANSITIONS` en gaan uitsluitend via
`applyTransition`:

| Intent | Route bij geen passend resultaat / niet helpend / uitputting |
|---|---|
| incident | `KNOWLEDGE_SEARCH → INTAKE` (incident-intake) → COMPLETE_CONTEXT → PREVIEW → SUBMIT → CONFIRM |
| request | `KNOWLEDGE_SEARCH → INTAKE` (request-intake) → zelfde route; verzoek-bewoording; nooit stille incidentregistratie |
| phishing/security | géén reguliere kenniszoekactie (port-aanroep-assertie). Veilige veiligheidsinstructie (§9.1), daarna `KNOWLEDGE_SEARCH → INTAKE` (security-intake); security-bewoording; nooit stille incidentregistratie. Echte security-routering/-registratie: Build 04 |
| unknown | verduidelijking binnen UNDERSTAND; na latere classificatie de reguliere route van die intent |

### 9.1 Veiligheidsinstructie phishing (standaardtekst, configureerbaar)

"Ik kan je hierbij niet rechtstreeks helpen. Ik kan je situatie niet
registreren of versturen — dit gesprek is een simulatie. Ik zet je
gegevens niet automatisch ergens vast. Volg de instructies zoals die
binnen je organisatie zijn gecommuniceerd, of neem direct contact op met
de IT-servicebalie."

- Geen onvoorwaardelijk wachtwoordadvies; geen registratie- of
  verzendingsclaim; expliciet dat niets wordt vastgelegd of verzonden.
- Definitieve tekst is een organisatiebesluit (configuratie).

### 9.2 Medewerkersmeldingen en simulatie-eerlijkheid (algemene regel)

**Elke medewerkersmelding in Build 03 die op registratie, verzending of
vastlegging betrekking heeft, maakt expliciet duidelijk dat Build 03
uitsluitend een simulatie is en dat geen echte TOPdesk-registratie
plaatsvindt of mogelijk is.** Concreet:

- **Preview (alle intake-typen):** "Dit is een voorbeeld (simulatie) van
  je [melding/aanvraag/beveiligingsmelding]. Er wordt in deze versie van
  Elvie niets naar TOPdesk verzonden — je bekijkt een voorbeeld. Bevestig
  om de simulatie af te ronden." — de preview wekt nooit de indruk dat een
  echte registratie mogelijk is.
- **Incident-preview:** "voorbeeld (simulatie) van je melding …".
- **Request-preview:** "voorbeeld (simulatie) van je aanvraag …" — nooit
  incident-bewoording, geen registratie-claim, geen buildnummers.
- **Security-preview:** "voorbeeld (simulatie) van je
  beveiligingsmelding …".
- **Succes (mock):** "De simulatie is afgerond met voorbeeldreferentie
  SIM-…. Let op: dit is een simulatie — er is géén echte TOPdesk-melding
  aangemaakt. Neem voor echte afhandeling contact op met de
  IT-servicebalie."
- **Fout/onzeker:** de vaste teksten uit §12; geen successclaim, geen
  referentie, altijd expliciet dat niets is verzonden.
- Geen enkele tekst in de medewerkersinterface suggereert een echte
  TOPdesk-registratie; bronvermeldingen bij kennisartikelen zijn
  catalogusverwijzingen (§6), geen registratie-claims.

## 10. TicketPort: generiek, TOPdesk-onafhankelijk simulatiecontract

### 10.1 Contract

De bestaande IncidentPort (uitsluitend incidenten) wordt vervangen door
een generiek mockcontract. Zonder deze generalisatie zouden requests en
securitymeldingen stilzwijgend als incident worden gesimuleerd —
verboden volgens de review — en zou de drieweg-architectuur (§8.1) zich
niet correct laten simuleren. De wijziging is puur generiek: geen
TOPdesk-semantiek, tickettypen of routering (Build 04/06). Enige
consumenten zijn de engine en de tests.

```ts
export type TicketCategory = 'incident' | 'request' | 'security';

/**
 * Deterministische, inhoudloze inzendingssleutel (intern: sessie-id +
 * inzendingsbeurt). Bevat nooit gespreks- of ticketinhoud. Identificeert
 * één logische inzending; bepaalt idempotentie aan poortzijde en is het
 * enige identificatiemiddel dat ook zonder ontvangen referentie werkt.
 */
export interface SubmissionKey {
  readonly value: string;
}

export interface TicketDraft {
  readonly category: TicketCategory;
  readonly summary: string;
  readonly description: string;
  readonly context: Readonly<Record<string, string>>; // gecontroleerde waarden
  readonly submissionKey: SubmissionKey;
}

/**
 * Discriminated union: exact één uitkomst per inzending.
 * - submitted  : aantoonbaar geslaagde simulatieregistratie;
 *                NIET-LEGE, geldige referentie verplicht; de
 *                submissionKey echoot EXACT de sleutel uit het draft.
 * - failed     : aantoonbaar definitieve fout; geen bevestigde referentie.
 * - unknown    : onzekere uitkomst (timeout/transport); geen bevestigde
 *                referentie.
 * Ongeldige of tegenstrijdige respons (verkeerde variant, lege referentie
 * bij submitted, afwijkende submissionKey) is een contractschending en
 * wordt door Elvie als 'unknown' behandeld: NOOIT CONFIRM.
 */
export type TicketSubmissionResult =
  | {
      readonly kind: 'submitted';
      readonly reference: string;        // niet-leeg, verplicht
      readonly submissionKey: SubmissionKey; // exact gelijk aan draft-sleutel
    }
  | {
      readonly kind: 'failed';
      readonly submissionKey: SubmissionKey; // exact gelijk aan draft-sleutel
      readonly reasonCategory: 'rejected' | 'invalid_draft';
      // GEEN referentieveld
    }
  | {
      readonly kind: 'unknown';
      readonly submissionKey: SubmissionKey; // exact gelijk aan draft-sleutel
      readonly reasonCategory: 'timeout' | 'transport';
      // GEEN referentieveld
    };

/**
 * Discriminated statusresultaat (v5.2.1): exact één uitkomst per
 * statuscontrole op dezelfde SubmissionKey.
 * - submitted: aantoonbaar geslaagde simulatieregistratie; NIET-LEGE,
 *   geldige referentie verplicht; de submissionKey echoot EXACT de
 *   sleutel van de logische inzending.
 * - unknown:    onzekere uitkomst; GEEN referentieveld.
 * Ongeldige of tegenstrijdige statusrespons (verkeerde variant, lege
 * referentie bij submitted, afwijkende submissionKey, referentieveld
 * bij unknown) is een contractschending en wordt door Elvie
 * fail-closed als onzeker (inconclusive) behandeld: NOOIT CONFIRM.
 */
export type TicketStatusResult =
  | {
      readonly kind: 'submitted';
      readonly submissionKey: SubmissionKey; // exact gelijk aan de inzendings-sleutel
      readonly reference: string;            // niet-leeg, verplicht
    }
  | {
      readonly kind: 'unknown';
      readonly submissionKey: SubmissionKey; // exact gelijk aan de inzendings-sleutel
      // GEEN referentieveld
    };

export interface TicketPort {
  /** Idempotent per submissionKey: zelfde sleutel → zelfde resultaat,
      nooit een tweede registratie. */
  submit(draft: TicketDraft): Promise<TicketSubmissionResult>;
  /** Statuscontrole uitsluitend op de sleutel; werkt ook wanneer nooit
      een referentie is ontvangen. Retourneert een discriminated
      TicketStatusResult (v5.2.1). */
  getStatus(submissionKey: SubmissionKey): Promise<TicketStatusResult>;
}
```

Contractregels (verplicht, getest):

- **submitted vereist** een niet-lege referentie én een submissionKey die
  exact overeenkomt met het draft; anders is de respons ongeldig.
- **failed/unknown bevatten nooit een referentie.**
- **submitted-status vereist** (v5.2.1) een niet-lege referentie én een
  submissionKey die exact overeenkomt met de sleutel van de logische
  inzending; anders is de statusrespons ongeldig.
- **unknown-status bevat nooit een referentie.**
- Elvies engine valideert elke respons: een `submitted`-variant met lege
  referentie, een `failed`/`unknown`-variant mét referentie, of een
  afwijkende submissionKey wordt als **ongeldig/tegenstrijdig** behandeld
  → verwerkt als `unknown` (onzeker) → **nooit CONFIRM**; veilig gelogd
  (`submission_contract_violation`-categorie, zonder inhoud).
- Elvies engine valideert elke statusrespons (v5.2.1): een
  `submitted`-status met lege referentie, een `unknown`-status mét
  referentieveld, of een afwijkende submissionKey wordt als
  **ongeldig/tegenstrijdig** behandeld → fail-closed verwerkt als
  `inconclusive` → **nooit CONFIRM**; veilig gelogd
  (`submission_contract_violation`-categorie, zonder inhoud).
- `submit` is idempotent per submissionKey (zelfde resultaat, geen tweede
  registratie).
- `getStatus` accepteert uitsluitend de sleutel.
- De sleutel is inhoudsloos en deterministisch per (sessie, beurt); binnen
  één sessie is één logische inzending één sleutel.

### 10.2 Simulatie vs. echte registratie

- Alle referenties zijn fictief (formaat "SIM-<categorie>-<id>",
  naamgeving beslispunt); alle registratie is simulatie.
- De preview en alle meldingen benoemen de simulatiestatus expliciet
  conform §9.2.
- Geen codepad beweert een echte TOPdesk-registratie; echte registratie
  bestaat niet in Build 03.

## 11. SubmissionStatus (intern, in ConversationContext)

Naast `currentState` (geen lifecycle-wijziging):

```ts
export type SubmissionStatus =
  | 'idle'          // geen inzending in deze sessie
  | 'confirmed'     // expliciet bevestigd; submit(gestarte) poging actief
  | 'submitted'     // aantoonbaar succes (kind 'submitted', gevalideerd)
  | 'failed'        // aantoonbaar definitieve fout
  | 'inconclusive'; // onzekere uitkomst of ongeldige respons
```

Regels (verplicht, getest):

- Bij `inconclusive` leidt nieuwe invoer — ook 'versturen' — **nooit**
  automatisch tot een nieuwe submit-aanroep. Elvie start uitsluitend een
  statuscontrole `getStatus(sleutel)` met dezelfde SubmissionKey:
  - geldige `kind: 'submitted'`-status (niet-lege referentie, exact
    overeenkomende submissionKey) → succesroute (PREVIEW → SUBMIT →
    CONFIRM) met de bestaande fictieve referentie;
  - geldige `kind: 'unknown'`-status → blijft `inconclusive` + PREVIEW;
    vaste dubbel-/simulatie-tekst met servicebalie-verwijzing;
  - ongeldige of tegenstrijdige statusrespons → fail-closed
    `inconclusive` (nooit CONFIRM); veilig gelogd;
  - exception bij de statuscontrole → blijft `inconclusive`; herhaalde
    'versturen'-invoer herhaalt alléén de statuscontrole.
- Herstel verloopt uitsluitend via statuscontrole en aantoonbare
  idempotentie; nooit via ongemerkt herverzenden.
- Bij `failed` is een nieuwe poging alleen mogelijk na expliciete nieuwe
  bevestiging in een nieuwe medewerkersbeurt (nieuwe beurt → nieuwe
  sleutel).
- Lifecycle-invariant: bij elke status ≠ `submitted` is
  `currentState === 'PREVIEW'` (geldige, bruikbare state); CONFIRM
  uitsluitend bij `submitted` na de transities PREVIEW → SUBMIT → CONFIRM.
- De status is puur intern; de medewerkersinterface gebruikt alléén de
  vaste teksten.

## 12. SUBMIT-afhandeling en exception-regels

### 12.1 Uitgestelde SUBMIT-transitie

De engine roept de poort aan vóór de SUBMIT-transitie. In PREVIEW na
expliciete bevestiging: (a) aanmaak SubmissionKey (sessie + beurt);
(b) `SubmissionStatus := 'confirmed'`; (c) `submit(draft)` mét sleutel;
(d) bij geldig `submitted`-resultaat → status `submitted`, transities
`PREVIEW → SUBMIT → CONFIRM`, succesmelding met fictieve referentie en
expliciete simulatie-vermelding (§9.2).

### 12.2 Resultaatverwerking en exception-afhandeling (definitieve regels)

| Uitkomst van `submit` | SubmissionStatus | Medewerkerstekst | Transitie |
|---|---|---|---|
| geldig `submitted` | `submitted` | simulatie-succes (§9.2) | PREVIEW → SUBMIT → CONFIRM |
| geldig `failed` (aantoonbaar definitief: rejected/invalid_draft) | `failed` | "Het versturen is niet gelukt; er is niets vastgelegd of verzonden. Je kunt het opnieuw proberen of contact opnemen met de IT-servicebalie." | geen; blijft PREVIEW |
| geldig `unknown` (timeout/transport) | `inconclusive` | "Het is niet zeker of de simulatie is aangekomen. Ik heb niets opnieuw verstuurd om dubbele verwerking te voorkomen. Neem bij twijfel contact op met de IT-servicebalie." | geen; blijft PREVIEW |
| **exception bij submit: timeout, netwerkonderbreking, onbekende transportfout** | `inconclusive` | zelfde tekst als `unknown` | geen; blijft PREVIEW |
| exception met aantoonbaar definitieve fout (alléén wanneer de poort expliciet een definitieve fout signaleert) | `failed` | zelfde tekst als `failed` | geen; blijft PREVIEW |
| ongeldige/tegenstrijdige respons (§10.1) | `inconclusive` | zelfde tekst als `unknown` | geen; blijft PREVIEW |
| geldige statusrespons `kind: 'submitted'` (herstel na timeout, §11) | `submitted` | simulatie-succes (§9.2) | PREVIEW → SUBMIT → CONFIRM |
| geldige statusrespons `kind: 'unknown'` | `inconclusive` | zelfde tekst als `unknown` | geen; blijft PREVIEW |
| ongeldige/tegenstrijdige statusrespons (§10.1, v5.2.1) | `inconclusive` | zelfde tekst als `unknown` | geen; blijft PREVIEW |

- **Uitsluitend aantoonbaar definitieve fouten → `failed`.** Alle
  timeouts, netwerkonderbrekingen en onbekende transportfouten →
  `inconclusive` (de uitkomst is onbekend; er kan al een registratie
  hebben plaatsgevonden).
- **Exception bij `getStatus`:** status `inconclusive` blijft behouden;
  de vaste onzekerheidstekst geldt; géén nieuwe submit-aanroep; nieuwe
  'versturen'-invoer herhaalt alléén de statuscontrole.
- **Geen automatische herverzending** in enig pad; herstel uitsluitend
  via statuscontrole (§11) of expliciete nieuwe bevestiging bij `failed`
  (nieuwe beurt, nieuwe sleutel).
- **Dubbele tickets onmogelijk:** idempotente poort per sleutel, geen
  automatische retry, elke submit vereist expliciete bevestiging,
  statuscontrole vóór verdere stappen.
- **Statusresponscontract (v5.2.1):** elke `getStatus`-respons is een
  gevalideerde discriminated union; herstel na een timeout verloopt
  uitsluitend via een geldige `kind: 'submitted'`-status met dezelfde
  SubmissionKey en de bestaande fictieve referentie (PREVIEW → SUBMIT →
  CONFIRM). Ongeldige of tegenstrijdige statusresponsen zijn fail-closed
  `inconclusive` en leiden nooit tot CONFIRM of een nieuwe
  submit-aanroep.
- SUBMIT wordt uitsluitend als doorgangsstap PREVIEW→CONFIRM gebruikt; de
  engine verkeert nooit rustend in SUBMIT.

### 12.3 Logging

Audit-events `ticket_submission / success|failed|inconclusive` (actor,
correlation-id, veilige categorie — geen inhoud, geen gevoelige waarden,
geen referenties in logs waar niet vereist); operationele logging met
veilige fout-categorie (`timeout`, `transport`, `rejected`,
`invalid_draft`, `submission_contract_violation`). Bestaande
audit-invarianten ongewijzigd.

## 13. Engine-fixes (regressietests die op huidige main falen)

1. Zoekvraag uitsluitend uit gecontroleerde contextwaarden (§4); nooit
   ruwe `initial_question`-tekst naar de poort.
2. Intake vraagt nooit reeds bekende informatie (§8.2).
3. Intent-correcte bewoording en routes (§9); incident-bewoording
   uitsluitend bij incident.
4. Driewegresolutie en KnowledgePhase (§7).
5. Uitgestelde SUBMIT-transitie met discriminated-union-verwerking,
   SubmissionStatus en exception-regels (§10–§12).

## 14. Testmatrix (minimum, incl. negatieve regressietests)

**Autorisatie & informatielekken:**
- granted-artikel aangeboden; elk fail-closed-pad (denied, inconclusive,
  afwezig, tegenstrijdig granted-zonder-policyId) biedt niets aan;
- geweigerd artikel onzichtbaar en niet als bestaand herkenbaar;
  "uitsluitend afgeschermde resultaten"-tekst identiek aan "geen
  resultaten"-tekst;
- interne logcategorieën afzonderlijk zonder gevoelige gegevens of
  artikelinhoud;
- geweigerd-artikelpad ≠ algemene storingpad in gedrag, tekst en log;
- defense-in-depth afzonderlijk testbaar (granted + foute audience →
  niet aangeboden).

**Zoekvraagopbouw (allowlist, negatief):**
- uitsluitend cataloguswaarden; determinisme; onbekende waarden afwezig;
- niet-catalogus-subject, niet-gecontroleerde symptoomtekst,
  manipulatieve injectie en geen-andere-contextvelden bereiken de poort
  nooit (port-aanroep-asserties).

**Gating/ranking/presentatie:**
- draft/verlopen/taal/kwaliteit/geldigheid (grensgevallen met
  geïnjecteerde klok); regelbijdragen, tie-break, relevantedrempel;
  herhaalde uitvoering identiek; explanation-records; vast
  presentatieformaat; max. 1 artikel per stap; max. 3 verschillende
  artikelen per reeks.

**Resolutie & KnowledgePhase:**
- opgelost → DONE uitsluitend na expliciete bevestiging; niet-opgelost →
  volgend artikel; onduidelijk → verduidelijking (geen afwijzing);
  herhaald onduidelijk → volgend artikel; onherkend → 1× herhalen → als
  onduidelijk; uitputting → intake-route;
- invoer na zoekfout wordt nooit als oplossingsfeedback geïnterpreteerd;
- per-substatus onwettige invoer → vaste herhaaldvraging.

**Intake & context:**
- drie intake-typen vragen uitsluitend ontbrekende informatie (positief +
  negatief per type); hergebruik van explicit/derived facts incl.
  voorrang en correcties; geen overschrijving van bekende feiten;
- request leidt nooit tot incident-bewoording of `TicketCategory
  'incident'`; security leidt nooit tot gewoon incident (asserties op
  TicketDraft en preview-tekst);
- phishing en unknown roepen de kennispoort nooit aan;
- preview toont actuele context, intent-correcte bewoording, geen
  gevoelige patronen (PII-preview-tests).

**TicketPort-contract (discriminated union, negatief):**
- geldig `submitted` met niet-lege referentie en exact overeenkomende
  submissionKey → `submitted`/CONFIRM;
- **negatief:** `submitted` met lege/afwezige referentie → ongeldig →
  `inconclusive`, nooit CONFIRM;
- **negatief:** afwijkende submissionKey in het resultaat → ongeldig →
  `inconclusive`, nooit CONFIRM;
- **negatief:** `failed`/`unknown`-variant mét referentieveld → ongeldig
  → `inconclusive`, nooit CONFIRM;
- idempotentie: zelfde sleutel → zelfde resultaat, één registratie
  (call-count-assertie);
- `getStatus` werkt met alléén de sleutel wanneer géén referentie is
  ontvangen (timeout-pad);
- **`getStatus` is discriminated (v5.2.1), positief en negatief:** geldige
  `kind: 'submitted'`-status met niet-lege referentie en exact
  overeenkomende submissionKey; **negatief:** lege/afwezige referentie,
  afwijkende submissionKey, `unknown` mét ongeoorloofd reference-veld →
  ongeldig → fail-closed `inconclusive`, nooit CONFIRM, veilig gelogd;
- sleutel is inhoudsloos (geen inhoud in sleutel/log/payload).

**SubmissionStatus & exception-afhandeling (negatief, faalt zonder v5.2):**
- timeout/netwerkonderbreking/onbekende transportfout bij submit →
  `inconclusive` (nooit `failed`), blijft PREVIEW;
- uitsluitend aantoonbaar definitieve fout → `failed`, blijft PREVIEW;
- exception bij `getStatus` → `inconclusive` blijft behouden; géén
  nieuwe submit;
- na `inconclusive` leidt invoer 'versturen' NIET tot een nieuwe
  submit-aanroep (poort-call-assertie), alléén tot statuscontrole;
  herhaalde 'versturen'-beurten veroorzaken nooit een tweede submit;
- `getStatus → 'submitted'` → CONFIRM met bestaande fictieve referentie;
  `getStatus → 'unknown'` → blijft PREVIEW + onzekerheidstekst;
- **timeout-herstel (v5.2.1):** herstel via geldige `kind: 'submitted'`-
  status met dezelfde SubmissionKey en de bestaande fictieve referentie →
  CONFIRM zonder tweede submit (poort-call-assertie); herhaalde
  'versturen'-beurten veroorzaken nooit een tweede submit; ongeldige
  statusrespons → blijft PREVIEW + veilige log;
- `failed` → nieuwe poging alléén na expliciete bevestiging in nieuwe
  beurt (nieuwe sleutel);
- lifecycle-invariant: `currentState === PREVIEW` bij elke status ≠
  `submitted`; CONFIRM alléén bij `submitted`.

**Simulatie-eerlijkheid (negatief, tekst-asserties):**
- phishing-instructie bevat geen registratie-/verzendingsclaim (assertie
  op "niet registreren of versturen"-semantiek);
- preview (alle drie typen) bevat expliciete simulatie-vermelding en geen
  echte-TOPdesk-suggestie;
- mock-succesmelding benoemt expliciet simulatie en fictieve referentie;
- fout-/onzekerheidsteksten bevatten nooit een successclaim of referentie;
- geen enkele medewerkersmelding in de volledige flow suggereert een
  echte TOPdesk-registratie.

**Overig:**
- state-machine-compatibiliteit (alleen bestaande edges; ongeldige
  transitie blijft gooien); determinisme end-to-end; veilig loggen;
  bestaande Build 01/02-regressie.

## 15. Security- en determinismeacceptatie

1. Geen productiegeheimen/-data/-URLs; uitsluitend fictieve catalogus,
   fictieve referenties, fictieve teksten.
2. Geen nieuwe runtime-dependencies.
3. Geen AI/LLM/externe NLP; deterministische matching met regel-ids.
4. Geen browser-naar-TOPdesk-pad; geen echte TOPdesk-integratie.
5. Server-side autorisatie bij de adapter; fail-closed;
   defense-in-depth onafhankelijk testbaar; geen informatielekken over
   afgeschermde artikelen.
6. Kennisinhoud en gespreksinhoud nooit in logs; alleen veilige id's en
   categorieën.
7. Geen persistente kennisopslag.
8. Zoekvragen, previews en mockpayloads bevatten uitsluitend gecontroleerde
   waarden; PII en manipulatieve invoer bereiken poort, preview en payload
   nooit (negatief getest).
9. Requests en securitymeldingen worden nooit stilzwijgend als incident
   gesimuleerd.
10. SUBMIT-uitkomsten zijn een gevalideerde discriminated union; ongeldige
    of tegenstrijdige responsen leiden nooit tot CONFIRM; timeouts,
    netwerkonderbrekingen en onbekende transportfouten zijn altijd
    `inconclusive`; uitsluitend aantoonbaar definitieve fouten zijn
    `failed`; geen automatische herverzending; dubbele tickets zijn
    uitgesloten (idempotentie + statuscontrole, getest).
11. Alle medewerkersmeldingen, previews en successen benoemen waar relevant
    expliciet de simulatiestatus; nergens wordt een echte
    TOPdesk-registratie gesuggereerd (tekst-asserties over de volledige
    flow).
12. Alle bestaande Build 01/02-securitytests blijven groen.
13. Identieke inputs/configuratie → identieke resultaten (getest).

## 16. Definition of Done

- Alle scope-items geïmplementeerd en gedekt door §14.
- Regressietests voor de engine-fixes (§13) die falen op huidige main.
- Generiek TicketPort-mockcontract (discriminated union, SubmissionKey,
  idempotentie, getStatus) geïmplementeerd; IncidentPort vervangen;
  SubmissionStatus en KnowledgePhase in ConversationContext.
- Geen wijzigingen aan de state machine, ARCHITECTURE.md,
  SECURITY_PRINCIPLES.md of AUDIT_LOGGING.md; ROADMAP.md wordt bij de
  latere implementatie bijgewerkt.
- Completionrapport conform de BUILD_02-conventie (bestanden, regel-ids,
  contractwijzigingen, testaantallen, CI-resultaat,
  acceptatieresultaten, bekende beperkingen).

## 17. Openstaande beslispunten

1. Definitieve organisatieteksten (phishing-instructie, preview- en
   succesformuleringen) — voorgestelde standaarden zijn configureerbaar
   te vervangen.
2. Formaat van de fictieve referentie (voorstel: "SIM-<categorie>-<id>").
3. Definitieve matchregel-ids voor ranking (voorstel in §5).
