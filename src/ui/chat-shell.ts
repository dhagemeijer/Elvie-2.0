import type { ConversationEngine, ChatMessage } from '../services/conversation-engine';

/**
 * Minimal accessible chat shell (Build 01): a recognizable Elvie entry,
 * text input, submit interaction, conversation output area, keyboard
 * operability, visible focus, and clear empty/error states.
 * No administrative controls exist in this user plane.
 */
export function createChatShell(root: HTMLElement, engine: ConversationEngine): void {
  root.innerHTML = '';

  const shell = document.createElement('section');
  shell.className = 'elvie-shell';
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Elvie chat met de IT-servicebalie');

  const header = document.createElement('header');
  header.className = 'elvie-header';
  const title = document.createElement('h1');
  title.textContent = 'Elvie — digitale assistent van de IT-servicebalie';
  header.append(title);

  const log = document.createElement('div');
  log.className = 'elvie-log';
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Gesprek met Elvie');

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

  form.append(input, send);
  shell.append(header, log, form);
  root.append(shell);

  const appendMessages = (messages: readonly ChatMessage[]): void => {
    for (const message of messages) {
      const line = document.createElement('p');
      line.className = `elvie-message elvie-message--${message.role}`;
      line.textContent = message.text;
      log.append(line);
    }
    log.scrollTop = log.scrollHeight;
  };

  const setBusy = (busy: boolean): void => {
    input.disabled = busy;
    send.disabled = busy;
    if (!busy) {
      input.focus();
    }
  };

  // Empty state / identity failure state both arrive via engine.start().
  setBusy(true);
  void engine
    .start()
    .then(appendMessages)
    .catch(() => {
      appendMessages([
        { role: 'error', text: 'Er ging iets mis bij het starten van Elvie. Probeer de pagina te herladen.' },
      ]);
    })
    .finally(() => {
      const hasError = log.querySelector('.elvie-message--error') !== null;
      setBusy(false);
      if (hasError) {
        // Fail closed: no session, so keep the input disabled.
        setBusy(true);
      }
    });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text.length === 0) {
      appendMessages([{ role: 'elvie', text: 'Typ eerst een korte omschrijving van je vraag.' }]);
      input.focus();
      return;
    }
    appendMessages([{ role: 'employee', text }]);
    input.value = '';
    setBusy(true);
    void engine
      .handleEmployeeInput(text)
      .then(appendMessages)
      .catch(() => {
        appendMessages([{ role: 'error', text: 'Er ging iets mis. Probeer het opnieuw.' }]);
      })
      .finally(() => setBusy(false));
  });

  input.focus();
}
