/**
 * Provides a Prisma client pointed at an in-memory SQLite database for tests.
 * Each test file that imports this module shares the same in-memory instance.
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import path from "path";

const DATABASE_URL = "file::memory:?cache=shared";

// Override DATABASE_URL so the Prisma client uses the in-memory DB
process.env.DATABASE_URL = DATABASE_URL;

export const testDb = new PrismaClient({
  datasources: {
    db: { url: DATABASE_URL },
  },
});

/**
 * Applies all migrations to the in-memory database.
 * Call this in beforeAll().
 */
export async function setupTestDatabase(): Promise<void> {
  // Push the schema (without migration history) to the in-memory DB
  const schemaPath = path.resolve(
    new URL("../../prisma/schema.prisma", import.meta.url).pathname
  );
  execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate --force-reset`, {
    env: {
      ...process.env,
      DATABASE_URL,
    },
    stdio: "pipe",
  });
  await testDb.$connect();
}

/**
 * Wipes all rows from application tables between tests.
 */
export async function clearDatabase(): Promise<void> {
  await testDb.notificationLog.deleteMany();
  await testDb.subscriber.deleteMany();
  await testDb.shopSettings.deleteMany();
}

/**
 * Disconnects the client after all tests complete.
 */
export async function teardownTestDatabase(): Promise<void> {
  await testDb.$disconnect();
}
