/**
 * Structured fact model for the Build 02 Conversation Core (BUILD_02.md par. 2).
 *
 * Facts are stored as structured records, never as bare strings: every fact
 * distinguishes explicit employee statements from deterministically derived
 * conclusions and carries concise rule/evidence metadata. No hidden
 * chain-of-thought is stored; only the rule identifier and matched evidence
 * required to explain a deterministic decision.
 *
 * Hardened domain model (final review): FactRecord is a discriminated union,
 * so the TypeScript compiler itself enforces the Build 02 contract. A
 * derived record MUST carry qualitative confidence, its concluding rule id
 * and evidence; an explicit record NEVER carries an inferred confidence.
 * This is a type-level change only: no runtime dependency is added and
 * Build 02 behavior is unchanged.
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
 * Explicit fact (BUILD_02.md par. 2): supplied by the employee.
 * capturedAtTurn is logical conversation ordering (1-based), NOT wall-clock
 * time. Evidence may be present; no inferred confidence is ever attached.
 */
export interface ExplicitFactRecord {
  /** Canonical value. For securityIndicators: comma-separated indicator names. */
  readonly value: string;
  /** Discriminator: an explicit employee statement. */
  readonly kind: 'explicit';
  /** Optional phrase rule that recognized the explicit statement. */
  readonly sourceRuleId?: string;
  /** Concise matched evidence (text span or rule id); never a reasoning trace. */
  readonly evidence?: readonly string[];
  /** Logical 1-based conversation turn in which the fact was captured. */
  readonly capturedAtTurn: number;
  /** Compile-time guard: explicit facts never carry an inferred confidence. */
  readonly confidence?: never;
}

/**
 * Derived fact (BUILD_02.md par. 2): a deterministic conclusion. Qualitative
 * confidence, the concluding rule and concise evidence are all REQUIRED at
 * compile time.
 */
export interface DerivedFactRecord {
  /** Canonical value. For securityIndicators: comma-separated indicator names. */
  readonly value: string;
  /** Discriminator: a deterministic conclusion. */
  readonly kind: 'derived';
  /**
   * Qualitative confidence, REQUIRED on every derived fact (BUILD_02.md): a
   * deterministic conclusion always carries high | medium | low. Never
   * numeric or pseudo-statistical; the former ConversationContext.confidence
   * scalar is not reintroduced.
   */
  readonly confidence: QualitativeConfidence;
  /** The rule that concluded the value; REQUIRED on derived facts. */
  readonly sourceRuleId: string;
  /** Concise matched evidence; REQUIRED on derived facts. */
  readonly evidence: readonly string[];
  /** Logical 1-based conversation turn in which the fact was captured. */
  readonly capturedAtTurn: number;
}

/**
 * One structured fact (BUILD_02.md par. 2): a discriminated union. The
 * compiler rejects a derived record without confidence, sourceRuleId and
 * evidence, and rejects an explicit record that carries an inferred
 * confidence.
 */
export type FactRecord = ExplicitFactRecord | DerivedFactRecord;

/** Deterministic, conservative security indicators (BUILD_02.md par. 7). */
export type SecurityIndicator =
  | 'suspicious_message_received'
  | 'suspicious_link_clicked'
  | 'credentials_entered_after_suspicious_link'
  | 'suspected_account_compromise';
