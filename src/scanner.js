import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignoreLib from 'ignore';
import { listFiles as gitListFiles } from './git.js';

export const DEFAULT_TAGS = ['TODO', 'FIXME', 'HACK', 'BUG', 'XXX', 'NOTE'];

export const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  'out', 'vendor', '.venv', '__pycache__', '.idea', '.vscode',
];

const MAX_FILE_SIZE = 1024 * 1024; // skip files over 1 MB

export function normalizeTags(tags) {
  return (tags?.length ? tags : DEFAULT_TAGS).map((t) => t.toUpperCase());
}

// Matches a tag that appears right after a comment marker: // # /* * <!-- -- ; %
export function buildRegex(tags) {
  const list = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `(?:\\/\\/|#|\\/\\*|\\*|<!--|--|;|%)\\s*(${list})\\b(?:\\(([^)]*)\\))?\\s*:?\\s*(.*)$`
  );
}

function cleanMessage(msg) {
  return msg.replace(/\s*(\*\/|-->)\s*$/, '').trim();
}

/** Returns { tag, author, message } if the line holds a tagged comment, else null. */
export function matchLine(regex, line) {
  const m = regex.exec(line);
  if (!m) return null;
  return { tag: m[1], author: m[2] || null, message: cleanMessage(m[3] || '') };
}

function looksBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) if (buffer[i] === 0) return true;
  return false;
}

// Fallback for folders that are not git repos: honour the root .gitignore ourselves.
async function loadGitignore(root) {
  try {
    const text = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    return ignoreLib().add(text);
  } catch {
    return null;
  }
}

async function* walk(dir, root, ignore, matcher) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory, skip
  }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (matcher?.ignores(entry.isDirectory() ? `${rel}/` : rel)) continue;
    if (entry.isDirectory()) yield* walk(full, root, ignore, matcher);
    else if (entry.isFile()) yield full;
  }
}

async function* listFiles(root, ignore, useGitignore) {
  if (useGitignore) {
    // Inside a git repo, git knows best: nested .gitignore files, global ignores, negations.
    const files = await gitListFiles(root);
    if (files) {
      for (const rel of files.sort()) {
        if (rel.split('/').some((seg) => ignore.has(seg))) continue;
        yield path.join(root, rel);
      }
      return;
    }
  }
  yield* walk(root, root, ignore, useGitignore ? await loadGitignore(root) : null);
}

/**
 * Scan a directory (or a single file) for comment tags.
 * Options: tags, ignore (names), gitignore (default true), onProgress(filesScanned).
 * @returns {Promise<{results: object[], filesScanned: number, root: string}>}
 */
export async function scan(root, options = {}) {
  const regex = buildRegex(normalizeTags(options.tags));
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);
  const absRoot = path.resolve(root);

  const stat = await fs.stat(absRoot);
  const base = stat.isFile() ? path.dirname(absRoot) : absRoot;
  const files = stat.isFile() ? [absRoot] : listFiles(absRoot, ignore, options.gitignore !== false);

  const results = [];
  let filesScanned = 0;

  for await (const file of files) {
    let info;
    try {
      info = await fs.stat(file);
    } catch {
      continue; // listed by git but deleted from disk
    }
    if (!info.isFile() || info.size > MAX_FILE_SIZE) continue;
    const buffer = await fs.readFile(file);
    if (looksBinary(buffer)) continue;
    filesScanned++;
    options.onProgress?.(filesScanned);

    buffer.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      const hit = matchLine(regex, line);
      if (!hit) return;
      results.push({
        file: path.relative(base, file).split(path.sep).join('/'),
        line: i + 1,
        ...hit,
      });
    });
  }

  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { results, filesScanned, root: base };
}

export function summarize(results) {
  const byTag = {};
  for (const r of results) byTag[r.tag] = (byTag[r.tag] ?? 0) + 1;
  return { total: results.length, byTag };
}

export const SORT_OPTIONS = ['file', 'tag', 'date'];

// Most urgent first; custom tags go after these, alphabetically.
const TAG_ORDER = ['BUG', 'FIXME', 'HACK', 'XXX', 'TODO', 'NOTE'];
const tagRank = (t) => (TAG_ORDER.includes(t) ? TAG_ORDER.indexOf(t) : TAG_ORDER.length);

export function sortResults(results, by = 'file') {
  const byFile = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  const sorted = [...results];
  if (by === 'tag') {
    sorted.sort((a, b) => tagRank(a.tag) - tagRank(b.tag) || a.tag.localeCompare(b.tag) || byFile(a, b));
  } else if (by === 'date') {
    // newest first; items without a date go last
    sorted.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || byFile(a, b));
  } else {
    sorted.sort(byFile);
  }
  return sorted;
}