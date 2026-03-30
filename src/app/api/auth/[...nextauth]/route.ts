/**
 * Auth.js route handlers (GET/POST) for session, callback, and provider endpoints.
 */
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
