import { summarize } from './scanner.js';

const COLORS = { TODO: 33, FIXME: 31, BUG: 31, HACK: 35, XXX: 35, NOTE: 36 };

function paint(text, code, enabled) {
  return enabled && code ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function toTable(results, { color = false } = {}) {
  if (results.length === 0) return 'No tagged comments found.';

  const hasDate = results.some((r) => r.date);
  const header = ['Location', 'Tag', ...(hasDate ? ['Date'] : []), 'Message'];
  const rows = results.map((r) => [
    `${r.file}:${r.line}`,
    r.tag,
    ...(hasDate ? [r.date ? r.date.slice(0, 10) : '-'] : []),
    truncate((r.author ? `(${r.author}) ` : '') + r.message, 60),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const bar = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const line = (cells, tagColor) =>
    '│ ' +
    cells.map((c, i) => (i === 1 ? paint(c.padEnd(widths[i]), tagColor, color) : c.padEnd(widths[i]))).join(' │ ') +
    ' │';

  const out = [
    bar('┌', '┬', '┐'),
    line(header),
    bar('├', '┼', '┤'),
    ...rows.map((r) => line(r, COLORS[r[1]])),
    bar('└', '┴', '┘'),
  ];

  const { total, byTag } = summarize(results);
  const parts = Object.entries(byTag).map(([t, n]) => `${t}: ${n}`).join('  ');
  out.push(`${total} item${total === 1 ? '' : 's'}  (${parts})`);
  return out.join('\n');
}

export function toMarkdown(results, { filesScanned = 0 } = {}) {
  const { total, byTag } = summarize(results);
  const hasDate = results.some((r) => r.date);
  const lines = ['# Todo Report', '', `**Total:** ${total} | **Files scanned:** ${filesScanned}`, ''];

  if (total === 0) return lines.concat('No tagged comments found.').join('\n') + '\n';

  lines.push('| Tag | Count |', '|-----|-------|');
  for (const [t, n] of Object.entries(byTag)) lines.push(`| ${t} | ${n} |`);
  lines.push('');

  for (const tag of Object.keys(byTag)) {
    lines.push(
      `## ${tag}`,
      '',
      hasDate ? '| File | Line | Date | Message |' : '| File | Line | Message |',
      hasDate ? '|------|------|------|---------|' : '|------|------|---------|'
    );
    for (const r of results.filter((x) => x.tag === tag)) {
      const msg = ((r.author ? `(${r.author}) ` : '') + r.message).replace(/\|/g, '\\|');
      const date = hasDate ? ` ${r.date ? r.date.slice(0, 10) : '-'} |` : '';
      lines.push(`| \`${r.file}\` | ${r.line} |${date} ${msg} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function toJson(results, { filesScanned = 0 } = {}) {
  const { total, byTag } = summarize(results);
  return JSON.stringify({ summary: { total, filesScanned, byTag }, results }, null, 2);
}

export const REPORTERS = { table: toTable, markdown: toMarkdown, json: toJson };