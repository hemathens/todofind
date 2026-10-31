import { promises as fs } from 'node:fs';
import { Command } from 'commander';
import prompts from 'prompts';
import { scan, sortResults, DEFAULT_TAGS, SORT_OPTIONS } from './scanner.js';
import { isGitRepo, resolveSince, annotate, filterSince } from './git.js';
import { REPORTERS } from './reporters.js';

const FORMATS = Object.keys(REPORTERS);
const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

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

export function run(argv) {
  const program = new Command();

  program
    .name('todofind')
    .description('Scan your code for TODO, FIXME and other comment tags')
    .version('1.1.0')
    .argument('[path]', 'directory or file to scan', '.')
    .option('-f, --format <type>', `output format: ${FORMATS.join(' | ')} (asks if omitted)`)
    .option('-t, --tags <list>', `comma-separated tags (default: ${DEFAULT_TAGS.join(',')})`, list)
    .option('-i, --ignore <list>', 'extra folders/files to ignore, comma-separated', list)
    .option('-s, --since <when>', 'only TODOs added/changed since: 7d, 2w, 3m, 2026-10-01 or a git ref (needs git)')
    .option('--sort <by>', `sort by: ${SORT_OPTIONS.join(' | ')}`, 'file')
    .option('-o, --output <file>', 'write the report to a file instead of the terminal')
    .option('--ci', 'exit with code 1 if any tags are found')
    .action(async (target, opts) => {
      try {
        let format = opts.format?.toLowerCase();
        if (format && !FORMATS.includes(format)) {
          console.error(`Unknown format "${format}". Use: ${FORMATS.join(', ')}`);
          process.exit(2);
        }
        const sortBy = opts.sort.toLowerCase();
        if (!SORT_OPTIONS.includes(sortBy)) {
          console.error(`Unknown sort "${sortBy}". Use: ${SORT_OPTIONS.join(', ')}`);
          process.exit(2);
        }
        // Ask only when no flag was given and a human is at the terminal.
        if (!format) format = process.stdin.isTTY ? await chooseFormat() : 'table';

        let { results, filesScanned, root } = await scan(target, {
          tags: opts.tags,
          ignore: opts.ignore,
        });

        // Git data is needed for --since, and for sorting by date.
        if (opts.since || sortBy === 'date') {
          if (!(await isGitRepo(root))) {
            throw new Error('--since and --sort date need git installed and a git repository.');
          }
          const since = opts.since ? await resolveSince(opts.since, root) : null;
          results = await annotate(results, root);
          if (since) results = filterSince(results, since);
        }
        results = sortResults(results, sortBy);

        const useColor = Boolean(process.stdout.isTTY) && !opts.output;
        const report = REPORTERS[format](results, { filesScanned, color: useColor });

        if (opts.output) {
          await fs.writeFile(opts.output, report + '\n', 'utf8');
          console.log(`Report saved to ${opts.output} (${results.length} items, ${filesScanned} files scanned)`);
        } else {
          console.log(report);
        }

        if (opts.ci && results.length > 0) process.exit(1);
      } catch (err) {
        console.error(`Error: ${err.code === 'ENOENT' ? `path not found: ${target}` : err.message}`);
        process.exit(2);
      }
    });

  program.parse(argv);
}