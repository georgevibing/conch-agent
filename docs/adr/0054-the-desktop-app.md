# 0054 — The desktop app: Conch as a download, for Mac, Windows and Linux

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0019](./0019-updates.md) and [ADR 0051](./0051-releases.md) (where an app's
  updates come from), [ADR 0026](./0026-always-on.md) (what starts at login),
  [ADR 0029](./0029-menu-bar-and-little-computer.md) (the menu bar)

## Context

Conch is installed with a script that clones the repository, installs Node and pnpm, and builds
the web app. It works, but it is a terminal command, and the Conch promise is that people who
have never opened a terminal can use it. They expect what every other app gives them: a file to
download, an icon to double-click, a window, an entry in the menu bar, and updates that arrive by
themselves.

The gateway already does everything a person sees. What's missing is the shell around it.

## Decision

Conch ships an app for macOS (Apple silicon and Intel), Windows (x64 and Arm) and Linux (x64 and
Arm), built with [Electron](https://www.electronjs.org) in `apps/desktop`. Each release attaches
the downloads to its GitHub Release.

### The app is a shell around the same Conch

The app does not reimplement anything. It carries a copy of Conch laid out exactly like a
checkout, and runs it:

```
Conch.app/Contents/Resources/        (resources\ on Windows and Linux)
  node/                 Node 24 itself, with npm
  conch/
    package.json        the one version (ADR 0051)
    release/allowed_signers
    apps/server/        the gateway's source and its production node_modules
    apps/web/dist/      the built web app
```

- **Its own Node.** The gateway runs on a real Node 24 from nodejs.org (checked against its
  `SHASUMS256.txt` when the app is built), not on Electron's built-in Node. So the gateway runs
  exactly as it does from a checkout: the same native modules (node-pty, onnxruntime-node), the
  same Node version as CI, and `npm` beside it for the programs Conch installs (ADR 0016).
  Electron's `ELECTRON_RUN_AS_NODE` would also leak into every terminal and agent the gateway
  starts, where it breaks any other Electron app run from there. The app turns that fuse off.
- **The same source.** `apps/server` runs through tsx, as `pnpm start` does. Its production
  dependencies come from `pnpm deploy` (hoisted, so no symlinks need to survive an installer),
  with tests and other platforms' binaries left out.
- **Electron is the supervisor.** The app starts `apps/server/src/main.ts` with
  `CONCH_SUPERVISED=1`, so everything that restarts Conch (an update, a restore) works
  unchanged: exit code 75 starts it again, a crash starts it again with the supervisor's own
  backoff (`nextStep`), and five crashes in ten minutes stop with a page that says why and offers
  **Try again**.
- **A Conch that's already running wins.** A gateway that finds a Conch on its port (from a
  checkout, or Always on) says so and stops; the app opens a window on that one instead of
  starting a second.

The gateway and the app talk over the IPC channel Node gives a child process, never a port. Both
sides check every message with the schemas in `@conch/protocol` (`desktop.ts`). The gateway says
where it's listening, or why it couldn't start; the app says what it is (its version, whether it
can update itself) and how a download is going.

### The window

- One window, on the gateway's own address. Closing it keeps Conch running in the menu bar,
  tray or panel, so routines and chat apps keep working; **Quit Conch** (the menu, the tray, or
  Settings) stops both. Opening the app again shows the window.
- While the gateway starts, the window shows the pearl and "Starting Conch…". If the gateway
  moves to another port after a restart, the window follows.
- Security, from Electron's checklist: `contextIsolation`, `sandbox`, no Node in the page, no
  preload at all. Navigation is held to the gateway's origin. Every other link opens in the
  person's browser, and only `http`, `https` and `mailto` are ever handed over. Sign-in windows
  (`window.open` of Conch's own `/…/done` page) are created hidden, and the moment they head for
  a provider's sign-in page that address goes to the person's browser instead: Google and others
  refuse sign-ins inside embedded browsers, and a person's own browser is where their passwords
  and passkeys are. The page notices the sign-in finishing the same way it does today, from the
  gateway. Permissions are granted to the gateway's origin only, and only those Conch uses
  (notifications, the microphone for voice, the clipboard).
- Fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments` are off, cookies are encrypted, and the app loads only from its
  ASAR archive.

### Updates

The gateway still decides, and the app does the work:

1. The gateway lists the GitHub Releases of Conch's repository (the root `package.json`'s
   `repository`), picks the newest in the person's channel with the same rules a checkout uses
   (`release/semver.ts`: `offered`, `inChannel`), and reads its notes from the release's body
   (`parseNotes`). A release is only offered once its files for this computer are attached.
2. **Update** in Settings → Health → Updates asks the app to download it (electron-updater,
   against that release's `latest*.yml`, which checks the file's SHA-512), then to quit and
   install it. The page shows "Updating Conch…" and comes back on the new version, as it does
   for a checkout.
3. When the app can't replace itself — an unsigned Mac app (macOS refuses), a `.deb` — the
   Update button becomes **Download Conch x.y.z**, which opens the release page.

The staged swap, rollback and signed tags of ADR 0051 belong to checkouts. An installed app is
replaced whole by its installer, and goes back by installing the version before.

**What an update trusts.** A checkout checks the release tag's SSH signature. A download can't:
the binaries are built by GitHub Actions from the signed tag, and the maintainer's key is not
there. So an app trusts GitHub's HTTPS, the repository's release, and the SHA-512 in the release's
own `latest*.yml`. Each binary also gets a GitHub build-provenance attestation
(`gh attestation verify`), which ties it to the workflow run and the tag's commit. When signing
certificates are configured (`CSC_LINK`, `APPLE_ID`…), the Mac app is signed and notarized and
the Windows installer is signed; electron-updater then also checks the Windows publisher.

### Always on and the menu bar

- **Always on** writes the same login item as before (launchd, the Run key, an autostart entry
  — never a systemd service, which has no desktop to open a window on), but it starts the app
  with `--background`: no window, just the menu bar. Turning it on from the app needs no
  handover: the app is already running.
- **The menu bar** is the app's own tray icon, not the helper Conch builds for a checkout. The
  **Show Conch in the menu bar** switch shows and hides it.
- `BackgroundRunning` gains `app`: closing the window doesn't stop Conch, so nothing warns that
  it will.

### Building and releasing

- `pnpm desktop:dev` runs the gateway and the web app's dev servers and opens the app on them,
  with hot reload. `pnpm desktop:start` builds everything and runs the app as it ships, without
  packaging. `pnpm desktop:build` makes this computer's installer; `desktop:build:mac`, `:win`
  and `:linux` make one platform's.
- A release is still `pnpm release` (ADR 0051). Pushing the tag starts `.github/workflows/
desktop.yml`, which builds each platform on its own kind of computer (native modules are built
  where they run), checks each app starts, makes the GitHub Release from the tag if `pnpm
release` couldn't, and attaches the files. The two Mac builds each write a `latest-mac.yml`;
  the workflow joins them into one.
- `pnpm desktop:e2e` drives the built app with Playwright: it starts, shows Conch, keeps running
  when its window closes, restarts a gateway that crashed, and stops everything on Quit. CI runs
  it on Linux.

## Consequences

- An install is a download. The app is big (about 250 MB unpacked), mostly Claude Code's own
  program and the on-device model runtime, which Conch already uses.
- Without signing certificates, macOS says the app is from an unidentified developer and
  Windows SmartScreen asks once. The download page says how to open it anyway. With
  certificates in the repository's secrets, both go away with no code change.
- `tsx` becomes a runtime dependency of the gateway: it always was one in practice.
- `pnpm conch` is for checkouts. Everything it does is also in the app's Settings.

## Sources

- Electron, [Security checklist](https://www.electronjs.org/docs/latest/tutorial/security) and
  [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).
- electron-builder, [Auto Update](https://www.electron.build/auto-update) and
  [Code Signing](https://www.electron.build/code-signing).
- Google, [OAuth 2.0 for native apps](https://developers.google.com/identity/protocols/oauth2/native-app)
  and RFC 8252 § 8.12: sign-ins belong in the system browser, not an embedded one.
- GitHub, [Artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).
