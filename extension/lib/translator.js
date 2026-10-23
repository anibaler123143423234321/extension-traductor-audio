/**
 * Traducción gratuita con el endpoint público de Google Translate (sin clave).
 * Incluye caché LRU y tiempo de espera para no bloquear los subtítulos.
 */
const CACHE_LIMIT = 500;
const TIMEOUT_MS = 5000;
const cache = new Map();

export async function translateText(text, from, to, { signal, fetchImpl = fetch } = {}) {
  const clean = normalizeText(text);
  if (!clean) return '';
  if (from === to) return clean;

  const key = `${from}>${to}:${clean}`;
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({ client: 'gtx', sl: from || 'auto', tl: to, dt: 't', q: clean });

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`Google Translate respondió ${response.status}`);

  const translated = parseGoogleResponse(await response.json());
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, translated);
  return translated;
}

export function parseGoogleResponse(data) {
  if (!Array.isArray(data?.[0])) return '';
  return data[0].map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('').trim();
}

export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}
