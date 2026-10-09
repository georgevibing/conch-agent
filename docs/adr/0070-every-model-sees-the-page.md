# 0070 — Every model sees the page

- Status: accepted
- Date: 2026-10-04
- Goes with: [ADR 0014](./0014-browser.md) (the browser), [ADR 0017](./0017-attachments.md)
  (pictures you attach), [ADR 0023](./0023-offline-and-limits.md) (who answers a turn),
  [ADR 0050](./0050-models-that-cannot-use-apps.md) (what a model can do, said outright),
  [ADR 0053](./0053-more-providers.md) (the model APIs), [ADR 0055](./0055-long-chats-on-every-model.md)
  (the transcript Conch keeps)

## Context

`browser_screenshot` is how a model looks at a page when its text isn't enough: a chart, a map, a
canvas, a captcha, a layout. Its result carries the picture beside the words
(`HostToolResult.images`), and only Claude Code ever got it. Every other engine dropped it on the
way: the model APIs sent the words alone (`engines/api/engine.ts`, `chat.ts`), Codex's dynamic
tools answered with text only, and the door ACP programs reach Conch's tools through returned
text only. The screenshot's own words then told the model "if you can't see the image, use
browser_read", which a model that could see but was never sent the picture would believe.

Meanwhile most models people connect can see, and the ones that can't (DeepSeek, most small local
models, many servers of your own) have no way to know what's on a page that isn't text. Rivals
handle that by having a model that sees describe the picture to one that doesn't.

Sending a picture to a model that can't take one is a refused request (a 400, OpenRouter's 404
"No endpoints found that support image input", Ollama's 500 "image input is not supported"), and
what providers' lists say about sight ranges from exact (OpenRouter's `input_modalities`, Ollama's
`vision`, LM Studio's `capabilities.vision`, Mistral's `capabilities.vision`) to nothing at all
(OpenAI's, Groq's).

## Decision

**A tool's pictures reach every model that can see them, in its provider's own shape.**

- Anthropic's Messages API: an `image` block inside the tool's `tool_result`, after its text.
- The chat APIs (OpenAI's shape: OpenAI, OpenRouter, Gemini's compatibility endpoint, xAI,
  Mistral, Groq, the other presets, LM Studio, servers of your own): a `tool` message only carries
  text there, and OpenAI refuses an `image_url` part in one. So the tool messages are followed by
  one user message that carries their pictures as `image_url` parts and opens with words that say
  whose they are (`TOOL_PICTURES`). Those words, not a field, mark it: an extra field is refused
  by some providers, and the version before reads the message as an ordinary one (ADR 0051).
  `startsTurn` knows it, so it is the middle of a turn, never the start of one (ADR 0055).
- Mistral refuses a user message straight after a tool's ("Unexpected role 'user' after role
  'tool'"), so its preset says `toolThenUser: 'bridge'` and its request (only the request, never
  the transcript) gets a blank assistant turn between them, as Zed does.
- Ollama: the same following user message, with the pictures in its `images`.
- Codex's app server takes `inputImage` content items back from a dynamic tool (its own schema,
  `DynamicToolCallOutputContentItem`): the picture goes as a data URL after the text.
- The ACP door answers with MCP `image` content after the text, for a program that says it takes
  pictures (`promptCapabilities.image`).

Only the newest three tool pictures stay pictures in a transcript; older ones become a line that
says so (`ageToolPictures`). Every picture is sent, and paid for, on every request after it.
(Amended below: they go in batches.)

**Whether a model sees is said outright, per model.** Each wire's `seesFor(model)` answers: the
provider's list when it says (OpenRouter's modalities, Ollama's and LM Studio's capabilities,
Mistral's), else the provider's own rule (`ChatPreset.sees`: `true` for OpenAI and Gemini, a
pattern for Groq, xAI, Z.ai, Kimi and Qwen, nothing for DeepSeek, Cerebras, MiniMax and servers of
your own). Every Claude model sees. An unknown model counts as seeing only where its provider
takes pictures at all. The engine writes the answer into each model's `ModelInfo.images`, so the
picker, the attachment card and the describer all read the same thing.

**A model that turns out not to see heals by itself.** Every wire reads the refusal of a picture,
in each provider's words (`refusesImages`), as an `ApiError` of kind `images`. Before a word of the
answer, the engine marks the model blind for the rest of the session (in its list too), puts the
pictures in the transcript into words (the turn's own described, older ones a plain line), says so
in one notice, and asks once more. A second refusal is the turn's error.

**A model that can't see gets the pictures in words.** `withSight` wraps the tools of every engine
that runs Conch's tools itself (the model APIs, Codex, the ACP programs): a tool's pictures stay
for a model that sees, and become words for one that doesn't, asked on every call. The words come
from `TurnInput.describe`, which the conversation binds to the turn's provider and model, and the
`Describer` (`apps/server/src/vision/describer.ts`) answers:

- **Who looks.** Another model of the same provider that sees (its small one, else its cheapest),
  then any other ready provider with one, in the person's own order. Only engines whose `complete`
  takes pictures (`completeSees`: the model APIs and Claude Code) can be asked. The chat's own
  blind model never is.
- **A chat on this computer stays on it.** When the chat's model runs here (Ollama, LM Studio),
  only a model on this computer looks. A screenshot can show anything the person has open, and
  they chose a model that keeps it here.
- **What it says.** A compact description for a model that already has the page's accessibility
  snapshot: the layout in a sentence, the controls it can see with their labels and rough `x,y`
  pixel positions, and what only a picture shows (images, charts and their numbers, canvas, icons
  without labels, a captcha's characters). The picture is data: the describer reports text in it
  and never acts on it, and its words reach the model framed as the picture's content, not
  instructions.
- **Once per picture.** Descriptions are kept by the picture's SHA-256, in memory only (256 of
  them, least recently used out first), and callers asking for the same picture at once share one
  request. Nothing is written to disk.
- **What it costs.** A description's usage is added to the turn's (ADR 0057), so a routine's limit
  counts it.
- **When no model can look.** The tool result says so plainly, and what to use instead:
  `browser_read` for the page's text and controls, `browser_handoff` when only seeing will do.

A picture the person attached to a model that can't see goes the same way: described, or a plain
note.

**The screenshot says how big it is.** Its text gives the viewport in pixels, with x across from
the left and y down from the top. The browser runs at scale 1, so a position read off the picture
is a position on the page.

**Who answers a turn with pictures prefers eyes.** When routing may choose another model of a
provider (offline, the model on this computer), a message with pictures attached gets one that
sees and can still use the apps the chat's model could (`carryTools` `sight`). Where the choice
is the person's (a limit's fallback), it's left alone: the describer covers a model that can't
see.

## Consequences

- Every model can use the browser's eyes: as pictures where it sees, as words where it doesn't.
- No setting. The describer is chosen from what the person already connected; a person with only
  blind models is told so in the tool result.
- A provider's list that says nothing costs one refused request the first time a blind model meets
  a picture; after that the model is known blind until Conch restarts.
- Pictures from an integration's MCP tools (bridged tools) still reach the model APIs as text: the
  bridge hands over text only. Native engines (Claude Code, Codex) get them from the server as
  they always did.
- Codex's and the ACP programs' turns don't count what describing cost; their usage is the
  program's own total. They rarely need it: every Codex model sees.

## Amended 2026-10-09: a picture goes at the size the model reads

A screenshot of your own Chrome on a Mac was taken at the screen's density, twice the page's
CSS pixels: four times the pixels, while its words and `browser_click_at` spoke CSS pixels. And
a picture past what a model reads is scaled down by the provider, in a space the tool never
named (a computer-use tool's is refused outright).

- **One picture pixel per CSS pixel** (`browser/shot.ts`, Playwright's `scale: 'css'`), on any
  screen. The computer tool already sends points, not Retina pixels (`policy.ts` `fitPicture`).
- **No bigger than the model reads**, in one table (`engines/api/sight.ts` `pictureLimit`):
  Claude before 4.7 reads 1568 px and 1568 visual tokens (⌈w ÷ 28⌉ × ⌈h ÷ 28⌉); Claude 4.7 and
  later 2576 px and 4784 tokens, kept to 2000 px, past which a request with more than 20 pictures
  is refused; every other model 2000 px (OpenAI reads 2048). A model not named is the newest
  Claude. A screenshot past its limit is scaled to fit (`fitPictureTo`), and its words give the
  size it went at, so `browser_click_at` maps the model's x,y back to the page exactly as before.
- **Not smaller than that.** Neither the browser nor the computer tool has a zoom yet, so a
  picture a newer model reads whole is never scaled down to save tokens.
- **Old pictures go in batches.** Letting one go changes the transcript there, so the prompt
  cache (and, on newer Claude, the thinking replayed after it) starts again from that point.
  Nothing changes until fifteen tool pictures have gathered; then all but the newest three go at
  once (`TOOL_PICTURE_BATCH`), and they go too when the chat needs room, with stale pages
  (ADR 0085).
