import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads .env for standalone scripts and the test harness. The Next.js server
 * does this for itself; plain Node does not.
 *
 * Uses Node's built-in loader - no dotenv dependency. Real values are never
 * committed; see .env.example.
 */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const full = path.resolve(process.cwd(), file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}
