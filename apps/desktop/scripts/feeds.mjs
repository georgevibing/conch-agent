// The update feeds electron-updater reads (`latest-mac.yml` and friends).
//
// The two Mac apps (Apple silicon and Intel) are built on two computers, and
// each writes its own `latest-mac.yml` naming only its files. A release
// carries one, naming both: electron-updater picks the file for its own chip
// from that list. This joins them.
//
//   node scripts/feeds.mjs merge <out.yml> <a.yml> <b.yml> [...]
import { readFileSync, writeFileSync } from 'node:fs';

/** A feed's parts: the lines before `files:`, its file entries, and the lines after. */
function parts(text) {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const start = lines.indexOf('files:');
  if (start === -1) throw new Error('Not an update feed: it lists no files.');
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end] ?? '')) end++;
  const entries = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^ {2}- /.test(line)) entries.push([line]);
    else entries.at(-1)?.push(line);
  }
  return { head: lines.slice(0, start), entries, tail: lines.slice(end) };
}

const versionOf = (lines) =>
  lines
    .find((line) => line.startsWith('version: '))
    ?.slice('version: '.length)
    .trim();
const urlOf = (entry) => /^ {2}- url: (.+)$/.exec(entry[0] ?? '')?.[1]?.trim();

/** One feed naming every file of every feed given, for the same version. */
export function mergeFeeds(texts) {
  if (!texts.length) throw new Error('No feeds to merge.');
  const all = texts.map(parts);
  const [first] = all;
  const version = versionOf(first.head);
  for (const feed of all)
    if (versionOf(feed.head) !== version)
      throw new Error(`Feeds for different versions: ${versionOf(feed.head)} and ${version}.`);
  const seen = new Set();
  const entries = all
    .flatMap((feed) => feed.entries)
    .filter((entry) => {
      const url = urlOf(entry);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  return `${[...first.head, 'files:', ...entries.flat(), ...first.tail].join('\n')}\n`;
}

if (process.argv[2] === 'merge') {
  const [out, ...inputs] = process.argv.slice(3);
  if (!out || inputs.length < 1) throw new Error('Usage: feeds.mjs merge <out.yml> <a.yml> ...');
  writeFileSync(out, mergeFeeds(inputs.map((file) => readFileSync(file, 'utf8'))));
}
