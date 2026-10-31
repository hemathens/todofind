import { git } from './git.js';
import { buildRegex, matchLine, normalizeTags, DEFAULT_IGNORE } from './scanner.js';

/** Reads one file's `git diff -U0` and returns the lines that were added, with their new line numbers. */
export function parseAddedLines(diffText) {
  const added = [];
  let inHunk = false;
  let line = 0;

  for (const raw of diffText.split('\n')) {
    const l = raw.replace(/\r$/, '');
    if (l.startsWith('diff --git ')) {
      inHunk = false; // next file: its "+++ b/..." header must not count as an added line
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      inHunk = true;
      line = Number(hunk[1]);
      continue;
    }
    if (inHunk && l.startsWith('+')) {
      added.push({ line, text: l.slice(1) });
      line++;
    }
  }
  return added;
}

/** Tagged comments on lines that are staged for the next commit (and only those). */
export async function getStagedResults(root, options = {}) {
  const regex = buildRegex(normalizeTags(options.tags));
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);

  const { stdout } = await git(
    ['diff', '--cached', '--name-only', '--relative', '-z', '--diff-filter=ACMR'],
    root
  );
  const files = stdout
    .split('\0')
    .filter(Boolean)
    .filter((f) => !f.split('/').some((seg) => ignore.has(seg)));

  const results = [];
  const CHUNK = 8;
  for (let i = 0; i < files.length; i += CHUNK) {
    await Promise.all(
      files.slice(i, i + CHUNK).map(async (file) => {
        const { stdout: diff } = await git(
          ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--relative', '--', file],
          root
        );
        for (const { line, text } of parseAddedLines(diff)) {
          const hit = matchLine(regex, text);
          if (hit) results.push({ file, line, ...hit });
        }
      })
    );
  }
  return { results, filesScanned: files.length };
}