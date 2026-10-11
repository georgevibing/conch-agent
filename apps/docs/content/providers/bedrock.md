---
provider: bedrock
---

## Connect it

1. Open **Settings → Providers** and find **Amazon Bedrock**.
2. Press **Use this** on one of the AWS sign-ins on this computer: a single sign-on profile, access keys or a role.
3. The Claude models that account can use appear one after another.

Signed in to AWS before? Look under **Found on this computer** on the Providers page.

No AWS sign-in yet? Press **Install AWS CLI** if Conch offers it, then sign in with your company's AWS start page. Or open **Or use a Bedrock API key** and paste one from the AWS console. Short-term keys last up to 12 hours.

## When a sign-in ends

Single sign-on lasts about a working day. When it ends, the chat and the account show **Sign in to AWS again**. Press it and enter the short code on AWS's page. Conch carries on once you're done. A session that can renew itself does.

## Region

Conch uses your profile's region. Pick another under **Region**. Only the models your account can use there are offered.

## Good to know

- **Billed to your AWS account** at Bedrock's prices. Conch shows Anthropic's list prices, so a regional endpoint can cost a little more.
- **Read-only.** Conch reads `~/.aws` and never changes it. Keys come from the AWS CLI when needed and stay in memory.
- **A narrower role first.** When a profile can do everything in its account, Conch recommends one that can only call models.
- **Claude only, for now.** Other Bedrock models aren't offered yet.
- **Claude Code can run here too.** On the [Claude Code](claude-code.md) page, choose **Amazon Bedrock** under **Where Claude Code runs**.
