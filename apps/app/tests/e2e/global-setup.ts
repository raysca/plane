import path from "path";
import { fileURLToPath } from "url";
import { rm, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, ".test-data");
const TEST_DB_PATH = path.resolve(TEST_DATA_DIR, "test.db");

export default async function globalSetup() {
  console.log("[global-setup] DB path:", TEST_DB_PATH);

  // Clean up any existing test data
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
  await mkdir(TEST_DATA_DIR, { recursive: true });

  // Push schema via drizzle-kit
  const apiNextRoot = path.resolve(__dirname, "../..");
  const schemaPath = path.resolve(apiNextRoot, "src/db/schema/index.ts");

  console.log("[global-setup] Pushing schema...");
  try {
    const output = execSync(
      `bunx drizzle-kit push --dialect=sqlite --schema=${schemaPath} --url=file:${TEST_DB_PATH} --force`,
      {
        cwd: apiNextRoot,
        env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
        stdio: "pipe",
      }
    );
    console.log("[global-setup] drizzle-kit output:", output.toString());
  } catch (error: unknown) {
    const err = error as { stderr?: Buffer; stdout?: Buffer };
    console.error("[global-setup] drizzle-kit push failed:");
    console.error(err.stderr?.toString() || err.stdout?.toString());
    throw new Error("drizzle-kit push failed");
  }

  console.log("[global-setup] Schema pushed. Seeding instance...");

  // Seed instance record using bun
  try {
    const seedScript = path.resolve(__dirname, "seed.ts");
    const output = execSync(`bun ${seedScript} ${TEST_DB_PATH}`, {
      cwd: __dirname,
      stdio: "pipe",
    });
    console.log("[global-setup]", output.toString().trim());
  } catch (error: unknown) {
    const err = error as { stderr?: Buffer; stdout?: Buffer };
    console.error("[global-setup] Seed failed:");
    console.error(err.stderr?.toString() || err.stdout?.toString());
    throw new Error("Seed failed");
  }

  console.log("[global-setup] Done.");
}
