/** Sample content shared by pattern stories. Not exported from the package. */

export const sampleDiff = `diff --git a/apps/server/src/session.ts b/apps/server/src/session.ts
--- a/apps/server/src/session.ts
+++ b/apps/server/src/session.ts
@@ -12,9 +12,12 @@ export class Session {
   private readonly socket: WebSocket;
-  private buffer = '';
+  private readonly queue: ClientMessage[] = [];
+  private closed = false;

   constructor(socket: WebSocket) {
     this.socket = socket;
-    socket.on('message', (raw) => this.buffer += raw);
+    socket.on('message', (raw) => this.enqueue(parse(raw)));
+    socket.on('close', () => (this.closed = true));
   }
 
   async *messages() {`;

export const sampleTestOutput = `> @conch/server test
> vitest run

 ✓ src/session.test.ts (6 tests) 41ms
 ✓ src/protocol.test.ts (12 tests) 18ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Duration  612ms`;

export const sampleCode = `export function parse(raw: RawData): ClientMessage {
  const result = ClientMessage.safeParse(JSON.parse(String(raw)));
  if (!result.success) throw new ProtocolError(result.error.message);
  return result.data;
}`;

export const sampleReply =
  "I've switched the session to a typed message queue. Incoming frames are now parsed and validated with the shared protocol schema before they reach the agent, and the socket's close event stops the iterator cleanly. All 18 server tests pass.";

/** A long command with a heredoc, as an assistant writes one to edit a file. */
export const sampleLongCommand = [
  "cd /home/george/pworkspace/conch-agent && git checkout AGENTS.md && python3 - <<'EOF'",
  "p='AGENTS.md'",
  's=open(p).read()',
  'a="""- A step in an app the person made here is their own work: it carries `own`, so what it sends goes only to the sites the person added it with."""',
  'b="""- A step in an app the person made here is their own work (ADR 0118)."""',
  "assert a in s, 'not found'",
  's=s.replace(a, b)',
  "open(p,'w').write(s)",
  "print('done')",
  'EOF',
].join('\n');
