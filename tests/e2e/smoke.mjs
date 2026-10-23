/**
 * Prueba de humo de punta a punta: carga la extensión en Chromium con un
 * micrófono simulado y las APIs de Groq / Google Translate / Deepgram simuladas
 * por un servidor HTTPS local, y comprueba que los subtítulos traducidos llegan
 * al historial y a la página.
 *
 *   npm run test:e2e            (en Linux sin pantalla: xvfb-run npm run test:e2e)
 *
 * Requiere openssl en el PATH. Variable opcional: SCREENSHOT_DIR para guardar capturas.
 */
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeWav } from '../../extension/lib/audio/wav.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const screenshotDir = process.env.SCREENSHOT_DIR;
const results = [];

function step(name, fn) {
  return fn().then(
    () => results.push(`✔ ${name}`),
    (error) => {
      results.push(`✘ ${name}: ${error.message}`);
      throw error;
    }
  );
}

async function waitFor(fn, { timeout = 20000, interval = 250, message = 'condición' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Tiempo agotado esperando ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// Audio de "voz" sintética: 1,6 s de tono modulado y 0,7 s de silencio, en bucle.
function writeFakeSpeech() {
  const rate = 48000;
  const samples = new Float32Array(rate * 2.3);
  for (let i = 0; i < rate * 1.6; i++) {
    const t = i / rate;
    samples[i] = 0.4 * Math.abs(Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * 220 * t);
  }
  const file = path.join(tmpDir, 'fake-speech.wav');
  fs.writeFileSync(file, Buffer.from(encodeWav(samples, rate)));
  return file;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liveaudio-e2e-'));

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>Clase de prueba</title><body style="margin:0;height:100vh;background:#1e293b;color:#fff;font:24px system-ui;display:grid;place-items:center"><h1>🎬 Video de prueba</h1></body>');
});
await new Promise((resolve) => server.listen(0, resolve));
const pageUrl = `http://localhost:${server.address().port}/`;

// Servidor que imita Groq, Google Translate y Deepgram.
const keyFile = path.join(tmpDir, 'key.pem');
const certFile = path.join(tmpDir, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });

let groqRequests = 0;
const mock = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const json = (data) => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/translate_a/single') {
    const q = url.searchParams.get('q');
    json([[[`[ES] ${q}`, q]]]);
  } else if (url.pathname === '/openai/v1/audio/transcriptions') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      groqRequests++;
      const body = Buffer.concat(chunks);
      const ok = body.includes(Buffer.from('RIFF')) && req.headers.authorization === 'Bearer gsk_test';
      if (!ok) {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      json({ text: 'Hello everyone, welcome to the class.', segments: [{ text: ' Hello everyone, welcome to the class.', no_speech_prob: 0.01, avg_logprob: -0.1 }] });
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});
const wss = new WebSocketServer({ server: mock, handleProtocols: (protocols) => (protocols.has('token') ? 'token' : false) });
wss.on('connection', (socket, req) => {
  assert.match(req.url, /^\/v1\/listen\?.*encoding=linear16/);
  let packets = 0;
  socket.on('message', (data, isBinary) => {
    if (!isBinary) return;
    packets++;
    if (packets % 10 === 5) {
      socket.send(JSON.stringify({ type: 'Results', is_final: false, speech_final: false, channel: { alternatives: [{ transcript: 'Live streaming' }] } }));
    }
    if (packets % 10 === 0) {
      socket.send(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'Live streaming text from Deepgram.' }] } }));
    }
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const mockHost = `127.0.0.1:${mock.address().port}`;

const fakeAudio = writeFakeSpeech();

const context = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1100, height: 700 },
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${fakeAudio}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-proxy-server',
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP api.groq.com ${mockHost},MAP translate.googleapis.com ${mockHost},MAP api.deepgram.com ${mockHost}`
  ]
});

const pageErrors = [];
context.on('weberror', (error) => pageErrors.push(error.error().message));

let exitCode = 0;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const extUrl = (file) => `chrome-extension://${extensionId}/${file}`;

  const page = await context.newPage();
  await page.goto(pageUrl);

  const control = await context.newPage();
  await control.goto(extUrl('popup.html'));
  const send = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const storage = (keys) => control.evaluate((k) => chrome.storage.local.get(k), keys);
  const tabId = await control.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0].id, pageUrl);

  await step('El popup carga con idiomas y motores', async () => {
    assert.ok((await control.locator('#sourceLang option').count()) > 10);
    assert.equal(await control.locator('#engineSelect option').count(), 4);
    assert.equal(await control.locator('#btnText').textContent(), 'Iniciar en esta pestaña');
    if (screenshotDir) await control.screenshot({ path: path.join(screenshotDir, 'popup.png'), clip: { x: 0, y: 0, width: 390, height: 700 } });
  });

  await step('Groq: micrófono → transcripción → traducción → historial', async () => {
    await control.evaluate(() => chrome.storage.local.set({ engine: 'groq', groqApiKey: 'gsk_test', source: 'mic', sessionHistory: [] }));
    const response = await send({ action: 'START_SESSION', tabId, tabTitle: 'Clase', source: 'mic' });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.engine, 'groq');

    const { sessionHistory } = await waitFor(async () => {
      const data = await storage('sessionHistory');
      return data.sessionHistory?.length ? data : null;
    }, { message: 'subtítulos de Groq en el historial' });
    assert.equal(sessionHistory[0].original, 'Hello everyone, welcome to the class.');
    assert.equal(sessionHistory[0].translated, '[ES] Hello everyone, welcome to the class.');
    assert.ok(groqRequests >= 1);

    const status = await send({ action: 'GET_STATUS' });
    assert.equal(status.capturing, true);
    assert.equal(status.engine, 'groq');
    await page.bringToFront();
    await page.waitForTimeout(300);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'overlay.png') });
  });

  await step('Detener libera la captura y cierra el offscreen', async () => {
    await send({ action: 'STOP_SESSION' });
    const status = await send({ action: 'GET_STATUS' });
    assert.equal(status.capturing, false);
    const contexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
    assert.equal(contexts.length, 0);
  });

  await step('Deepgram: streaming con resultados parciales y finales', async () => {
    await control.evaluate(() => chrome.storage.local.set({ engine: 'deepgram', deepgramApiKey: 'dg_test', sessionHistory: [] }));
    const response = await send({ action: 'START_SESSION', tabId, tabTitle: 'Clase', source: 'mic' });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.engine, 'deepgram');
    const { sessionHistory } = await waitFor(async () => {
      const data = await storage('sessionHistory');
      return data.sessionHistory?.length ? data : null;
    }, { message: 'subtítulos de Deepgram en el historial' });
    assert.equal(sessionHistory[0].translated, '[ES] Live streaming text from Deepgram.');
    await send({ action: 'STOP_SESSION' });
  });

  await step('Automático: si Chrome Live no funciona pasa a Groq', async () => {
    await control.evaluate(() => chrome.storage.local.set({ engine: 'auto', deepgramApiKey: '', groqApiKey: 'gsk_test', sessionHistory: [] }));
    const response = await send({ action: 'START_SESSION', tabId, tabTitle: 'Clase', source: 'mic' });
    assert.equal(response.ok, true, JSON.stringify(response));
    // Chromium de pruebas no tiene el servicio de voz de Google: debe acabar en Groq.
    const status = await waitFor(async () => {
      const s = await send({ action: 'GET_STATUS' });
      return s.engine === 'groq' ? s : null;
    }, { timeout: 30000, message: 'cambio automático a Groq' });
    results.push(`  · motor inicial: ${response.engine}; aviso: ${status.notice?.message ?? '—'}`);
    await waitFor(async () => (await storage('sessionHistory')).sessionHistory?.length, { message: 'subtítulos tras el cambio de motor' });
    await send({ action: 'STOP_SESSION' });
  });

  await step('La ventana de segundo monitor carga', async () => {
    const viewer = await context.newPage();
    await viewer.setViewportSize({ width: 780, height: 560 });
    await viewer.goto(extUrl('viewer.html'));
    await viewer.locator('.stream-item').first().waitFor();
    assert.match(await viewer.locator('#modeText').textContent(), /Bilingüe/);
    if (screenshotDir) await viewer.screenshot({ path: path.join(screenshotDir, 'viewer.png') });
  });

  await step('Páginas internas de Chrome se rechazan con un mensaje claro', async () => {
    const internal = await context.newPage();
    await internal.goto('chrome://version');
    const id = await control.evaluate(async () => (await chrome.tabs.query({ url: 'chrome://version/*' }))[0]?.id);
    const response = await send({ action: 'START_SESSION', tabId: id, source: 'tab' });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'restricted-page');
  });

  assert.deepEqual(pageErrors, [], `errores de JavaScript: ${pageErrors.join(' | ')}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  console.log(results.join('\n'));
  await context.close();
  server.close();
  mock.close();
  wss.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(exitCode);
}
