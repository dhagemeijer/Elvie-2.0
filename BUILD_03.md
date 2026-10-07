# ELVIE 2.0 — BUILD 03: Knowledge & Resolution

Status: definitief goedgekeurde specificatie (v5.2). Implementatie vindt plaats op de branch build-03-knowledge-resolution.

## 1. Doel en functionele scope

Elvie begeleidt de medewerker van begin tot eind: van vraag naar een passende oplossing via kennisartikelen en, wanneer selfservice niet helpt, naar een passend vastgelegd ticket in de simulatie. Geen doodlopende gesprekken en geen dubbele vragen.

**Scope (functioneel):**

- uitgebreid KnowledgePort-contract met een fictieve kennisadapter (mock);
- server-side autorisatiebesluiten met fail-closed filtering;
- gecontroleerde, allowlist-gebaseerde zoekvraagopbouw vanuit de Build 02-gespreidscontext;
- deterministische gating en ranking met uitlegbare matchregels;
- maximaal drie verschillende kennisartikelen per oplossingsreeks;
- interne KnowledgePhase-substatus voor zoeken, feedback, verduidelijking, foutafhandeling en uitputting;
- geleide oplossingsflow met driewegfeedback: opgelost / niet opgelost / onduidelijk;
- generieke intake met interne intake-typen incident / request / security;
- never-knowingly-ask-twice op engineniveau;
- veilige phishing/security-route zonder reguliere kenniszoekactie;
- generiek TicketPort (vervangt de incident-only mockpoort) met SubmissionKey, idempotentie, SubmissionStatus, getStatus en een discriminated TicketSubmissionResult;
- contractvalidatie vóór CONFIRM; uitgestelde SUBMIT-transitie; onderscheid failed versus inconclusive; geen automatische herverzending;
- expliciete simulatie-eerlijkheid in alle relevante medewerkersmeldingen;
- veilige audit- en operationele logging.

**Expliciete uitsluitingen:**

- geen echte TOPdesk-, Entra- of SharePoint-integratie (Build 05/06);
- geen LLM, generatieve AI, externe NLP, internetzoekactie of nieuwe runtime-dependencies;
- geen eigen persistente kennisbank: TOPdesk Knowledge blijft de gezaghebbende bron;
- geen rechtstreekse browser-naar-TOPdesk-communicatie;
- echte tickettypen, routering, payload-mapping en securityregistratie blijven Build 04/06;
- geen nieuwe lifecycle-states of ongeoorloofde transities; de Build 01 state machine blijft autoritair en ongewijzigd.

## 2. Aansluiting op de bestaande architectuur

- De Build 01 state machine (STATE_TRANSITIONS in src/domain/state-machine.ts) is en blijft de enige bron van gespreksstates. Build 03 voegt geen enkele state of transitie toe.
- Gebruikte transities zijn uitsluitend bestaande edges: START naar UNDERSTAND; UNDERSTAND naar KNOWLEDGE_SEARCH; KNOWLEDGE_SEARCH naar RESOLVE of INTAKE; RESOLVE naar DONE of INTAKE; INTAKE naar COMPLETE_CONTEXT; COMPLETE_CONTEXT naar PREVIEW; PREVIEW naar SUBMIT; SUBMIT naar CONFIRM.
- SUBMIT wordt pas gezet nadat de TicketPort-aanroep is uitgevoerd én het resultaat contractgeldig is; anders blijft het gesprek in PREVIEW. De niet-bestaande edge SUBMIT naar PREVIEW wordt daardoor nooit nodig.
- De interne substatus (KnowledgePhase) en submission-status (SubmissionStatus) zijn géén lifecycle-states: ze leven in ConversationContext en sturen alleen interpretatie van invoer binnen de bestaande states.
- Build 02-contracten blijven ongewijzigd: Conversation Core, FactRecord (discriminated union met confidence op afgeleide feiten), RecognitionCatalog, missing-information-engine en beslissingsregels worden hergebruikt.

## 3. KnowledgePort-contract en TOPdesk-adaptergrens

Het KnowledgePort-contract (src/ports/knowledge.ts) is de enige grens tussen het gespreksdomein en kennisvoorziening. De toekomstige TOPdesk Knowledge-adapter implementeert dit port; het domein kent geen TOPdesk-details.

Zoekvraag (KnowledgeSearchQuery):

- intent: de actuele Build 02-intent (enum, nooit vrije tekst);
- subject: canonieke cataloguswaarde (applicatie of apparaat), optioneel;
- symptom: gecontroleerde symptomwaarde, optioneel;
- requestedResource: canonieke cataloguswaarde, optioneel;
- keywords: uitsluitend canonieke cataloguswaarden.

Artikelmetadata (KnowledgeArticle): id, titel, samenvatting, stappen, status (published/draft/archived), taal, minimumQualityMet, validFrom/validUntil, matchvelden (subject, symptom, requestedResource, keywords) en vertrouwde autorisatiemetadata (policyId, allowedAudiences).

Antwoord (KnowledgeSearchResponse): results (uitsluitend geautoriseerde artikelen) en outcome (ok / no_results / unavailable). De medewerker kan uit het antwoord nooit afleiden dat afgeschermde kennis bestaat.

## 4. Autorisatie en anti-informatielek

Vertrouwenscontract: autorisatie is een server-side verplichting van de kennisadapter (in Build 06 de TOPdesk-adapter). Elke adapterbeslissing wordt vastgelegd als KnowledgeAuthorizationDecision met decidedBy knowledge-adapter en:

- granted: met verplicht policyId;
- denied of inconclusive: met verplicht reasonCategory.

Fail-closed: ontbrekende, onvolledige of tegenstrijdige autorisatiemetadata (bijvoorbeeld ontbrekend policyId) leidt altijd tot inconclusive en het artikel wordt niet aangeboden.

Niet-detecteerbaarheid van afgeschermde kennis:

- een geweigerd artikel is voor de medewerker onzichtbaar en niet herkenbaar als bestaand artikel;
- het medewerkersantwoord bij uitsluitend afgeschermde resultaten is byte-voor-byte identiek aan het antwoord bij geen resultaten;
- intern logt de adapter (en de engine) wel onderscheiden, zonder artikelinhoud of gevoelige gegevens: authorization_denied, no_results, authorization_inconclusive;
- een autorisatiefout op één artikel is niet te verwarren met een algemene storing van de kennisvoorziening: een algemene storing (outcome unavailable, dependency-uitval) geeft een eigen herstelroute (opnieuw proberen of vastleggen), zonder informatie over afgeschermde artikelen.

De domeinfilter op allowedAudiences is defense-in-depth en nooit een vervanging van server-side autorisatie. Het toegangsmodel (audience-begrippen) is bewust organisatie-configureerbaar en niet beperkt tot employee/servicedesk; de mock ondersteunt negatieve autorisatietests (artikelen met een audience waar de medewerker niet toe behoort, en artikelen met onbetrouwbare metadata).

## 5. Fictieve kenniscatalogus

Build 03 gebruikt uitsluitend fictieve testdata (src/mocks/mock-knowledge.ts). Geen echt LV- of TOPdesk-gehalte. De catalogus bevat naast normale artikelen expliciet negatieve testitems:

- een artikel met audience servicadesk (geweigerd voor medewerker);
- een draft-artikel en een gearchiveerd artikel (statusgating);
- een verlopen artikel en een nog niet geldig artikel (geldigheidscontrole);
- een artikel zonder minimale kwaliteit (kwaliteitsgating);
- een artikel met onbetrouwbare autorisatiemetadata (fail-closed).

## 6. Zoekvraagopbouw en dataminimalisatie

De bestaande PII-detectie is een vangnet, geen garantie. Daarom bereikt de KnowledgePort uitsluitend gecontroleerde, expliciet toegestane waarden:

- subject, symptom en requestedResource worden gevalideerd tegen vaste allowlists (canonieke cataloguswaarden en de Build 02-symptomwaarden uit SYMPTOM_RULE_VALUES);
- onbekende, niet-allowlisted of manipulatieve waarden worden verwijderd, nooit doorgestuurd;
- vrije gebruikersinvoer (zoals de oorspronkelijke vraagtekst) bereikt de port nooit; de engine bouwt de vraag uitsluitend op uit gestructureerde FactRecords;
- factcategorieën met werkelijke medewerkersformuleringen (zoals locatie, impact of starttijd) worden niet in de zoekvraag opgenomen.

Negatieve tests dekken persoonsgegevens, onbekende waarden en manipulatieve invoer (bijvoorbeeld een subjectwaarde met injectie-achtige inhoud die de allowlist niet haalt).

## 7. Deterministische gating en ranking

Gating (vóór ranking, met geïnjecteerde klok now):

- status published;
- taal nl-NL;
- minimumQualityMet waar;
- validFrom kleiner dan of gelijk aan now;
- validUntil ontbreekt of ligt in de toekomst.

Ranking (uitlegbaar, regel-ids):

- rank_subject_exact: artikelsubject is exact de querysubject;
- rank_symptom_match: artikelsymptom is exact de querysymptom;
- rank_resource_match: gevraagde resource komt overeen;
- rank_keyword_match: minstens één gecontroleerd keyword komt overeen.

Relevantiedrempel: een artikel moet minimaal één matchregel halen. De sortering is een geordende tuple (subject, symptom, resource, keyword), aflopend; bij gelijkwaardigheid bepaalt de artikel-id (oplopend) de volgorde. Alles is deterministisch: identieke invoer geeft identieke resultaten; tijd komt uitsluitend via de geïnjecteerde klok binnen.

## 8. Presentatie van artikelinhoud en bronvermelding

De engine presenteert maximaal één artikel per beurt, met titel, samenvatting, stappen en een bronvermelding (kennissysteem, simulatie). Artikelinhoud wordt nooit in logs opgenomen. De presentatie eindigt met de driewegfeedbackvraag.

## 9. KnowledgePhase-substatus

ConversationContext bevat knowledgePhase met precies deze waarden: searching, awaiting_feedback, clarifying, dependency_error, exhausted. Per substatus:

- searching: geen directe invoer verwacht; alleen intern tijdens het zoeken.
- awaiting_feedback: toegestane invoer is uitsluitend opgelost / niet opgelost / onduidelijk (met ja/nee-aliassen). Acties: opgelost naar RESOLVE naar DONE; niet opgelost biedt het volgende artikel of gaat naar INTAKE; onduidelijk start verduidelijking. Geen retries.
- clarifying: invoer is verduidelijking bij het huidige artikel en wordt nooit automatisch als afwijzing behandeld. Expliciete feedbackwoorden worden geaccepteerd. Acties: context-verrijking via de Build 02-core, daarna hetzelfde artikel opnieuw aanbieden met feedbackvraag. Maximaal één verduidelijkingsronde per artikel; daarna (bij opnieuw onduidelijk) volgt het volgende artikel. Voorkomt oneindige loops.
- dependency_error: invoer na een zoekfout wordt NOOIT als oplossingsfeedback geïnterpreteerd. Toegestane invoer: opnieuw (herhaal kenniszoekactie) of melding (gecontroleerde overgang KNOWLEDGE_SEARCH naar INTAKE). Alle overige invoer herhaalt veilig de herstelopties. Transities: KNOWLEDGE_SEARCH naar INTAKE of blijven.
- exhausted: de reeks is uitgeput (meer dan drie artikelen aangeboden of geen artikelen meer); de engine gaat gecontroleerd naar INTAKE.

## 10. Geleide oplossingsflow

- Maximaal drie verschillende artikelen per oplossingsreeks (knowledgeOfferedArticleIds).
- Opgelost leidt uitsluitend na expliciete bevestiging naar DONE (via RESOLVE).
- Niet opgelost biedt eventueel het volgende geschikte artikel.
- Onduidelijk vraagt verduidelijking (clarifying) en is geen automatische afwijzing.
- Herhaald onduidelijk en uitputting zijn vastgelegd (één verduidelijkingsronde; daarna volgend artikel of INTAKE) zonder oneindige loops.
- Wanneer kennis geen oplossing biedt, is KNOWLEDGE_SEARCH naar INTAKE de standaardroute; INTAKE is generiek en niet uitsluitend voor incidenten.

## 11. Intent-specifieke routes

- Incident: zoek kennis; bij geen resultaat of uitputting gecontroleerd naar INTAKE (intake-type incident).
- Request: dezelfde kennisroute, maar intake-type request. Geen enkele request wordt stilzwijgend als incident geregistreerd; previews en teksten zijn intent-correct (aanvraag).
- Phishing/security: géén reguliere kenniszoekactie (de KnowledgePort wordt niet aangeroepen). De medewerker ontvangt een neutrale, configureerbare veiligheidsinstructie zonder onvoorwaardelijk wachtwoordadvies, gevolgd door een gespecialiseerde security-intake (intake-type security). Security-routering en echte registratie blijven Build 04/06. De lifecycle passeert KNOWLEDGE_SEARCH (bestaande edge UNDERSTAND naar KNOWLEDGE_SEARCH en KNOWLEDGE_SEARCH naar INTAKE) zonder poortaanroep.
- Unknown: verduidelijking binnen UNDERSTAND; geen geforceerde kenniszoekactie of intake.

## 12. Generieke intake en TicketPort

Never-knowingly-ask-twice op engineniveau: de intake hergebruikt de Build 02 missing-information-berekening. Alle betrouwbaar bekende gegevens (expliciete en afgeleide feiten volgens de Build 02-regels) worden hergebruikt; alleen ontbrekende informatie wordt gevraagd. Als de medewerker antwoordt maar de deterministische core geen gestructureerd feit kan afleiden, wordt het antwoord als waarde voor die categorie vastgelegd zodat die vraag nooit terugkomt.

Interne intake-typen (intakeType in ConversationContext): incident, request, security. Deze bepalen de neutrale bewoording van previews en teksten én de categorie van het ticketconcept. Simulatie versus registratie: Build 03 simuleert generieke ticketafhandeling met fictieve gegevens; alle medewerkersmeldingen (phishing-instructie, previews, succes- en foutteksten) maken expliciet duidelijk dat het een simulatie betreft en suggereren nergens een echte TOPdesk-registratie. Fictieve referenties hebben het formaat SIM-categorie-volgnummer (bijvoorbeeld SIM-incident-0001).

TicketPort (src/ports/ticket.ts, vervangt de incident-only poort):

- TicketCategory: incident / request / security;
- TicketDraft: categorie, samenvatting, beschrijving en niet-gevoelige contextfeiten (uitsluitend gestructureerde waarden);
- SubmissionKey: inhoudsloze sleutel (sessie-id plus pogingnummer); zowel submit als getStatus gebruiken dezelfde sleutel, ook wanneer nooit een referentie is ontvangen;
- TicketSubmissionResult, discriminated union:
  - submitted: verplicht niet-lege referentie en exact dezelfde submissionKey;
  - failed (reasonCategory rejected of invalid_draft): geen bevestigde referentie;
  - inconclusive (reasonCategory timeout, transport of unknown_transport): geen bevestigde referentie;
- TicketStatusResult via getStatus: submitted (met referentie) of inconclusive; werkt ook zonder eerder ontvangen referentie.

Idempotentie: de adapter behandelt dezelfde SubmissionKey als dezelfde logische inzending (geen tweede ticket). Nieuwe pogingen krijgen een nieuwe sleutel.

## 13. SubmissionStatus en foutafhandeling

SubmissionStatus in ConversationContext: idle, confirmed, submitted, failed, inconclusive.

Uitgestelde SUBMIT-transitie: de engine roept de poort aan vóór enige transitie. Pas bij een contractgeldige submitted-respons volgt PREVIEW naar SUBMIT naar CONFIRM. Elke andere uitkomst laat het gesprek in PREVIEW achter (bruikbaar, nooit vastgelopen).

Contractvalidatie vóór CONFIRM: een submitted-responent geldt alléén als de referentie niet-lege tekst is én de submissionKey exact overeenkomt met de oorspronkelijke sleutel. Ongeldige of tegenstrijdige responsen (lege referentie, verkeerde sleutel, onbekende vorm) leiden NOOIT tot CONFIRM en worden behandeld als inconclusive, met een auditgebeurtenis reason submission_contract_violation.

Exception-afhandeling:

- timeout, netwerkonderbreking of onbekende transportfout bij submit: inconclusive;
- uitsluitend een aantoonbaar definitieve fout (failed) is definitief;
- exception bij getStatus: inconclusive blijft inconclusive;
- geen automatische herverzending.

Herstel bij inconclusive: nieuwe invoer zoals versturen leidt NOOIT tot een tweede submit-aanroep; herstel verloopt uitsluitend via getStatus met dezelfde sleutel en aantoonbare idempotentie. Pas een expliciete nieuwe bevestiging in een nieuwe beurt (nieuwe sleutel) kan tot een nieuwe poging leiden, en alleen na een definitieve failed-uitkomst. Dubbele tickets worden zo voorkomen. Als herstel niet mogelijk is, verwijst de engine naar de IT-servicebalie; de engine claimt nergens dat een ticket is aangemaakt.

## 14. Logging en audit

- Operationele logging bevat uitsluitend metadata en veilige categorieën (zoals ticket_submission_inconclusive, submission_contract_violation, kennisdependency-redenen); nooit gespreksinhoud, artikelinhoud of gevoelige waarden.
- Audit: eventType ticket_submission, action submit_ticket, targetType ticket, outcome success of failed. Onzekere uitkomsten worden met reason submission_inconclusive als failed gelogd (de schrijfactie is niet aantoonbaar geslaagd; AUDIT_LOGGING.md kent alleen success/denied/failed). Contractschendingen krijgen reason submission_contract_violation. Geen enkele audit- of operatielog bevat artikelinhoud of persoonsgegevens.

## 15. Fallbacks

- Geen resultaten: KNOWLEDGE_SEARCH naar INTAKE met de generieke tekst (identiek aan uitsluitend afgeschermde resultaten).
- Onvoldoende relevantie (onder de relevantiedrempel): gelijk aan geen resultaten.
- Onbekende intent: verduidelijking binnen UNDERSTAND.
- Afhankelijkheidsfout kennis: dependency_error met herstelopties (opnieuw / vastleggen); invoer wordt nooit als feedback geïnterpreteerd.
- Uitputting artikelen: gecontroleerd naar INTAKE.
- Ticketport-uitval: gesprek blijft bruikbaar in PREVIEW; eerlijke fouttekst en verwijzing naar de servicebalie; geen successmelding of fictief nummer bij een storing.

## 16. Beveiligingscriteria

- Afgeschermde kennis is niet detecteerbaar (negatieve test).
- Ongecontroleerde gebruikersinput bereikt KnowledgePort niet (negatieve test).
- Requests en securitymeldingen worden nooit stilzwijgend als incident geregistreerd (negatieve tests).
- Phishing raadpleegt de KnowledgePort niet (poort-aanroep-assertie).
- Bekende informatie wordt niet opnieuw gevraagd (engineniveau).
- Ongeldige TicketPort-respons, verkeerde SubmissionKey en lege submitted-referentie bereiken nooit CONFIRM (negatieve tests).
- Timeout/netwerk/onbekende transportfout geeft inconclusive; getStatus-exception blijft inconclusive; inconclusive plus opnieuw versturen geeft geen tweede submit (negatieve tests).
- De state machine gebruikt uitsluitend bestaande transities; Build 01/02-regressies blijven groen.
- De medewerkersinterface suggereert nergens dat Build 03 echte TOPdesk-registratie uitvoert.
- Geen productie-URLs, secrets of gevoelige gegevens; uitsluitend fictieve data.

## 17. Testmatrix (overzicht)

1. Zoekvraagopbouw: allowlist-only, symptom/resource-valiadatie, manipulatieve waarden weggefilterd, geen vrije invoer naar de port.
2. Gating: draft/archief, verlopen/nog niet geldig, minimale kwaliteit, taal.
3. Ranking: alle vier regel-ids, relevantiedrempel, tuplevolgorde, tie-break op id, determinisme.
4. Autorisatie: geweigerd artikel onzichtbaar; only-denied is identiek aan no_results; interne logcategorieën onderscheiden; fail-closed bij onbetrouwbare metadata; geen onbegrensde zoekactie.
5. Oplossingsflow: opgelost naar DONE; niet opgelost biedt volgend artikel; maximaal drie artikelen; onduidelijk start verduidelijking en is geen afwijzing; herhaald onduidelijk en uitputting zonder loops; dependency-fout-invoer wordt geen feedback; herstelopties werken.
6. Intent-routes: incident naar intake; request met aanvraagbewoording en categoriet request; phishing zonder poortaanroep met security-intake en categorie security; unknown blijft in UNDERSTAND.
7. Never-knowingly-ask-twice: bekende symptomen/apparaten worden niet opnieuw gevraagd; antwoorden zonder gestructureerd feit worden vastgelegd en niet herhaald.
8. TicketPort: discriminated result; SIM-referentieformaat; idempotentie per sleutel; getStatus met en zonder referentie.
9. Submission: uitgestelde transitie; contractvalidatie (lege referentie, verkeerde sleutel, ongeldige vorm) bereikt nooit CONFIRM; failed versus inconclusive; geen automatische herverzending; herstel via getStatus; getStatus-exception blijft inconclusive; state blijft bruikbaar (PREVIEW).
10. Logging/audit: veilige categorieën en reasons; geen inhoud in logs; simulatie-eerlijkheid in alle medewerkersmeldingen.
11. Build 01/02-regressies blijven groen; de state machine zelf is ongewijzigd.

## 18. Definition of Done

- typecheck, lint, volledige testsuite en productiebuild slagen in CI (workflow verify);
- geen nieuwe runtime-dependencies (package.json blijft ongewijzigd);
- de state machine en de beveiligde documenten (ARCHITECTURE.md, SECURITY_PRINCIPLES.md, AUDIT_LOGGING.md) zijn ongewijzigd;
- ROADMAP.md verwijst naar deze specificatie;
- uitsluitend fictieve data en referenties; geen productie-URLs of secrets;
- PR naar main met samenvatting en testresultaten; merggen gebeurt uitsluitend na expliciete goedkeuring.
