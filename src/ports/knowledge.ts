/**
 * Knowledge port: the only contract through which Elvie consults
 * service-desk knowledge. TOPdesk Knowledge Management is the authoritative
 * source (real adapter arrives in a later build); the conversation domain
 * depends only on this interface.
 */

export interface KnowledgeSearchQuery {
  readonly text: string;
  readonly serviceOrApplication?: string;
}

export interface KnowledgeItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

export interface KnowledgePort {
  /** Search knowledge. Returns deterministic results. */
  search(query: KnowledgeSearchQuery): Promise<readonly KnowledgeItem[]>;
}

/** Raised when no knowledge implementation is configured. */
export class KnowledgeNotConfiguredError extends Error {
  constructor(message = 'Knowledge provider is not configured.') {
    super(message);
    this.name = 'KnowledgeNotConfiguredError';
  }
}

/** Fail-closed knowledge implementation for unconfigured compositions. */
export function unconfiguredKnowledge(): KnowledgePort {
  return {
    async search(): Promise<readonly KnowledgeItem[]> {
      throw new KnowledgeNotConfiguredError();
    },
  };
}
