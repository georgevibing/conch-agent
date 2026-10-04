import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { DnsRecordCard } from './DnsRecordCard';

describe('DnsRecordCard', () => {
  it('shows each record with its name and value ready to copy, and keeps looking', async () => {
    const { container } = renderNacre(
      <DnsRecordCard
        name="conch.example.com"
        server="203.0.113.7"
        state="waiting"
        records={[
          { type: 'A', host: 'conch', value: '203.0.113.7' },
          { type: 'AAAA', host: 'conch', value: '2001:db8::7' },
        ]}
      />,
    );
    expect(screen.getByText('Add this record where you bought your domain:')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Copy the value 2001:db8::7' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy the name conch' })).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent(
      'This server is at 203.0.113.7. Conch keeps looking',
    );
    await expectAccessible(container);
  });

  it('turns into one quiet check once the name points here', async () => {
    const { container } = renderNacre(
      <DnsRecordCard name="conch.example.com" state="found" records={[]} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('conch.example.com points here.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await expectAccessible(container);
  });
});
