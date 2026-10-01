/**
 * Reading answers aloud, with the computer's or phone's own voices
 * (`speechSynthesis`): on the device, nothing sent anywhere (ADR 0027).
 */

/** Markdown as it sounds: no symbols, no code read out character by character. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (I’ve put the code on screen.) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences, so speech can start before a long answer is all there, and stop between them. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** The best voice for a language: the device's natural/enhanced ones first. */
export function bestVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  chosen?: string,
): SpeechSynthesisVoice | undefined {
  if (chosen) {
    const picked = voices.find((v) => v.voiceURI === chosen);
    if (picked) return picked;
  }
  const base = lang.split('-')[0]?.toLowerCase() ?? 'en';
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) +
    (v.lang.toLowerCase() === lang.toLowerCase() ? 2 : 0) +
    (v.localService ? 1 : 0) +
    (v.default ? 0.5 : 0);
  return [...matching].sort((a, b) => score(b) - score(a))[0] ?? voices.find((v) => v.default);
}

export interface Speaker {
  /** Say it; resolves when it's all been said (or it was stopped). */
  say(text: string): Promise<void>;
  stop(): void;
  speaking(): boolean;
}

export function createSpeaker(options: { lang: string; voice?: string; rate?: number }): Speaker {
  let stopped = false;
  return {
    async say(text) {
      if (!canSpeak()) return;
      stopped = false;
      const voices = speechSynthesis.getVoices();
      const voice = bestVoice(voices, options.lang, options.voice);
      for (const sentence of sentences(speakable(text))) {
        if (stopped) return;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(sentence);
          if (voice) u.voice = voice;
          u.lang = voice?.lang ?? options.lang;
          u.rate = options.rate ?? 1;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          speechSynthesis.speak(u);
        });
      }
    },
    stop() {
      stopped = true;
      if (canSpeak()) speechSynthesis.cancel();
    },
    speaking: () => canSpeak() && speechSynthesis.speaking,
  };
}
