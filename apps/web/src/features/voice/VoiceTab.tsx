import { isConchVoice } from '@conch/protocol';
import {
  Button,
  Collapsible,
  Field,
  RadioGroup,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  toast,
  VoiceLibrary,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useUpdateSettings } from '../../api/queries';
import { GetIt } from '../setup/GetIt';
import { voiceApi, voiceKeys } from './api';

import { Section } from '../settings/Section';
import { recognitionClass } from './listen';
import { languageOf, setVoicePrefs, useVoicePrefs } from './prefs';
import { PrivateDictation } from './PrivateDictation';
import { bestVoice, canSpeak, createSpeaker, hush } from './speak';
import { useListenEngine, useVoiceStatus } from './useEngine';

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

/** Where your voice is heard right now, as the page says it in one clause. */
const HOW: Record<string, string> = {
  device: 'heard on this device itself, privately.',
  private: 'heard on the computer Conch runs on, privately.',
  browser: 'heard by your browser’s speech service.',
};

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    canSpeak() ? speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (!canSpeak()) return;
    const synth = speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
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
  const conch = isConchVoice(prefs.voice);
  const voice = conch ? undefined : bestVoice(voices, lang, prefs.voice);
  const speech = useSpeech();
  const updateSettings = useUpdateSettings();
  const [trying, setTrying] = useState<string>();
  const ready = speech.data?.voices.filter((v) => v.state === 'ready') ?? [];
  const cloud = speech.data?.cloud ?? [];
  const chosen = conch ? prefs.voice : voice?.voiceURI;
  /** Natural voices live on the computer: voice notes from chat apps are answered with it too. */
  const choose = (id: string) => {
    setVoicePrefs({ voice: id });
    if (isConchVoice(id)) updateSettings.mutate({ preferences: { voice: id } });
  };
  const tryVoice = (id?: string) => {
    hush();
    setTrying(id);
    void createSpeaker({
      lang,
      voice: id ?? chosen,
      rate: prefs.rate,
      onFallback: (why) =>
        toast('Read with this device’s voice instead', { id: 'voice-fallback', description: why }),
    })
      .say('Hello. This is how I sound when I read to you.')
      .finally(() => setTrying(undefined));
  };

  return (
    <Stack gap={8}>
      <Section
        title="How Conch hears you"
        description={
          choice?.kind === 'ready'
            ? `Dictation and talking hands free — ${HOW[choice.engine]}`
            : 'Dictation and talking hands free.'
        }
      >
        <Stack gap={4}>
          {/* A default that's already right: compact choices, not a wall of cards. */}
          <Stack gap={2}>
            <Text as="span" size="sm" weight="medium" aria-hidden>
              Where it’s heard
            </Text>
            <RadioGroup
              aria-label="Where your voice is heard"
              value={prefs.engine}
              onValueChange={(engine) => setVoicePrefs({ engine: engine as typeof prefs.engine })}
            >
              <RadioGroup.Item
                value="auto"
                label="The most private way available"
                description="On this device when it can, then on the computer Conch runs on."
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
          </Stack>
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

      <HeyConch />

      {(canSpeak() || canSpeak('piper:x')) && (
        <Section title="How Conch sounds" description="Reading aloud, talking, and voice notes.">
          <Stack gap={4}>
            <Field>
              <Field.Label>Voice</Field.Label>
              <Select value={chosen ?? ''} onValueChange={choose} aria-label="Voice">
                {ready.length > 0 && (
                  <Select.Group label="On this computer">
                    {ready.map((v) => (
                      <Select.Item key={v.id} value={v.id}>
                        {v.name} · {v.language}
                      </Select.Item>
                    ))}
                  </Select.Group>
                )}
                {cloud.length > 0 && (
                  <Select.Group label="From OpenAI">
                    {cloud.map((v) => (
                      <Select.Item key={v.id} value={v.id}>
                        {v.name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                )}
                {canSpeak() && (
                  <Select.Group label="This device">
                    {(forLanguage.length ? forLanguage : voices).map((v) => (
                      <Select.Item key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                )}
              </Select>
              {prefs.voice?.startsWith('openai:') ? (
                <Field.Description>
                  What’s read aloud goes to OpenAI with your key, and counts there.
                </Field.Description>
              ) : (
                !forLanguage.length &&
                !conch && (
                  <Field.Description>
                    No voice for this language on this device yet. Get a natural voice below.
                  </Field.Description>
                )
              )}
            </Field>
            <NaturalVoices
              lang={lang}
              chosen={prefs.voice}
              trying={trying}
              onChoose={choose}
              onTry={tryVoice}
            />
            <Field>
              <Field.Label>Reading speed</Field.Label>
              <Slider
                thumbLabels={['Reading speed']}
                min={0.7}
                max={1.5}
                step={0.05}
                value={[prefs.rate]}
                onValueChange={([rate]) => setVoicePrefs({ rate: rate ?? 1 })}
              />
            </Field>
            <div>
              <Button
                variant="surface"
                leadingIcon={<Volume2 />}
                loading={trying !== undefined && trying === chosen}
                onClick={() => tryVoice()}
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

/** Natural voices on the computer Conch runs on, kept fresh while one downloads. */
export function useSpeech() {
  return useQuery({
    queryKey: voiceKeys.speech,
    queryFn: voiceApi.speech,
    staleTime: 30_000,
    refetchInterval: (q) =>
      q.state.data?.voices.some((v) => v.state === 'downloading') ? 1000 : false,
  });
}

/**
 * Natural voices (ADR 0077): Piper first (one press), then a few good voices
 * to get, try and use. The ones for this language come first.
 */
function NaturalVoices({
  lang,
  chosen,
  trying,
  onChoose,
  onTry,
}: {
  lang: string;
  chosen?: string;
  trying?: string;
  onChoose: (id: string) => void;
  onTry: (id: string) => void;
}) {
  const client = useQueryClient();
  const { data: speech } = useSpeech();
  if (!speech) return null;
  if (speech.piper === 'missing')
    return (
      <GetIt
        needId="piper"
        lead="Natural voices that run on this computer, offline, instead of this device’s own."
      />
    );
  const put = (next: typeof speech) => client.setQueryData(voiceKeys.speech, next);
  const base = lang.split('-')[0]?.toLowerCase() ?? 'en';
  const here = speech.voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const others = speech.voices.filter((v) => !v.lang.toLowerCase().startsWith(base));
  const library = (voices: typeof speech.voices, label: string) => (
    <VoiceLibrary
      aria-label={label}
      voices={voices}
      chosen={chosen}
      trying={trying}
      onDownload={(id) => void voiceApi.getVoice(id).then(put)}
      onPause={(id) => void voiceApi.pauseVoice(id).then(put)}
      onChoose={onChoose}
      onTry={onTry}
      onRemove={(id) => void voiceApi.forgetVoice(id).then(put)}
    />
  );
  return (
    <Stack gap={3}>
      {library(here.length ? here : speech.voices, 'Natural voices')}
      {here.length > 0 && others.length > 0 && (
        <Collapsible>
          <Collapsible.Trigger chevron>Other languages</Collapsible.Trigger>
          <Collapsible.Content>
            {library(others, 'Natural voices in other languages')}
          </Collapsible.Content>
        </Collapsible>
      )}
    </Stack>
  );
}

/**
 * "Hey Conch" (ADR 0078): only in the desktop app, off until it's turned on
 * here, and kept on this device. It needs private listening, which it uses.
 */
function HeyConch() {
  const prefs = useVoicePrefs();
  const { data: status } = useVoiceStatus();
  if (!status?.wake?.available) return null;
  const ready = status.private.state === 'ready';
  return (
    <Section title="Hey Conch" description="Start talking without touching anything.">
      <Stack gap={4}>
        <Switch
          labelPosition="start"
          checked={Boolean(prefs.wake)}
          onCheckedChange={(wake) => setVoicePrefs({ wake })}
          label="Listen for “Hey Conch”"
          description="The microphone listens on this computer only: speech is checked here and thrown away, nothing is recorded or sent. While it’s on, the window and the tray say so, with Stop."
        />
        {prefs.wake && !ready && <PrivateDictation />}
      </Stack>
    </Section>
  );
}
