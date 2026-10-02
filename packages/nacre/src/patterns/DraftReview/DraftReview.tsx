import { Text } from '../../components/Text';
import { Textarea } from '../../components/Textarea';
import styles from './DraftReview.module.css';

export interface DraftReviewProps {
  account?: string;
  to: readonly string[];
  subject: string;
  body: string;
}

/** The exact message being approved. Plain text, no model-controlled links or markup. */
export function DraftReview({ account, to, subject, body }: DraftReviewProps) {
  return (
    <section className={styles.root} aria-label="Draft to review">
      <dl className={styles.envelope}>
        {account && (
          <>
            <dt>Account</dt>
            <dd>{account}</dd>
          </>
        )}
        <dt>To</dt>
        <dd>{to.join(', ')}</dd>
        <dt>Subject</dt>
        <dd>{subject || '(No subject)'}</dd>
      </dl>
      <Textarea
        className={styles.body}
        aria-label="Draft message"
        readOnly
        value={body}
        minRows={4}
        maxRows={12}
        autosize
      />
      <Text size="sm" tone="muted">
        Saves a draft only. Nothing is sent.
      </Text>
    </section>
  );
}
