import type { EntityMatch, PseudonymizationScheme } from "./types";

/**
 * Lightweight regex-based default detector used by the starter scheme.
 * This is intentionally simple and can be replaced with stronger detectors.
 */
function detectWithRegex(text: string): EntityMatch[] {
  const entities: EntityMatch[] = [];
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phoneRegex = /\b(?:\+?\d{1,2}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b/g;

  for (const match of text.matchAll(emailRegex)) {
    if (typeof match.index === "number") {
      entities.push({ type: "email", value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }

  for (const match of text.matchAll(phoneRegex)) {
    if (typeof match.index === "number") {
      entities.push({ type: "phone", value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }

  return entities;
}

/**
 * Default built-in schemes. Consumers can provide their own custom schemes at runtime.
 */
export const defaultSchemes: Record<string, PseudonymizationScheme> = {
  regex: {
    name: "regex",
    detect(text: string) {
      return detectWithRegex(text);
    },
  },
};
