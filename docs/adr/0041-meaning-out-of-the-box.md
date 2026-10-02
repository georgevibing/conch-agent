# 0041 — Meaning out of the box: Conch's own small model, and habits however you word them

- Status: accepted
- Date: 2026-10-02
- Builds on: [ADR 0032](./0032-it-learns-you.md) (it learns you),
  [ADR 0022](./0022-a-model-on-this-computer.md) (Ollama),
  [ADR 0016](./0016-getting-what-a-feature-needs.md) (getting what a feature needs),
  [ADR 0020](./0020-backups.md) (backups)

## Context

ADR 0032 gave memory search meaning, but only for people who already run Ollama
with an embedding model. Everyone else got spelling: "anniversary" didn't find
"Got married on 12 June", and the offer to fix it was a 274 MB model for a program
they didn't have. Skill suggestions had the same gap from the other side: asking
for your weekly summary three times in three different ways was three different
things.

## Decision

Conch brings its own small embedding model, run inside the gateway, downloaded
once when the person says so. Before that, a tiny built-in concept layer gives a
little meaning for free. Skill suggestions cluster requests by meaning with the
same vectors.

### 1. Conch's own model, on this computer

`memory/ondevice.ts` runs a quantized sentence-embedding model with
[transformers.js](https://huggingface.co/docs/transformers.js) on ONNX Runtime for
Node: CPU only, two threads, **in a process of its own** (`ondevice-runner.ts`),
started on the first search and stopped after ten idle minutes. Its own process,
because:

- a model unloaded in place keeps its memory (measured: the process stayed 106 MB
  bigger after `dispose()`); a process that exits gives it all back;
- the native code that reads downloaded files runs apart from the gateway and its
  keys: it gets only `PATH`, `HOME`, `LANG` and the temp folders, and speaks over
  the IPC channel only. If it crashes, only it stops; twice in a run, and it's set
  aside until **Repair** tries again.

Two models, chosen by the languages the browser (else the computer) speaks:

| Who                         | Model                                                             | Download | Dimensions |
| --------------------------- | ----------------------------------------------------------------- | -------- | ---------- |
| Every language is English   | `Xenova/all-MiniLM-L6-v2` (q8)                                    | 23.7 MB  | 384        |
| Any other language is there | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (q8, 50 languages) | 136.1 MB | 384        |

The English one is the smallest model that clearly understands paraphrase
(Sentence-BERT, Reimers & Gurevych 2019; MiniLM, Wang et al. 2020); bge-small is
better on benchmarks but twice the size for little gain on one-line memories. The
multilingual one is its distilled sibling (Reimers & Gurevych 2020): "Wann ist
unser Hochzeitstag?" finds "Our wedding was on 12 June" (cosine 0.66), which the
English model can't (0.15). The choice is written down at **Get it** and kept.

Texts are embedded one at a time: in a batch, padding nudged the quantized
model's vectors (cosine 0.992 to the same text alone), and the same words must
always give the same vector. It costs nothing at this length (measured below).

### 2. Asked for, then downloaded once — exactly the files Conch expects

The page offers it in plain words, with its size: "A small model (23 MB,
downloaded once) would let it understand meaning: “anniversary” would find your
wedding. It runs on this computer, even offline, and nothing you’ve told Conch
leaves it." One press of **Get it**; then progress; then "Making your memories
searchable by meaning… 420 of 1,000"; then a quiet line. ⌘K **Search memories by
meaning** opens the page with **Get it** focused, never pressed.

- **Pinned by hash.** Every file (`config.json`, the tokenizer, the ONNX graph) is
  listed in the code with its Hugging Face revision, size and SHA-256 (Git LFS's
  own). Conch fetches `huggingface.co/<repo>/resolve/<revision>/<file>`, streams it
  through SHA-256 into `<file>.part`, stops at the expected size, and renames it
  only if the hash matches. A redirect to a CDN is fine; a different file is
  thrown away ("What arrived wasn’t the model Conch expected, so it wasn’t used").
  This is OWASP's LLM03 (supply chain) advice: verify a model's integrity before
  using it.
- **Never the network afterwards.** The runtime loads with
  `allowRemoteModels = false`, `local_files_only`, no cache of its own, and a
  `fetch` that refuses. An ONNX file is a graph of numbers, not code, unlike a
  pickled checkpoint.
- **Heals.** A flaky network is retried after 2, 8 and 30 seconds. A download cut
  short by a restart carries on at the next start (the person already said yes),
  and half-written `.part` files are swept. A file that goes missing or is damaged
  shows in Repair everything (`memory:model`), whose repair fetches it again and
  re-indexes. A model that won't run on this computer ("This computer couldn’t run
  the model that understands meaning, so search uses words") falls back to words.
- **Where.** `CONCH_HOME/models/<repo>/…` and `models/meaning.json` (the choice):
  `derived` in the backup manifest. A restored computer offers the download again.
- **Not a need in `setup/known.ts`.** Needs are programs installed by a package
  manager, whose versions Updates watches. The model is data that Conch itself
  fetches, pinned in Conch's code: it changes only when Conch does, and a new pin
  is fetched by the same repair.

### 3. Which vectors win

Ollama's embedding model when it has one, then Conch's own, then words. Ollama's
is bigger (nomic-embed-text: 768 dimensions, a long context) and the person chose
to install it; Conch doesn't offer to pull one any more, since its own model is a
tenth of the size and needs no Ollama. Each embedder carries its own scale —
`floor` (a match) and `same` (the same request) — because a cosine of 0.4 means
"related" to MiniLM and "unrelated" to nomic. Vectors are kept per embedder in
`memory-index.db`, so moving between them never mixes them, and each re-index is
a batch at a time (written as it goes, so it shows progress and survives a
restart). Searches and suggestions see the change as soon as the model lands
(`memory.changed`).

### 4. A little meaning before any download

`memory/concepts.ts` is 37 groups of everyday words that mean one thing
("anniversary wedding married spouse…", "car vehicle automobile suv…", "coffee
espresso latte…", "summary recap overview digest…"). A word's concept becomes a
token of its own (`~vehicle`) in BM25 and a feature of the built-in vectors, so
"my car" finds "Drives a red vehicle to work" and "our anniversary" finds "Got
married" with nothing downloaded. Words that mean too many things ("flat",
"account", "call", "run") are left out on purpose: a wrong match is worse than
none, and the model covers the rest. English only, for the same reason.

### 5. Habits by meaning

`skills/suggest.ts` embeds the newest 1,500 requests of the last 45 days (plus
your skills and what you turned down) in one go. A habit grows from its newest
request by **average linkage**: the request closest on average to everything
already in it joins next, while that average stays at `same` or above. One close
pair isn't enough ("Write a weekly newsletter" is 0.52 from "Write my weekly
summary" and 0.23–0.36 from the other summaries), and one loose pair doesn't keep
a real habit apart. Words still count (a same-words pair is a match), and without
a model it's ADR 0032's word rule, unchanged.

The rest of ADR 0032 holds: at least three different chats, one request per chat,
a draft to read set to **When I ask**, nothing saved by itself. Deduplication is by
meaning too: a habit whose requests are on average within `0.85 × same` of one of
your skills ("Week in review — Summarises the meetings you had this week") isn't
offered, nor one near something you turned down, whose first request is now kept
in `skill-suggestions.json` (backed up with skills) so it stays down in new words.

### Tuning

Cosines from the real models (one text at a time):

| Pair                                                    | MiniLM-L6 | Multilingual |
| ------------------------------------------------------- | --------- | ------------ |
| "when is our anniversary?" ↔ "Our wedding was on…"      | 0.58      | 0.42         |
| "nut allergy" ↔ "Allergic to peanuts"                   | 0.73      | 0.70         |
| "which automobile do I have" ↔ "Drives a … vehicle"     | 0.21      | 0.45         |
| unrelated memory pairs (football, Lisbon, coffee…)      | ≤ 0.28    | ≤ 0.38       |
| three weekly-summary requests, pairwise                 | 0.53–0.76 | 0.57–0.78    |
| weekly summary ↔ weekly newsletter / book a table       | 0.52/0.38 | 0.62/0.38    |
| "Week in review" skill ↔ the summary requests (average) | 0.64      | 0.75         |

So: MiniLM `floor` 0.3, `same` 0.5; multilingual `floor` 0.35, `same` 0.6; Ollama
0.5 / 0.8 (unchanged, untuned here: no Ollama on the machine this was measured on).
"automobile" ↔ "vehicle" is weak for MiniLM; the concept layer carries it.

### Measured

On the development Mac (Apple silicon, shared with six other jobs): downloading
all-MiniLM-L6-v2 through `OnDeviceModel.get` took 3.2 s and the multilingual one
11.4 s; loading takes about 80 ms and 400 ms in place. **Indexing 1,000 memories
took 1.6 s** with MiniLM in its own process, in the test that measures it
(`ondevice.test.ts`; 1.3 s in place), and about 4.6 s for 1,000 longer notes with
the multilingual model. One text at a time is no slower than batches of 32 (2.0 s
against 2.3 s for 1,000 longer notes with MiniLM).

## Dependencies

- `@huggingface/transformers` 4.3.0 (Apache-2.0), with `onnxruntime-node` 1.30.0
  (MIT; bundles CPU binaries for macOS, Windows and Linux, about 85 MB per
  platform on disk) and `sharp` (image code it doesn't use here, prebuilt). Its
  install scripts are off in `pnpm-workspace.yaml`: onnxruntime-node's would only
  fetch CUDA libraries, protobufjs's only checks a version. Imported lazily, so
  Conch starts no slower.
- The alternative — installing the runtime into `CONCH_HOME` with npm on **Get it**
  — would have kept the install smaller but put an unpinned package install behind
  a button. The lockfile pins this one, and the model is pinned by hash.

## Consequences

- Search understands meaning for everyone, after one small download they agree to,
  and a little of it even before.
- Habits are found however they're worded, and existing skills are recognised in
  other words.
- The gateway's install is bigger (ONNX Runtime). While the model runs, its process
  uses about 150 MB (MiniLM: 47 MB of runtime, 100 MB of model) or about 650 MB
  (the multilingual one: its 250,000-word vocabulary), all given back after ten idle
  minutes. The first search after that waits about a second for it to start (two for
  the multilingual one).
- **Known limits:**
  - The concept layer is small and English. Before the download, meaning beyond it
    is still spelling.
  - The English model is English: someone who writes in another language and whose
    browser only says English gets it. Their next choice is kept, not re-asked.
  - MiniLM is small: some paraphrases are beyond it ("where did we tie the knot" is
    0.26 from "Our wedding was…", under its floor), and the concept layer covers
    only its words. A bigger model in Ollama, if you have one, is used instead.
  - Long memories are cut to their first 2,000 characters (and the model's own
    limit of word pieces); memories are sentences, so this rarely matters.
  - Thresholds for Ollama's models are the old ones, not measured here.
