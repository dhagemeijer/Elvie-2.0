import type { KnowledgeItem, KnowledgePort, KnowledgeSearchQuery } from '../ports/knowledge';

/**
 * Development/test knowledge mock with fictional data only.
 * Deterministic keyword matching: an item matches when every word of the
 * query appears in its title or summary (case-insensitive).
 * Real ranking rules arrive in Build 03.
 */
export class MockKnowledgeProvider implements KnowledgePort {
  private readonly items: readonly KnowledgeItem[];

  constructor(items: readonly KnowledgeItem[] = DEFAULT_MOCK_ITEMS) {
    this.items = items;
  }

  async search(query: KnowledgeSearchQuery): Promise<readonly KnowledgeItem[]> {
    const words = splitWords(query.text);
    if (query.serviceOrApplication) {
      words.push(...splitWords(query.serviceOrApplication));
    }
    if (words.length === 0) {
      return [];
    }
    return this.items.filter((item) => {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }
}

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

/** Fictional knowledge items. No real LV or TOPdesk content. */
export const DEFAULT_MOCK_ITEMS: readonly KnowledgeItem[] = [
  {
    id: 'mock-kb-001',
    title: 'Wachtwoord vergeten',
    summary: 'Stel je wachtwoord opnieuw in via de selfservice portal met je registratiegegevens.',
  },
  {
    id: 'mock-kb-002',
    title: 'VPN verbinding werkt niet',
    summary: 'Herstart de VPN client en controleer of je verbonden bent met het juiste netwerk.',
  },
  {
    id: 'mock-kb-003',
    title: 'Printer print niet',
    summary: 'Controleer of de printer is aangezet en of er papier in de lade zit.',
  },
];
