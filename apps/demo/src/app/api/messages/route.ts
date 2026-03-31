/**
 * Message API for authenticated inbox retrieval and outbound message creation.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

type SendBody = {
  recipientId?: string;
  recipientEmail?: string;
  content?: string;
};

export async function GET() {
  // Returns latest messages where current user is sender or recipient.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const messages = await prisma.message.findMany({
    where: {
      OR: [{ senderId: userId }, { recipientId: userId }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      sender: { select: { id: true, username: true, name: true, email: true } },
      recipient: { select: { id: true, username: true, name: true, email: true } },
    },
    take: 100,
  });

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  // Resolves recipient by id/email then persists one message row.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SendBody;
    let recipientId = String(body.recipientId ?? "").trim();
    const recipientEmail = String(body.recipientEmail ?? "").trim().toLowerCase();
    const content = String(body.content ?? "").trim();

    if ((!recipientId && !recipientEmail) || !content) {
      return NextResponse.json({ message: "recipientId or recipientEmail and content are required" }, { status: 400 });
    }

    if (!recipientId && recipientEmail) {
      const recipientByEmail = await prisma.user.findUnique({
        where: { email: recipientEmail },
        select: { id: true },
      });

      if (!recipientByEmail) {
        return NextResponse.json({ message: "recipient not found" }, { status: 404 });
      }

      recipientId = recipientByEmail.id;
    }

    if (recipientId === userId) {
      return NextResponse.json({ message: "cannot message yourself in this demo" }, { status: 400 });
    }

    const recipientExists = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });

    if (!recipientExists) {
      return NextResponse.json({ message: "recipient not found" }, { status: 404 });
    }

    const created = await prisma.message.create({
      data: {
        senderId: userId,
        recipientId,
        content,
      },
      include: {
        sender: { select: { id: true, username: true, name: true, email: true } },
        recipient: { select: { id: true, username: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ message: created }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "failed to send message" }, { status: 500 });
  }
}
