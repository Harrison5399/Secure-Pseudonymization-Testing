/**
 * Login page route that redirects authenticated users to the E2EE demo.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import DemoLoginForm from "@/app/demo-login/DemoLoginForm";
import { authOptions } from "@/lib/auth-options";

export const dynamic = "force-dynamic";

/**
 * Resolves session status server-side and renders login/register form if needed.
 */
export default async function DemoLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    // Stale or malformed auth cookies should not block rendering the login page.
    session = null;
  }

  if (session?.user?.id) {
    redirect("/e2ee-client-side-encryption");
  }

  const params = await searchParams;

  return <DemoLoginForm callbackUrl={params.callbackUrl || "/e2ee-client-side-encryption"} />;
}
