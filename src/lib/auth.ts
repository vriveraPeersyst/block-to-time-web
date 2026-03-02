import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const googleClientId =
  process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID;
const googleClientSecret =
  process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

function extractErrorDetails(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: extractErrorDetails((value as Error & { cause?: unknown }).cause),
    };
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...record,
    cause: extractErrorDetails(record.cause),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  secret: authSecret,
  logger: {
    error(code, ...message) {
      console.error("[auth][logger][error]", code, message.map(extractErrorDetails));
    },
    warn(code) {
      console.warn("[auth][logger][warn]", code);
    },
  },
  providers: [
    Google({
      clientId: googleClientId!,
      clientSecret: googleClientSecret!,
    }),
  ],
  session: {
    strategy: "database",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});
