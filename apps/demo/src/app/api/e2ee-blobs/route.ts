/**
 * Authenticated blind-storage API for envelope-encrypted client bundles.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import type { EnvelopeBundle } from "@harrison/client-encryption";
import { authOptions } from "@/lib/auth-options";

type CreateBody = {
  bundle: EnvelopeBundle;
};

export async function POST(request: Request) {
  // Upserts one encrypted bundle for the current user by bundle id.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CreateBody;

    if (!body.bundle || body.bundle.userId !== userId) {
      return NextResponse.json({ message: "Invalid bundle" }, { status: 400 });
    }

    const saved = await prisma.encryptedBlob.upsert({
      where: {
        id_userId: {
          id: body.bundle.id,
          userId,
        },
      },
      create: {
        id: body.bundle.id,
        userId,
        bundle: body.bundle,
      },
      update: {
        bundle: body.bundle,
      },
    });

    return NextResponse.json({ id: saved.id, storedAt: saved.updatedAt.toISOString() });
  } catch {
    return NextResponse.json({ message: "Failed to store encrypted blob" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Reads one bundle by id or latest bundle list for the authenticated user.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      const one = await prisma.encryptedBlob.findUnique({
        where: {
          id_userId: {
            id,
            userId,
          },
        },
      });

      if (!one) {
        return NextResponse.json({ message: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ bundle: one.bundle });
    }

    const rows = await prisma.encryptedBlob.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });

    return NextResponse.json({ bundles: rows.map((row) => row.bundle) });
  } catch {
    return NextResponse.json({ message: "Failed to read encrypted blob" }, { status: 500 });
  }
}

export async function DELETE() {
  // Clears all encrypted bundle rows for the authenticated user.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.encryptedBlob.deleteMany({
      where: { userId },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Failed to reset encrypted blobs" }, { status: 500 });
  }
}
