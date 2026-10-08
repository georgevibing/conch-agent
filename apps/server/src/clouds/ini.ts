/**
 * The INI files the clouds' own programs keep (`~/.aws/config`,
 * `~/.aws/credentials`, gcloud's `configurations/config_default`), read the
 * way those programs read them: `[section]` headers, `key = value` lines,
 * `#` and `;` comments, and an indented line continuing the value above it
 * (the AWS CLI's nested `s3 =` blocks). Conch only ever reads them.
 */
export type Ini = Map<string, Map<string, string>>;

export function parseIni(text: string): Ini {
  const out: Ini = new Map();
  let section: Map<string, string> | undefined;
  let last: string | undefined;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*[#;]/.test(raw)) continue;
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (header?.[1]) {
      const name = header[1].trim().replace(/\s+/g, ' ');
      section = out.get(name) ?? new Map<string, string>();
      out.set(name, section);
      last = undefined;
      continue;
    }
    if (!section) continue;
    // A nested block (`s3 =` then indented keys) belongs to the key above it.
    if (/^\s+/.test(raw) && last) {
      section.set(last, `${section.get(last) ?? ''}\n${raw.trim()}`);
      continue;
    }
    const at = raw.indexOf('=');
    if (at <= 0) continue;
    last = raw.slice(0, at).trim().toLowerCase();
    section.set(last, raw.slice(at + 1).trim());
  }
  return out;
}
