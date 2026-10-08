import { Text } from '../../components/Text';
import { Textarea } from '../../components/Textarea';
import styles from './DraftReview.module.css';

export interface DraftReviewProps {
  /** The account it's saved in, or sent from. */
  account?: string;
  to: readonly string[];
  cc?: readonly string[];
  subject: string;
  body: string;
  /** The names of the files it carries. */
  files?: readonly string[];
  /** A draft to save (nothing goes), or an email that goes as soon as you say so. */
  kind?: 'draft' | 'send';
}

/** The exact message being approved. Plain text, no model-controlled links or markup. */
export function DraftReview({
  account,
  to,
  cc,
  subject,
  body,
  files,
  kind = 'draft',
}: DraftReviewProps) {
  const send = kind === 'send';
  return (
    <section className={styles.root} aria-label={send ? 'Email to review' : 'Draft to review'}>
      <dl className={styles.envelope}>
        {account && (
          <>
            <dt>From</dt>
            <dd>{account}</dd>
          </>
        )}
        <dt>To</dt>
        <dd>{to.join(', ')}</dd>
        {cc?.length ? (
          <>
            <dt>Cc</dt>
            <dd>{cc.join(', ')}</dd>
          </>
        ) : null}
        <dt>Subject</dt>
        <dd>{subject || '(No subject)'}</dd>
        {files?.length ? (
          <>
            <dt>Files</dt>
            <dd>{files.join(', ')}</dd>
          </>
        ) : null}
      </dl>
      <Textarea
        className={styles.body}
        aria-label={send ? 'Email message' : 'Draft message'}
        readOnly
        value={body}
        minRows={4}
        maxRows={12}
        autosize
      />
      <Text size="sm" tone="muted">
        {send
          ? `Sends this email as it is${account ? ` from ${account}` : ''}.`
          : 'Saves a draft only. Nothing is sent.'}
      </Text>
    </section>
  );
}
