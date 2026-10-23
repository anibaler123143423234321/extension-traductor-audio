/**
 * Utilidades compartidas por las pruebas e2e: servidor HTTPS que imita Groq,
 * Google Translate y Deepgram, audio de voz sintética y pequeños asserts.
 * Requiere openssl en el PATH.
 */
import { WebSocketServer } from 'ws';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encodeWav } from '../../extension/lib/audio/wav.js';

export function createReporter() {
  const results = [];
  return {
    results,
    step(name, fn) {
      return fn().then(
        () => results.push(`✔ ${name}`),
        (error) => {
          results.push(`✘ ${name}: ${error.message}`);
          throw error;
        }
      );
    }
  };
}

export async function waitFor(fn, { timeout = 20000, interval = 250, message = 'condición' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Tiempo agotado esperando ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Arranca las APIs simuladas y devuelve los argumentos de Chromium para usarlas. */
export async function startFakeEnvironment() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liveaudio-e2e-'));
  const keyFile = path.join(tmpDir, 'key.pem');
  const certFile = path.join(tmpDir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });

  const stats = { groqRequests: 0, deepgramConnections: 0, translations: 0 };
  const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' };
    const json = (data) => {
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST' });
      res.end();
    } else if (url.pathname === '/translate_a/single') {
      stats.translations++;
      const q = url.searchParams.get('q');
      json([[[`[ES] ${q}`, q]]]);
    } else if (url.pathname === '/openai/v1/audio/transcriptions') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        stats.groqRequests++;
        const body = Buffer.concat(chunks);
        if (!body.includes(Buffer.from('RIFF')) || req.headers.authorization !== 'Bearer gsk_test') {
          res.writeHead(400, cors);
          res.end('bad request');
          return;
        }
        json({ text: 'Hello everyone, welcome to the class.', segments: [{ text: ' Hello everyone, welcome to the class.', no_speech_prob: 0.01, avg_logprob: -0.1 }] });
      });
    } else {
      res.writeHead(404, cors);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server, handleProtocols: (protocols) => (protocols.has('token') ? 'token' : false) });
  wss.on('connection', (socket, req) => {
    stats.deepgramConnections++;
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

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${server.address().port}`;
  const fakeAudio = writeFakeSpeech(tmpDir);

  return {
    stats,
    // Sin variables de proxy del sistema: las peticiones deben llegar al servidor simulado.
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_proxy$/i.test(key))),
    chromiumArgs: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudio}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-proxy-server',
      '--ignore-certificate-errors',
      `--host-resolver-rules=MAP api.groq.com ${host},MAP translate.googleapis.com ${host},MAP api.deepgram.com ${host}`
    ],
    close() {
      wss.close();
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

// Voz sintética: 1,6 s de tono modulado (sílabas) y 0,7 s de silencio, en bucle.
function writeFakeSpeech(dir) {
  const rate = 48000;
  const samples = new Float32Array(rate * 2.3);
  for (let i = 0; i < rate * 1.6; i++) {
    const t = i / rate;
    samples[i] = 0.4 * Math.abs(Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * 220 * t);
  }
  const file = path.join(dir, 'fake-speech.wav');
  fs.writeFileSync(file, Buffer.from(encodeWav(samples, rate)));
  return file;
}
