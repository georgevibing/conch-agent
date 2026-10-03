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
2. In **Settings → Security**, press **Add a device**. Conch turns on its secure
   address for you (one press: **Turn on**), then shows a QR code. Point your
   phone's camera at it. That's it — your phone is signed in.

   (The terminal way still works: `tailscale serve --bg 4317`.)

3. On your phone, add Conch to the Home Screen (Safari: Share → Add to Home
   Screen). It opens like an app, and can tell you when it needs you
   (Settings → Notifications).

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

**A computer that stays on.** Install with `--server` (`sh install.sh --server`) and
Conch keeps running after you log out, asks you for a password in the terminal, turns
on the Tailscale address and prints a QR code for your phone. Nothing is opened to the
internet. Keeping Conch running with nobody logged in asks you to confirm it's you.

## Approve new devices (extra protection, if you want it)

A password or key is one thing to keep safe. If someone learns it, they could
sign in from anywhere. For a second lock, turn on **Settings → Security →
Devices → Approve new devices** (or run `pnpm conch devices on`).

From then on, a device Conch hasn't seen before still has to be approved
**on the computer running Conch**, even after the right password or key:

1. On the new device, sign in as usual. It shows a short code, like
   **K7M-Q2X**, and waits.
2. On the computer running Conch, open a terminal in the Conch folder and run:

   ```bash
   pnpm conch devices approve
   ```

   It shows who is asking, from where, and asks you to confirm. You can also
   approve it in **Settings → Security** on that computer.

3. The new device opens by itself. Next time, it's recognised and doesn't ask.

Some devices never need approving: the computer running Conch itself, a phone
you add with the **Add a device** QR code, and the devices already signed in
when you turn this on (you'll see them listed, so remove any you don't know).

If a device asks and **it isn't yours**, turn it down
(`pnpm conch devices reject`, or **Turn down** in Settings). Then change your
password, because someone knows it.

Everything else, from the terminal:

```bash
pnpm conch devices                 # what has signed in, and who is waiting
pnpm conch devices approve K7M-Q2X # let one in
pnpm conch devices reject          # turn one down (--all for every one)
pnpm conch devices remove <id>     # forget a device and sign it out
pnpm conch devices rename <id> Kitchen iPad
pnpm conch devices off             # back to just the password or key
```

Only the computer running Conch can approve devices or turn this off, so
someone who got in elsewhere can't let others in. Scripts that use an access
key from another device are approved once, as that key.

## Forgot your password? Lost a key?

On the computer running Conch, in the Conch folder:

```bash
pnpm conch reset       # turns sign-in off and signs every device out
pnpm conch password    # choose a new one
```

Only someone at that computer can do this — that's what keeps it safe.

Lost a phone? **Settings → Security → Devices → Remove** (or
`pnpm conch devices remove`). It's disconnected instantly and, with approval
on, can't get back in without your OK.

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

## Your own WhatsApp or Signal

- **Linking makes this computer one of your devices.** Whoever can use Conch can read
  and send your WhatsApp or Signal messages through it, like WhatsApp Web open on
  your desk. Its keys stay on this computer, encrypted (WhatsApp) or readable by you
  alone (Signal), never shown, and only in backups you lock with a passphrase.
- **Only you talk to your assistant there,** in the chat with yourself. What other
  people send you is never read, and your groups never hear from it, unless you say
  the number is just for your assistant. Then they wait for you to let them in, and
  what they write is treated like a web page: it can't approve anything.
- **Showing the code asks you to confirm it's you** from another device: whoever scans
  it links their account to your assistant. Codes last minutes and are never saved.
- **WhatsApp's terms allow only its own apps.** Conch uses an unofficial client, and
  WhatsApp can restrict a number it thinks is automated. Link a spare number if yours
  matters too much to risk.
- **Disconnecting** takes Conch off WhatsApp's Linked devices and deletes its keys. For
  Signal, also remove it under Linked devices on your phone.

## iMessage and email

- **Conch reads only what's for it.** On iMessage, only the chat with yourself (or,
  on a Mac with its own Apple ID, people's one-to-one texts). On email, only mail to
  your `+conch` address. The rest of your messages and inbox are never looked at.
- **Messages needs Full Disk Access**, which macOS asks you for. Conch opens the
  database read-only, and sends through Messages itself: what it sends is never
  turned into a command.
- **A From line is easy to fake.** Conch believes an email's sender only when your
  mail service says the sender checked out (DMARC, or DKIM or SPF for the same
  domain), or the email is in your own Sent mail. Anything else is left unread.
- **Other people's messages are never read,** since the answer would come from your
  own account, unless you say the address is just for your assistant. Then they wait
  for you to let them in.
- **A forwarded email is someone else's words.** Your assistant reads it as it would
  a web page, and asks you before doing anything it suggests.
- **Use an app password, never your account's own.** You can take it back in your
  mail service at any time; Conch keeps it locked on this computer.

## Chat apps that need a public address (Teams, WeChat)

Most channels connect outward, so nothing on your computer is opened to the
internet. Microsoft Teams and a WeChat Official Account only deliver to a web
address, so for them Conch can open one ([ADR 0045](./adr/0045-teams-matrix-wechat.md)):

- **It leads to a small door, not to Conch.** It's a separate listener on this
  computer that knows only the addresses of the channels you connected, each a
  long random name. There is no sign-in page, no app and no API behind it.
- **Only signed messages get through.** Every delivery must carry the app's own
  signature: a Bot Framework token from Microsoft, or WeChat's signature and
  encryption. Conch checks it before reading a word, and refuses old or repeated
  ones.
- **You open it, with one press**: through Tailscale Funnel, or an address of your
  own. From another device, Conch asks you to confirm it's you first. Turning it off
  never asks.
- **It checks itself.** Conch makes sure the address really reaches this door, and
  the security checkup says while it's open. A backup restored on another computer
  never opens it there by itself.
- **On Matrix**, chats stay end-to-end encrypted, and your assistant only reads
  messages from your sessions that your account has verified.

## Updates to Conch itself

- **Conch installs only signed releases.** Each release is a tag signed with
  the maintainer's SSH key. Conch checks it against the keys pinned in the
  version you already have, so a release can't vouch for itself. One signed by
  anyone else, or not signed at all, is refused in plain words.
- **The keys carry forward.** A release that changes the keys must be signed
  by a key you already trust. An install made before the first release learns
  the key once, from that release, and says so.
- **Nothing changes under you.** A new version is made ready in its own folder,
  your things are backed up, and only then does Conch switch and restart. If
  the new version doesn't start, Conch goes back to the one before by itself,
  and won't offer that version again. **Go back to** also does it at once.
- **The assistant can't touch it.** Conch's versions folder is off limits to
  the assistant's own tools. Changing the channel, going back, or following
  every change needs you to confirm it's you.
- **A developer's copy** (on another branch, with changes of its own, or with
  "Every change on main" on) follows its branch unsigned. That's the same
  trust as `git pull`.

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

## Bringing your things from another assistant

- **Conch only reads OpenClaw's or Hermes's folder, and never changes it.** Links
  in it aren't followed, so nothing outside the folder comes along.
- **You see everything first.** Memories, your persona and routine prompts that read
  like orders to the assistant ("ignore previous instructions…") start unticked, with
  what Conch found. Invisible characters are removed. Skills are read through and
  come over off; routines come over as drafts.
- **Bots and keys never come over by themselves.** Tick them, and Conch checks each
  with its app or provider before keeping it in its encrypted key file; a bot still
  waits for your hello. They're never shown, logged or written anywhere else.
- **Conch backs itself up first, and Undo takes the whole import back.** Both
  bringing things over and Undo ask that it's you.
- **The model you used comes over only in words you read, and never brings a key.**
  If it needs the other app's key, that key must be ticked too. A key written in
  `config.yaml` stays there.
- **Another agent's personality comes over as a skill that starts off**, read first
  like everything else. Its memories, skills and routines follow the same rules.
- **A Slack bot with one key is finished on the Slack page without the key ever
  reaching it.** Conch reads the key it has from the other app's folder when it
  connects, asks that it's you, and Undo takes the bot back.

## Good habits

- Keep **Ask first** or **Auto** as your default mode. Use **Full trust** only in a
  throwaway folder.
- Be careful what you ask the agent to read: web pages, emails and files can
  contain instructions meant for it ("prompt injection"). Conch never lets the agent
  turn on a scheduled routine or give itself more trust — you do that. And anything
  it learns about you in a chat that read something from outside waits for your OK
  in **What Conch knows about you** before it's ever used.
- Use a password manager.
- Sign out devices you don't use.

## The model for meaning

Memory search can understand meaning with a small model that runs on this
computer (ADR 0041). It's only downloaded when you press **Get it**, and:

- **It's exactly the file Conch expects.** Every file is pinned in Conch's code
  by revision, size and fingerprint (SHA-256). Anything else that arrives is
  thrown away, never used.
- **It never goes online.** Once it's here, it runs with downloading turned off;
  your memories and requests never leave this computer.
- **It runs on its own.** The model runs in a separate program that sees none of
  Conch's keys or settings and can only answer "which memories are close to
  this". If it crashes, Conch carries on with word search.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/georgevibing/conch-agent/security/advisories/new);
[SECURITY.md](../SECURITY.md) has the details. See [ARCHITECTURE.md § Security model](../ARCHITECTURE.md#security-model) and
[ADR 0008](./adr/0008-access-and-hardening.md) for the technical design.

## When the assistant reads something untrusted

A web page, an email or a message from someone else can contain instructions
aimed at your assistant. Conch can't tell a hostile page from a friendly one, so
it doesn't try: once a chat has read something from outside, anything that could
send your things somewhere or change this computer **asks you first**, in every
mode (Full trust included), and the question says why. Reading on is free.

Commands also run **sealed**: they can change your work folder and the caches
installs use, and can't read your SSH keys, cloud sign-ins, keychains or
browsers' saved passwords. A command that needs out asks first.

Both are in **Settings → Security → Safety**, on unless you turn them off. Turning
one off asks that it's you, and the checkup will say so. **Activity** (in the
sidebar) shows everything the assistant did, in every chat and routine.

Sealing works with Claude Code on macOS and Linux, and with Codex (fully from
Codex 0.159; an older Codex keeps to the work folder but can still read where keys
live, and Safety says so). Providers that talk to a model over the internet run no
commands of their own. **Windows can't seal commands yet**, and Safety says that
too. Conch never shows a protection that isn't there.

## Skills

Every skill is read through before it's used (above), and says what it can do:
"This skill can: run commands (only `git`), change files in your work folder".
Once its instructions are in a chat, anything else it tries **asks you first**,
in every mode, with the skill's name in the question. That holds in every later
turn too, in helpers and background tasks started from the chat, and after a
restart, because the instructions are still there: a summary or a long chat
doesn't let a skill out of its list. A line above the message box says "Held to
Quick setup's list"; only you can stop it, it asks first, and **Activity** keeps a
note. Several skills held together hold the strictest way. A skill that doesn't
say gets the usual: files in your work folder and the web.

A skill can be **signed**. Its `SKILL.sig` proves which key signed exactly these
files under exactly this name. Trust a publisher once (it asks that it's you)
and their skills say **Verified: signed by …**, and their signed updates stay
on. A skill changed after it was signed, or carrying someone else's signature,
is turned off with the reason. Someone using a name you trust with another key
is shown as a possible impostor. A name proves nothing; the key does.

Sign your own with `pnpm conch skills sign <folder>`. Share `pnpm conch skills
key` so people can check it's you. Your private key stays in
`skills.signing.json`, locked with this computer's own key (the Keychain, Windows'
DPAPI or the Secret Service) like Conch's other keys, readable only by you and never
by the assistant, whose shell also can't run `pnpm conch skills sign` or `trust`. A
copy of the file is no use on another computer; a passphrase-locked backup is how it
moves. If the file was changed, nothing is signed and **Repair everything** says
what to do.

## Undoing what the assistant changed

Conch keeps a copy of each file just before the assistant changes it, so you can
put it back from the chat or from **Activity** (ADR 0030). Those copies stay on
this computer, readable only by you, and are never in a backup. They're let go
after 30 days, or sooner if they grow past 1 GB.

Conch never keeps a copy of where your keys and passwords live (SSH keys, your
saved passwords, Conch's own keys), and an undo never writes through a link or
into a folder that now points somewhere else. If you've changed a file since,
Undo says so and leaves it alone unless you choose to replace it.

## Conch in the menu bar

The pearl in your menu bar (tray, panel) is a tiny helper Conch builds on your
computer. It can only ask how Conch is (counts, never anything from a chat) and quit
Conch, and only from the same computer, with a token in a file only
you can read (`~/.conch/tray/token`). The token isn't a sign-in: it opens nothing
else, and doesn't work through a proxy or from another device. Anything that needs you
to confirm it's you opens Conch's page instead.

## Things the assistant makes for you

A page or small app the assistant makes runs **sealed off**. It can't see your
cookies, your saved sign-ins or anything else in Conch. It can't load anything
from the internet or send anything there, not even through a picture's address.
It can't take you to another site either. When a page wants to open a link,
Conch shows you the whole address and asks first.

A page that has links or code that could take you elsewhere opens with its code
off until you press **Run it anyway**. Documents, charts, tables and diagrams are
drawn by Conch itself, and they load no pictures from other sites.
([ADR 0034](./adr/0034-show-me.md))

When you edit one by hand, its preview is sealed off in exactly the same way.

A page can show **live data**, but it still can't reach the internet itself. It
says which addresses it reads, and Conch reads them for it once you allow that
site for that page:

- Conch reads without your cookies or sign-ins, at most a megabyte, within ten
  seconds.
- It never reads your own network, cloud metadata or Conch itself. It reads
  this computer only when you said so for that page.
- A page can't spell your things into the address: the site is fixed, and the
  page can only choose from values it declared.
- A different address asks again. **Settings → Security → Live data in pages**
  lists every site, and **Take back** removes one.
  ([ADR 0046](./adr/0046-edit-by-hand-and-live-data.md))
