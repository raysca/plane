import path from "path";
import { fileURLToPath } from "url";
import { rm } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, ".test-data");

export default async function globalTeardown() {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
  console.log("[global-teardown] Cleaned up test data");
}
