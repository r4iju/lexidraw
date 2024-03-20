import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'
import env from "@packages/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const newSingleton = () => {
  const libsql = createClient({
    url: `${env.TURSO_URL}`,
    authToken: `${env.TURSO_TOKEN}`,
  })
  const adapter = new PrismaLibSQL(libsql)
  const prisma = new PrismaClient({
    adapter: adapter,
    log: env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  })
  return prisma;
}

export const db = globalForPrisma.prisma ?? newSingleton();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
