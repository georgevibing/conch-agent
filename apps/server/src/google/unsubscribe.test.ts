import { describe, expect, it } from 'vitest';

import { unsubscribeWay } from './unsubscribe';

describe('the way a list offers to leave it', () => {
  const ONE_CLICK = 'List-Unsubscribe=One-Click';

  it('prefers one click over https, then an email, then a page', () => {
    expect(unsubscribeWay('<mailto:x@list.example>, <https://list.example/u>', ONE_CLICK)).toEqual({
      kind: 'post',
      url: 'https://list.example/u',
    });
    expect(
      unsubscribeWay('<https://list.example/u>, <mailto:x@list.example?subject=stop>'),
    ).toEqual({
      kind: 'mail',
      to: 'x@list.example',
      subject: 'stop',
      body: 'unsubscribe',
    });
    expect(unsubscribeWay('<https://list.example/u>')).toEqual({
      kind: 'page',
      url: 'https://list.example/u',
    });
  });

  it('never posts inwards or in the clear, and reads nothing but angle brackets', () => {
    expect(unsubscribeWay('<https://127.0.0.1/u>', ONE_CLICK)).toEqual({ kind: 'none' });
    expect(unsubscribeWay('<https://10.0.0.5/u>', ONE_CLICK)).toEqual({ kind: 'none' });
    expect(unsubscribeWay('<http://list.example/u>', ONE_CLICK)).toEqual({ kind: 'none' });
    expect(unsubscribeWay('<https://user:pw@list.example/u>', ONE_CLICK)).toEqual({
      kind: 'none',
    });
    expect(unsubscribeWay('https://list.example/u', ONE_CLICK)).toEqual({ kind: 'none' });
    expect(unsubscribeWay('<mailto:not-an-address>')).toEqual({ kind: 'none' });
  });

  it('keeps a mailto subject on one line', () => {
    const way = unsubscribeWay('<mailto:x@list.example?subject=a%0D%0ABcc:%20evil@x.example>');
    expect(way).toMatchObject({ kind: 'mail', subject: 'a Bcc: evil@x.example' });
  });
});
