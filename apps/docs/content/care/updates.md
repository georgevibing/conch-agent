---
title: Updates
description: Conch follows its releases, says what each one brings, and updates itself and the programs it uses with one press.
order: 3
---

Conch looks for updates once a day, quietly. When a new release of Conch is out, a calm line at the top of the app says so once: **Conch 0.3 is ready**, with **What's new**, **Update** and **Not now**. Otherwise a dot on the Settings button is the only sign. Updating is one press, and Conch goes back to the version you had if anything fails.

## See what's waiting

Open **Settings → Health** and find **Updates**.

- **Conch itself.** The card says **Conch is up to date**, or **Conch 0.4 is ready**. **What's new** shows each waiting release in a few plain lines (**New**, **Better**, **Fixed**), the newest open. A **Heads up** line says when you need to do something after updating.
- **Programs Conch uses.** Each one shows the version you have, and a button when a newer one is out.

**Check now** looks at once. So does <kbd>mod+k</kbd>, then **Check for updates**.

## Stable, beta or alpha

Under **Release channel**, choose which releases Conch gets:

- **Stable** — tested releases. This is the one to have.
- **Beta** — new things a little early. Mostly finished.
- **Alpha** — the newest work, as soon as it's out. Expect rough edges.

Beta and alpha ask you to confirm it's you. Going back to **Stable** never takes you back a version. Conch waits for the next stable release newer than the one you have, and says so under the channels.

Conch only installs releases signed by Conch's makers. A release that isn't is refused, and the card says so in a sentence. [Security](../security/signing-in.md) says more.

## Update Conch

1. Press **Update Conch**. If you [sign in to Conch](../security/signing-in.md), it asks you to confirm it's you.
2. Conch checks the release is really from Conch's makers. It gets it ready in a folder of its own while you keep working, and backs up your things. The card shows which step it's on.
3. Conch starts again on the new version. The page shows **Updating Conch…** for a few seconds and comes back by itself, on the same page.

Your chats are safe. If a chat is still working, Conch asks you to update when it's finished, so nothing is cut short.

Where Conch can't restart itself, the card says **Restart Conch to finish**, and the new version starts the next time Conch does.

## If an update doesn't work

If something fails while the new version is being made ready, Conch keeps the version you have and says what happened in one sentence, with **Try again**. Nothing of yours changes.

If the new version doesn't start properly, Conch goes back to the one before by itself, within a minute or two, and says so. It won't offer that version again. The next release will be.

## Go back

Conch keeps the version you had beside the new one. **Go back to 0.3.0** switches back at once and restarts. Conch won't offer the version you left again.

## A developer's copy

A copy of Conch on another branch, or with changes of its own, follows every change on its branch instead of releases, as it always did. The card says why. If you changed files in Conch's own folder, it doesn't update by itself. It says why and shows the commands to run by hand, ready to copy.

Contributors can turn on **Every change on main** to follow `main` instead of releases. It's only shown on a developer's copy.

Updates never ask for your computer's administrator password in the background. The native terminal library is optional: if it cannot build, Conch uses its terminal fallback. If a Linux release requires that build, Conch checks its tools before changing any files. When tools are missing, it leaves the running version untouched and asks you to rerun the [installer](../start/install.md) from a terminal on that computer.

## Update a program

Press **Update to** and the version number beside a program. Conch updates it the way it was installed and shows the installer's progress. **Update all** does every waiting one, one at a time.

When Conch can't update a program on this computer, the row says so, and **Get it** opens the program's website.

Which programs these are is in [Programs Conch gets for you](../reference/programs.md).

## Let programs update themselves

Turn on **Keep the programs Conch uses up to date**. If you sign in to Conch, it asks you to confirm it's you. Programs then update overnight, between 2 and 5 a.m., while no chat or routine is running. Each update leaves a note under [Fixed on its own](./health.md). A version that failed isn't tried again every night.

Conch itself never updates this way. It restarts, so it always asks first.

## Good to know

- Automatic updates need the computer awake between 2 and 5 a.m.
- [Repair everything](./health.md) also lists the updates that wait. A new release of Conch shows there as news, not a problem.
- The menu bar says **Conch 0.3 is ready** too. To hear about new versions on your phone, turn on **New versions of Conch** in [Notifications](../start/phone.md). It's off until you do.
- Running [the install line](../start/install.md) again repairs Conch, but a copy installed from a release updates here, in **Updates**. The installer gets the newest stable release. Set `CONCH_CHANNEL=beta` or `alpha` before it for those.
