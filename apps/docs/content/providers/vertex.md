---
provider: vertex
---

## Connect it

1. Open **Settings → Providers** and find **Google Vertex AI**.
2. Not signed in to Google Cloud on this computer? Press **Sign in to Google Cloud**. Google's page opens on the computer Conch runs on.
3. Your projects appear. Press **Use this** on the one that should pay. Conch asks which Claude models it can use, and they appear one after another.

No Google Cloud CLI here? Press **Install Google Cloud CLI** when Conch offers it.

## Where it runs

**Global** answers fastest and costs least. **United States** and **European Union** keep your data there. Change it under **Where it runs**.

## Good to know

- **Turn Claude on first.** Each model has to be enabled for the project in Vertex AI's Model Garden. Conch notices when it is.
- **Billed to the project you chose**, whoever is signed in.
- **Read-only.** Conch looks at your Google Cloud sign-in only to see that it's there. Tokens come from the Google Cloud CLI and stay in memory.
- **Gemini on Vertex isn't offered yet.** Use [Google Gemini](gemini.md) for Gemini.
- **Claude Code can run here too.** On the [Claude Code](claude-code.md) page, choose **Google Vertex AI** under **Where Claude Code runs**.
