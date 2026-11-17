import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API (not in lib.dom for all browsers).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone in your browser settings, or type the observation instead.',
  'service-not-allowed': 'Speech recognition is not allowed on this page. Type the observation instead.',
  'no-speech': 'No speech was heard. Tap the microphone and try again.',
  'audio-capture': 'No microphone was found. Connect one, or type the observation instead.',
  network: 'Speech recognition needs an internet connection. Type the observation instead.',
  aborted: '',
};

export type SpeechState = 'idle' | 'listening' | 'unsupported';

/** Wraps SpeechRecognition / webkitSpeechRecognition with interim results and friendly errors. */
export function useSpeechRecognition(lang = 'en-IN') {
  const supported = typeof window !== 'undefined' && Boolean(getCtor());
  const [state, setState] = useState<SpeechState>(supported ? 'idle' : 'unsupported');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0); // 0..1 pulse used by the waveform
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const onFinal = useRef<((text: string) => void) | null>(null);

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(
    (handleFinal?: (text: string) => void) => {
      const C = getCtor();
      if (!C) {
        setState('unsupported');
        return;
      }
      setError(null);
      setTranscript('');
      setInterim('');
      finalRef.current = '';
      interimRef.current = '';
      onFinal.current = handleFinal || null;
      const r = new C();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onstart = () => setState('listening');
      r.onresult = (e) => {
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const res = e.results[i];
          if (res.isFinal) finalRef.current += `${res[0].transcript} `;
          else interimText += res[0].transcript;
        }
        setTranscript(finalRef.current.trim());
        setInterim(interimText);
        interimRef.current = interimText;
        setLevel(Math.random() * 0.5 + 0.5);
      };
      r.onerror = (e) => {
        const msg = ERRORS[e.error] ?? `Speech recognition error (${e.error}). Type the observation instead.`;
        if (msg) setError(msg);
      };
      r.onend = () => {
        setState('idle');
        setLevel(0);
        const text = `${finalRef.current} ${interimRef.current}`.trim();
        interimRef.current = '';
        setInterim('');
        if (text && onFinal.current) onFinal.current(text);
      };
      rec.current = r;
      try {
        r.start();
      } catch {
        setError('The microphone is busy. Wait a moment and try again.');
      }
    },
    [lang],
  );

  const stop = useCallback(() => rec.current?.stop(), []);
  const cancel = useCallback(() => {
    onFinal.current = null;
    rec.current?.abort();
    setState(supported ? 'idle' : 'unsupported');
  }, [supported]);

  return { supported, state, transcript, interim, error, level, start, stop, cancel, setError };
}
