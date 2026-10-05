import { useState, type FormEvent } from 'react';

import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import styles from './Folder.module.css';
import { FolderMark, type FolderLook } from './FolderMark';
import { MarkPicker } from './MarkPicker';

/** A folder as it's being made or changed. */
export interface FolderDraft extends FolderLook {
  name: string;
}

/** The longest a folder's name may be: enough for a few words, short enough for the sidebar. */
export const FOLDER_NAME_MAX = 40;

export interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Making a folder, or changing one. */
  mode: 'new' | 'edit';
  /** Where to start: the folder's own name and look when editing. */
  initial?: Partial<FolderDraft>;
  /** The name (trimmed), glyph and colour chosen. The dialog closes itself after. */
  onSave: (folder: FolderDraft) => void;
}

/**
 * Make a folder, or change one: a name, a colour and a glyph, with a
 * preview of how it'll sit in the list. Enter saves.
 */
export function FolderDialog({ open, onOpenChange, mode, initial, onSave }: FolderDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm" aria-describedby={undefined}>
        {/* Mounted only while open, so each opening starts from `initial`. */}
        <FolderForm
          mode={mode}
          initial={initial}
          onSave={(folder) => {
            onSave(folder);
            onOpenChange(false);
          }}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function FolderForm({
  mode,
  initial,
  onSave,
}: Pick<FolderDialogProps, 'mode' | 'initial' | 'onSave'>) {
  const [name, setName] = useState(initial?.name ?? '');
  const [look, setLook] = useState<FolderLook>({
    glyph: initial?.glyph ?? 'folder',
    color: initial?.color ?? 'blue',
  });
  const trimmed = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onSave({ name: trimmed, ...look });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <Dialog.Header>
        <Dialog.Title>{mode === 'new' ? 'New folder' : 'Edit folder'}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className={styles.dialogBody}>
        <div className={styles.preview} aria-hidden>
          <FolderMark glyph={look.glyph} color={look.color} size="md" />
          <span className={styles.previewName} data-empty={!trimmed || undefined}>
            {trimmed || 'Folder name'}
          </span>
        </div>
        <Field>
          <Field.Label>Name</Field.Label>
          {/* The first field: the dialog puts the cursor here as it opens. */}
          <Input
            required
            maxLength={FOLDER_NAME_MAX}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <MarkPicker value={look} onChange={setLook} />
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </Dialog.Close>
        <Button type="submit" disabled={!trimmed}>
          {mode === 'new' ? 'Create folder' : 'Save'}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
