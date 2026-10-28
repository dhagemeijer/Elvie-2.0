import type { ChatMessage, ConversationEngine, PresentationSnapshot } from '../services/conversation-engine';

/**
 * BUILD 05 — Employee-facing chat shell (user experience).
 *
 * A calm, accessible chat UI on top of the EXISTING deterministic
 * ConversationEngine. The shell is presentation only:
 * - every action (send, quick reply, confirm, status check) is executed as
 *   plain employee input through engine.handleEmployeeInput — there is NO
 *   parallel decision logic in the frontend;
 * - the ticket preview is rendered strictly FROM the engine's own preview
 *   message (the server-owned snapshot), never from a frontend copy;
 * - quick replies are derived exclusively from the engine's TYPED
 *   PresentationSnapshot (lifecycle state, knowledge phase, submission
 *   status), never from message text fragments: article or error texts can
 *   never produce commands;
 * - no conversation content is logged, stored in localStorage or sent
 *   anywhere else; the browser never calls TOPdesk directly;
 * - the simulation character is always visible (header badge and the
 *   engine's own simulation-honest texts).
 *
 * Targeted fixes (review 5b71753):
 * - the reset button participates in the busy lock: a new conversation can
 *   never hide or abort in-flight engine work (boot, turn, submission);
 * - every (re)start is a new session generation; callbacks of a stale
 *   session can no longer append messages, toggle buttons/status or move
 *   the focus. An allowed reset always uses a FRESH engine instance.
 *
 * Accessibility: full keyboard operation, visible focus, aria-live log,
 * busy status, 44px+ touch targets (see elvie.css), responsive layout for
 * desktop, tablet and mobile.
 */

export interface ChatShellOptions {
  /**
   * Factory for a fresh engine instance, used by the "Nieuw gesprek"
   * button. When absent, the button is not rendered (the shell stays
   * backward compatible with the Build 01 signature).
   */
  readonly createEngine?: () => ConversationEngine;
}

interface QuickReply {
  readonly label: string;
  readonly command: string;
}

/**
 * Session generation registry shared by all mounts of one shell: the
 * active session id. Incremented on every (re)start; a mount is current
 * exactly while its id equals the active one.
 */
interface SessionRegistry {
  active: number;
}

export function createChatShell(
  root: HTMLElement,
  engine: ConversationEngine,
  options: ChatShellOptions = {},
): void {
  const registry: SessionRegistry = { active: 0 };
  const startSession = (sessionEngine: ConversationEngine): void => {
    registry.active += 1;
    mountSession(root, sessionEngine, options, registry, startSession);
  };
  startSession(engine);
}

function mountSession(
  root: HTMLElement,
  engine: ConversationEngine,
  options: ChatShellOptions,
  registry: SessionRegistry,
  startSession: (sessionEngine: ConversationEngine) => void,
): void {
  const sessionId = registry.active;
  const isCurrent = (): boolean => registry.active === sessionId;

  root.innerHTML = '';

  const shell = document.createElement('section');
  shell.className = 'elvie-shell';
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Elvie chat met de IT-servicebalie');

  // --- Header: identity, permanent simulation badge, new conversation ---
  const header = document.createElement('header');
  header.className = 'elvie-header';

  const identity = document.createElement('div');
  identity.className = 'elvie-identity';
  const avatar = document.createElement('span');
  avatar.className = 'elvie-avatar';
  avatar.textContent = 'E';
  avatar.setAttribute('aria-hidden', 'true');
  const titleBox = document.createElement('div');
  const title = document.createElement('h1');
  title.textContent = 'Elvie';
  const subtitle = document.createElement('p');
  subtitle.className = 'elvie-subtitle';
  subtitle.textContent = 'Digitale assistent van de IT-servicebalie';
  titleBox.append(title, subtitle);
  identity.append(avatar, titleBox);

  const badge = document.createElement('span');
  badge.className = 'elvie-badge';
  badge.textContent = 'SIMULATIE — geen echte TOPdesk-registratie';
  badge.setAttribute('role', 'note');

  header.append(identity, badge);

  const reset =
    options.createEngine !== undefined
      ? document.createElement('button')
      : null;
  if (reset !== null) {
    reset.type = 'button';
    reset.className = 'elvie-reset';
    reset.textContent = 'Nieuw gesprek';
    reset.setAttribute('aria-label', 'Nieuw gesprek starten');
    reset.addEventListener('click', () => {
      if (busy) {
        // A reset never hides or aborts in-flight engine work (boot, turn,
        // submission): while Elvie processes, the button is locked.
        return;
      }
      const freshEngine = options.createEngine?.();
      if (freshEngine !== undefined) {
        // A new conversation is a NEW engine session: no state is reused.
        startSession(freshEngine);
      }
    });
    header.append(reset);
  }

  // --- Message log ---
  const log = document.createElement('div');
  log.className = 'elvie-log';
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Gesprek met Elvie');

  // --- Busy indicator ---
  const status = document.createElement('p');
  status.className = 'elvie-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Elvie denkt na…';
  status.hidden = true;

  // --- Quick replies ---
  const chips = document.createElement('div');
  chips.className = 'elvie-chips';
  chips.setAttribute('aria-label', 'Snelle antwoordopties');

  // --- Input form ---
  const form = document.createElement('form');
  form.className = 'elvie-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'elvie-input';
  input.name = 'message';
  input.placeholder = 'Typ je vraag…';
  input.setAttribute('aria-label', 'Je vraag aan Elvie');
  input.autocomplete = 'off';

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'elvie-send';
  send.textContent = 'Versturen';
  send.setAttribute('aria-label', 'Bericht versturen');

  form.append(input, send);
  shell.append(header, log, status, chips, form);
  root.append(shell);

  // --- State -------------------------------------------------------------
  let busy = false;

  const scrollToBottom = (): void => {
    log.scrollTop = log.scrollHeight;
    const last = log.lastElementChild;
    if (last !== null && typeof (last as HTMLElement).scrollIntoView === 'function') {
      (last as HTMLElement).scrollIntoView(false);
    }
  };

  const appendEmployeeMessage = (text: string): void => {
    const wrap = document.createElement('div');
    wrap.className = 'elvie-bubble elvie-bubble--employee';
    const who = document.createElement('span');
    who.className = 'elvie-who';
    who.textContent = 'Jij';
    const line = document.createElement('p');
    line.className = 'elvie-message elvie-message--employee';
    line.textContent = text;
    wrap.append(who, line);
    log.append(wrap);
    scrollToBottom();
  };

  const appendElvieCard = (text: string): void => {
    // Structured presentation (e.g. the ticket preview) of a multi-line
    // "Label: value" engine message. Purely presentational: the content is
    // the engine's own snapshot text, never a frontend copy.
    const card = document.createElement('div');
    card.className = 'elvie-message elvie-message--elvie elvie-card';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Voorbeeld van je melding (simulatie)');
    for (const line of text.split('\n')) {
      const row = document.createElement('div');
      row.className = 'elvie-card-row';
      const separator = line.indexOf(': ');
      if (separator > 0) {
        const label = document.createElement('span');
        label.className = 'elvie-card-label';
        // Keep the separating space so textContent-based assertions (and
        // screen readers) read 'Bron: TOPdesk Kennisbank', not 'Bron:TOPdesk'.
        label.textContent = line.slice(0, separator + 1) + ' ';
        const value = document.createElement('span');
        value.className = 'elvie-card-value';
        value.textContent = line.slice(separator + 2);
        row.append(label, value);
      } else {
        row.textContent = line;
      }
      card.append(row);
    }
    log.append(card);
  };

  const appendElvieMessage = (text: string): void => {
    // Multi-line engine text (knowledge article, ticket preview) is
    // rendered exactly once as a structured card.
    if (text.includes('\n')) {
      appendElvieCard(text);
      scrollToBottom();
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'elvie-bubble elvie-bubble--elvie';
    const who = document.createElement('span');
    who.className = 'elvie-who';
    who.textContent = 'Elvie';
    const line = document.createElement('p');
    line.className = 'elvie-message elvie-message--elvie';
    line.textContent = text;
    wrap.append(who, line);
    log.append(wrap);
    scrollToBottom();
  };

  const appendMessages = (messages: readonly ChatMessage[]): void => {
    for (const message of messages) {
      if (message.role === 'elvie') {
        appendElvieMessage(message.text);
      } else if (message.role === 'error') {
        const line = document.createElement('p');
        line.className = 'elvie-message elvie-message--error';
        line.textContent = message.text;
        log.append(line);
        scrollToBottom();
      }
    }
    if (messages.length > 0) {
      scrollToBottom();
    }
  };

  /**
   * Quick replies are derived exclusively from the engine's typed
   * PresentationSnapshot (lifecycle state, knowledge phase, submission
   * status). Each chip sends a plain, engine-recognized command that the
   * CURRENT engine phase permits:
   * - confirmation buttons only when the snapshot is confirmable;
   * - a status check only after an inconclusive submission;
   * - a retry only after a definitive failure, still as an explicit
   *   confirmation so the engine's own rules (fresh confirmation, current
   *   snapshot) stay authoritative;
   * - no command is ever derived from message text: knowledge articles and
   *   error texts can never produce buttons.
   */
  const quickRepliesFor = (snapshot: PresentationSnapshot): readonly QuickReply[] => {
    const replies: QuickReply[] = [];
    switch (snapshot.state) {
      case 'START':
      case 'UNDERSTAND':
        // Safe way to indicate unknown information (I-03/I-05/F-04).
        replies.push({ label: 'Weet ik niet', command: 'weet ik niet' });
        return replies;
      case 'KNOWLEDGE_SEARCH':
        if (snapshot.knowledgePhase === 'awaiting_feedback') {
          replies.push(
            { label: 'Opgelost', command: 'opgelost' },
            { label: 'Niet opgelost', command: 'niet opgelost' },
            { label: 'Onduidelijk', command: 'onduidelijk' },
          );
        } else if (snapshot.knowledgePhase === 'dependency_error') {
          replies.push(
            { label: 'Opnieuw zoeken', command: 'opnieuw' },
            { label: 'Direct vastleggen als melding', command: 'melding' },
          );
        }
        return replies;
      case 'INTAKE':
      case 'COMPLETE_CONTEXT':
        // The security intake hands over safely via 'klaar' (F-06/I-10).
        if (snapshot.intakeType === 'security') {
          replies.push({ label: 'Klaar, verder', command: 'klaar' });
        } else {
          replies.push({ label: 'Weet ik niet', command: 'weet ik niet' });
        }
        return replies;
      case 'PREVIEW':
        if (snapshot.statusCheckable) {
          // Recovery after an uncertain outcome: status check with the
          // SAME submission key; never a second submit (S-05).
          replies.push({ label: 'Status controleren', command: 'status' });
        } else if (snapshot.confirmable) {
          // A retry after a definitive failure still requires a fresh
          // explicit confirmation (S-08/S-18).
          replies.push({
            label: snapshot.submissionStatus === 'failed' ? 'Opnieuw bevestigen' : 'Bevestigen (simulatie)',
            command: 'bevestigen',
          });
        } else if (snapshot.previewCorrectionQuestionOpen) {
          replies.push({ label: 'Weet ik niet', command: 'weet ik niet' });
        }
        return replies;
      default:
        // DONE/CONFIRM/RESOLVE/SUBMIT: terminal or transitional, no chips.
        return replies;
    }
  };

  const renderChips = (): void => {
    chips.innerHTML = '';
    for (const reply of quickRepliesFor(engine.currentPresentation)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'elvie-chip';
      chip.textContent = reply.label;
      chip.setAttribute('aria-label', 'Stuur naar Elvie: ' + reply.label);
      chip.disabled = busy;
      chip.addEventListener('click', () => {
        void sendText(reply.command);
      });
      chips.append(chip);
    }
  };

  const setBusy = (next: boolean): void => {
    busy = next;
    input.disabled = next;
    send.disabled = next;
    if (reset !== null) {
      // The reset button participates in the busy lock: no new session can
      // be started while engine work is in flight.
      reset.disabled = next;
    }
    status.hidden = !next;
    log.setAttribute('aria-busy', next ? 'true' : 'false');
    for (const chip of chips.querySelectorAll('button.elvie-chip')) {
      (chip as HTMLButtonElement).disabled = next;
    }
    if (!next) {
      input.focus();
    }
  };

  const sendText = (text: string): Promise<void> => {
    if (busy || text.trim().length === 0) {
      return Promise.resolve();
    }
    appendEmployeeMessage(text);
    input.value = '';
    setBusy(true);
    return engine
      .handleEmployeeInput(text)
      .then((messages) => {
        if (isCurrent()) {
          appendMessages(messages);
        }
      })
      .catch(() => {
        if (isCurrent()) {
          appendMessages([
            { role: 'error', text: 'Er ging iets mis. Probeer het opnieuw.' },
          ]);
        }
      })
      .finally(() => {
        if (!isCurrent()) {
          return;
        }
        setBusy(false);
        renderChips();
      });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) {
      // Double-click protection: while Elvie processes a turn, no second
      // turn can be submitted from the UI (the engine's per-session
      // serialization remains the authoritative guard).
      return;
    }
    const text = input.value.trim();
    if (text.length === 0) {
      appendMessages([{ role: 'elvie', text: 'Typ eerst een korte omschrijving van je vraag.' }]);
      input.focus();
      return;
    }
    void sendText(text);
  });

  // --- Boot ---------------------------------------------------------------
  setBusy(true);
  void engine
    .start()
    .then((messages) => {
      if (isCurrent()) {
        appendMessages(messages);
        renderChips();
      }
    })
    .catch(() => {
      if (isCurrent()) {
        appendMessages([
          { role: 'error', text: 'Er ging iets mis bij het starten van Elvie. Probeer de pagina te herladen.' },
        ]);
      }
    })
    .finally(() => {
      if (!isCurrent()) {
        return;
      }
      const hasError = log.querySelector('.elvie-message--error') !== null;
      setBusy(false);
      renderChips();
      if (hasError) {
        // Fail closed: no session, so keep the input disabled.
        setBusy(true);
      }
    });

  input.focus();
}
