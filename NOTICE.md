# Third-party notices

Conch's own code is under the [MIT License](./LICENSE). It's built on open-source
packages installed from npm, each under its own licence; `pnpm licenses list`
lists them. A few have terms worth knowing:

- The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is provided under
  [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance), not
  an open-source licence.
- **libsignal** (GPL-3.0) comes with Baileys, which the WhatsApp channel uses.
  The desktop app's installers carry it with the rest of the gateway's
  dependencies; its source is at
  [github.com/WhiskeySockets/libsignal-node](https://github.com/WhiskeySockets/libsignal-node),
  and Conch's is this repository.
- The **desktop app** is built on [Electron](https://www.electronjs.org) (MIT)
  and carries [Node.js](https://nodejs.org) (MIT, with the licences of the
  components it bundles).

Included in this repository:

- **EFF's short wordlist** (`packages/protocol/src/words.ts`), © Electronic
  Frontier Foundation, [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/).
- **Brand marks** (`packages/nacre/src/patterns/Integrations/brands.ts`): most
  path data is from [Simple Icons](https://simpleicons.org) (CC0 1.0).

Fonts (Geist, Geist Mono, Instrument Serif) come from Fontsource under the SIL
Open Font License 1.1.

Product names and logos belong to their owners. Conch uses them only to show
which service something connects to; that doesn't mean the owners endorse Conch.
