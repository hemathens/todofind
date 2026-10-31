import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const git = (args, cwd) => run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });

const UNITS = { d: 86400, w: 604800, m: 2592000, y: 31536000 }; // seconds

export async function isGitRepo(cwd) {
  try {
    const { stdout } = await git(['rev-parse', '--is-inside-work-tree'], cwd);
    return stdout.trim() === 'true';
  } catch {
    return false; // git missing or not a repository
  }
}

/**
 * Turn "7d", "2w", "3m", "1y", "2026-10-01" or a git ref (main, v1.0.0, HEAD~5)
 * into a point in time. `inclusive` is false for refs, so the ref's own commit is excluded.
 */
export async function resolveSince(value, cwd) {
  const now = Math.floor(Date.now() / 1000);

  const rel = /^(\d+)([dwmy])$/i.exec(value);
  if (rel) return { time: now - Number(rel[1]) * UNITS[rel[2].toLowerCase()], inclusive: true };

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`Invalid date: ${value}`);
    return { time: Math.floor(ms / 1000), inclusive: true };
  }

  if (!value.startsWith('-')) {
    try {
      const { stdout } = await git(['log', '-1', '--format=%ct', value, '--'], cwd);
      const time = Number(stdout.trim());
      if (time) return { time, inclusive: false };
    } catch {
      /* fall through to the error below */
    }
  }
  throw new Error(
    `Could not understand --since "${value}". Use 7d, 2w, 3m, 2026-10-01, or a git ref like main or v1.0.0`
  );
}

// `git blame --porcelain` -> map of final line number -> { author, time }
async function blameFile(file, cwd) {
  const { stdout } = await git(['blame', '--porcelain', '--', file], cwd);
  const commits = new Map();
  const lines = new Map();
  let current = null;
  let finalLine = 0;

  for (const l of stdout.split('\n')) {
    const head = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(l);
    if (head) {
      current = head[1];
      finalLine = Number(head[2]);
      if (!commits.has(current)) commits.set(current, {});
      continue;
    }
    if (l.startsWith('author ')) commits.get(current).author = l.slice(7);
    else if (l.startsWith('author-time ')) commits.get(current).time = Number(l.slice(12));
    else if (l.startsWith('\t')) lines.set(finalLine, commits.get(current));
  }
  return lines;
}

/** Adds `date` (ISO) and `by` (who last changed the line) to every result. */
export async function annotate(results, base) {
  const byFile = new Map();
  for (const r of results) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }

  const files = [...byFile.keys()];
  const CHUNK = 8; // limited parallelism so big repos don't spawn hundreds of processes

  for (let i = 0; i < files.length; i += CHUNK) {
    await Promise.all(
      files.slice(i, i + CHUNK).map(async (file) => {
        const items = byFile.get(file);
        let info = null;
        try {
          info = await blameFile(file, base);
        } catch {
          /* untracked file: handled below */
        }

        let mtime = null;
        for (const r of items) {
          const meta = info?.get(r.line);
          if (meta?.time && meta.author !== 'Not Committed Yet') {
            r.date = new Date(meta.time * 1000).toISOString();
            r.by = meta.author;
          } else {
            // uncommitted change or untracked file: it is recent work by definition
            mtime ??= (await fs.stat(path.join(base, file))).mtime;
            r.date = mtime.toISOString();
            r.by = 'uncommitted';
          }
        }
      })
    );
  }
  return results;
}

export function filterSince(results, { time, inclusive }) {
  return results.filter((r) => {
    const t = Date.parse(r.date) / 1000;
    return inclusive ? t >= time : t > time;
  });
}