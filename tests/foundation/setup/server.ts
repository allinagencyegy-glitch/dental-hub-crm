import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const NEXT_BIN = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine a free port.')));
      }
    });
  });
}

export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function waitForReady(baseUrl: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The Next.js server exited early with code ${child.exitCode}.`);
    }
    try {
      // Any HTTP response means the server is listening.
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`The Next.js server did not become ready within ${timeoutMs}ms.`);
}

/**
 * Boots the production build (`next start`) against the disposable test
 * database. The production path is what the acceptance suite must assert:
 * cookie `Secure`/`__Host-` behaviour and the RSC payload shape both differ in
 * development.
 */
export async function startProductionServer(databaseUrl: string): Promise<RunningServer> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [NEXT_BIN, 'start', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      PORT: String(port),
    },
  });

  const logs: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));

  try {
    await waitForReady(baseUrl, child);
  } catch (error) {
    child.kill();
    throw new Error(`${(error as Error).message}\n--- server output ---\n${logs.join('')}`);
  }

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
        // Windows does not always honour SIGTERM for node child processes.
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5_000).unref();
      }),
  };
}
