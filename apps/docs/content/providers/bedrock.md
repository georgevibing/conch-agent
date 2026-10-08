---
provider: bedrock
---

## Connect it

1. Open **Settings → Providers** and find **Amazon Bedrock**.
2. Conch lists the AWS sign-ins already on this computer: your single sign-on profiles, access keys and roles. Press **Use this** on one.
3. Conch asks AWS which Claude models that account can use, and they appear one after another. That's it.

Signed in to AWS before? It often shows up under **Found on this computer** on the Providers page, ready in one press.

No AWS sign-in here yet? Press **Install AWS CLI** if Conch offers it, then sign in with your company's AWS start page. Or press **Or use a Bedrock API key** and paste one from the AWS console.

## When a sign-in ends

Single sign-on lasts a working day or so. When it ends, the chat and the account say so, with **Sign in to AWS again**. Press it: AWS's page opens with a short code, and Conch carries on by itself once you're done. A session that can renew itself does, without asking.

## Region

Conch uses the region your profile is set up for. Pick another under **Region**; only the models your account can use there are offered.

## Good to know

- **Billed to your AWS account.** Bedrock's prices apply. Conch's list prices are Anthropic's, so a regional endpoint can cost a little more than Conch shows.
- **Read-only.** Conch reads `~/.aws` to find your profiles and never changes it. Keys come from the AWS CLI when a request needs them and stay in memory.
- **A narrower role first.** When a profile can do everything in its account, Conch says so and recommends a narrower one. It only needs to ask for models.
- **Claude only, for now.** Other models on Bedrock aren't offered yet.
- **Claude Code can run here too.** On the [Claude Code](claude-code.md) page, choose **Amazon Bedrock** under **Where Claude Code runs**.
