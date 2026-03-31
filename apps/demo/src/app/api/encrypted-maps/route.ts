/**
 * Encrypted map blob API used by anonymization demo backend storage mode.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Request payload includes encrypted material only (no plaintext map).
type SaveBody = {
  conversationId?: string;
  label?: string;
  method: string;
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
  iterations: number;
};

export async function POST(request: Request) {
  // Saves one encrypted map payload and associates it with a conversation id.
  try {
    const body = (await request.json()) as SaveBody;

    if (!body.method || !body.ciphertextB64 || !body.ivB64 || !body.saltB64 || !body.iterations) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    // Use/creates a conversation grouping so multiple blobs can be versioned over time.
    const conversation = body.conversationId
      ? await prisma.conversation.upsert({
          where: { id: body.conversationId },
          update: {
            label: body.label,
          },
          create: {
            id: body.conversationId,
            label: body.label,
          },
        })
      : await prisma.conversation.create({
          data: {
            label: body.label,
          },
        });

    // Persist opaque encrypted payload fields exactly as received.
    const saved = await prisma.encryptedMap.create({
      data: {
        conversationId: conversation.id,
        method: body.method,
        ciphertext: body.ciphertextB64,
        iv: body.ivB64,
        salt: body.saltB64,
        iterations: body.iterations,
      },
    });

    return NextResponse.json({
      id: saved.id,
      conversationId: conversation.id,
      createdAt: saved.createdAt,
    });
  } catch {
    return NextResponse.json(
      {
        message: "Failed to store encrypted payload",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  // Returns latest encrypted blob for a given conversation id.
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json({ message: "conversationId is required" }, { status: 400 });
  }

  try {
    // Return latest blob for conversation; client does decrypt locally.
    const latest = await prisma.encryptedMap.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    if (!latest) {
      return NextResponse.json({ message: "No encrypted map found" }, { status: 404 });
    }

    return NextResponse.json({
      id: latest.id,
      conversationId: latest.conversationId,
      method: latest.method,
      ciphertextB64: latest.ciphertext,
      ivB64: latest.iv,
      saltB64: latest.salt,
      iterations: latest.iterations,
      createdAt: latest.createdAt,
    });
  } catch {
    return NextResponse.json(
      {
        message: "Failed to fetch encrypted payload",
      },
      { status: 500 },
    );
  }
}
