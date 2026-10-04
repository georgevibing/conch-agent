/**
 * The desktop app and its gateway (ADR 0054).
 *
 * The app starts the gateway as a child process and the two talk over the
 * IPC channel Node gives it, never a port. Neither trusts the other's
 * messages without these schemas: a message that doesn't parse is dropped.
 */
import { z } from 'zod';

/** WHATWG URL exists in browsers and Node; the protocol has neither's typings. */
const URLParser = (
  globalThis as unknown as {
    URL: new (input: string) => {
      protocol: string;
      hostname: string;
      username: string;
      password: string;
    };
  }
).URL;

/** A loopback web address, where a gateway answers. Nothing else is ever opened in the window. */
export const LoopbackUrl = z
  .string()
  .max(200)
  .refine((value) => {
    try {
      const url = new URLParser(value);
      return (
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Not an address on this computer.');

/** A release's files on GitHub: `https://github.com/<owner>/<repo>/releases/download/v1.2.3`. */
export const ReleaseFeed = z
  .string()
  .max(300)
  .regex(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/v[0-9A-Za-z.-]+$/,
    'Not a release on GitHub.',
  );

/** What the gateway tells the app. */
export const GatewayToApp = z.discriminatedUnion('type', [
  /** Conch is answering here: show it. */
  z.object({ type: z.literal('listening'), url: LoopbackUrl }),
  /** Another Conch already answers here (a checkout, Always on): show that one. This gateway stops. */
  z.object({ type: z.literal('elsewhere'), url: LoopbackUrl }),
  /** It couldn't start, in a sentence with the next step. It stops. */
  z.object({ type: z.literal('failed'), message: z.string().max(1000) }),
  /** Show or hide Conch in the menu bar, tray or panel. */
  z.object({ type: z.literal('tray'), on: z.boolean() }),
  /** The window is listening for "Hey Conch" (ADR 0078): the tray says so, and the window keeps running hidden. */
  z.object({ type: z.literal('wake'), on: z.boolean() }),
  /** "Hey Conch" was heard: bring the window to the front. */
  z.object({ type: z.literal('show') }),
  /** Download this release and replace the app with it (Settings → Health → Updates). */
  z.object({
    type: z.literal('update'),
    version: z.string().max(40),
    feed: ReleaseFeed,
  }),
]);
export type GatewayToApp = z.infer<typeof GatewayToApp>;

/** What the app tells the gateway: how an update is going, and the tray's "Stop listening". */
export const AppToGateway = z.discriminatedUnion('type', [
  /** "Stop listening for Hey Conch", pressed in the tray (ADR 0078). */
  z.object({ type: z.literal('wake.stop') }),
  z.object({
    type: z.literal('update.progress'),
    version: z.string().max(40),
    percent: z.number().min(0).max(100),
  }),
  /** Downloaded and checked: the app quits and the installer takes over. */
  z.object({ type: z.literal('update.ready'), version: z.string().max(40) }),
  z.object({
    type: z.literal('update.failed'),
    version: z.string().max(40),
    message: z.string().max(1000),
  }),
]);
export type AppToGateway = z.infer<typeof AppToGateway>;

/** How an installed app gets a new version: it replaces itself, or the person downloads it. */
export const AppUpdates = z.enum(['install', 'download']);
export type AppUpdates = z.infer<typeof AppUpdates>;
