/**
 * Protected route wrapper for the client-side encryption and E2EE demo UI.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import E2EEClientDemo from "@/app/e2ee-client-side-encryption/E2EEClientDemo";
import { authOptions } from "@/lib/auth-options";

export const dynamic = "force-dynamic";

/**
 * Requires an authenticated session before rendering the E2EE demo component.
 */
export default async function E2EEEncryptionPage() {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    redirect("/demo-login?callbackUrl=/e2ee-client-side-encryption");
  }

  return (
    <E2EEClientDemo
      sessionUser={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
    />
  );
}
