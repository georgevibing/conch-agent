import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Stack } from '../../components/Stack';
import { VirtualList } from '../../components/VirtualList';
import {
  type GeneratorSettings,
  PasswordGenerator,
  TotpCode,
  VaultApproval,
  VaultConnectedSources,
  VaultRequestCard,
  VaultUnlockCard,
  VaultFieldRow,
  VaultFieldsSkeleton,
  VaultFavoriteButton,
  VaultHealth,
  VaultItemHeader,
  VaultItemIcon,
  VaultListHeading,
  VaultPasskeyRow,
  VaultRow,
  VaultRowSkeleton,
  VaultSelectionBar,
  VaultSignInRow,
  VaultSourceBadge,
  VaultSourceFilter,
  VaultSourceRow,
  VaultSourceStrip,
  VaultTransferProgress,
} from './Passwords';

const meta = {
  title: 'Patterns/Passwords',
  component: VaultRow,
  args: {
    kind: 'login',
    title: 'Netflix',
    subtitle: 'ada@example.com',
    domain: 'netflix.com',
    onClick: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Passwords, Conch’s own vault, and the password managers it reads alongside. A list that says what each item is at a glance (a site’s own monogram, never a favicon fetched from the web), fields whose secrets stay as dots until you ask and hide again by themselves, one-time codes with a ring that runs out, a generator you can watch, and a Security check that says warmly when there’s nothing to do.',
      },
    },
  },
} satisfies Meta<typeof VaultRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const rows = [
  {
    kind: 'login',
    title: 'GitHub',
    subtitle: 'ada-lovelace',
    domain: 'github.com',
    totp: true,
    favorite: true,
  },
  {
    kind: 'login',
    title: 'Netflix',
    subtitle: 'ada@example.com',
    domain: 'netflix.com',
    issues: ['reused'],
  },
  {
    kind: 'login',
    title: 'Old forum',
    subtitle: 'ada1815',
    domain: 'forum.example',
    issues: ['compromised', 'weak'],
  },
  { kind: 'card', title: 'Everyday Visa', subtitle: '•••• 4242' },
  {
    kind: 'login',
    title: 'Bank of Somewhere',
    subtitle: 'ada',
    domain: 'bank.example',
    source: '1password',
  },
  {
    kind: 'login',
    title: 'Mail',
    subtitle: 'ada@proton.me',
    domain: 'mail.example',
    source: 'bitwarden',
  },
  { kind: 'wifi', title: 'Home Wi-Fi', subtitle: 'Lovelace-5G' },
  { kind: 'identity', title: 'Ada Lovelace', subtitle: 'ada@example.com' },
  { kind: 'note', title: 'Safe combination' },
  { kind: 'apiKey', title: 'OpenRouter key', subtitle: 'openrouter.ai' },
  { kind: 'document', title: 'Passport', subtitle: 'Ada Lovelace', issues: ['expired'] },
  { kind: 'sshKey', title: 'Work laptop key' },
  { kind: 'wallet', title: 'Hardware wallet' },
] as const;

/** Every kind, sources and problems: what the list looks like in use. */
export const List: Story = {
  render: () => {
    const [selected, setSelected] = useState('GitHub');
    return (
      <div style={{ display: 'grid', gap: 2, maxInlineSize: 380 }}>
        {rows.map((r) => (
          <VaultRow
            key={r.title}
            {...r}
            issues={'issues' in r ? [...r.issues] : undefined}
            selected={selected === r.title}
            onClick={() => setSelected(r.title)}
          />
        ))}
      </div>
    );
  },
};

/**
 * Where each item lives: Conch's pearl or the password manager's mark on the
 * corner of its tile, and one press to show only one place's items.
 */
export const WhereItemsLive: Story = {
  render: () => {
    const [from, setFrom] = useState<'all' | 'conch' | '1password' | 'bitwarden'>('all');
    const shown = rows.filter(
      (r) => from === 'all' || ('source' in r ? r.source : 'conch') === from,
    );
    return (
      <div style={{ display: 'grid', gap: 8, maxInlineSize: 380 }}>
        <VaultSourceFilter
          value={from}
          onValueChange={(v) => setFrom(v as typeof from)}
          total={rows.length}
          sources={[
            { source: 'conch', count: rows.filter((r) => !('source' in r)).length },
            { source: '1password', count: 1 },
            { source: 'bitwarden', count: 1 },
          ]}
        />
        <div style={{ display: 'grid', gap: 2 }}>
          {shown.map((r) => (
            <VaultRow
              key={r.title}
              {...r}
              container={'source' in r && r.source === '1password' ? 'Private' : undefined}
              issues={'issues' in r ? [...r.issues] : undefined}
            />
          ))}
        </div>
      </div>
    );
  },
};

/**
 * Choosing several: ⌘/Ctrl-click or Shift-click a row, or Select. The tiles
 * turn into tick boxes, and the bar says how many and what can be done.
 */
export const ChoosingSeveral: Story = {
  render: () => {
    const [chosen, setChosen] = useState<Set<string>>(
      new Set(['Netflix', 'Old forum', 'Bank of Somewhere']),
    );
    const toggle = (title: string) =>
      setChosen((before) => {
        const next = new Set(before);
        if (next.has(title)) next.delete(title);
        else next.add(title);
        return next;
      });
    return (
      <div style={{ display: 'grid', gap: 8, maxInlineSize: 380 }}>
        <VaultSelectionBar
          count={chosen.size}
          total={rows.length}
          onSelectAll={() => setChosen(new Set(rows.map((r) => r.title)))}
          onDone={() => setChosen(new Set())}
          actions={
            <>
              <Button size="sm" variant="surface">
                Copy to 1Password
              </Button>
              <Button size="sm" variant="ghost" tone="danger">
                Delete {chosen.size}
              </Button>
            </>
          }
        />
        <div style={{ display: 'grid', gap: 2 }}>
          {rows.slice(0, 7).map((r) => (
            <VaultRow
              key={r.title}
              {...r}
              issues={'issues' in r ? [...r.issues] : undefined}
              selecting
              checked={chosen.has(r.title)}
              onClick={() => toggle(r.title)}
            />
          ))}
        </div>
      </div>
    );
  },
};

const SITES = ['Amazon', 'Bank of Somewhere', 'Dropbox', 'GitHub', 'Netflix', 'Old forum', 'Zed'];
type LongRow = { heading: string } | { title: string; favorite: boolean };
const longRows: LongRow[] = [
  { heading: 'Favourites' },
  { title: 'GitHub', favorite: true },
  { title: 'A very long name for an account that someone kept from years ago', favorite: true },
  ...SITES.flatMap((site): LongRow[] => [
    { heading: site.charAt(0) },
    ...Array.from({ length: 140 }, (_, i) => ({ title: `${site} ${i + 1}`, favorite: false })),
  ]),
];

/**
 * A thousand items: only the rows in view are drawn (`VirtualList`), so the
 * list scrolls and a search above it answers at once. A heading stays at the
 * top while its group passes, a long title ends in “…”, and with one password
 * manager connected its mark is left out (`sourceMark={false}`).
 */
export const LongList: Story = {
  render: () => {
    const [selected, setSelected] = useState('GitHub');
    return (
      <VirtualList
        role="list"
        aria-label="Passwords"
        style={{ blockSize: 480, maxInlineSize: 380 }}
        items={longRows}
        rowHeight={(row) => ('heading' in row ? 2 : 3.625)}
        getKey={(row, i) => ('heading' in row ? `heading-${i}` : row.title)}
        sticky={(row) => 'heading' in row}
        rowProps={(row) => ({ role: 'heading' in row ? 'presentation' : 'listitem' })}
      >
        {(row) =>
          'heading' in row ? (
            <VaultListHeading>{row.heading}</VaultListHeading>
          ) : (
            <VaultRow
              kind="login"
              title={row.title}
              subtitle="ada@example.com"
              domain={`${row.title.toLowerCase().replaceAll(' ', '')}.example`}
              source="1password"
              sourceMark={false}
              favorite={row.favorite}
              selected={selected === row.title}
              onClick={() => setSelected(row.title)}
            />
          )
        }
      </VirtualList>
    );
  },
};

/** A search: the best match first, and the part of each title that matched is marked. */
export const SearchResults: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 2, maxInlineSize: 380 }}>
      <VaultRow
        kind="login"
        title="Amazon"
        subtitle="ada@example.com"
        domain="amazon.com"
        titleRanges={[[0, 3]]}
        selected
      />
      <VaultRow
        kind="login"
        title="My Amazon seller account"
        subtitle="ada"
        domain="sell.amazon.com"
        titleRanges={[[3, 6]]}
      />
      <VaultRow kind="note" title="Panama trip" titleRanges={[[3, 6]]} />
    </div>
  ),
};

/**
 * While things load: rows hold their place in the list, and an item’s fields
 * hold theirs in the card (its name and icon are already there from the list).
 * The fields wait a beat before showing, so a quick answer never flashes.
 */
export const Loading: Story = {
  render: () => (
    <div
      aria-busy="true"
      style={{ display: 'flex', gap: 24, alignItems: 'start', flexWrap: 'wrap' }}
    >
      <div style={{ inlineSize: 380 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <VaultRowSkeleton key={i} />
        ))}
      </div>
      <div
        style={{
          inlineSize: 420,
          borderRadius: 'var(--nc-radius-xl)',
          boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
        }}
      >
        <VaultFieldsSkeleton rows={3} />
      </div>
    </div>
  ),
};

const reveal = () =>
  new Promise<string>((resolve) => setTimeout(() => resolve('k7mbqe-x3tnzr-wd8pha'), 300));
const code = () =>
  Promise.resolve({
    code: String(Math.floor(Math.random() * 1e6)).padStart(6, '0'),
    period: 30,
    expiresAt: (Math.floor(Date.now() / 30_000) + 1) * 30_000,
  });

/** An item's fields: secrets as dots, Show and Copy, strength, a live code. */
export const Fields: Story = {
  render: () => (
    <div
      style={{
        maxInlineSize: 520,
        borderRadius: 16,
        background: 'var(--nc-surface)',
        boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
      }}
    >
      <VaultFieldRow label="Username" value="ada@example.com" onCopy={fn()} />
      <VaultFieldRow label="Password" concealed onReveal={reveal} onCopy={fn()} strength={4} />
      <TotpCode period={30} onFetch={code} onCopy={fn()} />
      <VaultFieldRow label="Website" value="netflix.com" href="https://netflix.com" onCopy={fn()} />
      <VaultFieldRow
        label="Old password"
        concealed
        onReveal={() => Promise.resolve('password1')}
        strength={0}
      />
    </div>
  ),
};

const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_';
const words = ['crane', 'bugle', 'spoof', 'ridge', 'otter', 'lemon', 'harbor', 'quilt'];
function demoGenerate(s: GeneratorSettings): string {
  if (s.style === 'pin')
    return Array.from({ length: s.length }, () => Math.floor(Math.random() * 10)).join('');
  if (s.style === 'words')
    return (
      Array.from(
        { length: s.length },
        () => words[Math.floor(Math.random() * words.length)] ?? 'x',
      ).join('-') + (s.digits ? '7' : '')
    );
  return Array.from({ length: s.length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join('');
}

export const Generator: Story = {
  render: () => {
    const [settings, setSettings] = useState<GeneratorSettings>({
      style: 'random',
      length: 20,
      symbols: true,
      digits: true,
      unambiguous: true,
    });
    return (
      <PasswordGenerator
        settings={settings}
        onSettingsChange={setSettings}
        generate={demoGenerate}
        score={(p) => (p.length > 15 ? 4 : p.length > 10 ? 3 : 2)}
        onUse={fn()}
        onCopy={fn()}
      />
    );
  },
};

export const SecurityCheck: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxInlineSize: 640 }}>
      <VaultHealth
        compromised={1}
        reused={4}
        weak={2}
        expired={1}
        total={48}
        checkedNote="Checked for breaches yesterday"
        onSelect={fn()}
        action={
          <Button size="sm" variant="surface">
            Check now
          </Button>
        }
      />
      <VaultHealth
        aria-label="Security check, all clear"
        compromised={0}
        reused={0}
        weak={0}
        total={48}
        checkedNote="Checked for breaches today"
      />
    </div>
  ),
};

const sourceRows = (
  <>
    <VaultSourceRow source="conch" state="ready" count={42} />
    <VaultSourceRow
      source="1password"
      state="locked"
      message="Turn on Settings › Developer › Integrate with 1Password CLI in the 1Password app."
      action={
        <Button size="sm" variant="surface">
          Turn off
        </Button>
      }
    />
    <VaultSourceRow
      source="1password"
      state="ready"
      count={12}
      via="Service account · 2 vaults"
      action={
        <Button size="sm" variant="surface">
          Settings
        </Button>
      }
    />
    <VaultSourceRow
      source="bitwarden"
      state="locked"
      message="Unlock it with its master password"
      action={
        <Button size="sm" variant="surface">
          Unlock
        </Button>
      }
    />
    <VaultSourceRow
      source="keepassxc"
      state="missing"
      message="Needs KeePassXC’s command line tool."
      action={
        <Button size="sm" variant="surface">
          Install KeePassXC
        </Button>
      }
    />
    <VaultSourceRow
      source="protonpass"
      state="ready"
      count={86}
      keptUnlocked
      sync={{ enabled: true, copies: 86, when: 'up to date 4 min ago' }}
      action={
        <Stack direction="row" gap={1}>
          <Button size="sm" variant="surface">
            Copy into Conch
          </Button>
          <Button size="sm" variant="surface">
            Lock
          </Button>
          <Button size="sm" variant="surface">
            Turn off
          </Button>
        </Stack>
      }
    />
    <VaultSourceRow
      source="dashlane"
      state="error"
      message="Dashlane didn’t answer. Try again in a moment."
      sync={{ enabled: true, copies: 20, problem: 'Dashlane is locked' }}
      action={
        <Button size="sm" variant="surface">
          Turn off
        </Button>
      }
    />
    <VaultSourceRow
      source="keeper"
      state="off"
      action={
        <Button size="sm" variant="surface">
          Turn on
        </Button>
      }
    />
    <VaultSourceRow source="keychain" state="ready" count={7} />
  </>
);

const sourceFrame = (width: number) => ({
  maxInlineSize: width,
  borderRadius: 16,
  background: 'var(--nc-surface)',
  boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
});

/**
 * Every state a manager can be in. The state's word never breaks; what to do
 * about it gets its own line under the name, so the button never squeezes it.
 */
export const Sources: Story = {
  render: () => <div style={sourceFrame(560)}>{sourceRows}</div>,
};

/** On a phone: a long hint wraps under the name, and several buttons go underneath. */
export const SourcesNarrow: Story = {
  render: () => <div style={sourceFrame(340)}>{sourceRows}</div>,
};

/** The start screen's glance at what else Passwords is showing. */
export const ConnectedManagers: Story = {
  render: () => (
    <VaultConnectedSources
      sources={[
        { source: 'keepassxc', state: 'ready', count: 4 },
        { source: '1password', state: 'ready', count: 318 },
        { source: 'bitwarden', state: 'locked' },
        { source: 'dashlane', state: 'error' },
      ]}
      onOpen={fn()}
    />
  ),
};

/** Passkeys kept with a login: the site, the account, the last use. Never the key. */
export const Passkeys: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, maxInlineSize: 480 }}>
      <VaultPasskeyRow
        site="github.com"
        userName="ada"
        when="Used yesterday"
        action={
          <Button size="sm" variant="ghost">
            Remove
          </Button>
        }
      />
      <VaultPasskeyRow site="shop.example" />
    </div>
  ),
};

/** Copying from another password manager into Conch: as it goes, finished, with problems. */
export const MovingIn: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxInlineSize: 480 }}>
      <VaultTransferProgress
        source="bitwarden"
        state="running"
        total={318}
        done={127}
        copied={120}
        updated={0}
        skipped={7}
        action={
          <Button size="sm" variant="ghost">
            Stop
          </Button>
        }
      />
      <VaultTransferProgress
        source="1password"
        state="done"
        total={318}
        done={318}
        copied={301}
        updated={0}
        skipped={15}
        failed={[
          { title: 'Old router', message: '1Password didn’t answer.' },
          { title: 'Work VPN', message: 'That field is empty in 1Password.' },
        ]}
        action={<Button size="sm">Done</Button>}
      />
      <VaultTransferProgress
        source="keeper"
        state="failed"
        total={0}
        done={0}
        copied={0}
        updated={0}
        skipped={0}
        message="Keeper needs you to sign in."
      />
    </div>
  ),
};

/** The assistant needs a credential: typed here, saved to Passwords, never seen by it. */
export const AskForACredential: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <VaultRequestCard
        state="waiting"
        title="GitHub"
        itemKind="login"
        site="github.com"
        reason="To open your pull requests"
        fields={[
          { label: 'Username', kind: 'text', role: 'username' },
          { label: 'Password', kind: 'secret', role: 'password' },
        ]}
        onSave={() => new Promise((r) => setTimeout(r, 600))}
        onDecline={fn()}
      />
      <VaultRequestCard state="done" title="GitHub" itemKind="login" fields={[]} onOpen={fn()} />
    </div>
  ),
};

/** Reading one thing, with what and why; a secret says the assistant will see it. */
export const AskToRead: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <VaultApproval
        itemTitle="Everyday Visa"
        itemKind="card"
        fieldLabel="PIN"
        reason="The bank’s phone menu asks for it"
        sensitive
        onDecide={fn()}
      />
      <VaultApproval
        itemTitle="Wi-Fi at home"
        itemKind="wifi"
        fieldLabel="Password"
        decision="allow"
      />
    </div>
  ),
};

/** A key put into a command's environment: the variable, the command, and that it isn't seen (ADR 0151). */
export const AskToUseInACommand: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <VaultApproval
        itemTitle="Gh pat giotiskl"
        itemKind="apiKey"
        fieldLabel="Key"
        reason="Clone indiestand-api as giotiskl"
        sensitive
        use={{
          envName: 'GH_TOKEN',
          command: 'git clone https://x-access-token:$GH_TOKEN@github.com/giotiskl/indiestand-api',
        }}
        onDecide={fn()}
      />
      <VaultApproval
        itemTitle="Gh pat giotiskl"
        itemKind="apiKey"
        fieldLabel="Key"
        use={{ envName: 'GH_TOKEN' }}
        decision="allow"
      />
    </div>
  ),
};

/** Passwords is locked: unlock it in the chat, and the task carries on. */
export const UnlockInTheChat: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <VaultUnlockCard
        state="waiting"
        onUnlock={(p) =>
          p === 'tide pool seven'
            ? Promise.resolve()
            : Promise.reject(new Error('That isn’t the password for Passwords.'))
        }
      />
      <VaultUnlockCard state="done" />
    </div>
  ),
};

// ── How an item signs in, and an item's page ───────────────────────────────

const card = {
  overflow: 'hidden',
  borderRadius: 16,
  background: 'var(--nc-surface)',
  boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
} as const;

const openLogin = (name: string) => (
  <Button size="sm" variant="ghost" trailingIcon={<ChevronRight />} aria-label={`Open ${name}`}>
    Open
  </Button>
);

/**
 * Every way an item can sign in when it isn't a password: through another
 * account (the provider's own mark), a passkey Conch can or can't use,
 * single sign-on, and an emailed link. The row says it in a few words and
 * offers the one next step.
 */
export const SignInMethods: Story = {
  render: () => (
    <div style={{ ...card, maxInlineSize: 520 }}>
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'google', name: 'Google', account: 'james@claw.dev' }}
        action={openLogin('your Google login')}
        onCopyAccount={fn()}
      />
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'apple', name: 'Apple', account: 'ada@icloud.com' }}
        hint="No Apple login saved"
        onCopyAccount={fn()}
      />
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'microsoft', name: 'Microsoft' }}
        hint="No Microsoft login saved"
      />
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'github', name: 'GitHub', account: 'ada-lovelace' }}
        action={openLogin('your GitHub login')}
      />
      <VaultSignInRow signIn={{ via: 'passkey', account: 'ada', usable: true }} />
      <VaultSignInRow
        signIn={{ via: 'passkey', account: 'ada', usable: false }}
        keptIn="1Password"
      />
      <VaultSignInRow signIn={{ via: 'sso', name: 'Okta', account: 'ada@acme.com' }} />
      <VaultSignInRow signIn={{ via: 'link', account: 'ada@example.com' }} />
      <VaultSignInRow signIn={{ via: 'provider', provider: 'other', name: 'Acme ID' }} />
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'other', account: 'james@claw.dev' }}
        hint="Which one is set in 1Password"
      />
    </div>
  ),
};

/** Rows that sign in some other way say so with a small mark at their end. */
export const RowsThatSignInOtherwise: Story = {
  render: () => (
    <Stack gap={1} style={{ maxInlineSize: 380 }}>
      <VaultRow
        kind="login"
        title="Product Hunt"
        subtitle="james@claw.dev"
        domain="producthunt.com"
        source="1password"
        signIn={{ via: 'provider', provider: 'google', name: 'Google' }}
      />
      <VaultRow
        kind="login"
        title="Figma"
        subtitle="ada@example.com"
        domain="figma.com"
        signIn={{ via: 'provider', provider: 'apple', name: 'Apple' }}
      />
      <VaultRow
        kind="login"
        title="Shop"
        subtitle="ada"
        domain="shop.example"
        passkey
        signIn={{ via: 'passkey', usable: true }}
      />
      <VaultRow
        kind="login"
        title="Acme intranet"
        subtitle="ada@acme.com"
        domain="intranet.acme.com"
        signIn={{ via: 'sso', name: 'Okta' }}
      />
      <VaultRow
        kind="login"
        title="Newsletter"
        subtitle="ada@example.com"
        domain="news.example"
        signIn={{ via: 'link' }}
      />
    </Stack>
  ),
};

/** The column an item's page sits in, as Passwords draws it. */
function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxInlineSize: 640 }}>
      {children}
    </div>
  );
}

/**
 * An item from 1Password that signs in with Google: its name and one line
 * of facts; where it lives, with **Copy into Conch**; then how it signs in,
 * and the Google login it uses. No password row, because there is none.
 */
export const ItemFromAnotherManager: Story = {
  render: () => (
    <Page>
      <VaultItemHeader
        icon={
          <VaultItemIcon kind="login" domain="producthunt.com" title="Product Hunt" size="lg" />
        }
        title="Product Hunt"
        meta={['Login', 'Edited 1 Apr 2023']}
      />
      <VaultSourceStrip
        source="1password"
        label="Stored in 1Password"
        detail="James Claw"
        action={
          <Button size="sm" variant="surface" leadingIcon={<VaultSourceBadge source="conch" />}>
            Copy into Conch
          </Button>
        }
      />
      <div style={card}>
        <VaultSignInRow
          signIn={{
            via: 'provider',
            provider: 'google',
            name: 'Google',
            account: 'james@claw.dev',
          }}
          action={openLogin('your Google login')}
          onCopyAccount={fn()}
        />
        <VaultFieldRow
          label="Website"
          value="https://www.producthunt.com/"
          href="https://www.producthunt.com/"
          onCopy={fn()}
        />
      </div>
    </Page>
  ),
};

/**
 * The same item when 1Password doesn't say whose account it signs in with:
 * it says so plainly, and where that's chosen.
 */
export const ItemSignsInWithAnUnnamedAccount: Story = {
  render: () => (
    <Page>
      <VaultItemHeader
        icon={
          <VaultItemIcon kind="login" domain="producthunt.com" title="Product Hunt" size="lg" />
        }
        title="Product Hunt"
        meta={['Login', 'Edited 1 Apr 2023']}
      />
      <VaultSourceStrip
        source="1password"
        label="Stored in 1Password"
        detail="James Claw"
        action={
          <Button size="sm" variant="surface" leadingIcon={<VaultSourceBadge source="conch" />}>
            Copy into Conch
          </Button>
        }
      />
      <div style={card}>
        <VaultSignInRow
          signIn={{ via: 'provider', provider: 'other' }}
          hint="Which one is set in 1Password"
        />
        <VaultFieldRow
          label="Website"
          value="https://www.producthunt.com/"
          href="https://www.producthunt.com/"
          onCopy={fn()}
        />
      </div>
    </Page>
  ),
};

/**
 * One of Conch's own: favourite, Edit and More beside its name (under it on
 * a phone), and the same account in 1Password one press away.
 */
export const ItemOfConch: Story = {
  render: () => (
    <Page>
      <VaultItemHeader
        icon={<VaultItemIcon kind="login" domain="github.com" title="GitHub" size="lg" />}
        title="GitHub"
        meta={['Login', 'Edited 3 days ago', 'Used yesterday']}
        actions={
          <>
            <VaultFavoriteButton favorite onToggle={fn()} />
            <Button size="sm" variant="surface" leadingIcon={<Pencil />}>
              Edit
            </Button>
            <IconButton label="More">
              <MoreHorizontal />
            </IconButton>
          </>
        }
      />
      <VaultSourceStrip
        source="conch"
        label="In Conch"
        action={
          <Button size="sm" variant="ghost" leadingIcon={<VaultSourceBadge source="1password" />}>
            Also in 1Password
          </Button>
        }
      />
      <div style={card}>
        <VaultFieldRow label="Username" value="ada-lovelace" onCopy={fn()} />
        <VaultFieldRow label="Password" concealed onReveal={reveal} onCopy={fn()} strength={4} />
        <TotpCode period={30} onFetch={code} onCopy={fn()} />
        <VaultFieldRow label="Website" value="github.com" href="https://github.com" onCopy={fn()} />
      </div>
    </Page>
  ),
};

/** A passkey kept only in 1Password: the row says Conch can't use it, in a few words. */
export const ItemPasskeyOnly: Story = {
  render: () => (
    <Page>
      <VaultItemHeader
        icon={<VaultItemIcon kind="login" domain="shop.example" title="Shop" size="lg" />}
        title="Shop"
        meta={['Login', 'Edited 2 days ago']}
      />
      <VaultSourceStrip
        source="1password"
        label="Stored in 1Password"
        detail="Private"
        action={
          <Button size="sm" variant="surface" leadingIcon={<VaultSourceBadge source="conch" />}>
            Copy into Conch
          </Button>
        }
      />
      <div style={card}>
        <VaultSignInRow
          signIn={{ via: 'passkey', account: 'ada', usable: false }}
          keptIn="1Password"
        />
        <VaultFieldRow
          label="Website"
          value="shop.example"
          href="https://shop.example"
          onCopy={fn()}
        />
      </div>
    </Page>
  ),
};

/** A copy kept up to date from 1Password, and a key Conch uses: one line each. */
export const ItemCopiedAndSystem: Story = {
  render: () => (
    <Stack gap={8}>
      <Page>
        <VaultItemHeader
          icon={<VaultItemIcon kind="login" domain="mail.example" title="Mail" size="lg" />}
          title="Mail"
          meta={['Login', 'Edited today']}
          actions={
            <Button size="sm" variant="surface" leadingIcon={<Pencil />}>
              Edit
            </Button>
          }
        />
        <VaultSourceStrip source="conch" label="Kept up to date from 1Password" detail="2 h ago" />
      </Page>
      <Page>
        <VaultItemHeader
          icon={<VaultItemIcon kind="apiKey" title="OpenRouter" size="lg" />}
          title="OpenRouter"
          meta={['API key']}
        />
        <VaultSourceStrip
          source="system"
          label="Used by OpenRouter"
          detail="works while locked"
          action={
            <Button size="sm" variant="surface">
              Open Providers
            </Button>
          }
        />
      </Page>
    </Stack>
  ),
};
