# 0088 — Everyday tools for every model

- Status: accepted
- Date: 2026-10-05

## Decision

Conch owns document extraction, bounded file search and paged reading, web research,
managed commands, task control, and delivery of finished files. Image creation and
editing use a connected image service with explicit cost and upload approval.
They use the same tools, permission checks and chat views on every provider.
A provider's native equivalents remain available where already supported.

## Boundaries

- File tools use the workspace and explicitly granted attachment directories. No
  traversal, protected paths, symbolic links or multiply linked regular files.
  Reads, searches, archives and extracted text have resource limits. Pagination
  reports continuation and truncation; a partial read never claims to be complete.
- Document parsing happens in a disposable permission-restricted process, with a
  time and memory limit. It never executes macros, scripts, embedded programs or
  external relationships. PDF text has page references; Office text retains sheet
  and slide boundaries. Images in scanned PDFs require OCR and must be identified
  honestly. Unsupported and encrypted formats produce actionable errors.
- Web requests have no ambient credentials or cookies. DNS checks apply to the
  address actually dialled and each redirect, rejecting private, loopback and
  metadata destinations. Response size, decompression and elapsed time are bounded.
  Web and document results are untrusted data and enter the existing taint guard.
- Processes belong to a conversation and are bounded in count, output and lifetime.
  Starting and writing stdin require command authority. A process cannot turn a
  read-only or stopped turn into a new source of authority. Stop and shutdown
  terminate the process tree. Handles are unguessable and never accept a raw PID.
- Task controls can reach only tasks launched by the current chat. Restarting work
  retains the original permission limits and verification ledger.
- Finished files are immutable snapshots with download-only responses, existing
  authentication, MIME sniffing, size limits and the conversation's retention.
  Browser content is never promoted into executable HTML at the gateway origin.

## Dependencies and sources

PDF.js provides PDF decoding without a platform binary. fflate and fast-xml-parser
provide bounded ZIP decompression and Office XML parsing; neither runs Office.
Resource isolation is required even with mature parsers.

Security design follows the existing Conch guards (ADRs 0028, 0031, 0046, 0047)
and the OWASP [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
(validation of resolved addresses; redirects checked individually),
[File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
(file size, storage, signature and decompressed-size limits), and
[LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
(untrusted results do not grant authority).

## Verification

Tests must exercise cross-conversation handles, cancellation, traversal, links,
protected paths, binary files, pagination, malformed and oversized archives,
network redirects and DNS rebinding, denied permissions, process cleanup and
retention. Product documentation describes actual support and limits.

## Image service and finished files

Image models are discovered from OpenRouter’s dedicated Image Models API and
called through its Image API, following the [provider’s documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).
Only the fixed OpenRouter endpoint receives its key, redirects are refused,
reference images come from the existing file boundary, responses are bounded,
and returned raster bytes are sniffed before saving. No paid POST is retried.
The existing provider connection dialog is offered from chat, with the original
request resumed only after a human connects it. It does not switch the chat model.
Image costs enter the usage ledger; no separate credential file is introduced.

Finished files are attachment-store snapshots claimed by their conversation.
This reuses authenticated preview/download routes, safe MIME responses, backup
classification and conversation retention. Listing and deleting owned files use
the store’s ownership records, including a result whose turn stopped before it
was logged. No new durable store or migration is required.

## Deliberate limits

Document reading extracts text, not page layout or OCR. Empty PDF text pages are
reported; Word headers and footers, charts and images need separate inspection.
Office formulas are shown with stored values and are never recalculated. Sections
and long section text have independent continuation offsets.

Managed shell processes are ephemeral, with 16 running globally and four per
chat, 64,000 retained characters, and at most 30 minutes per process. Their
supervisor’s stdin pipe closes if the gateway dies, triggering process-tree
cleanup. A normal completed turn can leave a process running; explicit stop,
chat deletion, timeout and shutdown terminate it.
