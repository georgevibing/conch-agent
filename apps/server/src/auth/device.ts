import type { SessionInfo } from '@conch/protocol';

/** "Safari on iPhone" from a User-Agent — good enough to recognise your own devices. */
export function describeDevice(userAgent = ''): { device: string; kind: SessionInfo['kind'] } {
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : undefined;
  const [os, kind]: [string | undefined, SessionInfo['kind']] = /iPhone/.test(ua)
    ? ['iPhone', 'phone']
    : /iPad/.test(ua)
      ? ['iPad', 'tablet']
      : /Android/.test(ua)
        ? ['Android', /Mobile/.test(ua) ? 'phone' : 'tablet']
        : /Macintosh|Mac OS X/.test(ua)
          ? ['Mac', 'desktop']
          : /Windows/.test(ua)
            ? ['Windows', 'desktop']
            : /CrOS/.test(ua)
              ? ['Chromebook', 'desktop']
              : /Linux/.test(ua)
                ? ['Linux', 'desktop']
                : [undefined, 'other'];
  const device = browser && os ? `${browser} on ${os}` : (browser ?? os ?? 'Unknown device');
  return { device, kind };
}
