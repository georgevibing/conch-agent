/**
 * The question before a paid picture, in the approval card's words: a short
 * title of what will happen, where things go, and what it costs. The card
 * builds nothing itself; chat apps read `summary`.
 */

/** A model as people would say it: "Google: Gemini 2.5 Flash Image (Nano Banana)" → "Gemini 2.5 Flash Image". */
export function modelWords(model: { id: string; name?: string | undefined }): string {
  const named = model.name
    ?.replace(/^[^:]{1,40}:\s*/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  if (named) return named.slice(0, 60);
  const bare = model.id.split('/').at(-1) ?? model.id;
  return bare
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) =>
      /^(?:gpt|ai|sd|xl)$/i.test(word)
        ? word.toUpperCase()
        : /^\d/.test(word)
          ? word
          : `${word[0]?.toUpperCase()}${word.slice(1)}`,
    )
    .join(' ')
    .slice(0, 60);
}

/** "$0.04", "$1.20": what one picture is likely to cost. */
const dollars = (usd: number) => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

export interface PaidPictureAsk {
  summary: string;
  title: string;
  detail: string;
  cost: string;
}

/** The words for asking to make (or edit) one picture with a model on a paid service. */
export function paidPictureAsk(input: {
  editing: boolean;
  model: { id: string; name?: string | undefined };
  /** The service the picture is made on: "OpenRouter". */
  service?: string;
  /** What one picture usually costs, when it's known. */
  estimateUsd?: number;
}): PaidPictureAsk {
  const service = input.service ?? 'OpenRouter';
  const model = modelWords(input.model);
  const title = input.editing
    ? `Edit your picture with ${model} on ${service}`
    : `Make a picture with ${model} on ${service}`;
  const cost =
    input.estimateUsd !== undefined && input.estimateUsd > 0
      ? `Paid · about ${dollars(input.estimateUsd)}`
      : 'Paid';
  return {
    summary: `${title} (paid)`,
    title,
    detail: input.editing
      ? `Your picture and what you asked for go to ${service}`
      : `What you asked for goes to ${service}`,
    cost,
  };
}
