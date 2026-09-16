import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dental Hub CRM is a standalone product. Nothing from any other product's
 * vocabulary may appear in the schema, the server code, the tests or the docs.
 */
const BANNED: { label: string; pattern: RegExp }[] = [
  { label: 'All In Studio', pattern: /all\s*in\s*studio/i },
  { label: 'allinstudio', pattern: /allinstudio/i },
  { label: 'Governed Front Door', pattern: /governed\s+front\s+door/i },
  { label: 'Sample Clinic Account', pattern: /sample\s+clinic\s+account/i },
  { label: 'M1', pattern: /\bM1\b/ },
];

function collectFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

describe('zero foreign vocabulary', () => {
  const roots: { dir: string; extensions: string[] }[] = [
    { dir: 'migrations', extensions: ['.sql'] },
    { dir: 'src/server', extensions: ['.ts'] },
    { dir: 'tests/crm', extensions: ['.ts'] },
  ];

  const files = [
    ...roots.flatMap(({ dir, extensions }) =>
      collectFiles(path.resolve(process.cwd(), dir), extensions),
    ),
    // Scanned docs are named explicitly: FOUNDATION-V0.md contains the
    // acceptance-criteria row that names the ban itself (a meta-reference),
    // and the scanner necessarily names the banned terms, so neither file is
    // scanned.
    path.resolve(process.cwd(), 'README.md'),
    path.resolve(process.cwd(), 'docs/ARCHITECTURE.md'),
    path.resolve(process.cwd(), 'docs/CRM-DOMAIN-V0.md'),
  ].filter((file) => !file.endsWith('vocabulary.test.ts'));

  it('finds project files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { label, pattern } of BANNED) {
    it(`contains no "${label}" reference`, () => {
      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        expect(
          pattern.test(content),
          `${path.relative(process.cwd(), file)} contains banned vocabulary "${label}"`,
        ).toBe(false);
      }
    });
  }
});
