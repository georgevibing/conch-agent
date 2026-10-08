import { describe, expect, it } from 'vitest';

import { modelWords, paidPictureAsk } from './ask';

describe('the question before a paid picture', () => {
  it('says the model as people know it', () => {
    expect(
      modelWords({
        id: 'google/gemini-2.5-flash-image',
        name: 'Google: Gemini 2.5 Flash Image (Nano Banana)',
      }),
    ).toBe('Gemini 2.5 Flash Image');
    expect(modelWords({ id: 'black-forest-labs/flux.2-pro' })).toBe('Flux.2 Pro');
  });

  it('is a short title, where things go and what it costs', () => {
    const ask = paidPictureAsk({
      editing: true,
      model: { id: 'google/gemini-2.5-flash-image', name: 'Google: Gemini 2.5 Flash Image' },
    });
    expect(ask).toEqual({
      title: 'Edit your picture with Gemini 2.5 Flash Image on OpenRouter',
      detail: 'Your picture and what you asked for go to OpenRouter',
      cost: 'Paid',
      summary: 'Edit your picture with Gemini 2.5 Flash Image on OpenRouter (paid)',
    });
    expect(
      paidPictureAsk({ editing: false, model: { id: 'openai/gpt-image-1' }, estimateUsd: 0.04 }),
    ).toMatchObject({
      title: 'Make a picture with GPT Image 1 on OpenRouter',
      cost: 'Paid · about $0.04',
    });
  });
});
