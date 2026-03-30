/**
 * Hybrid anonymization API: final server-side detection pass on partially redacted text.
 */
import { NextResponse } from "next/server";
import { detectByCompromise } from "@/lib/anonymization";

export async function POST(request: Request) {
  // Accepts partially anonymized text and returns detected entities only.
  try {
    // Server receives partially cleaned text only in hybrid mode.
    const body = (await request.json()) as { partialText?: string };
    const partialText = body.partialText ?? "";

    // Final pass entity detection on untrusted boundary.
    const entities = detectByCompromise(partialText);

    return NextResponse.json({
      entities,
      note: "Hybrid server check received partially anonymized text only.",
    });
  } catch {
    return NextResponse.json(
      {
        message: "Failed to process hybrid anonymization",
      },
      { status: 400 },
    );
  }
}
