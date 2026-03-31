"use client";

/**
 * Main educational page for anonymization pipelines and reversible map storage demos.
 */

import { useMemo, useState } from "react";
import {
  detectByCompromise,
  detectByLlm,
  detectByRegex,
  deanonymize,
  runHybridPipeline,
  runPipeline,
} from "@harrison/pseudonymization";
import { decryptMap, encryptMap } from "@harrison/client-encryption";
import { getLocalMap, saveMapLocally } from "@/lib/indexeddb";
import type { EncryptedPayload } from "@harrison/client-encryption";
import type { MapEntry, PipelineResult } from "@harrison/pseudonymization";

type MethodKey = "llm" | "ner" | "hybrid";

const METHOD_LABELS: Record<MethodKey, string> = {
  llm: "Pure Client-Side with LLM (Transformers.js)",
  ner: "Pure Client-Side with NER/Regex",
  hybrid: "Hybrid (Client + API Final Check)",
};

const SAMPLE_INPUT =
  "Alice Johnson from Acme Corp emailed alice.johnson@acme.com on 2026-03-25. Call her at 415-555-1212 before meeting in Seattle.";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function JsonBox({ data }: { data: unknown }) {
  // JSON inspector used everywhere to keep each pipeline step explicit.
  return (
    <pre className="max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/**
 * Coordinates anonymization runs and client/server encrypted map flows.
 */
export default function Home() {
  // Input + selected pipeline mode.
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [method, setMethod] = useState<MethodKey>("ner");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Encryption-related controls for backend blob mode.
  const [conversationId, setConversationId] = useState("");
  const [password, setPassword] = useState("");
  const [pepper, setPepper] = useState("");
  const [encryptedPayload, setEncryptedPayload] = useState<EncryptedPayload | null>(null);
  const [decryptedMap, setDecryptedMap] = useState<MapEntry[] | null>(null);
  const [status, setStatus] = useState<string>("");

  // Convenience pointer to current reversible map.
  const map = useMemo(() => result?.replacementDecisions ?? [], [result]);

  async function runSelectedMethod() {
    // Runs one of the three anonymization approaches.
    setRunning(true);
    setError(null);
    setStatus("");

    try {
      if (method === "llm") {
        const entities = await detectByLlm(input);
        setResult(runPipeline(METHOD_LABELS.llm, input, entities));
      } else if (method === "ner") {
        const entities = detectByCompromise(input);
        setResult(runPipeline(METHOD_LABELS.ner, input, entities));
      } else {
        const hybridResult = await runHybridPipeline(input);
        setResult(hybridResult);
      }
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Failed to run anonymization.";
      setError(message);
    } finally {
      setRunning(false);
    }
  }

  // Stores current reversible map in browser-only IndexedDB.
  async function storeMapInIndexedDb() {
    // Pure client mode: map never leaves browser storage.
    if (!map.length) {
      setStatus("Run a pipeline first to generate a map.");
      return;
    }

    const id = conversationId || crypto.randomUUID();
    await saveMapLocally(id, map);
    setConversationId(id);
    setStatus(`Saved map locally in IndexedDB with id: ${id}`);
  }

  // Loads a previously saved local map for deanonymization testing.
  async function loadMapFromIndexedDb() {
    // Pull back local map for demonstration and deanonymization.
    if (!conversationId) {
      setStatus("Enter a conversation id to load from IndexedDB.");
      return;
    }

    const stored = await getLocalMap(conversationId);
    if (!stored) {
      setStatus("No local map found for that id.");
      return;
    }

    setDecryptedMap(stored.map);
    setStatus("Loaded local map from IndexedDB.");
  }

  // Encrypts map client-side and uploads only ciphertext metadata to backend.
  async function encryptAndStoreOnBackend() {
    // Zero-knowledge backend mode: encrypt map first, then upload blob only.
    if (!map.length) {
      setStatus("Run a pipeline first to generate a map.");
      return;
    }
    if (!password) {
      setStatus("Password is required for client-side encryption.");
      return;
    }
    if (!pepper) {
      setStatus("Pepper is required for peppered client-side encryption.");
      return;
    }

    const encrypted = await encryptMap(map, password, pepper);
    setEncryptedPayload(encrypted);

    const response = await fetch("/api/encrypted-maps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: conversationId || undefined,
        label: METHOD_LABELS[method],
        method: method,
        ciphertextB64: encrypted.ciphertextB64,
        ivB64: encrypted.ivB64,
        saltB64: encrypted.saltB64,
        iterations: encrypted.iterations,
      }),
    });

    if (!response.ok) {
      setStatus("Failed to store encrypted payload on backend.");
      return;
    }

    const payload = (await response.json()) as { conversationId: string };
    setConversationId(payload.conversationId);
    setStatus(
      `Stored encrypted map on backend. Server only has ciphertext/iv/salt. conversationId: ${payload.conversationId}`,
    );
  }

  // Fetches encrypted blob from backend, then decrypts locally in browser.
  async function fetchAndDecryptFromBackend() {
    // Retrieve blob from backend and decrypt only in the browser.
    if (!conversationId || !password || !pepper) {
      setStatus("conversationId, password, and pepper are required.");
      return;
    }

    const response = await fetch(`/api/encrypted-maps?conversationId=${encodeURIComponent(conversationId)}`);
    if (!response.ok) {
      setStatus("Failed to fetch encrypted payload from backend.");
      return;
    }

    const payload = (await response.json()) as {
      ciphertextB64: string;
      ivB64: string;
      saltB64: string;
      iterations: number;
    };

    const decrypted = await decryptMap(
      {
        algorithm: "AES-GCM",
        ciphertextB64: payload.ciphertextB64,
        ivB64: payload.ivB64,
        saltB64: payload.saltB64,
        iterations: payload.iterations,
      },
      password,
      pepper,
    );

    setEncryptedPayload({
      algorithm: "AES-GCM",
      ciphertextB64: payload.ciphertextB64,
      ivB64: payload.ivB64,
      saltB64: payload.saltB64,
      iterations: payload.iterations,
    });
    setDecryptedMap(decrypted);
    setStatus("Fetched encrypted payload from backend and decrypted on client.");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <header className="mb-6 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">
          Secure LLM Anonymization + Reversible Deanonymization Demo
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          Trust boundary: client is trusted. Server stores only anonymized text or encrypted map blobs.
        </p>
      </header>

      <Card title="Input">
        <textarea
          className="h-32 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </Card>

      <Card title="Anonymization Method">
        {/* Method selector lets you compare pipelines side-by-side using same input. */}
        <div className="mb-3 flex flex-wrap gap-2">
          {(Object.keys(METHOD_LABELS) as MethodKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMethod(key)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                method === key
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
              }`}
            >
              {METHOD_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runSelectedMethod}
            disabled={running}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {running ? "Running..." : "Run Selected Method"}
          </button>
          <button
            type="button"
            onClick={() => setResult(runPipeline("Regex only quick check", input, detectByRegex(input)))}
            className="rounded-md border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Run Regex Quick Check
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Pipeline Debugging Steps">
          {/* Step-by-step debug trace from original to reversible output. */}
          {!result ? (
            <p className="text-sm text-slate-700">Run a method to see full step-by-step output.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 font-semibold text-slate-900">1. Original Text</p>
                <JsonBox data={result.original} />
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-900">2. Detected Entities</p>
                <JsonBox data={result.detectedEntities} />
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-900">3. Replacement Decisions (Map)</p>
                <JsonBox data={result.replacementDecisions} />
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-900">4. Final Anonymized Text</p>
                <JsonBox data={result.anonymized} />
              </div>
              <div>
                <p className="mb-1 font-semibold text-slate-900">5. Deanonymized Result</p>
                <JsonBox data={result.deanonymized} />
              </div>
            </div>
          )}
        </Card>

        <Card title="Map Storage Approaches">
          {/* Two storage paths: local plaintext map vs encrypted backend blob. */}
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block font-medium text-slate-900" htmlFor="conversationId">
                Conversation ID
              </label>
              <input
                id="conversationId"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                value={conversationId}
                onChange={(event) => setConversationId(event.target.value)}
                placeholder="optional - generated automatically"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-900" htmlFor="password">
                Password (PBKDF2 input)
              </label>
              <input
                id="password"
                type="password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="required for encrypted backend storage"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-900" htmlFor="pepper">
                Pepper (additional secret, never stored)
              </label>
              <input
                id="pepper"
                type="password"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
                value={pepper}
                onChange={(event) => setPepper(event.target.value)}
                placeholder="required for decrypting peppered payloads"
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-md border border-slate-400 px-3 py-2 font-semibold text-slate-900"
                onClick={storeMapInIndexedDb}
              >
                Save Map to IndexedDB
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-400 px-3 py-2 font-semibold text-slate-900"
                onClick={loadMapFromIndexedDb}
              >
                Load Map from IndexedDB
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 font-semibold text-white"
                onClick={encryptAndStoreOnBackend}
              >
                Encrypt on Client + Store on Backend
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-700 px-3 py-2 font-semibold text-white"
                onClick={fetchAndDecryptFromBackend}
              >
                Fetch Ciphertext + Decrypt on Client
              </button>
            </div>

            {status ? <p className="rounded-md bg-slate-100 p-2 text-slate-800">{status}</p> : null}

            <div>
              <p className="mb-1 font-semibold text-slate-900">Encryption Input Map</p>
              <JsonBox data={map} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-900">Stored Encrypted Payload (ciphertext + iv + salt)</p>
              <JsonBox data={encryptedPayload} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-900">KDF Inputs Used on Client</p>
              <JsonBox
                data={{
                  passwordProvided: Boolean(password),
                  pepperProvided: Boolean(pepper),
                  pbkdf2Iterations: encryptedPayload?.iterations ?? "run encryption",
                }}
              />
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-900">Decrypted Map (client-side)</p>
              <JsonBox data={decryptedMap} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-900">Deanonymize Using Decrypted Map</p>
              <JsonBox
                data={
                  result?.anonymized && decryptedMap
                    ? deanonymize(result.anonymized, decryptedMap)
                    : "Run anonymization and decrypt map first"
                }
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
