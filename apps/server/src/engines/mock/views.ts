/**
 * What the mock's pretend app tools find (ADR 0060): a calendar, emails,
 * files and messages, so `pnpm dev:mock` and e2e can show every tool view
 * without Google or Slack. Everything here is plainly made up.
 */
import type { ToolView } from '@conch/protocol';

/** A pretend call: the tool's name, what it was asked, the text the model reads, the view. */
export interface PretendFind {
  tool: string;
  input: Record<string, unknown>;
  text: string;
  view: ToolView;
  reply: string;
}

const HOUR = 3_600_000;

/** `hh:mm` local time, `days` from today, as ISO. */
function at(now: number, days: number, hh: number, mm = 0): string {
  const d = new Date(now + days * 24 * HOUR);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function day(now: number, days: number): string {
  const d = new Date(now + days * 24 * HOUR);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calendar(now: number): PretendFind {
  const view: ToolView = {
    kind: 'agenda',
    from: at(now, 0, 0),
    to: at(now, 2, 0),
    items: [
      {
        title: 'Team offsite',
        start: day(now, 1),
        end: day(now, 2),
        allDay: true,
        call: false,
        color: '#33b679',
      },
      {
        title: 'Standup',
        start: at(now, 0, 9, 30),
        end: at(now, 0, 9, 45),
        allDay: false,
        call: true,
        color: '#039be5',
        url: 'https://calendar.example.org/e/standup',
      },
      {
        title: 'Design review',
        start: at(now, 0, 14),
        end: at(now, 0, 15),
        allDay: false,
        call: false,
        location: 'Room 4',
        color: '#7986cb',
      },
      {
        title: 'Dentist',
        start: at(now, 1, 8, 15),
        end: at(now, 1, 9),
        allDay: false,
        call: false,
        location: '12 Harbour Street',
        color: '#e67c73',
      },
    ],
  };
  return {
    tool: 'google_calendar_briefing',
    input: { accountId: 'pretend', start: view.from, end: view.to },
    text: JSON.stringify({ items: view.items.map((i) => ({ summary: i.title, start: i.start })) }),
    view,
    reply:
      'Today you have standup at 9:30 and the design review at 2. Tomorrow is the offsite, after the dentist.',
  };
}

function mail(now: number, about: string): PretendFind {
  const view: ToolView = {
    kind: 'mail',
    items: [
      {
        from: 'Ada Lovelace',
        subject: `Q4 ${about}, final numbers`,
        snippet: 'Here are the final numbers. The travel line came in under.',
        date: new Date(now - 2 * HOUR).toISOString(),
        unread: true,
        attachments: true,
        url: 'https://mail.example.org/m/1',
      },
      {
        from: 'Sam Rivera',
        subject: `Re: ${about} for the launch`,
        snippet: 'Works for me. Can we move the review to Thursday?',
        date: new Date(now - 26 * HOUR).toISOString(),
        unread: false,
        attachments: false,
        url: 'https://mail.example.org/m/2',
      },
    ],
  };
  return {
    tool: 'google_mail_search',
    input: { accountId: 'pretend', query: about, limit: 20 },
    text: JSON.stringify({
      messages: [{ id: 'pretend1' }, { id: 'pretend2' }],
      resultSizeEstimate: 2,
    }),
    view,
    reply: `The newest is Ada’s “Q4 ${about}, final numbers”, with the spreadsheet attached.`,
  };
}

function files(now: number, name: string): PretendFind {
  const view: ToolView = {
    kind: 'files',
    items: [
      {
        name: `Q4 launch ${name}`,
        mime: 'application/vnd.google-apps.presentation',
        modified: new Date(now - 3 * HOUR).toISOString(),
        owner: 'Ada Lovelace',
        url: 'https://drive.example.org/f/1',
      },
      {
        name: 'Launch budget',
        mime: 'application/vnd.google-apps.spreadsheet',
        modified: new Date(now - 30 * HOUR).toISOString(),
        owner: 'Sam Rivera',
        url: 'https://drive.example.org/f/2',
      },
    ],
  };
  return {
    tool: 'google_drive_search',
    input: { accountId: 'pretend', query: name },
    text: JSON.stringify({ files: view.items.map((f) => ({ name: f.name })) }),
    view,
    reply: `It’s “Q4 launch ${name}”, which Ada changed this morning.`,
  };
}

function messages(now: number, channel: string): PretendFind {
  const view: ToolView = {
    kind: 'messages',
    place: `#${channel}`,
    items: [
      {
        author: 'Sam Rivera',
        text: 'Pushed the new onboarding screens. Feedback welcome!',
        at: new Date(now - 3 * HOUR).toISOString(),
      },
      {
        author: 'Ada Lovelace',
        text: 'Looks great. Two things:\n1. Step 2 says “Continue” but it saves.\n2. Smaller picture on phones?',
        at: new Date(now - 2 * HOUR).toISOString(),
      },
      {
        author: 'Grace Hopper',
        text: 'Agree on the button: Save and continue.',
        at: new Date(now - HOUR).toISOString(),
      },
    ],
  };
  return {
    tool: 'slack_read_channel',
    input: { channel: 'CPRETEND01', limit: 50 },
    text: JSON.stringify({ channel: { name: channel }, messages: view.items }),
    view,
    reply: `#${channel} likes the new onboarding; Ada and Grace want step 2 to say “Save and continue”.`,
  };
}

/** A pretend forecast: a mild, showery week, the same shape every run. */
function weather(now: number, place: string): PretendFind {
  const pad = (n: number) => String(n).padStart(2, '0');
  const wall = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const hour = new Date(now);
  hour.setMinutes(0, 0, 0);
  const codes = [2, 2, 3, 3, 80, 61, 61, 3, 2, 1, 0, 0];
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const t = hour.getTime() + i * HOUR;
    const h = new Date(t).getHours();
    const temp = Math.round((14 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI)) * 10) / 10;
    const code = codes[Math.floor(i / 2)] ?? 2;
    return {
      time: wall(t),
      temp,
      code,
      precipProb: code >= 61 ? 70 : code === 3 ? 20 : 5,
      isDay: h >= 7 && h < 19,
    };
  });
  const daily = Array.from({ length: 7 }, (_, i) => {
    const date = day(now, i);
    return {
      date,
      min: [9, 8, 10, 7, 6, 8, 9][i] ?? 8,
      max: [17, 14, 18, 13, 15, 19, 20][i] ?? 16,
      code: [80, 61, 2, 63, 3, 1, 0][i] ?? 2,
      precipProb: [70, 85, 10, 90, 25, 5, 0][i] ?? 0,
      sunrise: `${date}T07:${pad(19 + i)}`,
      sunset: `${date}T18:${pad(27 - i)}`,
      uvMax: [2, 1, 4, 1, 3, 4, 5][i] ?? 2,
    };
  });
  const first = hourly[0] ?? { temp: 14, code: 2, precipProb: 5, isDay: true };
  const view: ToolView = {
    kind: 'weather',
    place: { name: place, country: 'Pretendland' },
    at: wall(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    units: 'metric',
    current: {
      temp: first.temp,
      feels: Math.round((first.temp - 1.5) * 10) / 10,
      code: first.code,
      isDay: first.isDay,
      wind: 14,
      windDir: 250,
      gusts: 31,
      humidity: 72,
      precipProb: first.precipProb,
      uv: 2,
      pressure: 1012,
    },
    hourly,
    daily,
    airQuality: { european: 28, us: 41 },
    source: 'Open-Meteo',
  };
  return {
    tool: 'weather',
    input: { place },
    text: JSON.stringify({
      summary: `${place}: ${Math.round(first.temp)}°C now; showers this afternoon.`,
      now: { temp: first.temp, sky: 'Partly cloudy' },
    }),
    view,
    reply: `Take an umbrella: showers are likely in ${place} this afternoon, then it clears.`,
  };
}

/** A pretend recipe card (no picture: the mock fetches nothing). */
function recipe(dish: string): PretendFind {
  const title = dish.charAt(0).toUpperCase() + dish.slice(1);
  const step = (text: string, said?: string, seconds?: number, upTo?: number) => {
    const start = said ? text.indexOf(said) : -1;
    return {
      text,
      timers:
        said && seconds && start >= 0
          ? [{ start, end: start + said.length, seconds, ...(upTo && { upTo }) }]
          : [],
    };
  };
  const view: ToolView = {
    kind: 'recipe',
    items: [
      {
        title,
        source: { site: 'Pretend Kitchen', url: 'https://kitchen.example.org/recipes/pretend' },
        description: 'A weeknight favourite, made up for the mock.',
        yield: { amount: 4, unit: 'servings' },
        times: { prep: 600, cook: 1500, total: 2100 },
        rating: { value: 4.6, count: 212 },
        ingredients: [
          { text: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', item: 'olive oil' },
          { text: '1 onion, finely chopped', quantity: 1, item: 'onion', note: 'finely chopped' },
          {
            text: '2–3 cloves garlic',
            quantity: { from: 2, to: 3 },
            unit: 'cloves',
            item: 'garlic',
          },
          { text: '1½ cups rice', quantity: 1.5, unit: 'cups', item: 'rice' },
          { text: 'Salt, to taste', item: 'Salt', note: 'to taste' },
        ],
        steps: [
          step('Soften the onion and garlic in the olive oil for 5 minutes.', '5 minutes', 300),
          step('Stir in the rice and cook for 1 minute.', '1 minute', 60),
          step('Add water, cover and simmer for 18–20 minutes.', '18–20 minutes', 1080, 1200),
          step('Season with salt and serve.'),
        ],
        nutrition: [
          { label: 'Calories', value: '320 kcal' },
          { label: 'Protein', value: '7 g' },
        ],
      },
    ],
  };
  return {
    tool: 'recipe',
    input: { urls: ['https://kitchen.example.org/recipes/pretend'] },
    text: JSON.stringify({ recipes: [{ title }] }),
    view,
    reply: `Here’s a simple ${dish}: about 35 minutes, start to finish.`,
  };
}

function products(thing: string): PretendFind {
  const view: ToolView = {
    kind: 'products',
    compare: true,
    items: [
      {
        title: `Pour-over ${thing}, matte black`,
        url: 'https://shop.example.org/p/pour-over',
        price: { amount: 149, currency: 'USD' },
        was: { amount: 195, currency: 'USD' },
        rating: { value: 4.6, count: 1840 },
        store: 'Example Shop',
        brand: 'Fellow',
        availability: 'in_stock',
        highlights: ['0.9 litres', 'Holds a temperature for an hour', 'Gooseneck spout'],
      },
      {
        title: `Classic ${thing}, brushed steel`,
        url: 'https://kitchen.example.org/classic',
        price: { amount: 89.5, currency: 'USD' },
        rating: { value: 4.2, count: 312 },
        store: 'Kitchen Things',
        brand: 'Smeg',
        availability: 'limited',
        highlights: ['1.7 litres', 'Boils in 3 minutes'],
      },
      {
        title: `Travel ${thing}`,
        url: 'https://outdoors.example.org/travel',
        price: { amount: 39, currency: 'USD' },
        rating: { value: 3.8, count: 57 },
        store: 'Outdoors',
        availability: 'out_of_stock',
        highlights: ['0.5 litres', 'Folds flat'],
      },
    ],
  };
  return {
    tool: 'product_details',
    input: {
      urls: view.items.flatMap((i) => (i.url ? [i.url] : [])),
      compare: true,
    },
    text: JSON.stringify({ products: view.items.map((i) => ({ ...i, found: true })) }),
    view,
    reply: `The pour-over ${thing} is the one to get if you make coffee: it holds a temperature, and it’s 23% off. The classic boils more water at once, for less.`,
  };
}

/** Pretend cafés near a pretend hotel, on a map whose tiles weren't fetched (a drawn plan). */
function places(near: string): PretendFind {
  const at = { lat: 51.50715, lon: -0.14168 };
  const cafe = (name: string, lat: number, lon: number, distance: number, open: boolean) => ({
    name,
    category: 'cafe',
    lat,
    lon,
    distance,
    hours: 'Mo-Fr 08:00-18:00; Sa 09:00-14:00',
    openNow: open ? { open: true, at: '18:00' } : { open: false, at: '09:00', day: 'Sat' },
    url: 'https://www.openstreetmap.org/node/1',
    directions: {
      apple: `https://maps.apple.com/?daddr=${lat},${lon}`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
      osm: `https://www.openstreetmap.org/directions?to=${lat},${lon}`,
    },
  });
  const view: ToolView = {
    kind: 'places',
    mode: 'nearby',
    query: 'coffee',
    origin: { name: near, ...at },
    center: at,
    zoom: 16,
    map: {
      zoom: 16,
      x: 32741,
      y: 21791,
      cols: 3,
      rows: 2,
      tiles: [null, null, null, null, null, null],
    },
    attribution: '© OpenStreetMap contributors',
    items: [
      cafe('Pretend Kiosk', 51.5066, -0.1427, 120, true),
      cafe('Make-Believe Beans', 51.5081, -0.1405, 180, true),
      cafe('Imaginary Espresso', 51.5089, -0.1385, 260, false),
    ],
  };
  return {
    tool: 'places',
    input: { what: 'coffee', near },
    text: JSON.stringify({ places: view.items.map((p) => ({ name: p.name })) }),
    view,
    reply: 'Pretend Kiosk is closest and open now; Make-Believe Beans is a short walk further.',
  };
}

/** Pretend videos: ids of the right shape, no pictures (nothing is fetched). */
function videos(topic: string): PretendFind {
  const items = [
    ['aaaaaaaaaaa', `${topic}: a step-by-step guide`, 'Harbour Kitchen', 713],
    ['bbbbbbbbbbb', `The one thing to know about ${topic}`, 'The Flour Room', 504],
    ['ccccccccccc', `${topic}, explained in a talk`, 'Food Lab Talks', 3725],
  ] as const;
  const view: ToolView = {
    kind: 'videos',
    query: topic,
    items: items.map(([id, title, channel, duration]) => ({
      provider: 'youtube' as const,
      id,
      title,
      channel,
      duration,
      url: `https://www.youtube.com/watch?v=${id}`,
    })),
  };
  return {
    tool: 'video_search',
    input: { query: topic },
    text: JSON.stringify({ query: topic, videos: view.items.map((v) => ({ title: v.title })) }),
    view,
    reply: 'The first one is the best place to start; it plays right here.',
  };
}

/** A knowledge card, as `knowledge_card` draws it from Wikipedia (no picture: the mock fetches nothing). */
function knowledge(): PretendFind {
  const view: ToolView = {
    kind: 'knowledge',
    title: 'Ada Lovelace',
    description: 'English mathematician and writer (1815–1852)',
    extract:
      'Augusta Ada King, Countess of Lovelace, was an English mathematician and writer chiefly known for her work on Charles Babbage’s proposed mechanical general-purpose computer, the Analytical Engine. She was the first to recognise that the machine had applications beyond pure calculation, and published the first algorithm intended to be carried out by such a machine. As a result, she is often regarded as one of the first computer programmers.',
    facts: [
      { label: 'Born', value: '10 December 1815, London' },
      { label: 'Died', value: '27 November 1852, Marylebone' },
      { label: 'Occupation', value: 'Mathematician, writer' },
    ],
    url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
    lang: 'en',
    source: 'Wikipedia',
  };
  return {
    tool: 'knowledge_card',
    input: { query: 'Ada Lovelace', lang: 'en' },
    text: JSON.stringify({ ...view, kind: undefined }),
    view,
    reply:
      'She wrote what’s often called the first computer program, for Babbage’s Analytical Engine.',
  };
}

function books(): PretendFind {
  const book = (title: string, year: number, pages: number, rating: number, id: string) => ({
    title,
    authors: ['Ursula K. Le Guin'],
    year,
    pages,
    rating,
    url: `https://openlibrary.org/works/${id}`,
  });
  const view: ToolView = {
    kind: 'books',
    items: [
      { ...book('A Wizard of Earthsea', 1968, 183, 4.1, 'OL59863W'), subjects: ['Fantasy'] },
      {
        ...book('The Left Hand of Darkness', 1969, 304, 4.0, 'OL59878W'),
        subjects: ['Science fiction'],
      },
      { ...book('The Dispossessed', 1974, 387, 4.2, 'OL59856W'), subjects: ['Utopias'] },
      book('The Lathe of Heaven', 1971, 184, 3.9, 'OL59870W'),
    ],
  };
  return {
    tool: 'book_search',
    input: { query: 'Ursula K. Le Guin', limit: 6 },
    text: JSON.stringify({ books: view.items }),
    view,
    reply:
      'A Wizard of Earthsea is the gentlest place to start; The Dispossessed if you want ideas.',
  };
}

function shows(now: number): PretendFind {
  const view: ToolView = {
    kind: 'shows',
    items: [
      {
        title: 'Severance',
        kind: 'tv',
        year: 2022,
        genres: ['Drama', 'Mystery', 'Science-Fiction'],
        rating: 8.4,
        network: 'Apple TV+',
        status: 'Running',
        summary:
          'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
        next: { at: new Date(now + 3 * 24 * HOUR).toISOString(), season: 3, number: 1 },
        url: 'https://www.tvmaze.com/shows/44933/severance',
      },
    ],
  };
  return {
    tool: 'show_search',
    input: { query: 'Severance', kind: 'tv' },
    text: JSON.stringify({ shows: view.items }),
    view,
    reply: 'Season 3 starts in three days.',
  };
}

/** What a prompt asks the pretend apps for, if anything. */
export function pretendFind(prompt: string, now = Date.now()): PretendFind | undefined {
  const text = prompt.trim();
  if (/\bwhat(?:'|’)?s on my calendar\b/i.test(text)) return calendar(now);
  const email = /\bfind the (.+?) email\b/i.exec(text)?.[1];
  if (email) return mail(now, email.replace(/^.*\s/, ''));
  const file = /\bfind the (.+?) in drive\b/i.exec(text)?.[1];
  if (file) return files(now, file.replace(/^.*\s/, ''));
  const said = /\bwhat did #([\w-]+) say\b/i.exec(text)?.[1];
  if (said) return messages(now, said);
  if (/\b(?:weather|will it rain)\b/i.test(text))
    return weather(now, /\bin ([A-Z][\w-]+(?: [A-Z][\w-]+)?)/.exec(text)?.[1] ?? 'Lisbon');
  const dish = /\b(?:a )?recipe for (.+?)[.?!]*$/i.exec(text)?.[1];
  if (dish) return recipe(dish);
  const shopping = /\bshop for (?:an? |some )?([\w-]+?)s?[.?!]*$/i.exec(text)?.[1];
  if (shopping) return products(shopping.toLowerCase());
  const near = /\bcoffee near (.+?)[?.!]*$/i.exec(text)?.[1];
  if (near) return places(near);
  const topic = /\b(?:show|find) me (?:a )?videos? (?:of|on|about) (.+?)[?.!]*$/i.exec(text)?.[1];
  if (topic) return videos(topic);
  if (/\bwho (?:was|is) ada lovelace\b/i.test(text)) return knowledge();
  if (/\bbooks by (?:ursula k\.? )?le guin\b/i.test(text)) return books();
  if (/\bwhat(?:'|’)?s on with severance\b/i.test(text)) return shows(now);
  return undefined;
}
