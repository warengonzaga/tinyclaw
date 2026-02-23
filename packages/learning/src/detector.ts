import type { Signal } from '@tinyclaw/types';

const POSITIVE_PATTERNS = [
  /^(perfect|great|thanks|exactly|nice|awesome|good|yes|correct)/i,
  /^(that'?s? (right|correct|it|what i (wanted|needed)))/i,
  /^(love it|nailed it|spot on)/i,
];

const NEGATIVE_PATTERNS = [
  /^(no|wrong|not what|that'?s? not|you misunderstood|incorrect)/i,
  /^(that'?s? (wrong|incorrect|not right))/i,
  /^(try again|redo|not quite)/i,
];

const CORRECTION_PATTERNS = [
  /^(actually|i meant|i prefer|next time|please don'?t|instead)/i,
  /i (prefer|like|want|need) (.+)/i,
  /don'?t (.+), (instead )?(.+)/i,
  /(remember|note) that i (.+)/i,
];

export function detectSignals(userMessage: string, assistantMessage: string): Signal[] {
  const signals: Signal[] = [];
  const lower = userMessage.toLowerCase().trim();

  // Check positive patterns
  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(lower)) {
      signals.push({
        type: 'positive',
        confidence: 0.8,
        context: `Response accepted: "${assistantMessage.slice(0, 100)}..."`,
        timestamp: Date.now(),
      });
      break;
    }
  }

  // Check negative patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(lower)) {
      signals.push({
        type: 'negative',
        confidence: 0.85,
        context: `Response rejected: "${assistantMessage.slice(0, 100)}..."`,
        timestamp: Date.now(),
      });
      break;
    }
  }

  // Check correction patterns
  for (const pattern of CORRECTION_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      signals.push({
        type: 'correction',
        confidence: 0.95,
        context: userMessage,
        learned: extractPreference(userMessage),
        timestamp: Date.now(),
      });
      break;
    }
  }

  return signals;
}

function extractPreference(message: string): string {
  // Simple extraction - just return the message for MVP
  return message;
}
