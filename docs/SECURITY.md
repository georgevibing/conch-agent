# Signing in & staying safe

Conch can run commands and change files on your computer — as you. So it's
protected like your computer is. This page is the whole story in plain words.

## Out of the box

`pnpm start` opens Conch at http://localhost:4317, reachable **only from this
computer**. Nothing else on your network can get in, not even to see a sign-in
page.

## Choose how you sign in

Open **Settings → Security** and pick one:

- **Password.** Easiest on your own devices. Press **Suggest a strong one** and
  let your browser save it, or type a short sentence you'll remember (at least 15
  characters). No rules about symbols or numbers.
- **Access key.** A long `conch_…` key you paste once per device. Handy for
  scripts (`Authorization: Bearer conch_…`). Give each device its own key so you
  can revoke one without touching the others.

From then on, every device signs in, including this one. You stay signed in for
up to 30 days (or a week if you don't use it).

Prefer the terminal? In the Conch folder:

```bash
pnpm conch password            # choose one (typing is hidden)
pnpm conch password --generate # or have a strong one made
pnpm conch key "My laptop"     # or create an access key
pnpm conch status              # security checkup
```

## Use Conch on your phone

**Recommended: Tailscale.** It's free, encrypted, and nothing is opened to the
internet.

1. Install [Tailscale](https://tailscale.com/download) on your computer and phone,
   and sign in to both.
2. On your computer: `tailscale serve --bg 4317`
3. Restart Conch. In **Settings → Security**, press **Add a device** and point your
   phone's camera at the QR code. That's it — your phone is signed in.

The QR code works **once**, for **10 minutes**. Whoever opens it is signed in, so
don't share it. You can also run `pnpm conch pair` to show one in the terminal.

**Same Wi-Fi only** (not encrypted — only on a network you trust, like home):

```bash
pnpm start:network
```

Other devices then open `http://<your-computer's-name>.local:4317`. Conch will
warn you that the connection isn't encrypted — that's accurate: someone on the
same Wi-Fi could read your traffic.

**SSH tunnel** (for developers): `ssh -N -L 4317:localhost:4317 you@your-computer`,
then open http://localhost:4317.

## Forgot your password? Lost a key?

On the computer running Conch, in the Conch folder:

```bash
pnpm conch reset       # turns sign-in off and signs every device out
pnpm conch password    # choose a new one
```

Only someone at that computer can do this — that's what keeps it safe.

Lost a phone? **Settings → Security → Signed-in devices → Sign out**. It's
disconnected instantly.

## What Conch warns you about

The security checkup (in Settings, when Conch starts, and in `pnpm conch status`)
tells you, in plain words, when something is risky:

| Warning                                        | Why it matters                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Your network can see Conch traffic             | Plain HTTP on Wi-Fi exposes chats and your password.            |
| No sign-in on this computer                    | Anyone using your computer could use your assistant.            |
| New chats never ask before acting              | "Full trust" lets a malicious web page or file steer the agent. |
| An access key is set in CONCH_TOKEN            | Environment variables leak easily and can't be revoked singly.  |
| Conch is running as the administrator (root)   | Anything the agent does would control the whole computer.       |
| Other people may read your Conch files         | `~/.conch` holds every conversation.                            |
| Your work folder has its own Claude Code rules | A downloaded project's hooks could run commands without asking. |

In Settings, each warning has one button to fix it. A button that changes something
only ever makes Conch safer — back to asking, off, or private — and asks you to
confirm it's you where that setting would. Anything that gives the assistant more
room is never one click away: you choose it yourself, where it lives. When only you
can fix something (your shell's environment, say), the warning shows the one line to
copy.

## Connecting apps (integrations)

- **Sign-ins happen on the app's own page.** Conch never sees your password, and it
  keeps the resulting token only on this computer, readable by you alone. Nothing is
  shown again after you save it.
- **By default, your assistant asks before it changes anything** in a connected app
  (creating, sending, editing, deleting). Reading is allowed. You can make an app
  "Ask every time", or turn single tools off.
- **"Don't ask" is powerful.** An email or page the assistant reads could try to trick
  it. Conch asks you to confirm it's you before you choose it, and the security
  checkup reminds you it's on.
- **If an app changes what a tool does,** Conch stops auto-allowing that tool and
  tells you.
- **Programs you add run as you.** Only add ones from people you trust.
- **Disconnecting** makes Conch forget the sign-in. To revoke it on the app's side
  too, remove Conch from that app's "connected apps" settings.

## Backups

- **Conch backs itself up every day, on this computer** (Settings → Health). Those
  backups never hold your keys or sign-ins: they're already on this disk.
- **A backup file you download holds your chats and memories.** Keep it somewhere
  private. Your keys and sign-ins only go in when you choose a passphrase; they're
  encrypted with it, and Conch can't recover a forgotten one (everything else still
  restores). Taking them out asks you to confirm it's you.
- **Restoring asks you to confirm it's you, and shows what comes back first.** What's
  there now is kept, so you can undo it. Sign-in from a backup keeps the device you
  restore from signed in and signs every other device out.
- **Only restore backups you made.** A backup without a passphrase can't prove where
  it came from.

## Good habits

- Keep **Ask first** or **Auto** as your default mode. Use **Full trust** only in a
  throwaway folder.
- Be careful what you ask the agent to read: web pages, emails and files can
  contain instructions meant for it ("prompt injection"). Conch never lets the agent
  turn on a scheduled routine or give itself more trust — you do that.
- Use a password manager.
- Sign out devices you don't use.

## Reporting a vulnerability

Please report privately to the maintainers rather than opening a public issue.
See [ARCHITECTURE.md § Security model](../ARCHITECTURE.md#security-model) and
[ADR 0008](./adr/0008-access-and-hardening.md) for the technical design.
