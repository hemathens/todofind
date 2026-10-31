# todofind

Scan your codebase for `TODO`, `FIXME`, `HACK`, `BUG`, `XXX` and `NOTE` comments.
Get the report as a **table**, **Markdown** or **JSON**.

## Usage

```bash
npx todofind              # scans current folder, asks for output format
npx todofind src -f table
npx todofind -f markdown -o TODO.md
npx todofind -f json --ci          # exit code 1 if anything found (for CI)
```

## Options

| Option | Description |
|--------|-------------|
| `[path]` | Folder or file to scan (default `.`) |
| `-f, --format` | `table`, `markdown` or `json`. Asks interactively if omitted |
| `-t, --tags` | Custom tags, e.g. `-t TODO,FIXME` |
| `-i, --ignore` | Extra folders to skip, e.g. `-i tests,docs` |
| `-o, --output` | Save the report to a file |
| `--ci` | Exit with code 1 if any tags are found |

`node_modules`, `.git`, `dist`, `build` and other common folders are skipped automatically.
Binary files and files over 1 MB are skipped.

## Supported comment styles

`// TODO`, `# TODO`, `/* TODO */`, `<!-- TODO -->`, `-- TODO`, and `TODO(name): message`.

## Development

```bash
npm install
npm test
node bin/todofind.js .
```

## License

MIT
