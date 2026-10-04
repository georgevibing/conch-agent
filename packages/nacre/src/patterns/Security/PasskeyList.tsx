import { Check, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';

import { Badge } from '../../components/Badge';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import { PasskeyButton } from './PasskeyButton';
import { passkeyName, type PasskeyPlatform } from './passkeyPlatform';
import styles from './Security.module.css';

export interface PasskeyItem {
  id: string;
  /** What a person recognises: "iCloud Keychain", "Windows Hello", "Passkey on Chrome on Windows". */
  name: string;
  /** The address it signs in to: "conch.example.com". */
  site: string;
  /** "Added 3 Oct · last used 2 minutes ago". */
  meta: string;
  /** It works at the address this page is open on. */
  here?: boolean;
  /** Why it can't be removed (it's the only way in), if it can't. */
  keep?: string;
}

export interface PasskeyListProps extends Omit<ComponentProps<'div'>, 'children'> {
  passkeys: PasskeyItem[];
  /** What this device can add (`passkeyPlatform`); none hides the add button. */
  platform?: PasskeyPlatform;
  onAdd?: () => void;
  /** Adding one now (the browser is asking). */
  adding?: boolean;
  onRename?: (passkey: PasskeyItem, name: string) => void;
  onRemove?: (passkey: PasskeyItem) => void;
  /** The passkey being renamed or removed right now. */
  busy?: string;
}

/**
 * Settings → Security → Passkeys. Each one by the name of where it lives (the
 * password manager, or the device), the address it's for, and when it was
 * last used. The only way in can't be removed, and says why right there.
 * Adding one is the same button the person signs in with: "Add Touch ID".
 */
export function PasskeyList({
  passkeys,
  platform,
  onAdd,
  adding,
  onRename,
  onRemove,
  busy,
  className,
  ...props
}: PasskeyListProps) {
  return (
    <div className={cx(styles.passkeys, className)} {...props}>
      {passkeys.length ? (
        <ul aria-label="Passkeys" className={styles.devices}>
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              onRename={onRename}
              onRemove={onRemove}
              busy={busy === passkey.id}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.passkeysEmpty}>
          Sign in with a touch instead of typing. A passkey can’t be guessed, leaked or phished.
        </p>
      )}
      {platform && onAdd && (
        <div className={styles.passkeysAdd}>
          <PasskeyButton
            platform={platform}
            size="md"
            variant={passkeys.length ? 'surface' : 'solid'}
            loading={adding}
            onClick={onAdd}
          >
            {platform === 'phone'
              ? 'Add a passkey from your phone'
              : `Add ${passkeyName(platform)}`}
          </PasskeyButton>
        </div>
      )}
    </div>
  );
}

function PasskeyRow({
  passkey,
  onRename,
  onRemove,
  busy,
}: {
  passkey: PasskeyItem;
  onRename?: PasskeyListProps['onRename'];
  onRemove?: PasskeyListProps['onRemove'];
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name);
  const keepId = useId();

  const save = (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (next && next !== passkey.name) onRename?.(passkey, next);
    setEditing(false);
  };

  return (
    <li className={styles.device} data-elsewhere={passkey.here === false ? '' : undefined}>
      <span className={styles.deviceIcon} aria-hidden>
        <KeyRound />
      </span>
      {editing ? (
        <form className={styles.rename} onSubmit={save}>
          <Input
            size="sm"
            aria-label={`New name for ${passkey.name}`}
            value={name}
            maxLength={64}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just asked to rename it
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              setName(passkey.name);
              setEditing(false);
            }}
          />
          <IconButton size="sm" type="submit" label="Save name">
            <Check />
          </IconButton>
          <IconButton
            size="sm"
            label="Cancel"
            onClick={() => {
              setName(passkey.name);
              setEditing(false);
            }}
          >
            <X />
          </IconButton>
        </form>
      ) : (
        <>
          <div className={styles.deviceBody}>
            <p className={styles.deviceName}>
              {passkey.name}
              {passkey.here === false && (
                <Badge size="sm" variant="soft">
                  For {passkey.site}
                </Badge>
              )}
            </p>
            <p className={styles.deviceMeta}>
              {passkey.here === false ? passkey.meta : `${passkey.site} · ${passkey.meta}`}
            </p>
            {passkey.keep && onRemove && (
              <p id={keepId} className={styles.passkeyKeep}>
                {passkey.keep}
              </p>
            )}
          </div>
          <div className={styles.deviceActions}>
            {onRename && (
              <IconButton
                size="sm"
                label={`Rename ${passkey.name}`}
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil />
              </IconButton>
            )}
            {onRemove && (
              <IconButton
                size="sm"
                tone="danger"
                label={`Remove ${passkey.name}`}
                tooltip={!passkey.keep}
                disabled={Boolean(passkey.keep) || busy}
                aria-describedby={passkey.keep ? keepId : undefined}
                onClick={() => onRemove(passkey)}
              >
                <Trash2 />
              </IconButton>
            )}
          </div>
        </>
      )}
    </li>
  );
}
