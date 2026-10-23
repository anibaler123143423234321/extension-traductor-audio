import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { CaptionPipeline } from '../extension/lib/pipeline.js';
import { AppError } from '../extension/lib/errors.js';

function fakeEngine(id, { failOnStart, opensOwnMic = false } = {}) {
  return class FakeEngine {
    static id = id;
    static label = id;
    static opensOwnMic = opensOwnMic;
    static instances = [];
    constructor(options) {
      this.options = options;
      this.stopped = false;
      FakeEngine.instances.push(this);
    }
    async start() {
      if (failOnStart) throw new AppError(`${id}-fail`, `${id} no disponible.`);
    }
    stop() {
      this.stopped = true;
    }
    say(text, isFinal) {
      this.options.onTranscript({ text, isFinal });
    }
  };
}

const baseSettings = { engine: 'auto', sourceLang: 'en', targetLang: 'es', deepgramApiKey: '', groqApiKey: '' };
const slowTranslate = (delays) => async (text) => {
  await sleep(delays[text] ?? 5);
  return `ES(${text})`;
};

function createPipeline({ engines, settings = baseSettings, translate = slowTranslate({}) }) {
  const captions = [];
  const statuses = [];
  const pipeline = new CaptionPipeline({
    track: {},
    settings,
    engines,
    translate,
    onCaption: (c) => captions.push(c),
    onStatus: (s) => statuses.push(s)
  });
  return { pipeline, captions, statuses };
}

test('muestra el original al instante y completa la traducción después', async () => {
  const Live = fakeEngine('webspeech');
  const { pipeline, captions } = createPipeline({ engines: { webspeech: Live } });
  await pipeline.start();
  const engine = Live.instances[0];

  engine.say('Hello', false);
  assert.equal(captions.length, 1);
  assert.deepEqual([captions[0].original, captions[0].translated, captions[0].complete], ['Hello', '', false]);

  engine.say('Hello everyone', true);
  await sleep(30);
  const last = captions.at(-1);
  assert.equal(last.id, 0);
  assert.equal(last.translated, 'ES(Hello everyone)');
  assert.equal(last.complete, true);
  assert.equal(captions.filter((c) => c.complete).length, 1);

  engine.say('Next', false);
  assert.equal(captions.at(-1).id, 1, 'una frase nueva usa un id nuevo');
  pipeline.stop();
});

test('descarta traducciones antiguas que llegan tarde', async () => {
  const Live = fakeEngine('webspeech');
  const translate = slowTranslate({ 'one two': 80, 'one two three': 5 });
  const { pipeline, captions } = createPipeline({ engines: { webspeech: Live }, translate });
  await pipeline.start();
  const engine = Live.instances[0];

  engine.say('one two', false); // traducción lenta (80 ms)
  await sleep(400); // supera el intervalo de traducción parcial
  engine.say('one two three', true); // traducción rápida
  await sleep(150);

  const translatedSeq = captions.filter((c) => c.translated).map((c) => c.translated);
  assert.equal(translatedSeq.at(-1), 'ES(one two three)');
  assert.ok(!translatedSeq.slice(translatedSeq.indexOf('ES(one two three)')).includes('ES(one two)'));
  pipeline.stop();
});

test('limita la traducción de texto parcial mientras se habla', async () => {
  const Live = fakeEngine('webspeech');
  let calls = 0;
  const translate = async (text) => { calls++; return `ES(${text})`; };
  const { pipeline } = createPipeline({ engines: { webspeech: Live }, translate });
  await pipeline.start();
  const engine = Live.instances[0];

  for (let i = 1; i <= 20; i++) {
    engine.say('word '.repeat(i), false);
    await sleep(20);
  }
  await sleep(400);
  assert.ok(calls <= 4, `demasiadas traducciones parciales: ${calls}`);
  pipeline.stop();
});

test('en modo automático pasa al siguiente motor si uno falla al iniciar', async () => {
  const Deepgram = fakeEngine('deepgram', { failOnStart: true });
  const Live = fakeEngine('webspeech');
  const { pipeline, statuses } = createPipeline({
    engines: { deepgram: Deepgram, webspeech: Live },
    settings: { ...baseSettings, deepgramApiKey: 'key' }
  });
  await pipeline.start();
  assert.equal(pipeline.engineId, 'webspeech');
  assert.ok(statuses.some((s) => s.type === 'warning' && s.code === 'deepgram-fail'));
  assert.ok(statuses.some((s) => s.type === 'engine' && s.engine === 'webspeech'));
  pipeline.stop();
});

test('cambia de motor si el actual falla durante la sesión', async () => {
  const Live = fakeEngine('webspeech');
  const Groq = fakeEngine('groq');
  const { pipeline, captions } = createPipeline({
    engines: { webspeech: Live, groq: Groq },
    settings: { ...baseSettings, groqApiKey: 'gsk' }
  });
  await pipeline.start();
  Live.instances[0].options.onError(new AppError('network', 'sin red'));
  await sleep(10);
  assert.equal(pipeline.engineId, 'groq');

  Live.instances[0].say('ignorado', true);
  Groq.instances[0].say('desde groq', true);
  assert.equal(captions.at(-1).original, 'desde groq');
  assert.ok(!captions.some((c) => c.original === 'ignorado'), 'el motor caído ya no emite');
  pipeline.stop();
});

test('informa un error fatal si no quedan motores', async () => {
  const Live = fakeEngine('webspeech');
  const { pipeline, statuses } = createPipeline({ engines: { webspeech: Live } });
  await pipeline.start();
  Live.instances[0].options.onError(new AppError('mic-permission', 'falta permiso'));
  const error = statuses.find((s) => s.type === 'error');
  assert.equal(error.error.code, 'mic-permission');
  assert.equal(pipeline.running, false);
});

test('rechaza start() cuando ningún motor arranca', async () => {
  const Live = fakeEngine('webspeech', { failOnStart: true });
  const { pipeline } = createPipeline({ engines: { webspeech: Live } });
  await assert.rejects(pipeline.start(), /webspeech no disponible/);
});

test('si el idioma de origen y destino coinciden no traduce', async () => {
  const Live = fakeEngine('webspeech');
  const translate = () => assert.fail('no debe traducir');
  const { pipeline, captions } = createPipeline({
    engines: { webspeech: Live },
    settings: { ...baseSettings, targetLang: 'en' },
    translate
  });
  await pipeline.start();
  Live.instances[0].say('Same language', true);
  assert.equal(captions.at(-1).translated, 'Same language');
  assert.equal(captions.at(-1).complete, true);
  pipeline.stop();
});

test('web: el motor del navegador abre su propio micrófono (sin pista)', async () => {
  const Live = fakeEngine('webspeech', { opensOwnMic: true });
  let acquired = 0;
  const pipeline = new CaptionPipeline({
    settings: baseSettings,
    engines: { webspeech: Live },
    translate: slowTranslate({}),
    acquireTrack: async () => { acquired++; return { id: 'mic' }; },
    releaseTrack: () => {},
    onCaption: () => {},
    onStatus: () => {}
  });
  await pipeline.start();
  assert.equal(acquired, 0, 'no debe abrir el micrófono dos veces');
  assert.equal(Live.instances[0].options.track, null);
  pipeline.stop();
});

test('web: libera el micrófono al pasar de Deepgram al motor del navegador', async () => {
  const Deepgram = fakeEngine('deepgram', { failOnStart: true });
  const Live = fakeEngine('webspeech', { opensOwnMic: true });
  const released = [];
  const pipeline = new CaptionPipeline({
    settings: { ...baseSettings, deepgramApiKey: 'key' },
    engines: { deepgram: Deepgram, webspeech: Live },
    translate: slowTranslate({}),
    acquireTrack: async () => ({ id: 'mic' }),
    releaseTrack: (track) => released.push(track.id),
    onCaption: () => {},
    onStatus: () => {}
  });
  await pipeline.start();
  assert.equal(Deepgram.instances[0].options.track.id, 'mic');
  assert.deepEqual(released, ['mic']);
  assert.equal(pipeline.engineId, 'webspeech');
  pipeline.stop();
});

test('web: si se niega el micrófono, start() informa el error', async () => {
  const Groq = fakeEngine('groq');
  const pipeline = new CaptionPipeline({
    settings: { ...baseSettings, engine: 'groq', groqApiKey: 'gsk' },
    engines: { groq: Groq },
    translate: slowTranslate({}),
    acquireTrack: async () => { throw new AppError('mic-permission', 'Permiso de micrófono denegado.'); },
    releaseTrack: () => {},
    onCaption: () => {},
    onStatus: () => {}
  });
  await assert.rejects(pipeline.start(), (error) => error.code === 'mic-permission');
  assert.equal(Groq.instances.length, 0);
});

test('web: detener la escucha libera el micrófono', async () => {
  const Groq = fakeEngine('groq');
  const released = [];
  const pipeline = new CaptionPipeline({
    settings: { ...baseSettings, engine: 'groq', groqApiKey: 'gsk' },
    engines: { groq: Groq },
    translate: slowTranslate({}),
    acquireTrack: async () => ({ id: 'mic' }),
    releaseTrack: (track) => released.push(track.id),
    onCaption: () => {},
    onStatus: () => {}
  });
  await pipeline.start();
  pipeline.stop();
  assert.deepEqual(released, ['mic']);
  assert.equal(Groq.instances[0].stopped, true);
});
