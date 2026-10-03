/**
 * Structured fact model for the Build 02 Conversation Core (BUILD_02.md par. 2).
 *
 * Facts are stored as structured records, never as bare strings: every fact
 * distinguishes explicit employee statements from deterministically derived
 * conclusions and carries concise rule/evidence metadata. No hidden
 * chain-of-thought is stored; only the rule identifier and matched evidence
 * required to explain a deterministic decision.
 */

/** Qualitative confidence only (BUILD_02.md par. 1/8): never pseudo-statistical. */
export type QualitativeConfidence = 'high' | 'medium' | 'low';

/**
 * Fact categories aligned with the Build 01 ConversationContext fields,
 * plus requestedResource for access/hardware requests.
 * Unknown facts stay unknown; no category is ever filled with an invented default.
 */
export type FactCategory =
  | 'serviceOrApplication'
  | 'device'
  | 'symptom'
  | 'impact'
  | 'urgency'
  | 'startTime'
  | 'location'
  | 'affectedUsers'
  | 'attemptedSolutions'
  | 'securityIndicators'
  | 'requestedResource';

/**
 * One structured fact (BUILD_02.md par. 2).
 * capturedAtTurn is logical conversation ordering (1-based), NOT wall-clock time.
 */
export interface FactRecord {
  /** Canonical value. For securityIndicators: comma-separated indicator names. */
  readonly value: string;
  /** explicit = supplied by the employee; derived = deterministic conclusion. */
  readonly kind: 'explicit' | 'derived';
  /** For derived facts: the rule that concluded the value. */
  readonly sourceRuleId?: string;
  /** Concise matched evidence (text span or rule id); never a reasoning trace. */
  readonly evidence?: readonly string[];
  /** Logical 1-based conversation turn in which the fact was captured. */
  readonly capturedAtTurn: number;
}

/** Deterministic, conservative security indicators (BUILD_02.md par. 7). */
export type SecurityIndicator =
  | 'suspicious_message_received'
  | 'suspicious_link_clicked'
  | 'credentials_entered_after_suspicious_link'
  | 'suspected_account_compromise';
