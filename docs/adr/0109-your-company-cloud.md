# 0109 — Your company's cloud: Bedrock, Vertex AI and Azure OpenAI, from the sign-ins already here

- Status: accepted
- Date: 2026-10-08
- Amends: [ADR 0053](./0053-more-providers.md) (it left the enterprise clouds for later),
  [ADR 0010](./0010-providers.md) (a provider with nothing chosen isn't ready)
- Builds on: [ADR 0016](./0016-getting-what-a-feature-needs.md) (the clouds' programs are
  needs), [ADR 0023](./0023-offline-and-limits.md) (a throttle routes to the fallback),
  [ADR 0028](./0028-safe-hands.md) (sealed commands can't read `~/.aws`, `~/.azure`,
  gcloud's folder)

## Context

People at work rarely hold an Anthropic or OpenAI key. Their company pays for models
through its cloud: Claude in Amazon Bedrock, Claude on Google Vertex AI, OpenAI models in
Azure. The sign-in is already on their computer, put there by IT or a setup guide: AWS
profiles with single sign-on, Google's application default credentials, an `az login`.
ADR 0053 left these out, so for these people Conch was a dead end, or a page asking them
to paste access keys they shouldn't copy anywhere.

Other agents connect them, but make the person do the work:

- **OpenClaw** reads the AWS SDK chain, but discovers Bedrock models only when an
  environment variable is set (a host with only an instance role needs a placeholder
  `AWS_PROFILE`), and falls back to a 32k window because Bedrock says none. For Vertex
  it stores a dummy key and warns that a pasted `gcloud auth print-access-token`
  expires. For Azure it shells out to `az`, much as below.
- **Hermes Agent** routes Bedrock by model family (Anthropic SDK, Mantle, Converse) and
  probes context size by sending oversized requests. Its Vertex is Gemini only; its
  Azure wizard sniffs a pasted URL.

Neither lists only what the account can actually use, and both leave an ended single
sign-on to an error message.

## Decision

Three providers, in the pay-as-you-go gallery, each with a page that picks an account
Conch found on this computer, and Claude Code able to run on Bedrock or Vertex.

| Provider             | Models                           | How it talks                                                                                     | Its sign-in                                                            |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Amazon Bedrock**   | Claude (`anthropic.claude-…`)    | Bedrock's Messages API endpoint, `bedrock-mantle.{region}.api.aws/anthropic`, SSE as Anthropic's | an AWS profile (SigV4, service `bedrock-mantle`), or a Bedrock API key |
| **Google Vertex AI** | Claude (`claude-…`)              | `…/publishers/anthropic/models/{model}:streamRawPredict`, `anthropic_version: vertex-2023-10-16` | application default credentials, billed to a chosen project            |
| **Azure OpenAI**     | your resource's chat deployments | Azure's v1 API, `https://{resource}.openai.azure.com/openai/v1`, OpenAI's chat shape             | a Microsoft Entra token from `az`                                      |

### Found, then chosen, never typed

`apps/server/src/clouds/` reads what's here and only reads:

- **AWS** (`aws.ts`): every profile in `~/.aws/config` and `~/.aws/credentials` (or
  `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`), the way the AWS CLI parses them:
  single sign-on (an `sso-session` or the older `sso_start_url`), access keys, a role
  with its source profile, a `credential_process`, and keys in the environment. Whether
  an SSO profile is signed in comes from the CLI's own cache, named for the session's
  SHA-1 (botocore's rule), and only its dates are read: `expiresAt`, and whether a
  refresh token can renew it.
- **Google Cloud** (`gcp.ts`): whether application default credentials exist and which
  project they bill (`quota_project_id`), the active gcloud configuration's project, and
  `gcloud projects list` for the rest. The credentials' secrets are never read into
  Conch.
- **Azure** (`azure.ts`): the subscriptions in `azureProfile.json` (written with a byte
  order mark), then, with a management token from `az`, the `OpenAI` and `AIServices`
  accounts in each and their deployments, through `management.azure.com` with `GET`
  only.

The page (`CloudSetup.tsx`, Nacre `CloudAccountPicker`) shows them as a pick list.
Signed-in accounts come first; a role named like an administrator is marked "Full
access. A narrower role is safer." and never recommended, since Conch only asks for
models. One press uses an account. A signed-in AWS profile or Google project also
appears under **Found on this computer** on the Providers page, ready in one press,
before the person has opened anything (Azure needs its API to find resources, so it's
offered on its page only).

The choice is kept in `settings.clouds`, by provider: a profile's name, a project id or a
resource id, a region, and for Azure the resource's own address. No secret. Choosing
accepts only an account this computer has, a project id of Google's shape, or a resource
Azure listed, and a region from the cloud's own list.

**Nothing is ready until someone chooses.** A cloud provider with nothing chosen is
`signed-out` ("Choose the AWS account Conch should use"), so it is never the default by
`#settle`, and a company's bill never starts because a laptop happens to have a profile.

### Only the models the account can use

Neither Bedrock nor Vertex has Anthropic's Models API. Conch keeps the list of Claude
models each cloud names (`clouds/models.ts`, checked against Anthropic's and AWS's pages
on 2026-10-08: ids, windows, thinking levels), adds any `anthropic.claude-…` model
Bedrock's `ListFoundationModels` names that it doesn't know yet, and then asks about
every one with a **free token count** (`/count_tokens` on Bedrock, `count-tokens:rawPredict`
on Vertex). A 403 or 404 (no access, not in this region) leaves it out; a throttle or a
blip keeps it in; a 401 is a refused sign-in. The answer is kept for five minutes per
account and region. So the picker lists exactly what the account gives, and the card
says so: "dev · eu-west-1 · 8 models". No access anywhere is said as the fix: "This AWS
account can't use Claude in us-east-1 yet. Turn on model access in the Bedrock console,
or choose another region."

Azure lists your deployments: their names are what a request names, and the model
behind each says whether it sees and thinks. Embedding, speech and image deployments are
left out.

### One wire, routed

Bedrock's Messages endpoint and Vertex's `rawPredict` speak Anthropic's Messages API,
so they are the existing `AnthropicWire` with an `AnthropicRoute`: where a request goes,
its headers (signed if need be) and its body. Streaming, adaptive thinking and its
updates, prompt caching, tool calls, replayed thinking, healing a refused schema or
thinking beta: all the same code as Anthropic's own API. Errors are read the same way,
in the cloud's words ("Amazon Bedrock refused this AWS sign-in. Sign in to AWS again,
or choose another account."). Azure is `OpenAiWire` with a token where a key goes.

A model id must match its cloud's shape before it goes into an address, so a model
string from anywhere can't become a path.

### Keys and tokens, from the clouds' own programs

- **AWS**: plain access keys are read where the CLI would read them. Everything else
  (SSO, roles, credential processes) comes from `aws configure export-credentials
--profile P --format process`, which also renews an SSO session that can renew. Keys
  are kept in memory until five minutes before they expire, one CLI call per burst; a
  failure is kept ten seconds so a page that looks every few seconds doesn't run the
  CLI each time.
- **Requests are signed with SigV4** (`clouds/sigv4.ts`): AWS's documented canonical
  request and signing-key chain on `node:crypto`'s SHA-256 and HMAC, checked against
  AWS's published vectors (the signing-key example, the test suite's `get-vanilla`, the
  IAM `ListUsers` example). No AWS SDK: it would be several megabytes and a dozen
  packages for two signed requests, and a lockfile change eight parallel branches would
  conflict on. The signature covers the body, so it can't be replayed onto other words.
- **A Bedrock API key** (`ABSK…` long-term, `bedrock-api-key-…` short-term, AWS's own
  marks, so `distinct` under ADR 0053) is sent as `x-api-key` to Mantle and as a bearer
  to the control plane, never signed. `AWS_BEARER_TOKEN_BEDROCK` is offered under
  **Found on this computer** like any other key.
- **Google**: `gcloud auth application-default print-access-token`, kept 45 minutes.
  Every request carries `x-goog-user-project`, so the chosen project pays.
- **Azure**: `az account get-access-token --resource https://cognitiveservices.azure.com`
  for the resource and `https://management.azure.com` for listing, kept until five
  minutes before `expires_on`.

### A sign-in that ends is one press

Single sign-on ends every working day. The AWS CLI's refusals ("Token has expired",
"Error loading SSO Token", …) become a `CloudError('signed-out')`, an `ApiError` of kind
`auth`, so:

- the provider's card says "Your AWS sign-in for “dev” has ended. Sign in to AWS again."
  with `canSignIn`, and the account's row has **Sign in to AWS again**;
- a turn that meets it ends with `TurnProblem` `signed-out` (the chat's sign-in card,
  never a bare failure), and a throttle is `limit`, which routes to the fallback;
- Repair everything says whose sign-in ended, with **Sign in again**.

Signing in runs the cloud's own program: `aws sso login --profile P --use-device-code`
(falling back to the CLI's default where the flag is unknown), `gcloud auth
application-default login`, `az login --use-device-code`. The page and the short code it
prints are shown with Nacre `SignInCode`, so it works from a phone; only a page on the
cloud's own hosts is shown. When it exits, Conch checks keys come, then looks again.
Google's sign-in opens a browser on the computer Conch runs on, as Gemini CLI's does.

### The cloud's program, got for you

`aws-cli`, `gcloud` and `azure-cli` are needs (`setup/known.ts`: winget, Homebrew,
the vendor's page on Linux, with `version`, `latest` and `update`), so a missing one is
**Install AWS CLI**, and Updates watches it. Plain access keys need no program.

### Claude Code on Bedrock or Vertex

Claude Code's page gains **Where Claude Code runs**: Claude plan, Amazon Bedrock or
Google Vertex AI, and the same account list. Choosing one puts the switches Claude Code
documents in its environment: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_PROFILE`, `AWS_REGION`,
or `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION`. Conch's
Anthropic key is then left out of its environment, since it would win. Before a turn,
Conch checks the cloud sign-in itself (`claudeProblem`), so an ended SSO is the card's
"Sign in to AWS again", and **Sign in** on Claude Code's page runs the cloud's sign-in.
Claude Code's own settings are untouched; **Claude plan** forgets the cloud.

## Security

- **Read-only, everywhere.** Conch never writes `~/.aws`, gcloud's folder or
  `~/.azure`, and never changes anything in a cloud account: Azure is `GET` only, AWS and
  Google are asked only for models and token counts. A test runs every picker and
  checks no command it ran configures, logs in, creates or deletes.
  The only writes are the clouds' own sign-ins, started by a person's press.
- **No secret leaves memory.** Keys and tokens are never stored, logged, put in a URL or
  sent to the browser. A failing program's words go through `clean`, which removes
  token, key and secret shapes.
- **Tokens go only to their own cloud.** SigV4 and the Bedrock key go to
  `*.api.aws` and `bedrock.{region}.amazonaws.com`; Google's token to
  `*aiplatform.googleapis.com`; Azure's to `management.azure.com` and a resource address
  that Azure itself returned and that is `https://<name>.openai.azure.com`,
  `.cognitiveservices.azure.com` or `.services.ai.azure.com`, with no port
  (`azureEndpoint`). `send()` refuses plain http and redirects.
- **Least privilege by default.** Narrower roles are recommended; an administrator role
  is marked. Conch needs `bedrock-mantle:CreateInference` (and `bedrock:ListFoundationModels`
  for new models), Vertex's `aiplatform.endpoints.predict`, Azure's OpenAI User role.
- **The agent can't reach them.** Sealed commands already can't read `~/.aws`,
  `~/.azure` or gcloud's folder (`conversations/sandbox.ts`). On a cloud, Claude Code's
  environment carries a profile or project name, as Claude Code requires; its sealed
  commands still can't read the sign-in behind it.
- **Choosing is the person's.** The routes take only accounts found here; no tool
  chooses or signs in. A restored backup brings back only names, which work only where
  that sign-in exists, so no backup power is added.

## Consequences

- Three more needs, a route on two existing wires, and no new dependency.
- A cloud's list price can differ from Anthropic's (Bedrock's regional endpoints cost
  10% more): Conch's spend shows Anthropic's list price, and says nothing for an Azure
  deployment whose name doesn't say what it is.
- Probing costs one free request per model per account and region, every five minutes
  at most while a page or the picker asks.
- **Deferred:** Bedrock's other models (Nova, Llama, gpt-oss: Converse or Mantle's
  OpenAI endpoint), Gemini on Vertex (OpenAI's shape; one provider can't keep two
  transcript shapes), Claude on Azure AI Foundry's `/anthropic`, Azure resource keys,
  Bedrock's global inference profiles, an AWS sign-in set up from nothing (`aws configure
sso` needs the company's start page, which only the person knows), and Claude Code on
  Foundry (`CLAUDE_CODE_USE_FOUNDRY`).

## Sources

- Claude in Amazon Bedrock (Mantle, SigV4 service `bedrock-mantle`, model ids, regions):
  https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock
- Claude on Vertex AI: https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai
- SigV4: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
- Bedrock API keys: https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html;
  ListFoundationModels: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html
- `aws configure export-credentials`: https://docs.aws.amazon.com/cli/latest/reference/configure/export-credentials.html;
  `aws sso login`: https://docs.aws.amazon.com/cli/latest/reference/sso/login.html; the
  SSO cache's name and fields: botocore's `SSOTokenLoader`
- Azure OpenAI v1 API: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle;
  Cognitive Services management API 2024-10-01
- Claude Code on Bedrock and Vertex: https://code.claude.com/docs/en/amazon-bedrock,
  https://code.claude.com/docs/en/google-vertex-ai
- OpenClaw `docs/providers/bedrock.md`, `bedrock-mantle.md`, `extensions/anthropic-vertex`,
  `extensions/microsoft-foundry`; Hermes Agent `website/docs/guides/aws-bedrock.md`,
  `google-vertex.md`, `azure-foundry.md`
- OWASP ASVS 5.0 V13 (configuration and secrets) for keeping credentials out of logs,
  URLs and storage
