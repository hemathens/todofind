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

  const rows = results.map((r) => ({
    loc: `${r.file}:${r.line}`,
    tag: r.tag,
    msg: truncate((r.author ? `(${r.author}) ` : '') + r.message, 60),
  }));

  const wLoc = Math.max(8, ...rows.map((r) => r.loc.length));
  const wTag = Math.max(3, ...rows.map((r) => r.tag.length));
  const wMsg = Math.max(7, ...rows.map((r) => r.msg.length));

  const bar = (l, m, r) => l + [wLoc, wTag, wMsg].map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (loc, tag, msg, tagColor) =>
    `│ ${loc.padEnd(wLoc)} │ ${paint(tag.padEnd(wTag), tagColor, color)} │ ${msg.padEnd(wMsg)} │`;

  const out = [
    bar('┌', '┬', '┐'),
    row('Location', 'Tag', 'Message'),
    bar('├', '┼', '┤'),
    ...rows.map((r) => row(r.loc, r.tag, r.msg, COLORS[r.tag])),
    bar('└', '┴', '┘'),
  ];

  const { total, byTag } = summarize(results);
  const parts = Object.entries(byTag).map(([t, n]) => `${t}: ${n}`).join('  ');
  out.push(`${total} item${total === 1 ? '' : 's'}  (${parts})`);
  return out.join('\n');
}

export function toMarkdown(results, { filesScanned = 0 } = {}) {
  const { total, byTag } = summarize(results);
  const lines = ['# Todo Report', '', `**Total:** ${total} | **Files scanned:** ${filesScanned}`, ''];

  if (total === 0) return lines.concat('No tagged comments found.').join('\n') + '\n';

  lines.push('| Tag | Count |', '|-----|-------|');
  for (const [t, n] of Object.entries(byTag)) lines.push(`| ${t} | ${n} |`);
  lines.push('');

  for (const tag of Object.keys(byTag)) {
    lines.push(`## ${tag}`, '', '| File | Line | Message |', '|------|------|---------|');
    for (const r of results.filter((x) => x.tag === tag)) {
      const msg = ((r.author ? `(${r.author}) ` : '') + r.message).replace(/\|/g, '\\|');
      lines.push(`| \`${r.file}\` | ${r.line} | ${msg} |`);
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
