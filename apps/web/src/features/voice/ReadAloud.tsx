import { IconButton } from '@conch/nacre';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { languageOf, useVoicePrefs } from './prefs';
import { canSpeak, createSpeaker, type Speaker } from './speak';

/** "Read aloud" on an answer: the device's own voice, nothing sent anywhere. */
export function ReadAloud({ text }: { text: string }) {
  const prefs = useVoicePrefs();
  const [speaking, setSpeaking] = useState(false);
  const speaker = useRef<Speaker | undefined>(undefined);
  useEffect(() => () => speaker.current?.stop(), []);
  if (!canSpeak()) return null;
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
        speechSynthesis.cancel();
        speaker.current = createSpeaker({
          lang: languageOf(prefs),
          voice: prefs.voice,
          rate: prefs.rate,
        });
        setSpeaking(true);
        void speaker.current.say(text).finally(() => setSpeaking(false));
      }}
    >
      {speaking ? <Square /> : <Volume2 />}
    </IconButton>
  );
}
