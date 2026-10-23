/**
 * Utilidades compartidas por el popup y la ventana de segundo monitor.
 */
import { getLanguage } from './languages.js';

export const IS_MAC = /Mac/i.test(globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? '');

export const SHORTCUT_LABEL = IS_MAC ? '⌥ Option + ⇧ Shift + T' : 'Alt + Shift + T';

export function formatTime(ts) {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Acepta entradas del historial nuevo ({original, translated, ts}) y del antiguo ({english, spanish, time}). */
export function normalizeHistoryItem(item) {
  return {
    original: item.original ?? item.english ?? '',
    translated: item.translated ?? item.spanish ?? '',
    time: item.ts ? formatTime(item.ts) : item.time ?? ''
  };
}

export function historyToText(items, settings, title = 'TRANSCRIPCIÓN · LiveAudio Translate') {
  const from = getLanguage(settings.sourceLang).short;
  const to = getLanguage(settings.targetLang).short;
  const body = items
    .map(normalizeHistoryItem)
    .map((i) => `[${i.time}]\n${from}: ${i.original}\n${to}: ${i.translated || '—'}\n`)
    .join('\n');
  return `--- ${title} ---\n\n${body}`;
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampForFile() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

export async function flashButton(button, text, ms = 1500) {
  const original = button.textContent;
  button.textContent = text;
  await new Promise((resolve) => setTimeout(resolve, ms));
  button.textContent = original;
}

export function sendMessage(message) {
  return chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: { message: error.message } }));
}
