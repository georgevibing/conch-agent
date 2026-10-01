import { Button, Field, RadioGroup, Select, Slider, Stack, Text } from '@conch/nacre';
import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Section } from '../settings/Section';
import { recognitionClass } from './listen';
import { languageOf, setVoicePrefs, useVoicePrefs } from './prefs';
import { PrivateDictation } from './PrivateDictation';
import { bestVoice, canSpeak, createSpeaker } from './speak';
import { useListenEngine } from './useEngine';

const LANGUAGES: [string, string][] = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['de-DE', 'Deutsch'],
  ['el-GR', 'Ελληνικά'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['it-IT', 'Italiano'],
  ['nl-NL', 'Nederlands'],
  ['pt-BR', 'Português (Brasil)'],
  ['pl-PL', 'Polski'],
  ['tr-TR', 'Türkçe'],
  ['ja-JP', '日本語'],
  ['zh-CN', '中文'],
];

/** The language Select's "same as the browser" choice (an item can't be empty). */
const SAME = 'browser';

const HOW: Record<string, string> = {
  device: 'right now: on this device itself, privately.',
  private: 'right now: on the computer Conch runs on, privately.',
  browser: 'right now: your browser’s speech service.',
};

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    canSpeak() ? speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (!canSpeak()) return;
    const update = () => setVoices(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

/** Settings → Voice (ADR 0027): how Conch hears you, and how it sounds. Kept on this device. */
export function VoiceTab() {
  const prefs = useVoicePrefs();
  const choice = useListenEngine();
  const voices = useVoices();
  const lang = languageOf(prefs);
  const base = lang.split('-')[0] ?? 'en';
  const forLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const voice = bestVoice(voices, lang, prefs.voice);

  return (
    <Stack gap={8}>
      <Section
        title="How Conch hears you"
        description="For dictation in the message box, and for talking hands free. Kept on this device."
      >
        <Stack gap={4}>
          <RadioGroup
            variant="card"
            aria-label="How Conch hears you"
            value={prefs.engine}
            onValueChange={(engine) => setVoicePrefs({ engine: engine as typeof prefs.engine })}
          >
            <RadioGroup.Item
              value="auto"
              label="The most private way available"
              description={`On this device when it can, then on the computer Conch runs on${
                choice?.kind === 'ready' ? `; ${HOW[choice.engine]}` : '.'
              }`}
            />
            <RadioGroup.Item
              value="private"
              label="On the computer Conch runs on"
              description="Private everywhere, even on a phone. Works offline."
            />
            {recognitionClass() && (
              <RadioGroup.Item
                value="browser"
                label="Your browser’s speech service"
                description="Google for Chrome and Edge, Apple for Safari: they hear what you say."
              />
            )}
          </RadioGroup>
          <PrivateDictation />
          <Field>
            <Field.Label>Language</Field.Label>
            <Select
              value={prefs.lang ?? SAME}
              onValueChange={(value) =>
                setVoicePrefs({ lang: value === SAME ? undefined : value, voice: undefined })
              }
              aria-label="Language"
            >
              <Select.Item value={SAME}>Same as this browser ({navigator.language})</Select.Item>
              {LANGUAGES.map(([code, label]) => (
                <Select.Item key={code} value={code}>
                  {label}
                </Select.Item>
              ))}
            </Select>
          </Field>
        </Stack>
      </Section>

      {canSpeak() && (
        <Section
          title="How Conch sounds"
          description="Reading answers aloud, and talking back. This device’s own voices: nothing is sent anywhere."
        >
          <Stack gap={4}>
            <Field>
              <Field.Label>Voice</Field.Label>
              <Select
                value={voice?.voiceURI ?? ''}
                onValueChange={(value) => setVoicePrefs({ voice: value })}
                aria-label="Voice"
              >
                {(forLanguage.length ? forLanguage : voices).map((v) => (
                  <Select.Item key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </Select.Item>
                ))}
              </Select>
              {!forLanguage.length && (
                <Field.Description>
                  This device has no voice for this language yet. Add one in its system settings
                  (Accessibility → Spoken content).
                </Field.Description>
              )}
            </Field>
            <Stack gap={2}>
              <Text as="span" size="sm" weight="medium" id="voice-rate">
                Speed
              </Text>
              <Slider
                aria-labelledby="voice-rate"
                min={0.7}
                max={1.5}
                step={0.05}
                value={[prefs.rate]}
                onValueChange={([rate]) => setVoicePrefs({ rate: rate ?? 1 })}
              />
            </Stack>
            <div>
              <Button
                variant="surface"
                leadingIcon={<Volume2 />}
                onClick={() => {
                  speechSynthesis.cancel();
                  void createSpeaker({ lang, voice: voice?.voiceURI, rate: prefs.rate }).say(
                    'Hello. This is how I sound when I read to you.',
                  );
                }}
              >
                Try it
              </Button>
            </div>
          </Stack>
        </Section>
      )}
    </Stack>
  );
}
