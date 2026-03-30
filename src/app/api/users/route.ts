/**
 * User directory API for listing message recipients (excluding current user).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Returns a bounded list of other users for recipient selection.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        not: userId,
      },
    },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
    },
    take: 100,
  });

  return NextResponse.json({ users });
}
