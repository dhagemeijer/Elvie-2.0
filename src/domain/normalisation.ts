/**
 * Deterministic input normalisation (BUILD_02.md par. 9).
 *
 * Ordinary informal Dutch employee input is tolerated with safe, explicitly
 * defined deterministic operations only: casing, whitespace, simple
 * punctuation and a deliberately small contraction/variant map. No NLP
 * framework, no fuzzy or probabilistic interpretation.
 */

/**
 * Explicitly defined contraction/variant map (approved at specification
 * review; deliberately small and not expanded substantially).
 */
export const CONTRACTION_MAP: Readonly<Record<string, string>> = {
  mn: 'mijn',
};

/** Small deterministic phrase variants (informal Dutch). */
export const PHRASE_MAP: Readonly<Record<string, string>> = {
  'doet t': 'doet het',
  'werkt t': 'werkt het',
};

function replaceWordBounded(text: string, search: string, replacement: string): string {
  return text.replace(new RegExp('\\b' + search + '\\b', 'g'), replacement);
}

/**
 * Normalize raw employee input deterministically:
 * lowercase, strip simple punctuation, collapse whitespace, then apply the
 * documented phrase and contraction maps (word-bounded).
 */
export function normalizeInput(raw: string): string {
  const lowered = raw.toLowerCase();
  const withoutPunctuation = lowered.replace(/[,.;:!?()"']/g, ' ');
  const collapsed = withoutPunctuation.replace(/\s+/g, ' ').trim();
  let normalized = collapsed;
  for (const [phrase, replacement] of Object.entries(PHRASE_MAP)) {
    normalized = replaceWordBounded(normalized, phrase, replacement);
  }
  for (const [token, replacement] of Object.entries(CONTRACTION_MAP)) {
    normalized = replaceWordBounded(normalized, token, replacement);
  }
  return normalized;
}
