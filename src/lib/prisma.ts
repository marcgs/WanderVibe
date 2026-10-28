import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env for local development, or set it in the container environment.",
    );
  }

  // node-pg ignores connect_timeout in the URL. These are the JS client's timeouts.
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3000,
    query_timeout: 2500,
  });
  return new PrismaClient({ adapter });
}

function getPrismaClient() {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
