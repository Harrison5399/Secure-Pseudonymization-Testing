import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Demo-only credentials auth so the encryption page can be protected by session.
// In production, replace with OAuth/WebAuthn/passkeys and stronger account controls.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,
  },
  providers: [
    Credentials({
      name: "Demo Login",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username ?? "").trim();
        const password = String(credentials?.password ?? "");

        // Demo password can be configured from environment; fallback is for local learning only.
        const allowedPassword = process.env.DEMO_AUTH_PASSWORD ?? "demo-password";

        if (!username || password !== allowedPassword) {
          return null;
        }

        return {
          id: `demo-${username.toLowerCase()}`,
          name: username,
          email: `${username.toLowerCase()}@local.demo`,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/demo-login",
  },
});
