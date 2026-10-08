import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { CookMode } from './CookMode';
import { loaf, shakshuka } from './fixtures';
import { RecipeCard, RecipeCards } from './RecipeCard';
import { ServingsStepper } from './Servings';
import { TimerChip, TimerTray } from './TimerChips';
import { clearTimer, pauseTimer, startTimer } from './timers';

const meta = {
  title: 'Patterns/Chat/Recipe',
  component: RecipeCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A recipe the assistant found, as a card to cook from. Its photo (the chat’s own copy, never a remote address) with the title in the display serif over a soft, opaque scrim; how long, how many and how well liked in chips. − and + rescale every amount: each number rolls to its new value, written as a cook writes it (½, ⅓, 1¾, 2–3). Ingredients tick off with a springy check while a strike draws through them. Every length of time in the method is a timer chip: a tap starts a countdown in place, a ring that empties round the time left; it keeps running while the card scrolls away (or is unmounted), chimes softly when it’s done and tells the app, which can notify. Nutrition waits folded; the page it came from opens in a new tab. **Cook** opens a full-height sheet with one step at a time in large type, the ingredients that step uses, the running timers along the top, Back and Next (arrow keys, a swipe), and the screen kept awake. Servings, ticks and timers last for the session.',
      },
    },
  },
  args: { recipe: shakshuka, stateKey: 'story-playground' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecipeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** No photo: the chef’s mark on a pearl tile; servings in loaves; a long overnight proof. */
export const WithoutAPicture: Story = { args: { recipe: loaf, stateKey: 'story-loaf' } };

/** Only what a page gave: no times, rating, servings or nutrition. Amounts scale as a multiplier. */
export const Sparse: Story = {
  args: {
    stateKey: 'story-sparse',
    recipe: {
      title: 'Lemon dressing',
      source: { site: 'notes.example.org', url: 'https://notes.example.org/dressing' },
      ingredients: [
        { text: '3 tbsp olive oil', quantity: 3, unit: 'tbsp', item: 'olive oil' },
        { text: '1 lemon, juiced', quantity: 1, item: 'lemon', note: 'juiced' },
        { text: 'A pinch of flaky salt', quantity: 1, unit: 'pinch', item: 'flaky salt' },
      ],
      steps: [{ text: 'Shake everything together in a jar.' }],
    },
  },
};

/** Ticked and doubled, as after a while at the stove (and a reload: it’s kept for the session). */
export const HalfwayThrough: Story = {
  args: { stateKey: 'story-halfway' },
  render: (args) => {
    sessionStorage.setItem(
      'nc-recipe:story-halfway',
      JSON.stringify({ servings: 8, checked: [0, 1, 2, 4] }),
    );
    return <RecipeCard {...args} />;
  },
};

/** Timers going: one running, one paused, one done (it chimes when it ends). */
export const TimersRunning: Story = {
  args: { stateKey: 'story-timers' },
  render: (args) => <WithTimers {...args} />,
};

function WithTimers(args: Story['args']) {
  // Set going as the story is drawn, so the card arrives with them.
  useState(() => {
    const key = 'story-timers';
    startTimer({ id: `${key}:0:0`, recipe: key, step: 0, label: 'Step 1', ms: 600_000 });
    startTimer({ id: `${key}:2:0`, recipe: key, step: 2, label: 'Step 3', ms: 900_000 });
    pauseTimer(`${key}:2:0`);
    startTimer({ id: `${key}:1:0`, recipe: key, step: 1, label: 'Step 2', ms: 1 });
    return true;
  });
  useEffect(() => () => ['0:0', '1:0', '2:0'].forEach((t) => clearTimer(`story-timers:${t}`)), []);
  return <RecipeCard recipe={shakshuka} {...args} />;
}

/** Cook mode, open on a step with a timer going and the ingredients it uses. */
export const Cooking: Story = {
  args: { stateKey: 'story-cook' },
  parameters: { layout: 'fullscreen' },
  render: (args) => <Cook {...args} />,
};

function Cook(args: Story['args']) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(2);
  useEffect(() => {
    const key = 'story-cook';
    startTimer({ id: `${key}:2:0`, recipe: key, step: 2, label: 'Step 3', ms: 900_000 });
    startTimer({ id: `${key}:0:0`, recipe: key, step: 0, label: 'Step 1', ms: 420_000 });
    return () => ['0:0', '2:0'].forEach((t) => clearTimer(`${key}:${t}`));
  }, []);
  return (
    <>
      <RecipeCard recipe={shakshuka} {...args} />
      <CookMode
        open={open}
        onOpenChange={setOpen}
        recipe={shakshuka}
        recipeKey="story-cook"
        factor={1.5}
        step={step}
        onStepChange={setStep}
      />
    </>
  );
}

/** Two to compare, one under another. */
export const Several: Story = {
  render: () => <RecipeCards recipes={[shakshuka, loaf]} />,
};

/** The parts on their own: the stepper and a chip in each state. */
export const Parts: Story = {
  render: () => <PartsDemo />,
};

function PartsDemo() {
  const [n, setN] = useState(4);
  useEffect(() => {
    startTimer({ id: 'parts:run', recipe: 'parts', step: 1, label: 'Step 2', ms: 300_000 });
    return () => clearTimer('parts:run');
  }, []);
  return (
    <div style={{ display: 'grid', gap: 16, fontSize: 14 }}>
      <ServingsStepper value={n} onChange={setN} unit="servings" />
      <ServingsStepper value={n} onChange={setN} size="lg" />
      <p>
        Bake for{' '}
        <TimerChip
          id="parts:idle"
          recipe="parts"
          step={0}
          label="Step 1"
          seconds={1200}
          upTo={1500}
          words="20–25 minutes"
        />{' '}
        until golden, then rest for{' '}
        <TimerChip
          id="parts:run"
          recipe="parts"
          step={1}
          label="Step 2"
          seconds={300}
          words="5 minutes"
        />
        .
      </p>
      <TimerTray recipe="parts" />
    </div>
  );
}
