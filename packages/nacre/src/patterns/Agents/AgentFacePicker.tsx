import { Check } from 'lucide-react';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { AgentAvatar } from '../AgentAvatar/AgentAvatar';
import { AGENT_AVATAR_ART, AGENT_AVATAR_COLORS, type AgentFace } from '../AgentAvatar/presets';
import styles from './Agents.module.css';

/** The value `AgentFacePicker` works on: the protocol's preset face. */
export interface AgentPresetFace {
  kind: 'preset';
  id: string;
  color?: string;
}

export interface AgentFacePickerProps {
  /** The agent's name: each face is read as itself, the picture as theirs. */
  name: string;
  /** Its face now: a preset, or a picture of its own. */
  value: AgentFace;
  /** A preset chosen, or a colour for it. */
  onValueChange: (face: AgentPresetFace) => void;
  /** Other ways to a face: upload a picture, make one. Shown under the colours. */
  actions?: ReactNode;
  /** The ids to offer, in order (every preset Nacre draws, unless given). */
  presets?: readonly string[];
  /** `lg` where room is short (a dialog), `xl` on a page. */
  size?: 'lg' | 'xl';
  /** `center` on a page that's centred (the welcome). */
  align?: 'start' | 'center';
  className?: string;
}

const ALL = Object.keys(AGENT_AVATAR_ART);

/**
 * Choosing a face: the cast as a grid, then the colours it can wear, then
 * the ways to a picture of its own. A press is a choice; the arrow keys walk
 * each group. A picture of its own, while it has one, leads the grid.
 */
export function AgentFacePicker({
  name,
  value,
  onValueChange,
  actions,
  presets = ALL,
  size = 'xl',
  align = 'start',
  className,
}: AgentFacePickerProps) {
  const facesLabel = useId();
  const coloursLabel = useId();
  const picture = value.kind === 'image' ? value : undefined;
  const preset = value.kind === 'preset' ? value : undefined;
  const color = preset?.color ?? (preset ? AGENT_AVATAR_ART[preset.id]?.color : undefined);
  const chosen = picture ? 'picture' : (preset?.id ?? '');

  return (
    <div className={cx(styles.facePicker, className)} data-size={size} data-align={align}>
      <span id={facesLabel} className="nc-visually-hidden">
        Faces
      </span>
      <RadioPrimitive.Root
        aria-labelledby={facesLabel}
        value={chosen}
        onValueChange={(id) => {
          if (id === 'picture') return;
          // A face keeps the colour chosen for the last one, once one was chosen.
          onValueChange({ kind: 'preset', id, ...(preset?.color && { color: preset.color }) });
        }}
        loop
        className={styles.faces}
      >
        {picture && (
          <RadioPrimitive.Item
            value="picture"
            className={styles.faceOption}
            aria-label="Your picture"
          >
            <AgentAvatar name={name} avatar={picture} size={size} decorative />
            <Chosen />
          </RadioPrimitive.Item>
        )}
        {presets.map((id) => {
          const art = AGENT_AVATAR_ART[id];
          if (!art) return null;
          return (
            <RadioPrimitive.Item
              key={id}
              value={id}
              className={styles.faceOption}
              aria-label={art.label}
            >
              <AgentAvatar
                name={art.label}
                avatar={{
                  kind: 'preset',
                  id,
                  ...(chosen === id && preset?.color && { color: preset.color }),
                }}
                size={size}
                decorative
              />
              <Chosen />
            </RadioPrimitive.Item>
          );
        })}
      </RadioPrimitive.Root>
      {preset && (
        <>
          <span id={coloursLabel} className="nc-visually-hidden">
            Colour
          </span>
          <RadioPrimitive.Root
            aria-labelledby={coloursLabel}
            value={color ?? ''}
            onValueChange={(next) => onValueChange({ kind: 'preset', id: preset.id, color: next })}
            orientation="horizontal"
            loop
            className={styles.colours}
          >
            {AGENT_AVATAR_COLORS.map((swatch) => (
              <RadioPrimitive.Item
                key={swatch}
                value={swatch}
                className={styles.colour}
                data-color={swatch}
                aria-label={swatch[0]?.toUpperCase() + swatch.slice(1)}
              >
                <RadioPrimitive.Indicator className={styles.colourCheck}>
                  <Check aria-hidden />
                </RadioPrimitive.Indicator>
              </RadioPrimitive.Item>
            ))}
          </RadioPrimitive.Root>
        </>
      )}
      {actions && <div className={styles.faceActions}>{actions}</div>}
    </div>
  );
}

function Chosen() {
  return (
    <RadioPrimitive.Indicator className={styles.faceCheck}>
      <Check aria-hidden />
    </RadioPrimitive.Indicator>
  );
}
