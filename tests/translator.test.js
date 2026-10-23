import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateText, parseGoogleResponse, normalizeText } from '../extension/lib/translator.js';
import { cleanTranscript } from '../extension/lib/engines/groq.js';
import { normalizeSettings } from '../extension/lib/settings.js';
import { resolveEngineOrder } from '../extension/lib/engines/index.js';

test('parseGoogleResponse une los fragmentos traducidos', () => {
  const data = [[['Hola, ', 'Hello, ', null], ['¿cómo estás?', 'how are you?', null]], null, 'en'];
  assert.equal(parseGoogleResponse(data), 'Hola, ¿cómo estás?');
  assert.equal(parseGoogleResponse(null), '');
  assert.equal(parseGoogleResponse([null]), '');
});

test('translateText usa la caché y no repite peticiones', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.equal(url.searchParams.get('sl'), 'en');
    assert.equal(url.searchParams.get('tl'), 'es');
    return { ok: true, json: async () => [[['Buenos días', 'Good morning']]] };
  };
  assert.equal(await translateText('Good   morning', 'en', 'es', { fetchImpl }), 'Buenos días');
  assert.equal(await translateText('Good morning', 'en', 'es', { fetchImpl }), 'Buenos días');
  assert.equal(calls, 1);
});

test('translateText no traduce si el idioma es el mismo o el texto está vacío', async () => {
  const fetchImpl = () => assert.fail('no debe llamar a la red');
  assert.equal(await translateText('Hola', 'es', 'es', { fetchImpl }), 'Hola');
  assert.equal(await translateText('   ', 'en', 'es', { fetchImpl }), '');
});

test('translateText propaga errores HTTP', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(translateText('rate limited text', 'en', 'es', { fetchImpl }), /429/);
});

test('normalizeText compacta espacios', () => {
  assert.equal(normalizeText('  a \n b  '), 'a b');
  assert.equal(normalizeText(undefined), '');
});

test('cleanTranscript descarta silencio y frases inventadas por Whisper', () => {
  assert.equal(cleanTranscript({ text: ' Thank you. ' }), '');
  assert.equal(cleanTranscript({ text: 'Thanks for watching!' }), '');
  assert.equal(cleanTranscript({ text: 'you' }), '');
  assert.equal(
    cleanTranscript({
      segments: [
        { text: ' Welcome to the class.', no_speech_prob: 0.01, avg_logprob: -0.2 },
        { text: ' Subtitles by Amara', no_speech_prob: 0.9, avg_logprob: -1.2 }
      ]
    }),
    'Welcome to the class.'
  );
  assert.equal(cleanTranscript({ text: 'Thank you for joining the meeting today' }), 'Thank you for joining the meeting today');
});

test('normalizeSettings migra la configuración antigua', () => {
  const settings = normalizeSettings({ captionMode: 'spanish', groqApiKey: 'gsk_x', chunkInterval: 3500, engine: 'raro', fontSize: 99 });
  assert.equal(settings.captionMode, 'translation');
  assert.equal(settings.groqApiKey, 'gsk_x');
  assert.equal(settings.engine, 'auto');
  assert.equal(settings.fontSize, 48);
  assert.equal(settings.sourceLang, 'en');
  assert.equal(settings.targetLang, 'es');
});

test('resolveEngineOrder prioriza streaming y usa Groq como respaldo', () => {
  assert.deepEqual(resolveEngineOrder({ engine: 'auto' }), ['webspeech']);
  assert.deepEqual(resolveEngineOrder({ engine: 'auto', groqApiKey: 'g' }), ['webspeech', 'groq']);
  assert.deepEqual(resolveEngineOrder({ engine: 'auto', deepgramApiKey: 'd', groqApiKey: 'g' }), ['deepgram', 'webspeech', 'groq']);
  assert.deepEqual(resolveEngineOrder({ engine: 'groq' }), ['groq']);
});
