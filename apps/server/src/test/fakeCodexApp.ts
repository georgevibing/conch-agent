import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeProgram } from './fakeProgram';

export async function fakeCodexApp(
  options: {
    signedIn?: boolean;
    loginFails?: boolean;
    tool?: string;
    args?: Record<string, unknown>;
    hang?: boolean;
    fail?: boolean;
    malformed?: boolean;
    loginUrl?: string;
    /** Steps of a `turn/plan/updated`, sent before the answer. */
    plan?: unknown[];
    /** `thread/tokenUsage/updated`s, sent before the answer: the thread's running `total` and the request's own `last`. */
    tokenUsage?: { total: Record<string, number>; last: Record<string, number> }[];
    /**
     * Codex CLI's own work (ADR 0066): announce a command or a change, ask to
     * approve it, then run it (or not) as the answer says.
     */
    native?: { command?: string; paths?: string[]; network?: boolean };
    /** `thread/resume` fails, as for a thread Codex can't read back. */
    resumeFails?: boolean;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'conch-app-server-'));
  const log = join(dir, 'calls.jsonl');
  const bin = await fakeProgram(
    dir,
    'codex',
    `
const fs = require('node:fs'); const path = require('node:path'); const rl = require('node:readline');
const OPTIONS = ${JSON.stringify(options)}; const LOG = ${JSON.stringify(log)};
if (process.argv.includes('--version')) { console.log('codex 0.159.0'); process.exit(0); }
const send = (v) => process.stdout.write(JSON.stringify(v)+'\\n');
const note = (method, params) => send({method,params});
const auth = path.join(process.env.CODEX_HOME, 'auth.json');
let TID = 't1';
// Codex keeps a thread where it looks for it again: its home's sessions folder.
const rolloutOf = (id) => path.join(process.env.CODEX_HOME, 'sessions', '2026', '10', '04', 'rollout-2026-10-04T00-00-00-' + id + '.jsonl');
const findRollout = (id) => { try { return fs.readdirSync(path.join(process.env.CODEX_HOME, 'sessions'), {recursive:true}).map(String).find(f => f.endsWith('-' + id + '.jsonl')); } catch { return undefined; } };
fs.appendFileSync(LOG, JSON.stringify({spawn:true, argv: process.argv.slice(2), home: process.env.CODEX_HOME, secretLeaked: Boolean(process.env.CONCH_TOKEN || process.env.OPENAI_API_KEY || process.env.OP_SERVICE_ACCOUNT_TOKEN)})+'\\n');
const complete = () => {
 if (OPTIONS.hang) return;
 if (OPTIONS.plan) note('turn/plan/updated',{threadId:TID,turnId:'turn1',explanation:null,plan:OPTIONS.plan});
 for (const u of OPTIONS.tokenUsage || []) note('thread/tokenUsage/updated',{threadId:TID,turnId:'turn1',tokenUsage:u});
 note('item/agentMessage/delta',{threadId:TID,itemId:'m1',delta:'Finished.'});
 note('item/completed',{threadId:TID,item:{type:'agentMessage',id:'m1'}});
 note('turn/completed',{threadId:TID,turn:{id:'turn1',status:OPTIONS.fail?'failed':'completed'}});
};
rl.createInterface({input:process.stdin}).on('line', line => {
 const m = JSON.parse(line); fs.appendFileSync(LOG, JSON.stringify(m)+'\\n');
 const reply = result => send({id:m.id,result});
 if (m.method === 'initialize') reply({});
 else if (m.method === 'account/read') reply({account: OPTIONS.signedIn || fs.existsSync(auth) ? {type:'chatgpt',email:'test@example.com',planType:'plus'} : null});
 else if (m.method === 'account/login/start') {
   reply({type:'chatgptDeviceCode',loginId:'device1',verificationUrl:OPTIONS.loginUrl || 'https://auth.openai.com/codex/device',userCode:'TEST-1234'});
   setTimeout(() => { if (!OPTIONS.loginFails) fs.writeFileSync(auth,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'test-only-token'}})); note('account/login/completed',{loginId:'device1',success:!OPTIONS.loginFails}); },30);
 }
 else if (m.method === 'account/logout') { fs.rmSync(auth,{force:true}); reply({}); }
 else if (m.method === 'test/renew') { fs.writeFileSync(auth,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'renewed-token'}})); reply({}); }
 else if (m.method === 'test/lose') { fs.rmSync(auth,{force:true}); reply({}); }
 else if (m.method === 'test/token') { let t = null; try { t = JSON.parse(fs.readFileSync(auth,'utf8')).tokens.access_token; } catch {} reply({token: t}); }
 else if (m.method === 'test/refuse') send({id:m.id,error:{code:-32600,message:'Invalid request: unknown field "x" (Authorization: Bearer abc.def-123 sk-proj-ABCDEFGHIJKLMNOP)'}});
 else if (m.method === 'account/rateLimits/read') reply({rateLimits:{primary:{usedPercent:85,windowDurationMins:300,resetsAt:1791140000},secondary:{usedPercent:20,windowDurationMins:10080,resetsAt:1791600000},planType:'plus'}});
 else if (m.method === 'model/list') reply({data:[{id:'m',model:'account-model',displayName:'Account model',description:'Listed by this account',supportedReasoningEfforts:[{reasoningEffort:'high'}],inputModalities:['text','image']}],nextCursor:null});
 else if (m.method === 'thread/start') {
   // Like Codex 0.159: names starting mcp__ belong to its own MCP servers.
   const reserved = ((m.params && m.params.dynamicTools) || []).find(t => /^mcp__/.test(t.name));
   if (reserved) { send({id:m.id,error:{code:-32600,message:'dynamic tool name is reserved: '+reserved.name}}); return; }
   TID = require('node:crypto').randomUUID();
   fs.mkdirSync(path.dirname(rolloutOf(TID)), {recursive:true});
   fs.writeFileSync(rolloutOf(TID), JSON.stringify({type:'session_meta', tools:(m.params.dynamicTools||[]).map(t=>t.name)})+'\\n');
   reply({thread:{id:TID}});
 }
 else if (m.method === 'thread/resume') {
   if (OPTIONS.resumeFails || !findRollout(m.params.threadId)) send({id:m.id,error:{code:-32600,message:'no rollout found for thread id ' + m.params.threadId}});
   else { TID = m.params.threadId; reply({thread:{id:TID}}); }
 }
 else if (m.method === 'turn/start') {
   reply({turn:{id:'turn1'}});
   const file = findRollout(TID);
   if (file) fs.appendFileSync(path.join(process.env.CODEX_HOME, 'sessions', file), JSON.stringify({type:'user', input:m.params.input})+'\\n');
   if (OPTIONS.malformed) process.stdout.write('not-json\\n');
   else if (OPTIONS.tool) send({id:'call1',method:'item/tool/call',params:{threadId:TID,turnId:'turn1',callId:'tool1',tool:OPTIONS.tool,arguments:OPTIONS.args || {}}});
   else if (OPTIONS.native && OPTIONS.native.command) {
     note('item/started',{threadId:TID,turnId:'turn1',item:{type:'commandExecution',id:'cmd1',command:OPTIONS.native.command,cwd:'/work',status:'inProgress',aggregatedOutput:null,exitCode:null}});
     send({id:'approve1',method:'item/commandExecution/requestApproval',params:{kind:'command',threadId:TID,turnId:'turn1',itemId:'cmd1',startedAtMs:1,environmentId:null,command:OPTIONS.native.command,cwd:'/work',...(OPTIONS.native.network ? {networkApprovalContext:{host:'x.example',protocol:'https'}} : {})}});
   }
   else if (OPTIONS.native && OPTIONS.native.paths) {
     note('item/started',{threadId:TID,turnId:'turn1',item:{type:'fileChange',id:'fc1',status:'inProgress',changes:OPTIONS.native.paths.map(p=>({path:p,kind:{type:'update',move_path:null},diff:''}))}});
     send({id:'approve1',method:'item/fileChange/requestApproval',params:{threadId:TID,turnId:'turn1',itemId:'fc1',startedAtMs:1}});
   }
   else complete();
 }
 else if (m.id === 'call1') complete();
 else if (m.id === 'approve1') {
   const ok = m.result && m.result.decision === 'accept';
   if (OPTIONS.native.command) note('item/completed',{threadId:TID,turnId:'turn1',item:{type:'commandExecution',id:'cmd1',command:OPTIONS.native.command,cwd:'/work',status:ok?'completed':'declined',aggregatedOutput:ok?'ran it':null,exitCode:ok?0:null}});
   else note('item/completed',{threadId:TID,turnId:'turn1',item:{type:'fileChange',id:'fc1',status:ok?'completed':'declined',changes:OPTIONS.native.paths.map(p=>({path:p,kind:{type:'update',move_path:null},diff:''}))}});
   complete();
 }
 else if (m.method === 'turn/interrupt') { reply({}); note('turn/completed',{threadId:TID,turn:{id:'turn1',status:'interrupted'}}); }
});
`,
  );
  return {
    bin,
    dir,
    calls: async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
