import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, isGitRepo } from './git.js';

export const MARKER = '# todofind-managed-hook';
export const DEFAULT_HOOK_TAGS = ['FIXME', 'XXX', 'BUG'];

export function hookScript({ tags = DEFAULT_HOOK_TAGS, version = 'latest' } = {}) {
  return `#!/bin/sh
${MARKER} (remove with: todofind init --remove)

# Use the project's copy, then a global install, then a pinned version through npx.
if [ -f "node_modules/.bin/todofind" ]; then
  TODOFIND="node_modules/.bin/todofind"
elif command -v todofind >/dev/null 2>&1; then
  TODOFIND="todofind"
else
  TODOFIND="npx --yes todofind@${version}"
fi

$TODOFIND --staged --ci --quiet -f table --tags ${tags.join(',')}
status=$?

# Exit code 1 means tags were found. Anything else (tool error) never blocks a commit.
if [ "$status" -eq 1 ]; then
  echo ""
  echo "todofind: commit blocked. Resolve the items above, or skip this check with: git commit --no-verify"
  exit 1
fi
exit 0
`;
}

// Asks git where hooks live, so core.hooksPath, worktrees and submodules all work.
async function hookFile(cwd) {
  if (!(await isGitRepo(cwd))) throw new Error('This folder is not a git repository. Run "git init" first.');
  const { stdout } = await git(['rev-parse', '--git-path', 'hooks'], cwd);
  return path.resolve(cwd, stdout.trim(), 'pre-commit');
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function installHook(cwd, { tags, version, force = false } = {}) {
  const file = await hookFile(cwd);
  const existing = await readIfExists(file);
  const ours = existing?.includes(MARKER);

  let backedUp = false;
  if (existing !== null && !ours) {
    if (!force) {
      throw new Error(
        `A pre-commit hook already exists (${file}) and was not created by todofind.\n` +
          'Use "todofind init --force" to back it up and replace it.'
      );
    }
    await fs.copyFile(file, `${file}.backup`);
    backedUp = true;
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, hookScript({ tags, version }), 'utf8'); // LF endings: sh needs them
  await fs.chmod(file, 0o755);
  return { file, backedUp, updated: Boolean(ours) };
}

export async function removeHook(cwd) {
  const file = await hookFile(cwd);
  const existing = await readIfExists(file);
  if (existing === null) return { removed: false, file };
  if (!existing.includes(MARKER)) {
    throw new Error(`The pre-commit hook at ${file} was not created by todofind, so it was left alone.`);
  }
  await fs.unlink(file);

  let restored = false;
  if ((await readIfExists(`${file}.backup`)) !== null) {
    await fs.rename(`${file}.backup`, file); // put the user's original hook back
    restored = true;
  }
  return { removed: true, restored, file };
}