import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
	adapter: PrismaAdapter(prisma),
	secret: process.env.NEXTAUTH_SECRET,
	session: {
		// Credentials provider requires JWT sessions; user records are still persisted via adapter.
		strategy: "jwt",
		maxAge: 60 * 60,
	},
	providers: [
		CredentialsProvider({
			name: "Demo Login",
			credentials: {
				identifier: { label: "Username or Email", type: "text" },
				password: { label: "Password", type: "password" },
			},
			async authorize(credentials) {
				const identifier = String(credentials?.identifier ?? "").trim();
				const password = String(credentials?.password ?? "");

				if (!identifier || !password) {
					return null;
				}
				const user = await prisma.user.findFirst({
					where: {
						OR: [{ username: identifier.toLowerCase() }, { email: identifier.toLowerCase() }],
					},
				});

				if (!user?.passwordHash) {
					return null;
				}

				const passwordOk = await compare(password, user.passwordHash);
				if (!passwordOk) {
					return null;
				}

				return {
					id: user.id,
					name: user.name,
					email: user.email,
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
	logger: {
		error(code, metadata) {
			if (code === "JWT_SESSION_ERROR") {
				return;
			}
			console.error("[next-auth][error]", code, metadata);
		},
	},
};
