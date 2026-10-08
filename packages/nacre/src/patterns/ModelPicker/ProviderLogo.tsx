import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { brandMarks, OPENAI } from '../Integrations/brands';
import styles from './ModelPicker.module.css';

/**
 * `local`: a model on this computer (Ollama), drawn as the computer it runs on.
 * `server`: a server someone added themselves, drawn as a server.
 * `cloud`: your company's cloud (Bedrock, Vertex, Azure: ADR 0109), drawn as a cloud.
 */
export type ProviderId =
  | 'claude'
  | 'openai'
  | 'openrouter'
  | 'copilot'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'groq'
  | 'cerebras'
  | 'zai'
  | 'kimi'
  | 'minimax'
  | 'qwen'
  | 'ollama'
  | 'lmstudio'
  | 'local'
  | 'server'
  | 'cloud'
  | 'generic';

export interface ProviderLogoProps extends Omit<ComponentProps<'svg'>, 'children'> {
  provider: ProviderId;
  size?: number;
  /** Accessible name. Omit when a visible label sits next to the logo. */
  title?: string;
}

/** Twelve rays of slightly uneven length — a crisp, identifiable sunburst. */
const claudeRays = Array.from({ length: 12 }, (_, i) => ({
  angle: i * 30 + (i % 2 ? 4 : -3),
  outer: i % 3 === 0 ? 10.6 : i % 3 === 1 ? 9.2 : 9.9,
}));

/** Real marks, where a provider has one we bundle (the Claude sunburst is drawn below). */
const marks: Partial<Record<ProviderId, string>> = {
  openai: OPENAI,
  openrouter: brandMarks.openrouter,
  copilot: brandMarks.copilot,
  gemini: brandMarks.gemini,
  deepseek: brandMarks.deepseek,
  mistral: brandMarks.mistral,
  kimi: brandMarks.moonshot,
  minimax: brandMarks.minimax,
  qwen: brandMarks.qwen,
  zai: brandMarks.zai,
  ollama: brandMarks['ollama-cloud'],
  lmstudio: brandMarks['lm-studio'],
};

/** A letter for the labs Simple Icons has no mark for, on a soft tile. */
const letters: Partial<Record<ProviderId, string>> = {
  xai: 'x',
  groq: 'g',
  cerebras: 'c',
};

/** Small mark that identifies which provider serves a model. */
export function ProviderLogo({
  provider,
  size = 16,
  title,
  className,
  ...props
}: ProviderLogoProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-provider={provider}
      className={cx(styles.logo, className)}
      {...a11y}
      {...props}
    >
      {provider === 'claude' ? (
        <g stroke="currentColor" strokeLinecap="round" strokeWidth="2.3">
          {claudeRays.map(({ angle, outer }) => (
            <line
              key={angle}
              x1="12"
              y1="12"
              x2="12"
              y2={12 - outer}
              transform={`rotate(${angle} 12 12)`}
            />
          ))}
        </g>
      ) : provider === 'local' ? (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="4.5" width="16" height="11.5" rx="2" />
          <path d="M1.5 20h21" />
        </g>
      ) : provider === 'server' ? (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3.5" width="18" height="7" rx="2" />
          <rect x="3" y="13.5" width="18" height="7" rx="2" />
          <path d="M7 7h.01M7 17h.01" />
        </g>
      ) : provider === 'cloud' ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 8.6 5 5 0 0 0 7 19Z"
        />
      ) : marks[provider] ? (
        <path fill="currentColor" d={marks[provider]} />
      ) : (
        <>
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="21"
            rx="6.5"
            fill="currentColor"
            opacity="0.14"
          />
          <text
            x="12"
            y="16.2"
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="650"
            fill="currentColor"
            fontFamily="var(--nc-font-sans)"
          >
            {letters[provider] ?? '•'}
          </text>
        </>
      )}
    </svg>
  );
}
