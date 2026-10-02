/**
 * The pictures on the front page. Each is the app's own components playing a
 * short scripted moment on a loop while it's in view: nothing here is a
 * screenshot, so the page can't show a Conch that no longer exists. What they
 * say is true of the product; the chats and names in them are made up.
 */
import {
  ArtifactChart,
  Badge,
  BrowserApproval,
  BrowserWindow,
  Diff,
  FilesChanged,
  Handset,
  HealedNotes,
  IntegrationLogo,
  MemoryItem,
  MemoryList,
  Message,
  RoutedNote,
  RoutineCard,
  Stage,
  Steady,
  StreamingText,
  TaintNotice,
  TaskCard,
  Text,
  ThinkingIndicator,
  ToolCall,
  useInView,
  type HandsetMessage,
} from '@conch/nacre';
import { CalendarClock } from 'lucide-react';
import reference from 'virtual:conch-reference';

import styles from './demos.module.css';
import { checkout, checkoutPay, hotels, hotelsSearch, hotelsSecond } from './pictures';
import { arrived, useClock } from './useClock';

const provider = (id: string) => reference.providers.find((p) => p.id === id);
const channel = (id: string) => reference.channels.find((c) => c.id === id);
const noop = () => undefined;

function Speaker({ id }: { id: string }) {
  const speaker = provider(id);
  if (!speaker) return null;
  return (
    <span key={id} className={styles.speaker}>
      <IntegrationLogo
        brand={speaker.id}
        name={speaker.name}
        color={speaker.color}
        size="xs"
        decorative
      />
      <Text as="span" size="sm" weight="medium">
        {speaker.name}
      </Text>
    </span>
  );
}

// ── The hero: a question, a tool, an answer, and a chat that carries on offline ──

const CHAT = {
  ask: 500,
  think: 1_300,
  tool: 2_900,
  toolDone: 4_300,
  answer: 4_700,
  answerDone: 7_900,
  askAgain: 9_300,
  routed: 10_300,
  thinkAgain: 10_500,
  answerAgain: 11_900,
  answerAgainDone: 14_600,
  end: 19_000,
} as const;

const ANSWER =
  'Twelve commits since Monday. The terminal landed, search got two fixes, and backups have a new format.';
const ANSWER_AGAIN =
  'Yes. I’m answering from the model on this computer now, and I still have the whole thread.';

/** The chat as it stands at one moment of the script. */
function Transcript({ at }: { at: number }) {
  return (
    <div className={styles.chat}>
      {at >= CHAT.ask && <Message from="user">What changed in this repo since Monday?</Message>}
      {at >= CHAT.think && (
        <Message
          from="assistant"
          author="Conch"
          status={at < CHAT.answerDone ? 'streaming' : 'complete'}
        >
          <div className={styles.reply}>
            {at < CHAT.tool && <ThinkingIndicator size="sm" label="Reading the history" />}
            {at >= CHAT.tool && (
              <ToolCall
                name="Bash"
                summary="git log --since=monday --oneline"
                status={at < CHAT.toolDone ? 'running' : 'success'}
                duration={1_400}
              />
            )}
            {at >= CHAT.answer && (
              <StreamingText
                as="p"
                text={arrived(ANSWER, at, CHAT.answer, CHAT.answerDone)}
                streaming={at < CHAT.answerDone}
              />
            )}
          </div>
        </Message>
      )}
      {at >= CHAT.askAgain && (
        <Message from="user">I’m about to board. Can you keep going offline?</Message>
      )}
      {at >= CHAT.routed && (
        <RoutedNote reason="offline">
          You’re offline, so {provider('ollama')?.name ?? 'the model on this computer'} answered.
        </RoutedNote>
      )}
      {at >= CHAT.thinkAgain && (
        <Message
          from="assistant"
          author="Conch"
          status={at < CHAT.answerAgainDone ? 'streaming' : 'complete'}
        >
          <div className={styles.reply}>
            {at < CHAT.answerAgain && <ThinkingIndicator size="sm" label="Picking up the thread" />}
            {at >= CHAT.answerAgain && (
              <StreamingText
                as="p"
                text={arrived(ANSWER_AGAIN, at, CHAT.answerAgain, CHAT.answerAgainDone)}
                streaming={at < CHAT.answerAgainDone}
              />
            )}
          </div>
        </Message>
      )}
    </div>
  );
}

export function ChatDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(CHAT.end, inView);
  const speaker = at >= CHAT.routed ? 'ollama' : 'claude-code';
  const working =
    (at >= CHAT.think && at < CHAT.answerDone) ||
    (at >= CHAT.thinkAgain && at < CHAT.answerAgainDone);

  return (
    <div ref={ref}>
      <Stage
        label="Conch answering a question with Claude Code, then carrying on with the model on this computer when the internet goes"
        tide
        alive={working}
        align="end"
        bar={
          <>
            <Speaker id={speaker} />
            <Badge size="sm" tone={working ? 'accent' : 'neutral'} dot={working ? 'pulse' : true}>
              {working ? 'Working' : 'Ready'}
            </Badge>
          </>
        }
      >
        {/* The window is as tall as the whole chat from the start: it fills, it never grows. */}
        <Steady align="end" holds={[<Transcript key="end" at={CHAT.end} />]}>
          <Transcript at={at} />
        </Steady>
      </Stage>
    </div>
  );
}

// ── Every provider: the one answering changes, the list doesn't ─────────────

const TURN = 2_400;

export function ProvidersDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const all = reference.providers;
  const at = useClock(TURN * all.length, inView);
  // Standing still, the first one answers.
  const speaking = Math.floor(at / TURN) % all.length;

  return (
    <div ref={ref}>
      <Stage
        label={`The providers Conch drives (${all.map((p) => p.name).join(', ')}), each answering in turn`}
        bar={
          <Text as="span" size="sm" tone="muted">
            Who answers this chat
          </Text>
        }
        bare
      >
        <ul className={styles.providers}>
          {all.map((p, index) => (
            <li key={p.id} data-speaking={index === speaking || undefined}>
              <IntegrationLogo brand={p.id} name={p.name} color={p.color} size="sm" decorative />
              <span className={styles.providerWords}>
                <Text as="span" weight="medium">
                  {p.name}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  {p.tagline}
                </Text>
              </span>
              {index === speaking ? (
                <Badge size="sm" tone="accent" dot="pulse">
                  Answering
                </Badge>
              ) : (
                <Badge size="sm" tone="neutral">
                  Ready
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </Stage>
    </div>
  );
}

// ── Safe hands: it read a page, so the click that spends money asks first ────

const ASK = { read: 600, ask: 2_200, press: 5_600, end: 9_000 } as const;

function Approval({ at }: { at: number }) {
  return (
    <div className={styles.column}>
      {at >= ASK.read && <TaintNotice read="staylight.example" />}
      {at >= ASK.ask && (
        <BrowserApproval
          kind="high-stakes"
          site="staylight.example"
          action="Click “Book and pay”"
          shot={checkout}
          box={checkoutPay}
          decision={at >= ASK.press ? 'allow' : undefined}
          onDecide={noop}
        />
      )}
    </div>
  );
}

export function ApprovalDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  // Standing still, it shows the question: that is the point of the picture.
  const at = useClock(ASK.end, inView, ASK.press - 1);

  return (
    <div ref={ref}>
      <Stage
        label="After reading a web page, Conch asks before pressing the button that pays, and waits for the answer"
        alive={at >= ASK.ask && at < ASK.press}
        align="end"
      >
        <Steady
          align="end"
          holds={[<Approval key="ask" at={ASK.ask} />, <Approval key="end" at={ASK.end} />]}
        >
          <Approval at={at} />
        </Steady>
      </Stage>
    </div>
  );
}

// ── The browser: the page, live, with the pearl where it's about to click ───

const STEPS = [
  { label: 'Clicking “Search”', box: hotelsSearch, frame: hotels, title: 'Stays in Lisbon' },
  {
    label: 'Clicking “See availability”',
    box: hotelsSecond,
    frame: hotels,
    title: 'Stays in Lisbon',
  },
  { label: 'Reading the total', box: checkoutPay, frame: checkout, title: 'Review your stay' },
] as const;
const STEP = 2_600;

export function BrowserDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(STEP * STEPS.length, inView, STEP * 1.5);
  const index = Math.min(STEPS.length - 1, Math.floor(at / STEP));
  const step = STEPS[index] ?? STEPS[0];

  return (
    <div ref={ref}>
      <Stage
        label="Conch’s own browser on a hotel site, with a small pearl gliding to the button it is about to press"
        bare
      >
        <BrowserWindow
          className={styles.browser}
          phase="running"
          frame={step.frame}
          tab={{ url: 'https://staylight.example/lisbon', title: step.title, control: 'agent' }}
          action={{ key: index, action: 'click', label: step.label, box: step.box }}
        />
      </Stage>
    </div>
  );
}

// ── In your pocket: asked in Telegram, approved in Telegram ─────────────────

const PHONE = { ask: 500, question: 2_000, allow: 4_800, done: 6_000, end: 10_000 } as const;

function Phone({ at }: { at: number }) {
  const telegram = channel('telegram');
  const messages: HandsetMessage[] = [
    { id: 'ask', from: 'you', text: 'Restart the staging server.' },
    {
      id: 'question',
      from: 'them',
      text:
        at >= PHONE.allow ? (
          <>
            Run <code>systemctl restart staging</code>? Allowed.
          </>
        ) : (
          <>
            Run <code>systemctl restart staging</code>?
          </>
        ),
      buttons:
        at >= PHONE.allow
          ? undefined
          : [
              { label: 'Allow', tone: 'primary' },
              { label: 'Don’t allow', tone: 'danger' },
            ],
    },
    { id: 'done', from: 'them', text: 'Done. It’s back up, and the health check passes.' },
  ];
  const shown = at >= PHONE.done ? 3 : at >= PHONE.question ? 2 : at >= PHONE.ask ? 1 : 0;

  return (
    <Handset
      label="Your assistant in Telegram asking before it runs a command, with Allow and Don’t allow under the question"
      brand="telegram"
      color={telegram?.color}
      title="Conch"
      subtitle="bot"
      alive={at >= PHONE.question && at < PHONE.allow}
      typing={
        (at >= PHONE.ask + 600 && at < PHONE.question) || (at >= PHONE.allow && at < PHONE.done)
      }
      messages={messages.slice(0, shown)}
      footer={<Handset.Composer />}
    />
  );
}

export function PhoneDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(PHONE.end, inView, PHONE.allow - 1);

  return (
    <div ref={ref} className={styles.phone}>
      <Steady
        holds={[
          <Phone key="question" at={PHONE.question} />,
          <Phone key="allow" at={PHONE.allow} />,
          <Phone key="end" at={PHONE.end} />,
        ]}
      >
        <Phone at={at} />
      </Steady>
    </div>
  );
}

// ── The smaller pictures, for the grid ──────────────────────────────────────

const MEMORIES = [
  { kind: 'preference', text: 'Likes the morning briefing short: three lines, no greeting.' },
  { kind: 'person', text: 'Sam leads the release. Ask her before changing the date.' },
  { kind: 'project', text: 'The backup format changed in October. Old files still restore.' },
] as const;

function Memories({ shown }: { shown: number }) {
  return (
    <MemoryList>
      {MEMORIES.slice(0, shown).map((memory, i) => (
        <MemoryItem
          key={memory.text}
          source="agent"
          kind={memory.kind}
          time={i === shown - 1 ? 'Just now' : 'Earlier'}
        >
          {memory.text}
        </MemoryItem>
      ))}
    </MemoryList>
  );
}

export function MemoryDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(9_000, inView);
  const shown = at >= 4_200 ? 3 : at >= 2_000 ? 2 : 1;
  return (
    <div ref={ref}>
      <Steady holds={[<Memories key="all" shown={MEMORIES.length} />]}>
        <Memories shown={shown} />
      </Steady>
    </div>
  );
}

const EDIT = `@@ -8,4 +8,5 @@ export function header(backup: Backup) {
   return {
-    version: 1,
+    version: 2,
+    sealed: seal(backup.files),
     createdAt: backup.createdAt,
   };`;

const CHANGED = [
  { path: 'src/backup/format.ts', kind: 'changed' },
  { path: 'src/backup/format.test.ts', kind: 'created' },
  { path: 'notes/old-format.md', kind: 'deleted' },
] as const;

function Changes({ undone }: { undone: boolean }) {
  return (
    <div className={styles.column}>
      <ToolCall name="Edit" summary="src/backup/format.ts" duration={310} defaultOpen>
        <Diff diff={EDIT} header={false} />
      </ToolCall>
      <FilesChanged
        files={[...CHANGED]}
        state={undone ? 'undone' : 'applied'}
        onUndo={noop}
        onRedo={noop}
      />
    </div>
  );
}

export function UndoDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(7_000, inView, 0);
  // Changed, put back, and (as the loop comes round) changed again.
  const undone = at >= 3_600 && at < 7_000;
  return (
    <div ref={ref}>
      <Steady holds={[<Changes key="applied" undone={false} />, <Changes key="undone" undone />]}>
        <Changes undone={undone} />
      </Steady>
    </div>
  );
}

const SPENDING = {
  type: 'bar',
  title: 'Commits by week',
  labels: ['1 Sep', '8 Sep', '15 Sep', '22 Sep', '29 Sep'],
  series: [{ name: 'Commits', values: [14, 22, 31, 27, 44] }],
} as const;

const COMMITS = {
  ...SPENDING,
  labels: [...SPENDING.labels],
  series: [{ name: 'Commits', values: [...SPENDING.series[0].values] }],
};

/**
 * The one picture that isn't a picture: it is the chart itself, so Chart and
 * Table can be pressed.
 */
export function ChartDemo() {
  return (
    // Room for the table as well, so choosing it moves nothing.
    <Steady
      holds={[<ArtifactChart key="table" chart={COMMITS} height={191} defaultView="table" />]}
    >
      <ArtifactChart chart={COMMITS} height={191} />
    </Steady>
  );
}

const TASK = { second: 2_200, third: 4_400, done: 6_600, end: 10_000 } as const;

const TASK_STEPS = [
  'Read the failing test',
  'Found the off-by-one in the pager',
  'Ran the suite: 46 pass',
];

function Task({ at }: { at: number }) {
  const count = at >= TASK.third ? 3 : at >= TASK.second ? 2 : 1;
  const done = at >= TASK.done;
  return (
    <TaskCard
      title="Fix the flaky pager test"
      kind="background"
      variant="compact"
      status={done ? 'done' : 'running'}
      current={done ? undefined : TASK_STEPS[count - 1]}
      steps={TASK_STEPS.slice(0, count)}
      summary={done ? 'Fixed. The pager counted one page too many.' : undefined}
      onOpen={noop}
      onStop={done ? undefined : noop}
    />
  );
}

export function TaskDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  const at = useClock(TASK.end, inView);
  return (
    <div ref={ref}>
      <Steady
        align="end"
        holds={[<Task key="third" at={TASK.third} />, <Task key="done" at={TASK.done} />]}
      >
        <Task at={at} />
      </Steady>
    </div>
  );
}

function Routine({ on }: { on: boolean }) {
  return (
    <RoutineCard
      variant="proposal"
      title="Morning briefing"
      summary="What’s on my calendar, and anything urgent in my inbox."
      scheduleText="Every weekday at 8:00 AM"
      status={on ? 'active' : 'draft'}
      icon={<CalendarClock />}
      onActivate={noop}
      onTryNow={noop}
      onEdit={noop}
      onDismiss={noop}
    />
  );
}

export function RoutineDemo() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, margin: '0px' });
  // Standing still, it shows the draft: the question is the picture.
  const at = useClock(8_000, inView, 0);
  return (
    <div ref={ref}>
      {/* Turned on, the card loses its buttons: the room they took stays. */}
      <Steady align="end" holds={[<Routine key="draft" on={false} />, <Routine key="on" on />]}>
        <Routine on={at >= 3_600} />
      </Steady>
    </div>
  );
}

/** Three things Conch really says after mending itself (the words are the server's own). */
const HEALED = [
  'Conch stopped unexpectedly, so it started itself again.',
  'The browser closed mid-step; Conch restarted it and carried on.',
  'There was no browser on this computer, so Conch downloaded Chromium.',
];
const WHEN = ['Just now', 'This morning', 'Yesterday'];

export function HealedDemo() {
  return (
    <HealedNotes
      bare
      notes={HEALED.map((message, i) => ({ at: i, message }))}
      formatTime={(at) => WHEN[at] ?? ''}
    />
  );
}
