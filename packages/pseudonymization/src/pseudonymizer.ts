import nlp from "compromise";
import type {
  EntityType,
  MapEntry,
  PipelineResult,
  PseudonymizationResult,
  PseudonymizationScheme,
  SensitiveEntity,
} from "./types";

const FIRST_NAMES = ["Avery", "Jordan", "Casey", "Riley", "Taylor", "Morgan"];
const LAST_NAMES = ["Miller", "Nguyen", "Garcia", "Patel", "Carter", "Kim"];
const LOCATIONS = ["Lisbon", "Helsinki", "Oslo", "Tallinn", "Zurich", "Seville"];
const ORGS = ["Northwind Labs", "Summit Systems", "Blue Harbor Group", "Maple Analytics"];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)/g;
const DATE_PATTERN = /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/gi;
const ID_PATTERN = /\b(?:\d{3}-\d{2}-\d{4}|\d{9})\b/g;

let llmDetectorPromise: Promise<((text: string) => Promise<SensitiveEntity[]>) | null> | null = null;

function uniqueEntities(entities: SensitiveEntity[]): SensitiveEntity[] {
  const seen = new Set<string>();
  const out: SensitiveEntity[] = [];

  for (const entity of entities) {
    const key = `${entity.type}:${entity.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entity);
    }
  }

  return out;
}

function canonicalEntityValue(type: EntityType, value: string): string {
  if (type === "phone") {
    return value.replace(/\D+/g, "");
  }
  if (type === "email") {
    return value.trim().toLowerCase();
  }
  return value.trim();
}

function makeEntity(type: EntityType, value: string): SensitiveEntity {
  return {
    id: crypto.randomUUID(),
    type,
    value,
  };
}

function matchPattern(text: string, pattern: RegExp, type: EntityType): SensitiveEntity[] {
  const matches = text.match(pattern) ?? [];
  return matches.map((value) => makeEntity(type, value));
}

export function detectByRegex(text: string): SensitiveEntity[] {
  const entities = [
    ...matchPattern(text, EMAIL_PATTERN, "email"),
    ...matchPattern(text, PHONE_PATTERN, "phone"),
    ...matchPattern(text, DATE_PATTERN, "date"),
    ...matchPattern(text, ID_PATTERN, "id"),
  ];

  return uniqueEntities(entities);
}

export function detectByCompromise(text: string): SensitiveEntity[] {
  const doc = nlp(text);
  const entities: SensitiveEntity[] = [
    ...detectByRegex(text),
    ...doc.people().out("array").map((value: string) => makeEntity("name", value)),
    ...doc.places().out("array").map((value: string) => makeEntity("location", value)),
    ...doc.organizations().out("array").map((value: string) => makeEntity("organization", value)),
  ];

  return uniqueEntities(entities).filter((entity) => entity.value.trim().length > 1);
}

function fakeForType(type: EntityType, index: number): string {
  switch (type) {
    case "name": {
      const first = FIRST_NAMES[index % FIRST_NAMES.length];
      const last = LAST_NAMES[index % LAST_NAMES.length];
      return `${first} ${last}`;
    }
    case "email":
      return `user${index + 1}@example.test`;
    case "phone":
      return `+1-202-555-${String(1000 + index).slice(-4)}`;
    case "date":
      return `2025-01-${String((index % 28) + 1).padStart(2, "0")}`;
    case "location":
      return LOCATIONS[index % LOCATIONS.length] ?? `LOCATION_${index + 1}`;
    case "organization":
      return ORGS[index % ORGS.length] ?? `ORG_${index + 1}`;
    case "id":
      return `000-00-${String(1000 + index).slice(-4)}`;
    default:
      return `REDACTED_${index + 1}`;
  }
}

export function applyAnonymization(
  original: string,
  entities: SensitiveEntity[],
): {
  anonymized: string;
  map: MapEntry[];
} {
  let anonymized = original;
  const map: MapEntry[] = [];

  entities.forEach((entity, index) => {
    if (!entity.value) {
      return;
    }

    const fake = fakeForType(entity.type, index);
    if (fake === entity.value) {
      return;
    }
    const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const replacementPattern = new RegExp(escaped, "g");
    anonymized = anonymized.replace(replacementPattern, fake);

    map.push({
      type: entity.type,
      real: entity.value,
      fake,
    });
  });

  return {
    anonymized,
    map,
  };
}

export function deanonymize(text: string, map: MapEntry[]): string {
  let restored = text;
  for (const entry of map) {
    const escaped = entry.fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    restored = restored.replace(new RegExp(escaped, "g"), entry.real);
  }
  return restored;
}

export function runPipeline(method: string, original: string, entities: SensitiveEntity[]): PipelineResult {
  const { anonymized, map } = applyAnonymization(original, entities);
  return {
    method,
    original,
    detectedEntities: entities,
    replacementDecisions: map,
    anonymized,
    deanonymized: deanonymize(anonymized, map),
  };
}

async function initLlmDetector(): Promise<((text: string) => Promise<SensitiveEntity[]>) | null> {
  try {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowRemoteModels = true;

    const ner = await pipeline("token-classification", "Xenova/bert-base-NER", {
      quantized: true,
    });

    return async (text: string) => {
      const output = (await ner(text)) as Array<{
        entity_group?: string;
        entity?: string;
        word?: string;
      }>;

      const entities = output
        .map((entry) => {
          const rawGroup = entry.entity_group ?? entry.entity ?? "";
          const group = rawGroup.toUpperCase().replace(/^B-|^I-/, "");
          const value = entry.word?.replace(/\s+/g, " ").trim() ?? "";

          if (!value) {
            return null;
          }

          if (group === "PER") {
            return makeEntity("name", value);
          }
          if (group === "ORG") {
            return makeEntity("organization", value);
          }
          if (group === "LOC") {
            return makeEntity("location", value);
          }

          return makeEntity("other", value);
        })
        .filter((entity): entity is SensitiveEntity => Boolean(entity));

      return uniqueEntities([...entities, ...detectByRegex(text)]);
    };
  } catch {
    return null;
  }
}

export async function detectByLlm(text: string): Promise<SensitiveEntity[]> {
  if (!llmDetectorPromise) {
    llmDetectorPromise = initLlmDetector();
  }

  const detector = await llmDetectorPromise;
  if (!detector) {
    return detectByCompromise(text);
  }

  try {
    return await detector(text);
  } catch {
    return detectByCompromise(text);
  }
}

export async function runHybridPipeline(original: string, endpoint = "/api/hybrid-anonymize"): Promise<PipelineResult> {
  const clientEntities = detectByRegex(original);
  const firstPass = applyAnonymization(original, clientEntities);
  const firstPassFakeValues = new Set(
    firstPass.map.map((entry) => `${entry.type}:${canonicalEntityValue(entry.type, entry.fake)}`),
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      partialText: firstPass.anonymized,
    }),
  });

  const payload = (await response.json()) as { entities?: SensitiveEntity[] };
  const serverEntities = (payload.entities ?? []).filter(
    (entity) => !firstPassFakeValues.has(`${entity.type}:${canonicalEntityValue(entity.type, entity.value)}`),
  );
  const secondPass = applyAnonymization(firstPass.anonymized, serverEntities);
  const mergedMap = [...firstPass.map, ...secondPass.map];

  return {
    method: "Hybrid (Client + API)",
    original,
    detectedEntities: [...clientEntities, ...serverEntities],
    replacementDecisions: mergedMap,
    anonymized: secondPass.anonymized,
    deanonymized: deanonymize(secondPass.anonymized, mergedMap),
  };
}

// Legacy scaffold API kept for compatibility with initial package interface.
export function pseudonymize(text: string, entities: SensitiveEntity[]): PseudonymizationResult {
  const { anonymized, map } = applyAnonymization(text, entities);
  return {
    originalText: text,
    pseudonymizedText: anonymized,
    map,
    entities: entities.map((entity) => ({
      type: entity.type,
      value: entity.value,
      start: 0,
      end: entity.value.length,
    })),
  };
}

export function createPseudonymizer(scheme: PseudonymizationScheme) {
  return {
    scheme,
    async pseudonymize(text: string): Promise<PseudonymizationResult> {
      const entities = await scheme.detect(text);
      const normalized: SensitiveEntity[] = entities.map((entity) => ({
        id: crypto.randomUUID(),
        type: entity.type,
        value: entity.value,
      }));
      return pseudonymize(text, normalized);
    },
    deanonymize(text: string, map: MapEntry[]): string {
      return deanonymize(text, map);
    },
  };
}
