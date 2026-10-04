import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './DnsRecordCard.module.css';

export interface DnsRecord {
  type: 'A' | 'AAAA';
  /** Relative to the domain, as most providers ask for it: `conch`, or `@` for the domain itself. */
  host: string;
  value: string;
}

export interface DnsRecordCardProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** The address being set up: "conch.example.com". */
  name: string;
  /** The records to add where the domain was bought. */
  records: readonly DnsRecord[];
  /** This server's own address, said once so the person can check it. */
  server?: string;
  /** `waiting` looks again by itself; `found` means the name points here now. */
  state: 'waiting' | 'found';
}

/**
 * The one record to add at a domain provider so an address reaches Conch
 * (ADR 0064): type, name and value, each ready to copy, and whether it has
 * arrived. While waiting it says Conch keeps looking by itself; once found,
 * one quiet check takes its place.
 */
export function DnsRecordCard({
  name,
  records,
  server,
  state,
  className,
  ...props
}: DnsRecordCardProps) {
  if (state === 'found') {
    return (
      <section
        aria-label={`The record for ${name}`}
        className={cx(styles.root, className)}
        data-state="found"
        {...props}
      >
        <p className={styles.found} role="status">
          <span className={styles.tick} aria-hidden>
            <Check />
          </span>
          {name} points here.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label={`The record for ${name}`}
      className={cx(styles.root, className)}
      data-state="waiting"
      {...props}
    >
      <p className={styles.lead}>Add this record where you bought your domain:</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Name</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.type}-${record.value}`}>
              <td className={styles.type}>{record.type}</td>
              <td>
                <span className={styles.cell}>
                  <code>{record.host}</code>
                  <CopyButton value={record.host} label={`Copy the name ${record.host}`} />
                </span>
              </td>
              <td>
                <span className={styles.cell}>
                  <code>{record.value}</code>
                  <CopyButton value={record.value} label={`Copy the value ${record.value}`} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.meta} role="status">
        <Pearl size="xs" state="thinking" label={null} />
        {server ? `This server is at ${server}. ` : ''}Conch keeps looking, and carries on when it
        arrives.
      </p>
    </section>
  );
}
