# @harrison/pseudonymization

Reusable pseudonymization and deanonymization helpers for educational privacy workflows.

## Scope

- Detect candidate sensitive entities using regex, compromise, or optional Transformers.js NER.
- Apply deterministic fake replacements with a reversible map.
- Run end-to-end pipeline helpers for demo and API flows.

## Install

```bash
npm i @harrison/pseudonymization
```

## Quick start

```ts
import { detectByCompromise, runPipeline } from "@harrison/pseudonymization";

const input = "Alice Johnson emailed alice@example.com from Seattle.";
const entities = detectByCompromise(input);
const result = runPipeline("Compromise", input, entities);

console.log(result.anonymized);
console.log(result.replacementDecisions);
```

## Main exports

- `detectByRegex(text)`
- `detectByCompromise(text)`
- `detectByLlm(text)`
- `applyAnonymization(original, entities)`
- `deanonymize(text, map)`
- `runPipeline(method, original, entities)`
- `runHybridPipeline(original, endpoint?)`

## Core types

- `EntityType`
- `SensitiveEntity`
- `MapEntry`
- `PipelineResult`

## Notes

- `runHybridPipeline()` calls `fetch()` and expects a JSON body with `entities` from your endpoint.
- `detectByLlm()` lazily imports `@xenova/transformers`; if unavailable it falls back to compromise-based detection.
- Intended for education/demo usage unless independently security reviewed.

## Development

```bash
npm run typecheck -w @harrison/pseudonymization
npm run lint -w @harrison/pseudonymization
npm run build -w @harrison/pseudonymization
```
