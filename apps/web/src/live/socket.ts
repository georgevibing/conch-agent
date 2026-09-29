import { ClientCommand, ServerEvent } from '@conch/protocol';

type Listener = (event: ServerEvent) => void;

/**
 * A WebSocket that never gives up: exponential backoff reconnects, a send
 * queue while offline, and an `onOpen` hook so callers can re-subscribe with
 * the last `seq` they saw.
 */
export class LiveSocket {
  #ws?: WebSocket;
  #queue: string[] = [];
  #listeners = new Set<Listener>();
  #attempt = 0;
  #closed = false;
  #timer?: ReturnType<typeof setTimeout>;
  #heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly url: string,
    private readonly hooks: {
      onOpen: () => void;
      onState: (state: 'connecting' | 'open' | 'reconnecting') => void;
    },
  ) {}

  connect() {
    this.#closed = false;
    this.hooks.onState(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
      this.hooks.onState('open');
      this.hooks.onOpen();
      for (const message of this.#queue.splice(0)) ws.send(message);
      this.#heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };
    ws.onmessage = (message) => {
      let json: unknown;
      try {
        json = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const parsed = ServerEvent.safeParse(json);
      if (!parsed.success) {
        console.warn('Ignoring unexpected server event', parsed.error.issues[0]);
        return;
      }
      for (const listener of this.#listeners) listener(parsed.data);
    };
    ws.onclose = (event?: { code?: number }) => {
      clearInterval(this.#heartbeat);
      if (this.#closed) return;
      // 4401: this device was signed out. Don't retry — show the sign-in screen.
      if (event?.code === 4401) {
        this.#closed = true;
        window.dispatchEvent(new Event('conch:signed-out'));
        return;
      }
      this.hooks.onState('reconnecting');
      const delay = Math.min(8000, 400 * 2 ** this.#attempt++) * (0.8 + Math.random() * 0.4);
      this.#timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(command: ClientCommand) {
    const message = JSON.stringify(ClientCommand.parse(command));
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(message);
    else if (command.type !== 'ping') this.#queue.push(message);
  }

  on(listener: Listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    clearInterval(this.#heartbeat);
    this.#ws?.close();
  }
}

export function socketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}
