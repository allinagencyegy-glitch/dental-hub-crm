/**
 * Reads the first worksheet of an .xlsx file into rows of strings.
 *
 * A deliberately small reader for the Spider CRM exports, so the import needs
 * no spreadsheet dependency: an .xlsx file is a zip archive of XML parts, and
 * the exports use only shared strings, inline strings and plain values.
 * Formatting, formulas and dates-as-numbers are not interpreted - every cell
 * comes back as the text Excel would show for a general cell.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Every file in the zip archive, by path, still compressed. */
function readZipEntries(zip: Buffer): Map<string, () => Buffer> {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not an .xlsx file: no zip directory found.');

  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = new Map<string, () => Buffer>();

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw new Error('Corrupt .xlsx zip directory.');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    entries.set(name, () => {
      if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error(`Corrupt .xlsx entry ${name}.`);
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported compression in .xlsx entry ${name}.`);
    });
  }
  return entries;
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

/** The text of every <t> inside a fragment - rich text splits one string into runs. */
function textOf(fragment: string): string {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function readXlsxRows(path: string): string[][] {
  const entries = readZipEntries(readFileSync(path));
  const read = (name: string) => entries.get(name)?.().toString('utf8');

  const sharedXml = read('xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));

  const sheetName = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  const sheet = sheetName ? read(sheetName) : undefined;
  if (!sheet) throw new Error(`${path} has no worksheet.`);

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const body = cell[2] ?? '';
      const reference = /\br="([A-Z]+)\d*"/.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

      // Spider writes phone numbers as a string formula (="+2010...") whose
      // cached value is 0, so a formula that is a plain string literal is
      // read for its literal.
      const literal = /^"((?:[^"]|"")*)"$/.exec(decodeXml(/<f>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? ''));

      let text = '';
      if (literal) text = literal[1].replace(/""/g, '"');
      else if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = textOf(body);
      else if (value !== undefined) text = decodeXml(value);

      const index = reference ? columnIndex(reference) : row.length;
      while (row.length < index) row.push('');
      row[index] = text;
    }
    rows.push(row);
  }
  return rows;
}

/** Rows as records keyed by the header row. */
export function readXlsxRecords(path: string): Record<string, string>[] {
  const [header, ...rows] = readXlsxRows(path);
  if (!header) return [];
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => Object.fromEntries(header.map((name, index) => [name.trim(), row[index] ?? ''])));
}
