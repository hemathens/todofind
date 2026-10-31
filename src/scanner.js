import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TAGS = ['TODO', 'FIXME', 'HACK', 'BUG', 'XXX', 'NOTE'];

export const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  'out', 'vendor', '.venv', '__pycache__', '.idea', '.vscode',
];

const MAX_FILE_SIZE = 1024 * 1024; // skip files over 1 MB

// Matches a tag that appears right after a comment marker: // # /* * <!-- -- ; %
function buildRegex(tags) {
  const list = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `(?:\\/\\/|#|\\/\\*|\\*|<!--|--|;|%)\\s*(${list})\\b(?:\\(([^)]*)\\))?\\s*:?\\s*(.*)$`
  );
}

function cleanMessage(msg) {
  return msg.replace(/\s*(\*\/|-->)\s*$/, '').trim();
}

function looksBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) if (buffer[i] === 0) return true;
  return false;
}

async function* walk(dir, ignore) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory, skip
  }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, ignore);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Scan a directory (or a single file) for comment tags.
 * @returns {Promise<{results: object[], filesScanned: number}>}
 */
export async function scan(root, options = {}) {
  const tags = (options.tags?.length ? options.tags : DEFAULT_TAGS).map((t) => t.toUpperCase());
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const regex = buildRegex(tags);
  const absRoot = path.resolve(root);

  const stat = await fs.stat(absRoot);
  const files = stat.isFile() ? [absRoot] : walk(absRoot, ignore);
  const base = stat.isFile() ? path.dirname(absRoot) : absRoot;

  const results = [];
  let filesScanned = 0;

  for await (const file of files) {
    const info = await fs.stat(file);
    if (info.size > MAX_FILE_SIZE) continue;
    const buffer = await fs.readFile(file);
    if (looksBinary(buffer)) continue;
    filesScanned++;

    const lines = buffer.toString('utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = regex.exec(line);
      if (!m) return;
      results.push({
        file: path.relative(base, file).split(path.sep).join('/'),
        line: i + 1,
        tag: m[1],
        author: m[2] || null,
        message: cleanMessage(m[3] || ''),
      });
    });
  }

  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { results, filesScanned };
}

export function summarize(results) {
  const byTag = {};
  for (const r of results) byTag[r.tag] = (byTag[r.tag] ?? 0) + 1;
  return { total: results.length, byTag };
}
