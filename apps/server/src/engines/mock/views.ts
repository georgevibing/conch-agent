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

/**
 * A pie chart of made-up spending, drawn live in the chat. Numbers only: a
 * chart carries no words for a model to follow and no addresses.
 */
function pieChart(about: string): PretendFind {
  const labels = ['Rent', 'Food', 'Travel', 'Tools', 'Health'];
  const values = [1450, 620, 310, 185, 96];
  const view: ToolView = {
    kind: 'chart',
    type: 'pie',
    title: `Where the ${about} went`,
    subtitle: 'Last month, by category',
    labels,
    series: [{ name: 'Spend', values }],
    prefix: '$',
  };
  return {
    tool: 'chart_show',
    input: { type: 'pie', title: view.title, labels, series: view.series, prefix: '$' },
    text: 'Drawn in the chat: a pie chart — “Where the money went”, 5 parts of one whole.',
    view,
    reply: 'Rent is over half of it; everything else together is less than the rent.',
  };
}

/** A column chart of made-up weekly numbers, drawn live in the chat. */
function columnChart(about: string): PretendFind {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const view: ToolView = {
    kind: 'chart',
    type: 'column',
    title: `${about.charAt(0).toUpperCase()}${about.slice(1)} by day`,
    subtitle: 'Last week',
    labels,
    series: [
      { name: 'This week', values: [18, 24, 31, 27, 12] },
      { name: 'The week before', values: [15, 21, 22, 25, 14] },
    ],
    goal: { value: 25, label: 'Target' },
  };
  return {
    tool: 'chart_show',
    input: { type: 'column', title: view.title, labels, series: view.series },
    text: `Drawn in the chat: a column chart — “${view.title}”, 2 series over 5 points.`,
    view,
    reply: 'Wednesday was the peak both weeks, and only Wednesday and Thursday beat the target.',
  };
}

/**
 * Pretend prices: a made-up instrument with a made-up week, the same shape
 * every run. Nothing is fetched, and the card says Stooq the way a real one
 * would, so the demo shows the real card and not a different one.
 */
function quotes(now: number, symbols: string[], compare: boolean): PretendFind {
  const shapes: Record<string, { name: string; price: number; drift: number }> = {
    AAPL: { name: 'APPLE', price: 257.2, drift: 0.9 },
    MSFT: { name: 'MICROSOFT', price: 512.4, drift: -0.4 },
  };
  const closes = (price: number, drift: number) =>
    Array.from({ length: 22 }, (_, i) => {
      const wave = Math.sin((i / 21) * Math.PI * 1.6) * price * 0.018;
      return Math.round((price - drift * (21 - i) + wave) * 100) / 100;
    });
  const items = symbols.map((symbol) => {
    const shape = shapes[symbol] ?? { name: symbol, price: 100, drift: 0.2 };
    const series = closes(shape.price, shape.drift);
    const price = series.at(-1) ?? shape.price;
    const previous = series.at(-2) ?? price;
    return {
      symbol,
      name: shape.name,
      currency: 'USD',
      class: 'stock' as const,
      price,
      change: Math.round((price - previous) * 100) / 100,
      changePercent: Math.round(((price - previous) / previous) * 10000) / 100,
      asOf: new Date(now - 10 * HOUR).toISOString(),
      delayed: true,
      dayRange: {
        low: Math.round(price * 0.991 * 100) / 100,
        high: Math.round(price * 1.006 * 100) / 100,
      },
      previousClose: previous,
      open: previous,
      volume: 41_234_567,
      marketCap: {
        value: Math.round(price * 14_840_390_000),
        shares: 14_840_390_000,
        filed: day(now, -343),
        source: 'SEC EDGAR',
      },
      dayState: 'closed' as const,
      spark: { period: '1M' as const, values: series },
      source: 'Stooq',
    };
  });
  const view: ToolView = {
    kind: 'quotes',
    items,
    ...(compare && items.length > 1 && { compare: true }),
    series: symbols.map((symbol, k) => ({
      symbol,
      period: '1M' as const,
      dates: Array.from({ length: 22 }, (_, i) => day(now, i - 21)),
      closes: items[k]?.spark.values ?? [],
      currency: 'USD',
      source: 'Stooq (daily closes)',
      note: `Daily closes from ${day(now, -21)} to ${day(now, 0)}.`,
    })),
  };
  return {
    tool: 'quote',
    input: { symbols, period: '1M', compare },
    text: JSON.stringify({ quotes: items.map((q) => ({ symbol: q.symbol, price: q.price })) }),
    view,
    reply: compare
      ? `Over the month ${symbols[0]} is the stronger of the two; ${symbols[1]} has drifted. Delayed closes, and not advice.`
      : `${symbols[0]} closed a touch up on the day. These are delayed closes, not live prices.`,
  };
}

/** The coins the demo knows, with made-up figures in CoinGecko's shapes. */
const COINS: Record<
  string,
  {
    id: string;
    name: string;
    price: number;
    rank: number;
    circulating: number;
    max?: number;
    ath: number;
    athDaysAgo: number;
    changes: Record<'1h' | '24h' | '7d' | '30d' | '1y', number>;
  }
> = {
  BTC: {
    id: 'bitcoin',
    name: 'Bitcoin',
    price: 67_187,
    rank: 1,
    circulating: 19_610_806,
    max: 21_000_000,
    ath: 109_000,
    athDaysAgo: 627,
    changes: { '1h': 0.12, '24h': -0.31, '7d': 4.2, '30d': 12.08, '1y': 140.4 },
  },
  ETH: {
    id: 'ethereum',
    name: 'Ethereum',
    price: 2_612.4,
    rank: 2,
    circulating: 120_412_345,
    ath: 4_878.26,
    athDaysAgo: 1_795,
    changes: { '1h': -0.08, '24h': 1.42, '7d': 6.1, '30d': -3.4, '1y': 38.2 },
  },
};

/**
 * A pretend coin: CoinGecko's figures for a made-up month, hour by hour, the
 * same shape every run. Nothing is fetched; the card is the real one.
 */
function cryptoQuote(now: number, symbol: string): PretendFind {
  const coin = COINS[symbol] ?? COINS.BTC;
  if (!coin) throw new Error('no demo coin');
  const hours = 30 * 24;
  const start = coin.price / (1 + coin.changes['30d'] / 100);
  const points = Array.from({ length: 180 }, (_, i) => {
    const f = i / 179;
    const wave = Math.sin(i / 7) * coin.price * 0.012 + Math.sin(i / 23 + 1) * coin.price * 0.02;
    return {
      at: new Date(now - (1 - f) * hours * HOUR).toISOString(),
      price:
        Math.round((start + (coin.price - start) * f + wave * Math.sin(f * Math.PI)) * 100) / 100,
    };
  });
  const asOf = new Date(now - 2 * 60_000).toISOString();
  const quote = {
    symbol,
    name: coin.name,
    currency: 'USD',
    class: 'crypto' as const,
    price: coin.price,
    change: Math.round(coin.price * coin.changes['24h']) / 100,
    changePercent: coin.changes['24h'],
    asOf,
    delayed: true,
    dayRange: {
      low: Math.round(coin.price * 0.988 * 100) / 100,
      high: Math.round(coin.price * 1.009 * 100) / 100,
    },
    dayState: 'always' as const,
    spark: { period: '1W' as const, values: points.slice(-42).map((p) => p.price) },
    crypto: {
      id: coin.id,
      rank: coin.rank,
      marketCap: Math.round(coin.price * coin.circulating),
      fullyDiluted: Math.round(coin.price * (coin.max ?? coin.circulating)),
      volume24h: Math.round(coin.price * coin.circulating * 0.024),
      supply: {
        circulating: coin.circulating,
        ...(coin.max ? { total: coin.max, max: coin.max } : { unlimited: true }),
      },
      ath: {
        price: coin.ath,
        date: new Date(now - coin.athDaysAgo * 24 * HOUR).toISOString(),
        fromPercent: Math.round(((coin.price - coin.ath) / coin.ath) * 10_000) / 100,
      },
      changes: coin.changes,
      source: 'CoinGecko' as const,
    },
    source: 'CoinGecko',
  };
  const view: ToolView = {
    kind: 'quotes',
    items: [quote],
    series: [
      {
        symbol,
        period: '1M',
        dates: points.map((p) => p.at.slice(0, 10)),
        times: points.map((p) => p.at),
        closes: points.map((p) => p.price),
        currency: 'USD',
        source: 'CoinGecko (hourly)',
      },
    ],
  };
  return {
    tool: 'quote',
    input: { symbols: [symbol], period: '1M' },
    text: JSON.stringify({ quotes: [{ symbol, price: coin.price, source: 'CoinGecko' }] }),
    view,
    reply: `${coin.name} is a little ${coin.changes['24h'] < 0 ? 'down' : 'up'} on the day and up over the month. That’s CoinGecko’s average across exchanges, not one exchange’s price, and not advice.`,
  };
}

/** Pretend crypto as a whole: the total, its day, dominance and the biggest coins. */
function cryptoMarket(now: number): PretendFind {
  const coins = [
    ['bitcoin', 'BTC', 'Bitcoin', 67_187, -0.31, 4.2],
    ['ethereum', 'ETH', 'Ethereum', 2_612.4, 1.42, 6.1],
    ['tether', 'USDT', 'Tether', 1.0002, 0.01, 0],
    ['binancecoin', 'BNB', 'BNB', 581.2, 0.8, 2.2],
    ['solana', 'SOL', 'Solana', 148.73, 3.12, 11.4],
    ['usd-coin', 'USDC', 'USDC', 0.9999, 0, 0],
    ['ripple', 'XRP', 'XRP', 0.5312, -1.12, -2.4],
    ['dogecoin', 'DOGE', 'Dogecoin', 0.1123, 2.41, 8.8],
    ['the-open-network', 'TON', 'Toncoin', 5.21, -0.42, 1.2],
    ['tron', 'TRX', 'TRON', 0.1563, 0.32, 0.9],
  ] as const;
  const view: ToolView = {
    kind: 'crypto-market',
    currency: 'USD',
    totalMarketCap: 2_412_345_678_901,
    change24h: 1.23,
    volume24h: 81_234_567_890,
    dominance: { btc: 54.62, eth: 13.21 },
    coinsTracked: 17_234,
    coins: coins.map(([id, symbol, name, price, c24, c7], i) => ({
      id,
      symbol,
      name,
      rank: i + 1,
      price,
      change24h: c24,
      change7d: c7,
      spark: Array.from({ length: 42 }, (_, k) => {
        const f = k / 41;
        const wave = Math.sin(k / 3 + i) * price * 0.008;
        return (
          Math.round((price / (1 + c7 / 100) + (price - price / (1 + c7 / 100)) * f + wave) * 1e6) /
          1e6
        );
      }),
    })),
    asOf: new Date(now - 2 * 60_000).toISOString(),
    source: 'CoinGecko',
  };
  return {
    tool: 'crypto_market',
    input: {},
    text: JSON.stringify({ market: { totalMarketCap: 2_412_345_678_901, change24h: 1.23 } }),
    view,
    reply:
      'A quiet, slightly green day: the whole market is up about 1%, and bitcoin is still more than half of it. CoinGecko’s averages, not advice.',
  };
}

/** Pretend filings, in the shape SEC EDGAR really answers in. */
function fundamentals(now: number, company: string): PretendFind {
  const figure = (value: number, year: number) => ({
    value,
    period: `CY${year}`,
    periodEnd: `${year}-09-27`,
    form: '10-K',
    filed: `${year}-10-30`,
  });
  const years = [2023, 2024, 2025];
  const view: ToolView = {
    kind: 'fundamentals',
    source: 'SEC EDGAR',
    items: [
      {
        symbol: 'AAPL',
        name: `${company} Inc.`,
        cik: '320193',
        currency: 'USD',
        basis: 'annual',
        revenue: {
          label: 'Revenue',
          unit: 'currency',
          tag: 'RevenueFromContractWithCustomerExcludingAssessedTax',
          points: [383_285_000_000, 391_035_000_000, 416_161_000_000].map((v, i) =>
            figure(v, years[i] ?? 2025),
          ),
        },
        grossProfit: {
          label: 'Gross profit',
          unit: 'currency',
          tag: 'GrossProfit',
          points: [169_148_000_000, 180_683_000_000, 198_900_000_000].map((v, i) =>
            figure(v, years[i] ?? 2025),
          ),
        },
        netIncome: {
          label: 'Net income',
          unit: 'currency',
          tag: 'NetIncomeLoss',
          points: [96_995_000_000, 93_736_000_000, 112_010_000_000].map((v, i) =>
            figure(v, years[i] ?? 2025),
          ),
        },
        eps: {
          label: 'Earnings per share',
          unit: 'perShare',
          tag: 'EarningsPerShareDiluted',
          points: [6.13, 6.08, 7.48].map((v, i) => figure(v, years[i] ?? 2025)),
        },
        dividendPerShare: {
          label: 'Dividend per share',
          unit: 'perShare',
          tag: 'CommonStockDividendsPerShareDeclared',
          points: [0.94, 0.98, 1.04].map((v, i) => figure(v, years[i] ?? 2025)),
        },
        employees: {
          value: 164_000,
          period: 'CY2025',
          periodEnd: '2025-09-27',
          filed: '2025-10-30',
        },
        priceEarnings: {
          value: 34.39,
          price: 257.2,
          asOf: new Date(now - 10 * HOUR).toISOString(),
          period: 'CY2025',
        },
      },
    ],
  };
  return {
    tool: 'fundamentals',
    input: { companies: [company], basis: 'annual' },
    text: JSON.stringify({ companies: [{ symbol: 'AAPL', name: `${company} Inc.` }] }),
    view,
    reply: `Revenue grew about 6% last year and profit rather more, so margins widened. From its filings, not advice.`,
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
  // Only the plain question: a routine's "weather briefing" or other journeys' prompts stay theirs.
  if (/^(?:what(?:'|’)?s the weather in\b|will it rain in\b)/i.test(text))
    return weather(now, /\bin ([A-Z][\w-]+(?: [A-Z][\w-]+)?)/.exec(text)?.[1] ?? 'Lisbon');
  // Only these two openings: "chart" and "pie chart" turn up in plenty of
  // other journeys' prompts, and last round a wide pattern stole them.
  const pie = /^make me a pie chart of (?:my |the )?(.+?)[.?!]*$/i.exec(text)?.[1];
  if (pie) return pieChart(pie.toLowerCase());
  const charted = /^chart (?:my |the )?(.+?)[.?!]*$/i.exec(text)?.[1];
  if (charted) return columnChart(charted.toLowerCase());
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
  // Money: only a plain ticker in capitals, so "compare the two kettles" and
  // "how is the build doing" stay with the journeys they belong to.
  const at = /^[Ww]hat(?:'|’)?s ([A-Z][A-Z0-9.^-]{0,11}) at\b/.exec(text)?.[1];
  if (at) return COINS[at] ? cryptoQuote(now, at) : quotes(now, [at], false);
  // Crypto as a whole: only the plain question, from its first word.
  if (/^how(?:'|’)?s crypto doing\b|^how is crypto doing\b/i.test(text)) return cryptoMarket(now);
  const pair = /^[Cc]ompare ([A-Z][A-Z0-9.^-]{0,11}) and ([A-Z][A-Z0-9.^-]{0,11})\b/.exec(text);
  if (pair?.[1] && pair[2]) return quotes(now, [pair[1], pair[2]], true);
  const doing = /^[Hh]ow is ([A-Z][A-Za-z.]{1,19}) doing financially\b/.exec(text)?.[1];
  if (doing) return fundamentals(now, doing);
  return undefined;
}
