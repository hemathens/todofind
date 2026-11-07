import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import prompts from 'prompts';
import { scan, sortResults, DEFAULT_TAGS, SORT_OPTIONS } from './scanner.js';
import { isGitRepo, resolveSince, annotate, filterSince } from './git.js';
import { getStagedResults } from './staged.js';
import { installHook, removeHook, DEFAULT_HOOK_TAGS } from './hook.js';
import { REPORTERS } from './reporters.js';
import { createSpinner } from './spinner.js';

const FORMATS = Object.keys(REPORTERS);
const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
const { version: VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function chooseFormat() {
  const { format } = await prompts(
    {
      type: 'select',
      name: 'format',
      message: 'Choose report format',
      choices: [
        { title: 'Table (print in terminal)', value: 'table' },
        { title: 'Markdown (.md report)', value: 'markdown' },
        { title: 'JSON (machine readable)', value: 'json' },
      ],
    },
    { onCancel: () => process.exit(0) }
  );
  return format;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 2; // 0 = ok, 1 = tags found (with --ci), 2 = error or bad usage
}

// The slow part: find files, optionally ask git. Throws on bad usage (caught in scanAction).
async function collect(target, opts, sortBy, spinner) {
  if (opts.staged) {
    const root = path.resolve(target);
    if (!(await isGitRepo(root))) throw new Error('--staged needs git installed and a git repository.');
    return getStagedResults(root, { tags: opts.tags, ignore: opts.ignore });
  }

  const found = await scan(target, {
    tags: opts.tags,
    ignore: opts.ignore,
    gitignore: opts.gitignore,
    onProgress: (n) => spinner.update(`Scanning files… ${n}`),
  });
  let { results } = found;

  // Git data is needed for --since, and for sorting by date.
  if (opts.since || sortBy === 'date') {
    if (!(await isGitRepo(found.root))) throw new Error('--since and --sort date need git installed and a git repository.');
    spinner.update('Reading git history…');
    const since = opts.since ? await resolveSince(opts.since, found.root) : null;
    results = await annotate(results, found.root);
    if (since) results = filterSince(results, since);
  }
  return { results, filesScanned: found.filesScanned };
}

async function scanAction(target, opts) {
  try {
    const sortBy = opts.sort.toLowerCase();
    if (!SORT_OPTIONS.includes(sortBy)) return fail(`Unknown sort "${sortBy}". Use: ${SORT_OPTIONS.join(', ')}`);
    let format = opts.format?.toLowerCase();
    if (format && !FORMATS.includes(format)) return fail(`Unknown format "${format}". Use: ${FORMATS.join(', ')}`);
    if (opts.staged && (opts.since || sortBy === 'date')) {
      return fail('--staged cannot be combined with --since or --sort date.');
    }

    // Ask only when no flag was given and a human is at the terminal.
    if (!format) format = process.stdin.isTTY ? await chooseFormat() : 'table';

    const spinner = createSpinner('Scanning files…', { enabled: !opts.quiet }).start();
    let results, filesScanned;
    try {
      ({ results, filesScanned } = await collect(target, opts, sortBy, spinner));
    } finally {
      spinner.stop(); // always clear the line, even on errors
    }
    results = sortResults(results, sortBy);

    if (opts.quiet && results.length === 0 && !opts.output) return;

    const report = REPORTERS[format](results, {
      filesScanned,
      color: Boolean(process.stdout.isTTY) && !opts.output,
    });

    if (opts.output) {
      await fs.writeFile(opts.output, report + '\n', 'utf8');
      console.log(`Report saved to ${opts.output} (${results.length} items, ${filesScanned} files scanned)`);
    } else {
      console.log(report);
    }

    if (opts.ci && results.length > 0) process.exitCode = 1;
  } catch (err) {
    fail(err.code === 'ENOENT' ? `path not found: ${target}` : err.message);
  }
}

async function initAction(opts) {
  try {
    const cwd = process.cwd();
    if (opts.remove) {
      const res = await removeHook(cwd);
      if (!res.removed) console.log('No pre-commit hook found. Nothing to remove.');
      else console.log(`Removed the todofind hook${res.restored ? ' and restored your previous hook' : ''}.`);
      return;
    }
    const tags = (opts.tags?.length ? opts.tags : DEFAULT_HOOK_TAGS).map((t) => t.toUpperCase());
    const res = await installHook(cwd, { tags, version: VERSION, force: opts.force });
    console.log(`${res.updated ? 'Updated' : 'Installed'} pre-commit hook: ${res.file}`);
    if (res.backedUp) console.log(`Your previous hook was saved as ${res.file}.backup`);
    console.log(`Commits that ADD a ${tags.join(' / ')} comment will now be blocked.`);
    console.log('Skip the check once with: git commit --no-verify');
  } catch (err) {
    fail(err.message);
  }
}

export function run(argv) {
  const program = new Command();

  // Usage mistakes must exit with 2, never 1 (1 is reserved for "tags found").
  program.exitOverride((err) => process.exit(err.exitCode === 0 ? 0 : 2));

  program
    .name('todofind')
    .description('Scan your code for TODO, FIXME and other comment tags')
    .version(VERSION)
    .argument('[path]', 'directory or file to scan', '.')
    .option('-f, --format <type>', `output format: ${FORMATS.join(' | ')} (asks if omitted)`)
    .option('-t, --tags <list>', `comma-separated tags (default: ${DEFAULT_TAGS.join(',')})`, list)
    .option('-i, --ignore <list>', 'extra folders/files to ignore, comma-separated', list)
    .option('-s, --since <when>', 'only TODOs added/changed since: 7d, 2w, 3m, 2026-10-01 or a git ref (needs git)')
    .option('--sort <by>', `sort by: ${SORT_OPTIONS.join(' | ')}`, 'file')
    .option('--staged', 'only check lines added in staged changes (used by the pre-commit hook)')
    .option('--no-gitignore', 'also scan files that .gitignore excludes')
    .option('-q, --quiet', 'print nothing when no tags are found')
    .option('-o, --output <file>', 'write the report to a file instead of the terminal')
    .option('--ci', 'exit with code 1 if any tags are found')
    .action(scanAction);

  program
    .command('init')
    .description('install a git pre-commit hook that blocks newly added FIXME/XXX/BUG comments')
    .option('-t, --tags <list>', `tags that block a commit (default: ${DEFAULT_HOOK_TAGS.join(',')})`, list)
    .option('--force', 'replace an existing pre-commit hook (a backup is saved)')
    .option('--remove', 'uninstall the todofind hook')
    .action(initAction);

  program.parse(argv);
}