import { IconButton, toast } from '@conch/nacre';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { languageOf, useVoicePrefs } from './prefs';
import { canSpeak, createSpeaker, hush, type Speaker } from './speak';

/** "Read aloud" on an answer: with the voice chosen in Settings → Voice. */
export function ReadAloud({ text }: { text: string }) {
  const prefs = useVoicePrefs();
  const [speaking, setSpeaking] = useState(false);
  const speaker = useRef<Speaker | undefined>(undefined);
  useEffect(() => () => speaker.current?.stop(), []);
  if (!canSpeak(prefs.voice) && !canSpeak()) return null;
  return (
    <IconButton
      size="sm"
      label={speaking ? 'Stop reading' : 'Read aloud'}
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          speaker.current?.stop();
          setSpeaking(false);
          return;
        }
        // One voice at a time across the page.
        hush();
        speaker.current = createSpeaker({
          lang: languageOf(prefs),
          voice: prefs.voice,
          rate: prefs.rate,
          onFallback: (why) =>
            toast('Read with this device’s voice instead', {
              id: 'voice-fallback',
              description: why,
            }),
        });
        setSpeaking(true);
        void speaker.current.say(text).finally(() => setSpeaking(false));
      }}
    >
      {speaking ? <Square /> : <Volume2 />}
    </IconButton>
  );
}
