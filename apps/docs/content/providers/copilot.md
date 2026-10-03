---
provider: copilot
---

## Connect your Copilot plan

1. Open **Settings → Providers** and choose **GitHub Copilot**.
2. If Copilot isn’t on this computer, press **Install GitHub Copilot**. Conch shows the command it runs.
3. Press **Sign in with GitHub**. Conch shows a short code. Choose **Copy code and open sign-in page**, paste it on GitHub and approve.

Every Copilot plan works, including Copilot Free. Your plan’s models and limits apply. Conch uses GitHub’s own Copilot program with your own sign-in, and never sees its credentials.

## The same Conch tools

Conch opens a door for each turn: a connection on this computer, with a key made for that turn, that hands the program Conch’s own tools. Files in the chat’s work folder, sealed commands with no network access, memory, the browser and your [apps](../features/apps.md) all go through Conch’s approvals, skill limits and Undo, the same as with every provider.

The program’s own tools that would change a file or run a command ask first, and Conch declines them. An action Conch can’t seal or put back doesn’t happen.

Each turn gets the whole conversation from Conch, so a chat can move between providers and nothing is lost.

## Good to know

- **Early support.** Conch talks to Copilot through GitHub’s agent connection, which GitHub still calls a preview.
- **Conch keeps Copilot’s version steady.** It turns off Copilot’s own updates while Conch runs it, and **Settings → Health → Updates** offers new versions.
- **A token in your environment is left out.** `GH_TOKEN` and `GITHUB_TOKEN` often hold a key for other tools that Copilot would refuse, so Conch doesn’t pass them on.
