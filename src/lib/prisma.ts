import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl,
            },
          },
        }
      : undefined
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
