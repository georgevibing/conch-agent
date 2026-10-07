/**
 * The eval suite's own small web (ADR 0071): a local site with the things real
 * sites make an agent do — a form, a value two pages deep, a sign-in only the
 * person can do, a number drawn on a canvas, a file to upload, a long list to
 * build, and hotels to compare. Every answer is fixed here, and everything the
 * agent submits is recorded, so a task is checked by code, never by a model.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The fixed answers, read by the tasks' checkers. */
export const SITE = {
  orderCode: 'WC-4821-B',
  decoyCode: 'WC-1177-G',
  membership: '88-301-562',
  login: { username: 'ada.eval', password: 'shells-' + 'and-tides-42' },
  meter: '4729',
  cheapestHotel: { name: 'Casa Azul', perNight: 78 },
  /** On the price list page; its CSV export is always down (ADR 0101). */
  kettle: { name: 'Copper Kettle', price: 64.9 },
} as const;

const PRICES: [string, number][] = [
  ['Steel Kettle', 39.5],
  [SITE.kettle.name, SITE.kettle.price],
  ['Copper Pan', 54.0],
  ['Bread Tin', 12.75],
];

export interface Submissions {
  signup: Record<string, string>[];
  uploads: { name: string; content: string }[];
  lists: { item: string; quantity: number }[][];
  logins: number;
}

export interface FixtureSite {
  url: string;
  submissions: Submissions;
  close(): Promise<void>;
}

const page = (title: string, body: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px}` +
  `label{display:block;margin:10px 0 4px}table{border-collapse:collapse}td,th{padding:4px 10px;border:1px solid #ccc}</style>` +
  `</head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const HOTELS: [string, number, string][] = [
  ['Alfama Rooms', 95, '4.6'],
  ['Baixa Suites', 120, '4.8'],
  [SITE.cheapestHotel.name, SITE.cheapestHotel.perNight, '4.3'],
  ['Chiado Loft', 142, '4.9'],
  ['Belém Garden Inn', 88, '4.1'],
];

const PRODUCTS: Record<string, [string, string, string][]> = {
  kitchen: [
    ['steel-kettle', 'Steel Kettle', 'KT-3020-S'],
    ['bread-tin', 'Bread Tin', 'BT-0412-K'],
  ],
  garden: [
    ['blue-watering-can', 'Blue Watering Can', SITE.orderCode],
    ['green-watering-can', 'Green Watering Can', SITE.decoyCode],
    ['pruning-shears', 'Pruning Shears', 'PS-5530-G'],
  ],
  tools: [['claw-hammer', 'Claw Hammer', 'CH-9001-T']],
};

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('too big');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Start the site on a free port of this computer. */
export async function startSite(): Promise<FixtureSite> {
  const submissions: Submissions = { signup: [], uploads: [], lists: [], logins: 0 };
  const sessions = new Set<string>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://site.local');
    const send = (html: string, status = 200, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(html);
    };
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cookie = /(?:^|;\s*)sid=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1];

    if (req.method === 'POST') {
      const raw = await body(req);
      if (path === '/signup') {
        const form = Object.fromEntries(new URLSearchParams(raw));
        submissions.signup.push(form);
        return send(
          page(
            'Signed up',
            `<h1>Thanks, ${escape(form.name ?? '')}!</h1><p>You’re signed up for the ${escape(form.plan ?? '')} plan.</p>`,
          ),
        );
      }
      if (path === '/login') {
        const form = new URLSearchParams(raw);
        if (
          form.get('username') === SITE.login.username &&
          form.get('password') === SITE.login.password
        ) {
          const sid = Math.random().toString(36).slice(2);
          sessions.add(sid);
          submissions.logins++;
          return send('', 303, {
            location: form.get('next') || '/account',
            'set-cookie': `sid=${sid}; Path=/; HttpOnly`,
          });
        }
        return send(page('Sign in', '<p>Wrong username or password.</p>'), 401);
      }
      if (path === '/upload') {
        const parsed = JSON.parse(raw) as { name?: unknown; content?: unknown };
        submissions.uploads.push({ name: String(parsed.name), content: String(parsed.content) });
        return json({ ok: true });
      }
      if (path === '/list/save') {
        const parsed = JSON.parse(raw) as { items?: { item: string; quantity: number }[] };
        submissions.lists.push(parsed.items ?? []);
        return json({ ok: true });
      }
      return send('Not found', 404);
    }

    if (path === '/')
      return send(
        page(
          'Eval site',
          '<h1>Eval site</h1><ul>' +
            ['signup', 'shop', 'account', 'meter', 'upload', 'list', 'trips', 'prices']
              .map((p) => `<li><a href="/${p}">${p}</a></li>`)
              .join('') +
            '</ul>',
        ),
      );
    if (path === '/signup')
      return send(
        page(
          'Sign up',
          `<h1>Sign up for the newsletter</h1>
<form method="post" action="/signup">
<label for="name">Full name</label><input id="name" name="name" required>
<label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="plan">Plan</label><select id="plan" name="plan"><option>Basic</option><option>Pro</option><option>Team</option></select>
<label for="message">Anything else?</label><textarea id="message" name="message"></textarea>
<label><input type="checkbox" name="terms" value="yes" required> I agree to the terms</label>
<p><button type="submit">Sign up</button></p>
</form>`,
        ),
      );
    if (path === '/shop')
      return send(
        page(
          'Shop',
          '<h1>Shop</h1><p>Choose a department.</p><ul>' +
            Object.keys(PRODUCTS)
              .map((d) => `<li><a href="/shop/${d}">${d[0]?.toUpperCase()}${d.slice(1)}</a></li>`)
              .join('') +
            '</ul>',
        ),
      );
    const department = /^\/shop\/([a-z]+)$/.exec(path)?.[1];
    if (department && PRODUCTS[department])
      return send(
        page(
          department,
          `<h1>${department}</h1><ul>` +
            PRODUCTS[department]
              .map(([slug, name]) => `<li><a href="/shop/${department}/${slug}">${name}</a></li>`)
              .join('') +
            '</ul><p>Prices and order codes are on each product’s page.</p>',
        ),
      );
    const product = /^\/shop\/([a-z]+)\/([a-z-]+)$/.exec(path);
    const found = product && PRODUCTS[product[1] ?? '']?.find(([slug]) => slug === product[2]);
    if (found)
      return send(
        page(
          found[1],
          `<h1>${found[1]}</h1><p>In stock.</p><dl><dt>Order code</dt><dd>${found[2]}</dd></dl>`,
        ),
      );
    if (path === '/account') {
      if (!cookie || !sessions.has(cookie))
        return send('', 303, { location: '/login?next=/account' });
      return send(
        page(
          'Your account',
          `<h1>Your account</h1><p>Signed in as ${SITE.login.username}.</p><p>Membership number: <strong>${SITE.membership}</strong></p>`,
        ),
      );
    }
    if (path === '/login')
      return send(
        page(
          'Sign in',
          `<h1>Sign in</h1><form method="post" action="/login">
<input type="hidden" name="next" value="${escape(url.searchParams.get('next') ?? '/account')}">
<label for="username">Username</label><input id="username" name="username" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
<p><button type="submit">Sign in</button></p></form>`,
        ),
      );
    if (path === '/meter')
      return send(
        page(
          'Water meter',
          '<h1>Water meter</h1><p>The current reading is shown on the dial below.</p><canvas id="dial" width="360" height="140" role="img" aria-label="Meter dial"></canvas>',
          // Drawn, never written: no text node holds the number.
          `const c=document.getElementById('dial').getContext('2d');c.fillStyle='#10233f';c.fillRect(0,0,360,140);` +
            `c.fillStyle='#fff';c.font='bold 72px monospace';c.textBaseline='middle';` +
            `const d=[${[...SITE.meter].map((x) => `'${x}'`).join(',')}];d.forEach((x,i)=>c.fillText(x,40+i*72,74));`,
        ),
      );
    if (path === '/upload')
      return send(
        page(
          'Upload a report',
          `<h1>Upload a report</h1><form id="f"><label for="file">Report file</label><input id="file" type="file" name="file">
<p><button type="submit">Upload</button></p></form><p id="done" role="status"></p>`,
          `document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();` +
            `const f=document.getElementById('file').files[0];if(!f){document.getElementById('done').textContent='Choose a file first.';return;}` +
            `const content=await f.text();await fetch('/upload',{method:'POST',body:JSON.stringify({name:f.name,content})});` +
            `document.getElementById('done').textContent='Uploaded '+f.name+'.';});`,
        ),
      );
    if (path === '/list')
      return send(
        page(
          'Shopping list',
          `<h1>Shopping list</h1>
<label for="item">Item</label><input id="item">
<label for="qty">Quantity</label><select id="qty"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
<p><button id="add" type="button">Add to list</button></p>
<h2>On the list</h2><ul id="items"></ul>
<p><button id="save" type="button">Save list</button></p><p id="saved" role="status"></p>`,
          `const items=[];const ul=document.getElementById('items');` +
            `document.getElementById('add').addEventListener('click',()=>{const i=document.getElementById('item');` +
            `const name=i.value.trim();if(!name)return;const quantity=Number(document.getElementById('qty').value);` +
            `items.push({item:name,quantity});const li=document.createElement('li');li.textContent=quantity+' × '+name;ul.appendChild(li);` +
            `i.value='';document.getElementById('qty').value='1';});` +
            `document.getElementById('save').addEventListener('click',async()=>{await fetch('/list/save',{method:'POST',body:JSON.stringify({items})});` +
            `document.getElementById('saved').textContent='Saved '+items.length+' items.';});`,
        ),
      );
    // The export a person names first is down; the same prices are on the page (ADR 0101).
    if (path === '/prices.csv')
      return send(
        page('Export unavailable', '<h1>503</h1><p>The export service is unavailable.</p>'),
        503,
      );
    if (path === '/prices')
      return send(
        page(
          'Price list',
          '<h1>Price list</h1><table><thead><tr><th>Item</th><th>Price (EUR)</th></tr></thead><tbody>' +
            PRICES.map(([n, p]) => `<tr><td>${n}</td><td>${p.toFixed(2)}</td></tr>`).join('') +
            '</tbody></table><p><a href="/prices.csv">Download as CSV</a></p>',
        ),
      );
    if (path === '/trips')
      return send(
        page(
          'Lisbon hotels',
          '<h1>Hotels in Lisbon</h1><table><thead><tr><th>Hotel</th><th>Price per night (EUR)</th><th>Rating</th></tr></thead><tbody>' +
            HOTELS.map(([n, p, r]) => `<tr><td>${n}</td><td>${p}</td><td>${r}</td></tr>`).join('') +
            '</tbody></table>',
        ),
      );
    return send(page('Not found', '<h1>Not found</h1>'), 404);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('error');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    submissions,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
