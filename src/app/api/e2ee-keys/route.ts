/**
 * Per-device public key directory API for multi-device E2EE message fan-out.
 */
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

type UpsertBody = {
  identityPublicB64?: string;
  algorithm?: string;
  deviceId?: string;
};

function makeKeyId(identityPublicB64: string): string {
  return createHash("sha256").update(identityPublicB64).digest("hex").slice(0, 16);
}

export async function GET(request: Request) {
  // Looks up key(s) by email or returns current user's device key directory entries.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
  const deviceId = String(url.searchParams.get("deviceId") ?? "").trim();

  try {
    if (email) {
      const target = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          username: true,
          deviceKeys: {
            orderBy: { updatedAt: "desc" },
            select: {
              deviceId: true,
              identityPublicB64: true,
              algorithm: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!target) {
        return NextResponse.json({ message: "recipient not found" }, { status: 404 });
      }

      return NextResponse.json({
        user: {
          id: target.id,
          email: target.email,
          username: target.username,
        },
        publicKeys: target.deviceKeys.map((deviceKey) => ({
          ...deviceKey,
          keyId: makeKeyId(deviceKey.identityPublicB64),
          keyVersion: deviceKey.updatedAt.toISOString(),
        })),
      });
    }

    const selfWhere = deviceId ? { userId_deviceId: { userId, deviceId } } : undefined;

    if (selfWhere) {
      const one = await prisma.userDeviceKey.findUnique({
        where: selfWhere,
        select: {
          deviceId: true,
          identityPublicB64: true,
          algorithm: true,
          updatedAt: true,
        },
      });

      return NextResponse.json({
        publicKey: one
          ? {
              ...one,
              keyId: makeKeyId(one.identityPublicB64),
              keyVersion: one.updatedAt.toISOString(),
            }
          : null,
      });
    }

    const all = await prisma.userDeviceKey.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        deviceId: true,
        identityPublicB64: true,
        algorithm: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      publicKeys: all.map((key) => ({
        ...key,
        keyId: makeKeyId(key.identityPublicB64),
        keyVersion: key.updatedAt.toISOString(),
      })),
    });
  } catch {
    return NextResponse.json({ message: "failed to read key directory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Upserts one public key record for the authenticated user/device tuple.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as UpsertBody;
    const identityPublicB64 = String(body.identityPublicB64 ?? "").trim();
    const algorithm = String(body.algorithm ?? "X25519").trim() || "X25519";
    const deviceId = String(body.deviceId ?? "").trim();

    if (!identityPublicB64) {
      return NextResponse.json({ message: "identityPublicB64 is required" }, { status: 400 });
    }

    if (!deviceId) {
      return NextResponse.json({ message: "deviceId is required" }, { status: 400 });
    }

    const saved = await prisma.userDeviceKey.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: {
        userId,
        deviceId,
        identityPublicB64,
        algorithm,
      },
      update: {
        identityPublicB64,
        algorithm,
      },
      select: {
        deviceId: true,
        identityPublicB64: true,
        algorithm: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      publicKey: {
        ...saved,
        keyId: makeKeyId(saved.identityPublicB64),
        keyVersion: saved.updatedAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ message: "failed to publish public key" }, { status: 500 });
  }
}
