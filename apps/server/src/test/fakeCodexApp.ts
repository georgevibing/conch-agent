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
fs.appendFileSync(LOG, JSON.stringify({spawn:true, home: process.env.CODEX_HOME, secretLeaked: Boolean(process.env.CONCH_TOKEN || process.env.OPENAI_API_KEY || process.env.OP_SERVICE_ACCOUNT_TOKEN)})+'\\n');
const complete = () => {
 if (OPTIONS.hang) return;
 note('item/agentMessage/delta',{threadId:'t1',itemId:'m1',delta:'Finished.'});
 note('item/completed',{threadId:'t1',item:{type:'agentMessage',id:'m1'}});
 note('turn/completed',{threadId:'t1',turn:{id:'turn1',status:OPTIONS.fail?'failed':'completed'}});
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
 else if (m.method === 'model/list') reply({data:[{id:'m',model:'account-model',displayName:'Account model',description:'Listed by this account',supportedReasoningEfforts:[{reasoningEffort:'high'}],inputModalities:['text','image']}],nextCursor:null});
 else if (m.method === 'thread/start') reply({thread:{id:'t1'}});
 else if (m.method === 'turn/start') {
   reply({turn:{id:'turn1'}});
   if (OPTIONS.malformed) process.stdout.write('not-json\\n');
   else if (OPTIONS.tool) send({id:'call1',method:'item/tool/call',params:{threadId:'t1',turnId:'turn1',callId:'tool1',tool:OPTIONS.tool,arguments:OPTIONS.args || {}}});
   else complete();
 }
 else if (m.id === 'call1') complete();
 else if (m.method === 'turn/interrupt') { reply({}); note('turn/completed',{threadId:'t1',turn:{id:'turn1',status:'interrupted'}}); }
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
