/**
 * Prueba e2e de la web móvil: la abre en Chromium emulando un celular, con un
 * micrófono simulado y las APIs simuladas, y comprueba transcripción, traducción,
 * cambio automático de motor, ajustes y el código QR para compartir.
 *
 *   npm run test:e2e   (Linux sin pantalla: xvfb-run npm run test:e2e)
 *
 * Variable opcional: SCREENSHOT_DIR para guardar capturas.
 */
import { chromium, devices } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createReporter, startFakeEnvironment } from './helpers.mjs';

const screenshotDir = process.env.SCREENSHOT_DIR;
const shot = (page, name) => screenshotDir && page.screenshot({ path: path.join(screenshotDir, name) });
const { results, step } = createReporter();

const server = createStaticServer();
await new Promise((resolve) => server.listen(0, resolve));
const webUrl = `http://localhost:${server.address().port}/web/`;

const fake = await startFakeEnvironment();
const browser = await chromium.launch({ args: fake.chromiumArgs, env: fake.env });
const context = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

async function useSettings(settings) {
  await page.evaluate((s) => {
    localStorage.setItem('liveaudio-web:settings', JSON.stringify(s));
    localStorage.removeItem('liveaudio-web:history');
  }, settings);
  await page.reload();
}

async function listenUntil(text, { engine, timeout = 30000 }) {
  await page.locator('#btnMic').click();
  await page.locator('#statusLine', { hasText: `Escuchando · ${engine}` }).waitFor({ timeout });
  await page.locator('#transcriptList li', { hasText: text }).first().waitFor({ timeout });
}

async function stop() {
  await page.locator('#btnMic').click();
  await page.locator('#statusLine', { hasText: 'Listo para escuchar' }).waitFor();
}

let exitCode = 0;
try {
  await step('La web carga en el celular sin errores', async () => {
    await page.goto(webUrl);
    assert.match(await page.title(), /LiveAudio Translate · Inglés → Español/);
    assert.equal(await page.locator('#micLabel').textContent(), 'Toca para escuchar');
    assert.equal(await page.locator('#langFrom').textContent(), 'EN');
    assert.ok(await page.evaluate(() => window.isSecureContext));
    await shot(page, 'web-inicio.png');
  });

  await step('Groq: micrófono → transcripción → traducción', async () => {
    await useSettings({ engine: 'groq', groqApiKey: 'gsk_test' });
    await listenUntil('[ES] Hello everyone, welcome to the class.', { engine: 'Groq Whisper' });
    assert.equal(await page.locator('#textTranslated').textContent(), '[ES] Hello everyone, welcome to the class.');
    assert.equal(await page.locator('#textOriginal').textContent(), 'Hello everyone, welcome to the class.');
    await shot(page, 'web-escuchando.png');
    await stop();
  });

  await step('Deepgram: streaming en tiempo real', async () => {
    await useSettings({ engine: 'deepgram', deepgramApiKey: 'dg_test' });
    await listenUntil('[ES] Live streaming text from Deepgram.', { engine: 'Deepgram' });
    await stop();
  });

  await step('Automático: si el reconocimiento del navegador falla pasa a Groq', async () => {
    // Chromium de pruebas no tiene el servicio de voz de Google.
    await useSettings({ engine: 'auto', groqApiKey: 'gsk_test' });
    await listenUntil('[ES] Hello everyone', { engine: 'Groq Whisper', timeout: 45000 });
    await stop();
  });

  await step('La transcripción se guarda y sobrevive a recargar', async () => {
    await page.reload();
    assert.ok((await page.locator('#transcriptList li:not(.transcript-empty)').count()) >= 1);
  });

  await step('Ajustes: cambiar el idioma de destino', async () => {
    await page.locator('#btnSettings').click();
    await page.locator('#settingsSheet[open]').waitFor();
    await page.waitForTimeout(400);
    await shot(page, 'web-ajustes.png');
    await page.locator('#targetLang').selectOption('fr');
    await page.locator('#settingsSheet .sheet-head button').click();
    assert.equal(await page.locator('#langTo').textContent(), 'FR');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('liveaudio-web:settings')));
    assert.equal(saved.targetLang, 'fr');
  });

  await step('Compartir muestra el código QR', async () => {
    await page.locator('#btnShare').click();
    await page.locator('#qr svg').waitFor();
    await page.waitForTimeout(400); // fin de la animación de entrada
    assert.equal(await page.locator('#shareUrl').textContent(), webUrl);
    await shot(page, 'web-compartir.png');
  });

  await step('Sin clave ni reconocimiento de voz se explica qué hacer', async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
    });
    const iphone = await ctx.newPage();
    await iphone.goto(webUrl);
    await iphone.locator('#banner:not([hidden])').waitFor();
    assert.match(await iphone.locator('#bannerText').textContent(), /En iPhone usa Safari/);
    await shot(iphone, 'web-iphone-aviso.png');
    await ctx.close();
  });

  assert.deepEqual(pageErrors, [], `errores de JavaScript: ${pageErrors.join(' | ')}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  console.log(results.join('\n'));
  await browser.close();
  server.close();
  fake.close();
  process.exit(exitCode);
}
