---
title: Updates
description: Conch says what each release brings, then updates itself and the programs it uses with one press.
order: 3
---

Conch updates itself and the programs it uses with one press. If anything fails, it goes back to the version you had.

When a new Conch is ready:

- **Update** appears beside your name at the foot of the sidebar.
- A line at the top says **Conch 0.3 is ready** once, with **What's new**, **Update** and **Not now**.

A newer program puts a dot on the Settings button.

## See what's waiting

Open **Settings → Health → Updates**. The card names your build: a release, such as **v0.1.0-beta.2**, or **Dev · commit** for a development copy.

- **Conch itself**: **Conch is up to date** or **Conch 0.4 is ready**. **What's new** lists each waiting release (**New**, **Better**, **Fixed**), newest first. **Heads up** says when you need to act after updating.
- **Programs Conch uses**: the version you have, and a button when a newer one is out.

Conch looks for releases every hour, every quarter hour on a copy following a branch, and when you come back to it. Programs are checked daily. Opening **Updates** looks again if the last look is a few minutes old. **Check now**, or <kbd>mod+k</kbd> then **Check for updates**, looks at once.

## Stable, beta or alpha

Under **Release channel**, choose:

- **Stable**: tested releases. The one to have.
- **Beta**: new things early, mostly finished.
- **Alpha**: the newest work. Expect rough edges.

Until you choose, Conch follows **Stable**, else **Beta**, else **Alpha**, whichever has a release first. A channel with no release can't be chosen. A copy following `main` keeps doing so until you choose. A channel changes future updates, not your current build's name.

- Beta and alpha ask you to confirm it's you.
- Going back to **Stable** never takes you back a version. Conch waits for the next newer stable release, and says so.
- Conch only installs releases signed by its makers, and says why it refused any other. See [Security](../security/signing-in.md).

## Update Conch

1. Press **Update** beside your name, **Update Conch** in Settings, or <kbd>mod+k</kbd> then **Update Conch**. A window shows the release notes, or each change for a copy following a branch.
2. Press **Update now**. If you [sign in to Conch](../security/signing-in.md), confirm it's you.
3. Conch checks the release's signature, prepares it while you work, and backs up your things. The pearl's ring and the window show each step. **Keep working** closes the window; the button beside your name shows progress and reopens it.
4. Conch restarts in a few seconds. The page comes back where you were and says **Updated to** and the version.

Your chats are safe.

## Update while a chat is working

If a chat, task or routine is working, the window names it first: **Fix Conch CI failures is working. Update anyway? It will pause, and carry on after Conch restarts.**

- **Wait until it's done**: the window and **Settings → Health** say **Will update when the chat finishes**, and Conch updates once nothing is working. **Don't wait** cancels.
- **Update anyway**: Conch prepares the update while work goes on. Before restarting, it pauses at a safe point: a running step gets a few seconds, and nothing new starts. Afterwards the work carries on, and the chat says **Conch updated and picked up where it left off**.

After the restart:

- What you were writing stays in the box, and queued messages still go.
- A step waiting for your approval didn't run, so you're asked again.
- Conch never repeats a step that may have happened. If that stopped a chat, it says so, with **Carry on**.
- If a provider can't resume its session, Conch gives it the chat so far, and says so.

Updating from a version without freeze detection turns it on in the normal restart, with no extra command. See [Staying responsive](./health.md#after-repeated-trouble).

Where Conch can't restart itself, the card says **Restart Conch to finish**, and the new version starts with Conch next time.

## If an update doesn't work

- **Preparing fails**: Conch keeps your version, says why in one sentence, and offers **Try again**. Nothing of yours changes.
- **The new version doesn't start**: Conch goes back within a minute or two and says so. It won't offer that version again, only the next release.

## Go back

Conch keeps the version you had. **Go back to 0.3.0** switches and restarts, and that version isn't offered again.

## In the app

[The app](../start/app.md) uses the same releases and channels. **Update Conch** downloads, checks and installs the new version, then reopens on it.

An unsigned Mac app and the Linux `.deb` can't replace themselves. The card says **Download Conch** and opens the release page. Install over yours; your things stay. To go back a version, install it from its release page.

## A developer's copy

- A copy on another branch, or with its own changes, follows its branch instead of releases. The card says why.
- If you changed files in Conch's folder, it won't update by itself. It shows the commands to run, ready to copy.
- After a `git pull`, Conch rebuilds its app on its next start, and open pages offer **Reload**.
- **Get changes before they’re released** follows `main` instead of releases. Only a developer's copy shows it.

Updates never ask for your administrator password in the background. If the optional native terminal library can't build, Conch uses its terminal fallback. If a Linux release needs that build and tools are missing, Conch changes nothing and asks you to rerun the [installer](../start/install.md) from a terminal on that computer.

## Update a program

Press **Update to** and the version beside a program. Conch updates it the way it was installed and shows progress. **Update all** does each waiting one in turn. Where Conch can't, **Get it** opens the program's website. They're listed in [Programs Conch gets for you](../reference/programs.md).

## Let programs update themselves

Turn on **Keep the programs Conch uses up to date**, and confirm it's you if you sign in.

- Programs update between 2 and 5 a.m. while nothing is running, so the computer must be awake.
- Each leaves a note under [Fixed on its own](./health.md).
- A failed version isn't retried every night.

Conch itself always asks first, because it restarts.

## Good to know

- [Repair everything](./health.md) lists waiting updates. A new Conch release shows as news, not a problem.
- The menu bar shows new releases too. For your phone, turn on **There's a new version** in [Notifications](../start/phone.md). It's off by default.
- Running [the install line](../start/install.md) again repairs Conch. A copy installed from a release updates here.
- The installer gets the newest stable release, else beta, else alpha. Put `CONCH_CHANNEL=beta` or `alpha` before it to follow that channel.
