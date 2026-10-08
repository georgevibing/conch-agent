# Nacre — design language

> _Nacre_ (mother-of-pearl) is the iridescent layer a mollusc builds inside its shell:
> thousands of translucent platelets that turn plain light into shifting colour.
> It's calm, solid, and alive when it moves. That's the brief for every pixel of Conch.

## Principles

1. **Calm by default, alive on contact.** At rest the interface is quiet porcelain.
   Light only blooms where your attention is — under the pointer, around focus, while
   the agent is working.
2. **Solid, not glass.** Surfaces are opaque. Depth comes from layered, tinted
   shadows and a glazed top edge, never from blur. This keeps text contrast high and
   rendering cheap.
3. **Physical motion.** Everything moves on springs. Things arrive by _surfacing_
   (rising out of soft focus); they leave faster than they came.
4. **One accent, many hues.** A single accent colour carries meaning; iridescence is
   decoration and never encodes state.
5. **Accessible is the baseline.** WCAG 2.2 AA contrast, full keyboard paths, visible
   focus, 44 px touch targets at `lg`, and every effect degrades under
   `prefers-reduced-motion` or `lustre = 0`.

## The Lustre material

Nacre's signature. Any element opts in with `data-lustre`; one delegated pointer
listener (`installLustre`, installed by `NacreProvider`) writes CSS variables, so no
React re-renders happen on pointer move.

| Layer         | Pseudo                | What you see                                                                                                                              |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rim           | `::before`            | A 1 px pearl edge. A conic spectrum rotates with the pointer's angle around the element, so the edge "catches the light" as you orbit it. |
| Sheen         | `::after`             | A soft iridescent spotlight under the pointer (thin-film banding perpendicular to the light direction).                                   |
| Tide ring     | `::after`             | On press, a ring of pearl light ripples out from the press point (animated `--nc-bloom`).                                                 |
| Ambient orbit | `data-lustre-ambient` | The rim becomes a slowly orbiting band — used when something is _alive_, e.g. the composer while the assistant is working.                |

Knobs per component: `--nc-rim-rest`, `--nc-rim-hover`, `--nc-sheen-size`,
`--nc-sheen-hover`, `--nc-sheen-blend`. Global intensity: `--nc-lustre` (0–1), set
from `NacreProvider lustre={…}`.

Lustre is for things you press: cards, buttons, dialogs. A page is canvas, not a
card, so nothing that fills the window carries it (a `full` Dialog doesn't): a
press on empty space never ripples the screen.

The pearl spectrum (`--nc-pearl-1…5`) is an accent-tinted pearl followed by aqua,
periwinkle, lilac and rose, interpolated in Oklab so transitions pass through
pearly near-white instead of mud.

## Colour

- Authored in **OKLCH**. Every scale is computed in CSS from knobs:
  `--nc-accent-h`, `--nc-accent-c`, `--nc-neutral-h`, `--nc-neutral-c`.
- 12-step scales (`--nc-gray-1…12`, `--nc-accent-1…12`) with Radix-style semantics:
  1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solids, 11–12 text.
- Light (**Pearl**) and dark (**Abalone**) resolved with `light-dark()` against the
  root's `color-scheme`, so there is one token definition per value.
- Accent presets: `coral` (default), `amber`, `kelp`, `lagoon`, `tide`, `iris`,
  `orchid`, `graphite`. Any `{ hue, chroma }` works.
- Neutral tints: `porcelain` (warm, default), `slate`, `tinted` (follows accent), `pure`.
  A tint may carry its own dark side (`--nc-neutral-dark-h`/`-c`): porcelain turns
  to a cold graphite in the dark, since a warm grey that dark reads as brown and
  the cool ground sets off the coral text.

<!-- conch:accents -->

- Semantic tokens are what components use: `--nc-canvas`, `--nc-surface`,
  `--nc-surface-overlay`, `--nc-surface-sunken`, `--nc-text`, `--nc-text-muted`,
  `--nc-border`, `--nc-ring`, `--nc-wash-1…3` (translucent hover/press tints).

## Type

- **Geist** (variable) for UI, **Geist Mono** for code, **Instrument Serif** for
  editorial display moments (`<Heading display>` — empty states, onboarding).
- **The reader's size is the root.** `<html>` keeps the browser's own size, so
  `1rem` is 16px (or more, if someone chose more) and every token is the size it's
  written as. UI text is 14px from the `<body>` (`--nc-text-md`). Never set a size on
  the root.
- **Two kinds of text.** _UI_ text is for glancing at: rows, labels, settings, the
  sidebar, cards and tool rows, at `--nc-text-sm`/`md` (13/14px), with meta lines at
  `--nc-text-xs` (12px). These stay dense. _Reading_ text is for reading through: a
  reply, your own message, the composer you write it in, and a document. It uses
  `--nc-text-read` (16px) with `--nc-leading-read` (1.6), at most
  `--nc-measure-read` (70ch) wide. A long-form page (the documentation, `Prose
size="lg"`) uses `--nc-text-read-lg` (17px). Code beside reading text is
  `--nc-text-code` (14px), since a mono reads large.
- **The chat is one size.** `--nc-chat-text`/`--nc-chat-leading` set a reply, the
  bubble and the composer, so what you type is the size it will be read at. A reply
  reads 16 / 13 / 12: the words, the steps, the when. Each level is about 1.2× the
  next, so they never blur together. The 46rem column holds about 65 characters a
  line.
- **Headings** in prose are em steps over the body (1.6 / 1.3 / 1.1), set
  `--nc-leading-tight`/`snug`. Numbers that change or line up (times, counts,
  durations, costs) use `font-variant-numeric: tabular-nums`.
- Tracking tightens as size grows (optical sizing by hand).
- `text-wrap: pretty` for body and `balance` for headings.
- Why, and what it was before: [ADR 0116](../adr/0116-type-at-the-size-it-says.md).

## Space, size, shape

- 4 px grid: `--nc-space-*`.
- Every page (Apps, Routines, Tasks, Settings…) is one centred column at
  `--nc-page-width` (64rem), drawn with `Page`: switching pages, nothing jumps
  sideways. The pane around it scrolls from edge to edge, so the scrollbar sits
  at the window's side, not beside the column.
- Control heights: 24 / 30 / 36 / 44 px (`xs`…`lg`).
- Radii scale with `--nc-radius-scale`. Where supported, corners use
  `corner-shape: squircle` (continuous curvature) with radii re-tuned so the optical
  size is unchanged.

### Search

The command palette holds its size while results filter or a preview loads. Its
search field and keyboard hints keep their height; results and previews scroll
inside the space between them. The large palette leaves room for both panes,
while narrow screens show results alone. Its height fits the visible viewport,
including the space above a phone’s keyboard.

### Where you are

A page inside a page (Settings → Memory → What Conch knows, a provider's own
page) says where it is with one `Breadcrumb` above it: each place above is a
step back to it, the last is the page you're on. Never a stack of back buttons,
and never a trail for a page with nothing above it: its heading is enough. Short
of room, the places above give way to an ellipsis first. In a narrow window, a
page's own places float in from the side as a `Sheet`, like the chats do, opened
from the menu button beside the trail; the way out (‹ Chats) is at their top.
They fold away at the width the window's own sidebar does — one shared
breakpoint (`apps/web/src/app/widths.ts`), so there's never a band where one
has folded and the other hasn't. Everywhere else (an app's page, a skill's, a
routine's, a password on a phone) the trail is the window's header, in place of
the place's name and on every width (`usePageTrail` in
`apps/web/src/app/trail.tsx`): Apps › Gmail. Arriving there by a press puts the
focus on the page's name in the trail, so the way back is one Shift+Tab away;
stepping back out — or choosing a place from the menu — puts it on the place's
heading.

### Settings

Settings is the calmest part of Conch: most people should be able to read a
place in a glance and never change a thing.

- **One place, one page.** A place opens as a heading, a line of plain words
  under it, and a short list of rows — a switch with the few words it needs, a
  `Field`, or one row that leads to a page of its own. Never a paragraph where a
  line will do, and never the same thing said twice (a Nacre pattern that
  explains itself keeps its words; the section above it stays quiet).
- **Everything in sight, unless the page is dense.** A short page shows all it
  holds, compact: a rare switch is one more row, a rare action one line with its
  button beside it — never a fold that hides one or two things and leaves the
  page emptier. Only a place with a lot in it (Models, Security) keeps what
  almost nobody changes at its foot, under a hairline, behind the word
  **Advanced** (`SettingsAdvanced`). Inside it are the page's own sections,
  spaced as they are above, so opening it only makes the page longer — never a
  second page, never a dialog. What people come to a place for (how a terminal
  looks, which voice) is never folded. Nothing is lost: ⌘K finds what's in
  there by name (`ADVANCED_FOCUS`, `useAdvanced`), and the place opens with its
  Advanced already open, as a repair's fix does.
- **Choices under the switch they belong to.** A choice that only means
  something while a switch is on (what notifications are about) sits beneath
  it, indented under a hairline, and opens with it (`Collapsible`) — folded
  away while it's off, never shown greyed out. Each is a short label, at most a
  few words of hint.
- **The other way in, quietly.** A page whose main way is a press (Providers:
  sign in) keeps the way for the few — an API key — as one muted line at its
  foot, **Use an API key instead**, that opens to a single field in place.
- **The places, as the chats are.** The list beside the page (a `Sheet` on a
  phone, like the chat list) reads like the sidebar: one left edge for the way
  back, the page's name, every group's label and every row's mark — a label sits
  flush over its rows, never indented to their names. The place you're on wears the sidebar's soft wash, gliding
  from row to row — not a card lifted off the list, which at a row's height
  reads as a box to type in. A thumb gets 44 px rows and the size a phone
  reads, and the list keeps room at its feet for the phone's home bar.

## Elevation

`--nc-elevation-0…4`: stacked tight + ambient shadows tinted with the neutral hue,
plus `--nc-glaze-edge`, a 1 px inner top highlight that makes surfaces read as glazed
porcelain.

## Motion

| Token                         | Use                                             |
| ----------------------------- | ----------------------------------------------- |
| `--nc-spring-snappy` (400 ms) | Controls, toggles, press release                |
| `--nc-spring-soft` (620 ms)   | Surfaces entering, layout shifts                |
| `--nc-spring-bouncy` (780 ms) | Small confirmations (check-marks, switch thumb) |
| `--nc-ease-out` + durations   | Colour, opacity, shadow                         |

**Controls move when people move them.** A switch, a checkbox or a segmented
control arrives already in its state, and a value that changes by itself —
data that loaded, a save undone, another device's change — is simply there.
Only a person's press, click or key plays the spring (`useMotionFromPeople`
sets `data-moving`, which the control's CSS needs before it transitions at
all), including a change that lands a moment after the press, once a
permission prompt or a save has answered. A `Collapsible` that's open from the
start arrives open too; only opening it later plays the reveal. And a screen
never shows a control in a placeholder state while its value loads: it waits
for the value (a `Skeleton` in its place), or uses the one it already has.

Springs are real damped-spring curves baked into CSS `linear()`; the same physics are
exported for JS as `springs` from `@conch/nacre` for the `motion` library. Keyframes:
`nc-surface-in` / `nc-surface-out` (rise + un-blur), `nc-fade-*`, `nc-shimmer`,
`nc-breathe`, `nc-spin`, `nc-settle`. All durations collapse to ~0 under reduced motion.

### Panels: one motion, "glint"

Every panel that appears and leaves — the browser and what the assistant made beside
the chat, the terminal under it, the sidebar, every `Sheet` — moves the same way. It
surfaces about 24 px from the edge it lives on with a touch of spring
(`--nc-panel-in-duration`, 320 ms, `--nc-spring-snappy`). As it settles, a band of
pearl light (`--nc-pearl-*`) crosses it in the direction it travelled
(`--nc-panel-glint-duration`, 620 ms), the way light runs across the inside of a
shell as you turn it. Leaving is quicker (`--nc-panel-out-duration`, 200 ms,
`--nc-ease-in`): it sinks back toward its edge and the light runs back, fainter. Only
transform and opacity move. `lustre = 0` takes the light away; reduced motion makes
it instant.

Docked panels use `PanelPresence` (`open`, `side`, plus `keepMounted` and
`appear={false}` for a panel that keeps its place, like the sidebar). It keeps what
was in the panel on screen until the exit has played. A `Sheet` carries the same
glint and timing. For a panel drawn as a card inside padding, set
`--nc-glint-inset` / `--nc-glint-radius` so only the card lights up. Don't give a
panel its own entrance keyframes.

### Waiting and arriving (chat)

The wait before an answer should feel like progress, not a spinner, and the answer
should flow, never stutter.

- **Anticipation** (`ThinkingIndicator`). Verbs picked for the request ("Tracing the
  problem" for a bug, "Finding the words" for an email) take turns. Each one surfaces
  letter by letter while a slow tide of colour washes across it, and three pearls rise
  in place of an ellipsis. While the model reasons, the newest words of that reasoning
  drift past underneath in italic serif. The verb comes from the clock, so a remount
  continues where the last one left off. Screen readers hear one stable label.
- **The face** (`AgentAvatar`, Conch's own `MessageMark`). While the speaker works —
  words or steps — the conch spiral draws itself from the centre, flows away and grows
  again, and light orbits the rim of every look. When the answer lands, one ring of
  light passes around it.
- **Arrival** (`useSmoothText` + `revealWords`). Bursty deltas are paced into an even
  flow of _whole words_, at a speed proportional to the backlog. Each fresh word
  _settles_ (`[data-nc-fresh]` → `nc-settle`): it un-blurs and dries from the accent
  to the text colour, like wet ink. Half-arrived Markdown is closed so raw `**` never
  flashes. The wait holds its place and the reply replaces it in place, with no jump.

### Choosing a folder

A browser can't hand a page a real path, and a phone can't see a dialog on the
computer across the room, so a folder (or a file) on the computer is chosen in
`FolderBrowser`: a dialog that holds its size while you walk, the places people
start from beside it (a row to swipe on a phone), the trail to where you are
above the folders, filtered as you type. A folder is one press to go into;
**Choose** takes the one you're in, as a Mac's Open dialog does. A new folder is
made where you are, in the list, never a second dialog. Typing a path is one
press away and never the first thing offered, with suggestions as you type and
a sentence for what's wrong. In the desktop app the system's own Open dialog
does all of this instead.

### Passwords

Secrets are dots until you ask, and go back to dots by themselves
(`VaultFieldRow`): after thirty seconds, or when you switch away. A login wears
its site's monogram, never a favicon fetched from the web (that would tell the
site you have an account; a chat's site chips do get icons, from the gateway,
ADR 0103). Other kinds wear a glyph tinted by kind. A
one-time code is split for reading ("123 456") beside a ring that empties and
turns amber in its last five seconds (`TotpCode`). The generator shows its
password as you change it, digits and symbols coloured so it can be read back
(`PasswordGenerator`). The Security check (`VaultHealth`) leads with what
matters most, every tile a filter; with nothing to say, it says the passwords
look good.

The list never makes anyone wait. Only the rows in view are drawn
(`VirtualList`), so a vault of a thousand items scrolls, searches and selects
like one of twenty. A search marks what matched in each title (`titleRanges`).
A long list has a quiet heading over each group (`VaultListHeading`), held at
the top while its rows pass. With one password manager connected, its mark is
left off the rows (`sourceMark`): the same badge a thousand times says nothing.
What is still on its way holds its exact place (`VaultRowSkeleton`,
`VaultFieldsSkeleton`), and waits a beat before showing, so a quick answer
never flashes.

### Attachments (chat)

A paste, a picture and a PDF each look like what they are before anyone opens
them (`AttachmentCard`). A paste is a slip of paper set in type, with its first
lines fading out; a picture is its own thumbnail; every other file gets a glyph
and a badge tinted by family (PDF red, sheets green, documents blue, slides amber,
archives grey). In the composer every card is the same small size, in one row
that scrolls sideways; in the transcript pictures show their true shape. Cards
lift on hover, breathe while uploading (a ring in the corner, or the middle of a
picture), turn red with a Retry when they fail, and wear a small amber dot when
the chosen model can't use them. `AttachmentPreview` is the closer look;
`DropOverlay` dims the chat and gathers a pearl halo while files are dragged over.

### Who is speaking (chat)

A reply uses the whole column. Nothing is set in beside a face, so on a phone the
words get every pixel the column has.

- **The speaker line** (`MessageSpeaker`, drawn by `Message`). One compact line over
  the reply: the agent's face at `--nc-chat-speaker` (20 px), its name in a small
  semibold, and after it, quietly, the model that answered and the time (`meta`,
  `timestamp`) — shown on hover or focus where there's a pointer, always on touch.
  The name is the turn's heading (“Conch said:”), so a screen reader hears it once
  per turn, never per paragraph; the face is decoration.
- **Once per turn, at its top.** Everything the assistant did in a turn is one reply
  under one line, whatever it did first: a turn that opens with a tool row has its
  speaker line above that row. The same voice again with nothing of yours (or a line
  across the chat, `/clear`, a summary) between — it carried on after its own card,
  or picked up after a restart — is `continued`: no second line, still named once
  for assistive tech.
- **The face** (`AgentAvatar`). Agents are rounded tiles, people (`Avatar`) circles,
  so the two are never mistaken. `avatar` is the protocol's `Agent.avatar` — a preset
  (`{ kind: 'preset', id, color? }`: its artwork on a glazed tile of one of the app
  colours; `shell` in its own colour is Conch's mark in the accent) or a picture
  (`{ kind: 'image', url }`) — or, for short, a preset's id or a picture's address.
  A picture shows the name's initial on its own tint until it has loaded, and keeps
  it if it can't; no avatar, or a preset nobody draws, is Conch's mark. Nacre draws
  every preset the protocol names (`AGENT_AVATAR_ART`); the web app hands its own
  artwork to `AgentAvatarArtProvider` once, merged over Nacre's by id. The same
  component draws an agent anywhere else (a list of agents, a picker).
- **Another agent takes over** (`AgentChange`). A hairline across the column with
  the new face and one quiet sentence, “Atlas took over from Juniper”; replies from
  there carry its speaker line. Who a chat is with from its start is not a change,
  so it draws nothing.
- **Yours.** Your words are a bubble at the column's end, up to 85 % of it. Where
  there's a pointer and room, its time and Copy wait beside it, not under it, so
  your message is only as tall as its words.

### Who you talk to (agents)

Agents are people you meet, so they're shown as faces, never as rows of settings.

- **The wall** (`AgentGallery`). Every agent large, its name under it and what it's
  for in a quiet line, the default marked, and a **+** for another. A press opens it.
  Drag to change the order every picker shows (on a phone, hold first; Alt and an
  arrow from the keyboard); the others glide out of the way. Each face's ⋯ (or a
  right-click) holds the rest: make it the default, move it, delete it, with Undo.
- **Making one** (`AgentCard`, `AgentFacePicker`, `ToneChips`). One screen: the agent
  on one side as it's made — its name writing itself in, its face landing, its hello in
  its voice — and the three choices on the other. Everything else waits for its page.
- **Faces in even rows.** The cast is nine across where there's room and six where
  there isn't, never a straggler; the thirteen colours one row, or seven and six.
- **Saved where it changed.** An agent's page saves itself; "Saved" shows beside the
  part just changed, not at the top of a long page.
- **Undo is in reach.** Toasts sit on the top layer, over every dialog, and pressing one
  never closes the dialog under it.

### A reply and what belongs to it (chat)

A reply is one piece: its words, then everything that belongs to it (stories
of its steps, more words, a plan, a question, an offer, an artifact, what
changed, replies to send next), then its actions. `Message attached` holds those parts, so the hover
actions (Copy, Read aloud) come once, at the end, and never sit as an empty
row between the words and their card.

- **One step, one edge.** Each part sits `--nc-chat-step` under what's above
  it and starts where the words do: the column's edge (`--nc-chat-indent`, 0).
  Stories, task cards, thinking, plans, and the lines across the chat
  (`/clear`, a goal, a summary) all share that edge, on a phone as on a
  computer. A part reads `--nc-chat-flow-gap` and `--nc-chat-indent`, so the
  same rule fits in the transcript and inside a reply. The stories of one run
  of steps stack closer, a stack of their own (`StoryStack`).
- **One card.** Every card in a reply takes its shape from the `--nc-chat-card-*`
  tokens: radius, surface, ring with glaze and a soft shadow, padding, the
  1.75rem mark beside a small semibold title, and one width.
- **Folding.** A card done with folds away. One that can open again becomes a
  row like a tool's (`--nc-chat-row-*`). One that only says what happened
  becomes a line (`--nc-chat-note-*`). One that's dismissed closes the gap it
  sat in as it goes.

### Stories: what the assistant did (chat)

Steps are told, not listed (ADR 0103). A run of tool calls between two pieces of
the reply's words becomes one to three stories (`tellStories` cuts them, the same
in the gateway and the chat), each told at three depths, one press apart:

1. **The line** (`Story`). Its family's glyph, the headline, a quiet outcome
   after a dot ("Ran the server tests · 241 passed"), the faces of what it
   touched (`ChipStack`: favicons and photos, up to three, then "+N"), how many
   steps, and how long. While it runs, a `LiveLine` under it says the step at
   hand, or the provider's own narration in the reasoning trail's serif italic.
2. **The steps.** Opened, a thin timeline of each step in plain words, its
   outcome and its time, **Why?** beside it, and pills for what it looked at.
3. **The call.** A step opens once more to the exact call (`renderRaw`): input,
   output, diff. Nothing is ever hidden, only folded.

A long run keeps its latest few stories in view and folds the earlier ones into
one quiet line with their glyphs (`StoryStack`, four by default). At the end of
the turn, `WhatChanged` is one line ("Changed 4 files · committed · pushed to
main") that opens to each change, what others see or what costs money first,
with **Undo** where a change set can put it back. `AwayDigest` greets someone
back at a chat that kept working without them, a line per story, each a jump.
`TurnMeter` is the turn's tally: "1m 04s · 12 steps · $0.04 · 41.2k tokens".

**Copy.** Every line follows the same rules, whoever wrote it: past tense once
done, `-ing` while running; sentence case; 60 characters at most for a
headline; no jargon and no raw shell (the command is the subject, never the
words); the outcome over a count ("Fixed the login test", not "Ran 6 tools"),
and when a count is all there is, what was counted ("Read 6 files"). A model's
words are drawn as plain text only, never Markdown or links. Failing is calm: a
warm note and "Didn't work", never a red flood; a step put right says "Worked
on the second try"; a story going round in circles says so in a sentence, with
an hourglass, while there's time to step in.

**Glyphs.** One per family (`FamilyGlyph`), drawn on lucide's grid so they sit
with every other icon, each with exactly one part that moves while the work
runs: explore (a lens scans the page), edit (a pen writes), run (a cursor
blinks), verify (a shield's tick draws), ship (an arrow lifts from its tray),
research (the globe turns), browse (a pointer taps), connect (one of three
tiles breathes), make (a spark twinkles), plan (a line is ticked), delegate (a
paper plane flies), remember (a bookmark), other (three dots in turn). They're
decorative; the words say what happened. Once a story ends, its status lands
on the glyph's well as a badge, and a passing check glints once.

**Motion.** Only a story arriving in a live turn moves (`arriving`); history is
drawn still. A headline that changes, "Running" to "Ran" or the rules' words to
a small model's, morphs in place (`MorphText`): the words before the change
hold still, the rest rise out of the line and are gone (130ms) before the new
ones rise into it word by word (the last lands by 345ms), clipped to the line's
own box, so two texts never sit on one baseline and nothing around it moves. The live line reserves its height, coalesces
changes faster than the eye can read, and lets a band of light cross it while
the work goes on. A story is announced once when it starts and once when it
ends, never per step. Reduced motion stills all of it: no orbit, no glint, no
morph, the new words simply there.

**When a view stands alone.** What a step found (a `ToolView`: an agenda,
emails, files) is drawn under its step whenever the story is open
(`renderFound`), never only behind the raw call. When that view is the answer
(a story of one step that returned it, the day's agenda the person asked for),
it isn't folded away: it stays in sight under the line, as below.

### What a tool found (chat)

A tool's results are drawn under its row, inside the same surface, the way the
app itself would show them: `AgendaView` (days, a time column, a slim rail in
the calendar's colour, all-day bands, **Free**, a line for now), `MailList`,
`FileList` (a glyph tinted by kind, as attachments are) and `ChatMessages`.
Rows are as dense as the tool row, six at first with **Show all**. Everything is
plain text from outside, and only web links open, in a new tab. A row's next
step is quiet (Reply waits for the pointer) and only ever fills the composer.
An artifact's card shows a small, inert picture of a chart, table, diagram or
picture above its line; pressing anywhere still opens it.

### Making a picture (chat)

A picture being made is drawn where the picture will be (`ImageMaking`), never as
a tool row. The frame already has the picture's shape (its aspect ratio from the
request). Inside, a mesh of pearl light moves: five soft shapes, each on its own
loop and clock (17, 19, 23, 29, 31 beats, so it never repeats), a turning film of
`--nc-pearl-spectrum`, caustic veins and a slow hue drift, with a sheen that
crosses now and then and fine grain. Round the edge, two arcs of iridescent light
chase each other, with a soft bloom outside the frame. Only transform and opacity
move. Every inner layer is cut to the corners by one clip (`clip-path`, or the
squircle overflow clip where `corner-shape` exists): a rounded `overflow` alone
lets moving, blurred layers show square corners on Safari. How far it got sits in
a small pill on the frame: a ring that fills, the percent, and "about 12s left"
once there's enough to tell; with no number the ring just turns. A rough picture
from the service shows through, blurred, under the sheen. While its approval
waits, the light holds still. When it's ready it _develops_ (about a second): a
wave of light runs in from the edge while the picture sharpens out of the pearl
and the edge light flares once and goes, only when it arrived live; a picture
already there just shows. Then it rests as a quiet card: the picture, its name,
and one row of icon buttons: **Look closer**, **Download**, **Copy picture**,
**Change it** and **Details** (an info button). Details opens a quiet panel under
the card, on its edges: what was asked for, the model, who made it, the size, how
long it took, the cost; never a path or the raw call. Not made (you said no, it
failed, it was stopped) is a calm line with an image-off glyph on its first line,
never a tick; a long reason keeps to three lines there and is in full in Details.
Reduced motion keeps the light still (a resting mesh, the edge lit) and the
percent.

### Making a file (chat)

A file being made is drawn where the file will be (`FileMaking`), never as a
tool row or a story: the same family as a picture being made, suited to
documents. On a slow wash of pearl light tinted by the file's type, the file's
own shape draws itself: a page's heading and lines are written in, a sheet's
cells fill in a diagonal wave, slides stack from the back, papers drop into a
box for an archive, a window's blocks settle in for a web page, code lines are
written light on ink, a waveform breathes for audio. Two arcs of light go round
the edge, a sheen crosses now and then, the type's badge sits in the corner,
and a pill says how far it got and the step it's on ("Laying out pages"), or
its ring just turns. It surfaces after a breath (300 ms), since most files take
less, so nothing flashes. When it's ready, the picture of the file rises out
of the light once, only when it arrived live: its first page or slide (the
gateway's thumbnail; a PDF without one shows its first page in an inert
frame), its first rows or words set small, or, with nothing to show, its drawn
shape at rest as a cover with its badge. A web page is drawn as its title and
words, never run: what the assistant writes runs only in `SealedFrame`. Then
it rests as a card: the type's tile (PDF red, documents blue, sheets green,
tables teal, slides orange, Markdown violet, web pages azure, code indigo,
archives khaki, audio magenta, video rose), its name, one quiet line ("PDF ·
3 pages · 242 KB"), and **Look closer**, **Download**, **Copy link** (where it
has one), **Send to…** and **Details** in one row. Not made is the picture's
calm line, with a file glyph. A file on a message is a `FileTile`: the same
tile, name and line, small, with **Download**. Every layer bigger than the
card sits inside an `overflow: hidden` box and the edge light stays on the
edge, so a card never widens a phone's chat. Reduced motion draws the file
whole and still.

### The browser (chat)

The browser panel shows someone else's page, so Nacre stays out of its way. The page
is never tinted, blurred or framed with decoration. What Nacre adds is the
assistant's presence, and it wears the pearl:

- **The hand.** A small pearl cursor glides on `--nc-spring-soft` to the control
  it's about to touch. Its tip, not its middle, lands on the target, so the words
  stay readable. The control gets a pearl rim, and a click sends out one ripple.
- **The caption.** One line on the inverse surface at the foot of the page says what
  is happening, then fades. It never stacks or scrolls.
- **Your turn.** When the assistant waits for you, the page wears the orbiting pearl
  rim (the same ambient Lustre as the working composer), and the chat card does too.
  Waiting on a person is the only time the browser asks for attention.
- **Driving.** When you have the wheel, the screen gets a steady accent ring: clear,
  not animated.
- **The trail.** Steps become a filmstrip of thumbnails that grows as the agent
  works, with the running frame shimmering at the end.

The screen is a `<button>` (take over) with a hidden `<textarea>` for the keys, so it
stays within jsx-a11y strict and works with input methods and phone keyboards.

### Channels (setting up a chat app)

Connecting Telegram, Discord or Slack means going back and forth between
Conch and another app, so Nacre shows the other app. It never describes it.

- **The phone** (`Handset`). A porcelain handset shows the chat as it will
  look, with the app's colour as a whisper over the screen:
  - BotFather's reply, with the key to copy lit in pearl;
  - the Start button, called by one slow ring (the only moving thing on it);
  - the bot's first hello.

  Messages rise in one after another, once. Tints mix in Oklab, so a blue
  brand over warm porcelain stays blue and never turns lilac.

- **The page** (`PortalSketch`). For steps in a web portal (Discord's
  Developer Portal, Slack's app settings) it draws a sketch, not a
  screenshot: the address, the menu with the right item marked, and the
  button to press in the brand's colour, with the same calling ring.
- **The path** (`GuideSteps`). Numbered, because it is a sequence. Only the
  current step is open. A finished step folds to one line saying what was
  done, with a quiet **Change**, and the steps ahead wait in grey. The thread
  between the markers is solid behind you.
- **The key** (`KeyField`) is masked, with **Paste**, which reads the
  clipboard in one tap. It's checked as it lands, and the answer comes in the
  words of the app it belongs to.
- **The hello** (`HelloCard`). A QR code whose rim slowly orbits while it
  waits, beside the button that opens the app. Your hello turns it into a
  welcome with a settling check. `ChannelRequest` asks **Is this you?** in
  the display serif for the owner's first message, and is a plain card for
  anyone else.
- **Logos** come from Simple Icons, drawn white on the brand colour. Slack's
  brand rules forbid recolouring its mark, so it keeps its four colours on a
  porcelain tile (`brandArt`).

### The site (the front page)

The front page shows Conch with Conch. Nothing on it is a screenshot or a drawing of
the app: the pictures are the components themselves, playing a short script.

- **The picture** (`Stage`). A porcelain window holding real components, `inert` and
  named by one sentence, so it reads as a figure and nothing in it can be pressed. The
  hero's stage carries the pearl tide behind it; no other does. The tide fades out on
  its own and is only cut where the window ends, so it never shows an edge.
- **The claim** (`Scene`). One sentence in the display serif, the turn of it in italic
  accent, beside the picture that proves it. Words first in the page's order, always;
  the picture changes sides down the page.
- **The rest** (`Bento`). Smaller claims as tiles of uneven width, each with a small
  picture. A tile can be `live` instead: the real component, left in reach, where using
  it says more than watching it. `Facts` is a row of numbers in the serif; `Marquee`
  drifts a long list of logos (`LogoChip`) past, slowly, and stops under the pointer.
  `LogoRow` fits catalog marks into one row, reserving room for “+N more” when
  they exceed the available width. It measures again as the card or text changes size.
- **Holding still** (`Steady`). A picture that plays is the same size from its first
  moment to its last, at every width: the tallest moments lie under the one showing,
  unseen, and hold the room. Nothing on the page moves because a picture did.
- **The computer** (`OsMark`). Apple's, Linux's and Windows' marks at the size and
  colour of the text beside them, for a tab or a chip that says which computer.
- **The last word** (`Statement`). One centred sentence, large, with room around it.
- **Arriving** (`Reveal`). Things surface once as they scroll into view: a short rise
  out of a slight blur on `--nc-spring-soft`, staggered by `index`. With reduced motion
  everything is there from the start, and every script stands at its best moment.

Motion on the page is the app's motion (text streaming, a tool finishing, the pearl
cursor gliding) and little else. Nothing loops faster than a person reads.

### The terminal

The terminal is a tool you reach for, so it is plain, quick and quiet. It is a drawer
from the bottom of the main area, never a page or a modal. The chat above keeps its
place.

- **Its own palette.** `--nc-term-bg`, `--nc-term-fg`, `--nc-term-cursor`,
  `--nc-term-selection` and the 16 ANSI colours (`--nc-term-black…bright-white`) are
  tokens with `light-dark()` values. They're tuned so every colour is readable on
  the terminal background in both themes: light mode's "white" is a mid grey, and
  yellow is ochre. The cursor is the accent. xterm.js reads the tokens as computed
  colours and repaints when the theme or accent changes.
- **Type.** Geist Mono at 13 px (Settings offers 12 to 17), line height 1.2, a
  2 px bar cursor.
- **Tabs, not chrome.** A tab is an icon and a name. A shell that printed something
  while you weren't looking shows a small thinking pearl, and an ended one shows an
  "ended" badge. The close × is for pointers only; keyboards use <kbd>Delete</kbd>
  on the tab, or **Close this terminal**.
- **Notices, not dead ends.** Connecting, ended, "turned off" and "not on this
  device" are one centred card on the terminal's own background, with at most one
  solid button (the likely next step).
- **Touch.** On coarse pointers, a key row (Esc, Tab, Ctrl, arrows) sits under the
  screen. Ctrl is a toggle that applies to the next key.
- **The seam.** A horizontal `ResizeHandle` (`axis="y"`) sits on the drawer's top
  edge, so dragging it or using the arrow keys resizes the terminal.

### Conch apps (made, shared, added)

An app someone made should sit among Notion and GitHub as one of them
(ADR 0061), and adding one should feel like a small celebration, never a
form.

- **The icon** (`AppIcon`). One of Lucide's glyphs on one of thirteen colours
  (`--nc-app-*`), drawn as an integration's logo is: the same tile, corners,
  glaze and status dot. White on most colours, a deep glyph of the same hue on
  amber, yellow and lime. Nothing is fetched. `IntegrationCard` takes `app`
  for it and `badge` for **Made by you** (`AppMadeBadge`).
- **The shelf** (`AppDock`, `AppFolder`). Pinned pages sit at the top of the
  chat list under a quiet **Apps** heading, set exactly as the list's own group
  labels (`Pinned`, `Today`), so the sidebar reads as one list of parts. Four
  tiles to a row, two rows; the ones a person opens most are the ones in it.
  Past that the last place is **All apps**, a folder holding the rest in
  miniature on one glazed tile, wearing the most pressing dot inside it. It
  opens the way a folder opens on a phone: it grows out of that tile into a
  grid with a search at its head, and folds back into it. The search has the
  focus on a computer (a phone's keyboard waits for a tap), ↓ goes into the
  grid, the arrows move by tile and by row, a letter goes back to the search
  and lands in it, and choosing an app opens it and closes the folder.
- **What it can do** (`AppAbilityList`). One plain line each, in the
  protocol's own words (`appAbilities`), so the card, the app's page, the
  preview and the assistant's prompt say the same thing. What it reaches wears
  the accent; what it can't touch is said a shade quieter, as reassurance. An
  update's new reach comes first, on a calm amber wash (`AppChanges`).
- **The card** (`AppOffer`). Under the reply, never a dialog: icon, name, the
  assistant's one sentence, what it can do, its tools folded under a count,
  who it's from, and below a hairline, your part — the settings only you type
  (secrets masked, **Get it** beside the field) and **Add to my apps**.
  Added, the icon lands on the bouncy spring while one ring of pearl light
  passes out from it, and its examples wait as chips. Overtaken or declined,
  it folds to one quiet line.
- **Describe it** (`AppMaker`). The question in the display serif, one big
  box whose hint takes turns through things people really want, and idea
  chips. With reduced motion the hint holds still.
- **The page kit** (`pagekit.css`). Pages an app ships get the tokens and a
  classless base in a layer of their own, so plain HTML looks like Conch, and
  the page's own styles still win. Squircle corners, the accent and light or
  dark follow the person; nothing else is assumed.
  - A page has no React and no Nacre components: it is HTML in a sealed frame
    (ADR 0034), so the kit is the whole of its look. Every control the page
    can hold is drawn by the kit, the chrome the system would draw included —
    a select's chevron (two strokes in `--nc-text-subtle`, a `--nc-space-3`
    from the edge, with `--nc-space-8` of room so the words never reach it),
    the button inside `input[type="file"]`, a colour's swatch, a meter's bar.
    Nothing may be left to the platform: that is what makes one control in a
    page look foreign. `pagekit.test.ts` lists every control and fails when
    the kit stops drawing one.
  - `.nc-page-head` is a page's title: an icon that keeps its shape beside an
    `<h1>` and one quiet line, with the page's buttons at the end. Words
    inside a row (`.nc-row`, `.nc-toolbar`, `.nc-page-head`, `.nc-list > li`)
    drop the stacking margins they carry in a column, however deeply they're
    wrapped — a title in a `<div>` beside an icon used to sit a few pixels
    low, and no model could see it.
  - A page's own styles are for its own classes. `conchapps/check.ts` warns
    when a page restyles `button`, `select` or `input`, writes
    `appearance: none`, or builds a control out of `<div>`s; the maker's guide
    (`conchapps/guide.ts`) says the same in the words a model reads.

## Interaction checklist (every interactive component)

- [ ] Hover: subtle fill/shadow change, Lustre where appropriate, `@media (hover: hover)` only
- [ ] Press: scale ≈ 0.975 with instant ease-in, spring back on release
- [ ] Focus: `:focus-visible` 2 px accent outline, offset 2 px
- [ ] Disabled: 45 % opacity, `not-allowed` cursor, no Lustre
- [ ] Loading: keep dimensions, `aria-busy`
- [ ] Keyboard path identical to pointer path
- [ ] Reduced motion and `lustre = 0` both still look finished

## Form controls: never native pickers

Browser date, time, number and select pickers can't be themed, animate differently on
every platform, and ignore Lustre. Every form value goes through a Nacre control:

| Value          | Control       | Notes                                                                  |
| -------------- | ------------- | ---------------------------------------------------------------------- |
| Text           | `Input`       | `PasswordInput` for secrets (show/hide toggle)                         |
| One of a list  | `Select`      | `SegmentedControl` for 2–4 visible choices, `RadioGroup` for rich ones |
| Whole number   | `NumberField` | − / + with press-and-hold, arrows, Page Up/Down, clamps on commit      |
| Time of day    | `TimePicker`  | Typeable spin-button segments + a chip clock face; value `HH:MM`       |
| Calendar date  | `DatePicker`  | Speech-like trigger, keyboard grid, quick picks; value `YYYY-MM-DD`    |
| Range / amount | `Slider`      |                                                                        |
| A folder, file | `PathPicker`  | What Conch found; `FolderBrowser` for the rest, from any device        |

If a screen needs a value none of these cover, build the control in Nacre first (with
stories and an axe test). `<input type="date|time|number|range|color">` and bare
`<select>` never ship.

**On a phone, one size.** A phone zooms into any field typed in under 16px, so on a
touch screen every field is 16px to the browser (`base.css`). `Input` and `NumberField`
lay their text out at that and draw it at the well's own size (`--well-type`, the
well's size over 16px: 14/16 for `md`), so a field, its unit, `Field`'s label and a
`Select` beside it read on a phone as they do with a pointer. A field never looks a
size too big for the words around it. `Textarea` stays at 16px: it holds writing, like the composer.

**One exception, and only one: a Conch app's page.** It is HTML in a sealed frame with
no React in it, so there is no Nacre component to reach for, and a hand-rolled listbox
inside a page loses the keyboard, the screen reader and a phone's own wheel. There, the
native control _is_ the right answer — and the page kit dresses it to match the Nacre
component beside it (`Select`'s field, radius, chevron and focus halo). So: Conch's own
screens, never a native control; an app's page, always a native control and never a
hand-rolled one.
