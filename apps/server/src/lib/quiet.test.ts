import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { quietCryptoWarnings } from './quiet';

const warning = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('the crypto libraries’ "experimental" warnings', () => {
  it('leaves those two unsaid, and prints every other warning as before', () => {
    const target = new EventEmitter() as unknown as NodeJS.Process;
    const print = vi.fn();
    target.on('warning', print);
    quietCryptoWarnings(target);
    target.emit(
      'warning',
      warning(
        'ExperimentalWarning',
        'The supports Web Crypto API method is an experimental feature',
      ),
    );
    target.emit(
      'warning',
      warning(
        'ExperimentalWarning',
        'The ML-DSA-44 Web Crypto API algorithm is an experimental feature',
      ),
    );
    expect(print).not.toHaveBeenCalled();
    target.emit('warning', warning('ExperimentalWarning', 'VM Modules is an experimental feature'));
    target.emit('warning', warning('DeprecationWarning', 'Buffer() is deprecated'));
    expect(print).toHaveBeenCalledTimes(2);
  });
});
