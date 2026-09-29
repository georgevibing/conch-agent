import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { brandMarks, OPENAI } from '../Integrations/brands';
import styles from './ModelPicker.module.css';

export type ProviderId = 'claude' | 'openai' | 'openrouter' | 'generic';

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
            •
          </text>
        </>
      )}
    </svg>
  );
}
