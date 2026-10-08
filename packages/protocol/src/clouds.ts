/**
 * Your company's cloud as a provider (ADR 0109): Amazon Bedrock, Google
 * Vertex AI and Azure OpenAI, and Claude Code running on Bedrock or Vertex.
 *
 * Conch finds the sign-ins already on this computer — AWS profiles (SSO
 * included), Google's application default credentials and projects, the
 * Azure CLI's subscriptions — and offers them as a pick list. Nothing here
 * carries a secret: an account is a name, a few plain words and whether it's
 * signed in. A key, a token or a session never reaches the browser.
 */
import { z } from 'zod';

/** Which cloud. */
export const CloudKind = z.enum(['aws', 'gcp', 'azure']);
export type CloudKind = z.infer<typeof CloudKind>;

/** The providers that run on a cloud you pick (Claude Code only when you say so). */
export const CloudProviderId = z.enum(['bedrock', 'vertex', 'azure-openai', 'claude-code']);
export type CloudProviderId = z.infer<typeof CloudProviderId>;

/** Where Claude Code runs: Anthropic's own sign-in, or a cloud you pick. */
export const ClaudeRunsOn = z.enum(['anthropic', 'bedrock', 'vertex']);
export type ClaudeRunsOn = z.infer<typeof ClaudeRunsOn>;

/** The cloud each provider (and each place Claude Code can run) uses. */
export const CLOUD_OF: Readonly<Record<'bedrock' | 'vertex' | 'azure-openai', CloudKind>> = {
  bedrock: 'aws',
  vertex: 'gcp',
  'azure-openai': 'azure',
};

/** Whether an account can be used right now, as far as this computer knows. */
export const CloudAccountState = z.enum([
  /** Signed in (or keys that don't expire): ready to use. */
  'ready',
  /** Its sign-in ended: one press signs in again. */
  'expired',
  /** Never signed in on this computer. */
  'signed-out',
  /** Conch can't tell without trying (a program that hands out keys). */
  'unknown',
]);
export type CloudAccountState = z.infer<typeof CloudAccountState>;

/** One account Conch found: an AWS profile, a Google Cloud project, an Azure resource. */
export const CloudAccount = z.object({
  /** The profile's name, the project's id, the resource's id. */
  id: z.string().min(1).max(400),
  /** "work-dev", "My Project", "acme-openai". */
  label: z.string().max(200),
  /** A few plain words: "Signed in with AWS SSO · account …1234 · ReadOnly". */
  detail: z.string().max(300),
  state: CloudAccountState,
  /** How it signs in: `sso` can sign in again with one press. */
  kind: z.enum(['sso', 'keys', 'role', 'process', 'env', 'project', 'resource']),
  /** The region it's set up for, when it says. */
  region: z.string().max(40).optional(),
  /** What this computer uses when nothing else is said (`default`, the active project). */
  isDefault: z.boolean().default(false),
  /**
   * It can do everything in its account (an administrator role). Conch only
   * needs to ask for models, so a narrower one is offered first.
   */
  broad: z.boolean().default(false),
});
export type CloudAccount = z.infer<typeof CloudAccount>;

/** A region a person can choose, in words. */
export const CloudRegion = z.object({
  id: z.string().max(40),
  label: z.string().max(80),
});
export type CloudRegion = z.infer<typeof CloudRegion>;

/** What a provider uses: one account, and where. Kept in settings; never a secret. */
export const CloudChoice = z.object({
  account: z.string().min(1).max(400),
  region: z.string().max(40).optional(),
  /** Claude Code only: which cloud it runs on. */
  via: z.enum(['bedrock', 'vertex']).optional(),
  /** Azure: the resource's own address, as Azure gave it (checked to be Microsoft's). */
  endpoint: z.string().url().max(300).optional(),
  /** Azure: the subscription the resource is in. */
  subscription: z.string().max(80).optional(),
  /** Azure: the directory to ask for a token in. */
  tenant: z.string().max(80).optional(),
  /** The account's name as it was shown, for the card. */
  label: z.string().max(200).optional(),
  chosenAt: z.number().optional(),
});
export type CloudChoice = z.infer<typeof CloudChoice>;

/** The cloud's own program and whether it's here. */
export const CloudTool = z.object({
  /** The setup need that installs it (`aws-cli`, `gcloud`, `azure-cli`). */
  need: z.string(),
  /** "AWS CLI" */
  name: z.string(),
  present: z.boolean(),
  /** It's here, but too old for what Conch asks of it. */
  outdated: z.boolean().default(false),
});
export type CloudTool = z.infer<typeof CloudTool>;

/** Everything a cloud's page shows: the accounts found, the regions, what's chosen. */
export const CloudPicker = z.object({
  provider: CloudProviderId,
  cloud: CloudKind,
  /** "Amazon Bedrock" */
  name: z.string(),
  tool: CloudTool,
  /**
   * Signed in to the cloud at all on this computer (Google's application
   * default credentials, `az login`). AWS signs in per profile instead.
   */
  signedIn: z.boolean().optional(),
  accounts: z.array(CloudAccount),
  /** Empty when the account decides (an Azure resource lives in one region). */
  regions: z.array(CloudRegion),
  /** The region to offer first. */
  region: z.string().optional(),
  chosen: CloudChoice.optional(),
  /** One plain sentence, when something's in the way. */
  message: z.string().max(400).optional(),
});
export type CloudPicker = z.infer<typeof CloudPicker>;

/** Use an account. */
export const ChooseCloudBody = z.object({
  account: z.string().min(1).max(400),
  region: z.string().max(40).optional(),
});
export type ChooseCloudBody = z.infer<typeof ChooseCloudBody>;

/** Where Claude Code runs. `anthropic` forgets the cloud. */
export const ClaudeCloudBody = z.object({
  via: ClaudeRunsOn,
  account: z.string().min(1).max(400).optional(),
  region: z.string().max(40).optional(),
});
export type ClaudeCloudBody = z.infer<typeof ClaudeCloudBody>;
