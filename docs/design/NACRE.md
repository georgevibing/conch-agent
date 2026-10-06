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

<!-- conch:accents -->

- Semantic tokens are what components use: `--nc-canvas`, `--nc-surface`,
  `--nc-surface-overlay`, `--nc-surface-sunken`, `--nc-text`, `--nc-text-muted`,
  `--nc-border`, `--nc-ring`, `--nc-wash-1…3` (translucent hover/press tints).

## Type

- **Geist** (variable) for UI, **Geist Mono** for code, **Instrument Serif** for
  editorial display moments (`<Heading display>` — empty states, onboarding).
- Base size 14 px. Tracking tightens as size grows (optical sizing by hand).
- `text-wrap: pretty` for body and `balance` for headings.

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
of room, the places above give way to an ellipsis first. On a phone, a page's
own places float in from the side as a `Sheet`, like the chats do, opened from
the menu button beside the trail; the way out (‹ Chats) is at their top.
Everywhere else (an app's page, a skill's, a routine's, a password on a
phone) the trail is the window's header, in place of the place's name and on
every width (`usePageTrail` in `apps/web/src/app/trail.tsx`): Apps › Gmail.
Arriving there by a press puts the focus on the page's name in the trail, so
the way back is one Shift+Tab away; stepping back out puts it on the place's
heading.

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

Springs are real damped-spring curves baked into CSS `linear()`; the same physics are
exported for JS as `springs` from `@conch/nacre` for the `motion` library. Keyframes:
`nc-surface-in` / `nc-surface-out` (rise + un-blur), `nc-fade-*`, `nc-shimmer`,
`nc-breathe`, `nc-spin`, `nc-settle`. All durations collapse to ~0 under reduced motion.

### Waiting and arriving (chat)

The wait before an answer should feel like progress, not a spinner, and the answer
should flow, never stutter.

- **Anticipation** (`ThinkingIndicator`). Verbs picked for the request ("Tracing the
  problem" for a bug, "Finding the words" for an email) take turns. Each one surfaces
  letter by letter while a slow tide of colour washes across it, and three pearls rise
  in place of an ellipsis. While the model reasons, the newest words of that reasoning
  drift past underneath in italic serif. The verb comes from the clock, so a remount
  continues where the last one left off. Screen readers hear one stable label.
- **The mark** (`MessageMark`). While working, the conch spiral draws itself from the
  centre, flows away and grows again. When the answer lands, one ring of light passes
  around the rim.
- **Arrival** (`useSmoothText` + `revealWords`). Bursty deltas are paced into an even
  flow of _whole words_, at a speed proportional to the backlog. Each fresh word
  _settles_ (`[data-nc-fresh]` → `nc-settle`): it un-blurs and dries from the accent
  to the text colour, like wet ink. Half-arrived Markdown is closed so raw `**` never
  flashes. The wait holds its place and the reply replaces it in place, with no jump.

### Passwords

Secrets are dots until you ask, and go back to dots by themselves
(`VaultFieldRow`): after thirty seconds, or when you switch away. A login wears
its site's monogram, never a favicon fetched from the web (that would tell the
site you have an account). Other kinds wear a glyph tinted by kind. A
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

### A reply and what belongs to it (chat)

A reply is one piece: its words, then everything that belongs to it (tool
rows, more words, a plan, a question, an offer, an artifact, replies to send
next), then its actions. `Message attached` holds those parts, so the hover
actions (Copy, Read aloud) come once, at the end, and never sit as an empty
row between the words and their card.

- **One step.** Each part sits `--nc-chat-step` under what's above it and
  lines up with the words (`--nc-chat-inset`, the mark plus its gap). A part
  reads `--nc-chat-flow-gap` and `--nc-chat-indent`, so the same rule fits in
  the transcript and inside a reply. Tool rows stack closer, a stack of their
  own. On a phone parts reach back to the mark's edge.
- **One card.** Every card in a reply takes its shape from the `--nc-chat-card-*`
  tokens: radius, surface, ring with glaze and a soft shadow, padding, the
  1.75rem mark beside a small semibold title, and one width.
- **Folding.** A card done with folds away. One that can open again becomes a
  row like a tool's (`--nc-chat-row-*`). One that only says what happened
  becomes a line (`--nc-chat-note-*`). One that's dismissed closes the gap it
  sat in as it goes.

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

If a screen needs a value none of these cover, build the control in Nacre first (with
stories and an axe test). `<input type="date|time|number|range|color">` and bare
`<select>` never ship.
