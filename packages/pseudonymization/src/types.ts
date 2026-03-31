export type EntityType =
  | "name"
  | "email"
  | "phone"
  | "date"
  | "location"
  | "organization"
  | "id"
  | "other";

export type SensitiveEntity = {
  id: string;
  type: EntityType;
  value: string;
};

export type MapEntry = {
  type: EntityType;
  real: string;
  fake: string;
};

export type PipelineResult = {
  method: string;
  original: string;
  detectedEntities: SensitiveEntity[];
  replacementDecisions: MapEntry[];
  anonymized: string;
  deanonymized: string;
};

// Backward-compatible type aliases from the package scaffold.
export type EntityMatch = {
  type: EntityType;
  value: string;
  start: number;
  end: number;
};

export type PseudonymizationScheme = {
  name: string;
  detect(text: string): Promise<EntityMatch[]> | EntityMatch[];
};

export type PseudonymizationResult = {
  originalText: string;
  pseudonymizedText: string;
  map: MapEntry[];
  entities: EntityMatch[];
};
