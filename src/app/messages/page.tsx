/**
 * Protected route wrapper for the user-to-user messaging page.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import MessagesClient from "@/app/messages/MessagesClient";

export const dynamic = "force-dynamic";

/**
 * Redirects unauthenticated users and passes session user data to the client UI.
 */
export default async function MessagesPage() {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    redirect("/demo-login?callbackUrl=/messages");
  }

  return (
    <MessagesClient
      currentUser={{
        id: session.user.id,
        usernameOrName: session.user.name ?? "unknown",
        email: session.user.email ?? null,
      }}
    />
  );
}
