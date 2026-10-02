# Writing these pages

The documentation is the Markdown in this folder, drawn by `apps/docs` with Nacre.
`pnpm docs:dev` shows it as you write. Everything here also reads well on GitHub.

## A page is a file

`content/<section>/<name>.md` is the page at `/<section>/<name>`. Sections and their
order are in `src/site/config.ts`; nothing else is listed by hand. Each file starts
with:

```yaml
---
title: Memory
description: One sentence under the title, and in search.
order: 1
---
```

| Key           | What it does                                                                         |
| ------------- | ------------------------------------------------------------------------------------ |
| `title`       | The page's heading. Leave it out with `source`, `provider` or `channel`.             |
| `description` | The sentence under the title, on cards and in search.                                |
| `order`       | Its place in the section, lowest first.                                              |
| `nav`         | A shorter name for the sidebar.                                                      |
| `source`      | Show this file from the repository instead (`docs/SECURITY.md`). No body.            |
| `provider`    | The provider this page is about (`claude-code`): title and facts come from the code. |
| `channel`     | The same, for a channel (`telegram`).                                                |

## Say it once, and let the code say what it knows

Anything the code can list is generated, never typed: providers, channels, apps,
commands, settings, modes, files, programs, the API. A page asks for one with a
comment on a line of its own:

```markdown
<!-- conch:cli -->
```

The parts are in `src/embeds/Embed.tsx`; what they read from the code is in
`reference/build.ts`. Write the words around them: what it's for, when you'd want it.
Don't repeat what another page says. Link to it.

## Markdown, as GitHub reads it

- **Links** are relative to the file: `[skills](../features/skills.md)`. One to a
  page's file opens that page; one to any other file opens it on GitHub.
- **Numbered lists** at the top level are drawn as steps. Use them for things done
  in order, and bullets for everything else.
- **A one-line `bash` or `powershell` block** becomes a command ready to copy.
- **Keys** are `<kbd>mod+k</kbd>`: `mod` is ⌘ on a Mac and Ctrl elsewhere.
- **Notes** are `> [!NOTE]`, `> [!TIP]` and `> [!WARNING]`. Rarely.
- Start headings at `##`. The title is the page's only `#`.

## The voice

Write for someone who has never opened a terminal, in the words Conch itself uses.

- Short sentences. One idea each. Say what happens, then stop.
- Name the button, in bold, exactly as the app does: **Settings → Health**, **Repair
  everything**.
- "Your assistant" or "Conch", never a provider's name, unless the page is about it.
- No "simply", "just", "easily", "powerful". No exclamation marks. No em dashes.
- Lead with what the person gets. Leave how it's built to
  [the decisions](../../../docs/adr).
- A page is done when nothing more can be taken out.

## The front page

`/` is the landing page (`src/landing/`), not a guide. Its pictures are the app's own
components playing a script, and its numbers come from the code. It says what Conch
does, plainly: nothing it can't show, and no apologies either. A feature worth showing
first gets a scene or a tile there.

## It can't go stale quietly

`pnpm check` runs `src/content.test.ts`, which fails, with the fix in its message,
when a provider or channel in the code has no page, a link leads nowhere, a page asks
for a part that doesn't exist, or the app listens for a key the keyboard page
doesn't list.
