import type { OperationalLogEntry, OperationalLoggerPort } from '../ports/logging';

/** Development operational logger: structured entries to the console. */
export function consoleOperationalLogger(): OperationalLoggerPort {
  return {
    log(entry: OperationalLogEntry): void {
      // Metadata only; never conversation or TOPdesk content.
      const line = `[${entry.timestamp}] [${entry.level}] [${entry.component}] [cid=${entry.correlationId}] ${entry.message}`;
      // eslint-disable-next-line no-console -- dev operational logger, by design
      console.log(line);
    },
  };
}
