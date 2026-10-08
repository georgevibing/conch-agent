/** Made-up numbers for stories and tests: nothing here is real. */
import type { ChartSpec } from './types';

export const quarterlyRevenue: ChartSpec = {
  type: 'column',
  title: 'Revenue by quarter',
  subtitle: 'Three regions, millions of euros',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Europe', values: [4.2, 5.1, 5.8, 7.4] },
    { name: 'Americas', values: [3.1, 3.4, 4.9, 5.2] },
    { name: 'Asia', values: [1.8, 2.6, 3.1, 4.4] },
  ],
  prefix: '€',
  source: 'the finance sheet',
};

export const monthlySignups: ChartSpec = {
  type: 'line',
  title: 'Sign-ups a month',
  subtitle: 'The last year, with a target of 900',
  labels: [
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
  ],
  series: [
    { name: 'Free', values: [420, 460, 390, 610, 700, 760, 820, 880, 910, 1020, 1105, 1180] },
    { name: 'Paid', values: [110, 128, 96, 170, 190, 215, 240, 268, 290, 320, 356, 402] },
  ],
  goal: { value: 900, label: 'Target' },
  source: 'the product log',
};

export const spendByCategory: ChartSpec = {
  type: 'pie',
  title: 'Where the money went',
  subtitle: 'September, by category',
  labels: ['Rent', 'Food', 'Travel', 'Tools', 'Health'],
  series: [{ name: 'Spend', values: [1450, 620, 310, 185, 96] }],
  prefix: '$',
};

export const longTail: ChartSpec = {
  type: 'donut',
  title: 'Visits by country',
  subtitle: 'Last 30 days',
  labels: [
    'Germany',
    'United States',
    'United Kingdom',
    'France',
    'Netherlands',
    'Spain',
    'Italy',
    'Poland',
    'Sweden',
    'Portugal',
    'Ireland',
    'Austria',
    'Denmark',
    'Belgium',
  ],
  series: [
    {
      name: 'Visits',
      values: [
        41_200, 33_800, 18_400, 12_900, 8400, 6100, 5200, 3900, 2600, 2100, 1700, 1400, 900, 700,
      ],
    },
  ],
  note: 'Bots filtered out.',
};

export const energyByHour: ChartSpec = {
  type: 'area',
  title: 'Energy used',
  subtitle: 'Yesterday, hour by hour',
  labels: Array.from({ length: 24 }, (_, i) => `2026-10-07T${String(i).padStart(2, '0')}:00`),
  series: [
    {
      name: 'Heating',
      values: [
        1.2, 1.1, 1.0, 1.0, 1.1, 1.6, 2.4, 3.1, 2.8, 2.2, 1.9, 1.8, 1.8, 1.9, 2.0, 2.3, 3.0, 3.6,
        3.4, 3.0, 2.6, 2.1, 1.7, 1.4,
      ],
    },
    {
      name: 'Everything else',
      values: [
        0.4, 0.4, 0.3, 0.3, 0.4, 0.6, 1.1, 1.4, 1.0, 0.8, 0.8, 0.9, 1.0, 0.9, 0.8, 1.0, 1.5, 1.9,
        2.1, 1.8, 1.4, 1.0, 0.7, 0.5,
      ],
    },
  ],
  stacked: true,
  unit: 'kWh',
};

export const teamLoad: ChartSpec = {
  type: 'bar',
  title: 'Open tickets by team',
  labels: [
    'Platform reliability',
    'Billing and invoices',
    'Mobile',
    'Design system',
    'Data warehouse',
    'Support tooling',
  ],
  series: [{ name: 'Open', values: [48, 36, 29, 21, 14, 9] }],
  goal: { value: 25, label: 'Healthy' },
};

export const eightSeries: ChartSpec = {
  type: 'column',
  title: 'Requests by endpoint',
  subtitle: 'Eight endpoints, the token ceiling',
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  series: [
    { name: '/search', values: [820, 910, 880, 1020, 760] },
    { name: '/chat', values: [640, 700, 760, 820, 610] },
    { name: '/files', values: [410, 450, 470, 520, 380] },
    { name: '/apps', values: [300, 330, 340, 390, 280] },
    { name: '/skills', values: [220, 240, 260, 280, 210] },
    { name: '/tasks', values: [160, 180, 190, 210, 150] },
    { name: '/memory', values: [110, 120, 130, 140, 100] },
    { name: '/health', values: [70, 80, 85, 90, 65] },
  ],
};

export const withGaps: ChartSpec = {
  type: 'line',
  title: 'Sensor readings',
  subtitle: 'Two sensors; the gaps are hours with no reading',
  labels: Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
  series: [
    {
      name: 'Inside',
      values: [21, 21.4, null, null, 22.1, 22.6, 22.4, 21.9, null, 21.2, 21, 20.8, 21.1, 21.5],
    },
    {
      name: 'Outside',
      values: [12, 13.2, 14.1, 13.6, null, 11.8, 10.4, 9.9, 11.2, 12.8, 13.4, null, null, 12.1],
    },
  ],
  unit: '°C',
};

export const twoMeasures: ChartSpec = {
  type: 'scatter',
  title: 'Price against rating',
  subtitle: 'Each dot is one kettle: price in £ along the bottom, rating out of 5 up the side',
  labels: ['19', '24', '29', '35', '39', '45', '52', '59', '64', '72', '85', '99'],
  series: [
    { name: 'Rating', values: [3.4, 3.8, 3.6, 4.1, 4.0, 4.3, 4.2, 4.5, 4.4, 4.6, 4.5, 4.7] },
  ],
};

export const onePoint: ChartSpec = {
  type: 'column',
  title: 'Today’s total',
  labels: ['Today'],
  series: [{ name: 'Orders', values: [184] }],
};
