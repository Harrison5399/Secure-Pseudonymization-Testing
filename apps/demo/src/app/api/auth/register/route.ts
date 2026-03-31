/**
 * Registration API for creating credentials-based demo users.
 */
import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";

type RegisterBody = {
  username?: string;
  email?: string;
  password?: string;
  name?: string;
};

export async function POST(request: Request) {
  // Validates payload, hashes password, and creates one persisted user row.
  try {
    const body = (await request.json()) as RegisterBody;
    const username = String(body.username ?? "").trim().toLowerCase();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? username).trim();

    if (!username || !email || !password) {
      return NextResponse.json({ message: "username, email, and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ message: "password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json({ message: "username or email already exists" }, { status: 409 });
    }

    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        name,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "registration failed" }, { status: 500 });
  }
}
