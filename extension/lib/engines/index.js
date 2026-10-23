import { WebSpeechEngine } from './webspeech.js';
import { DeepgramEngine } from './deepgram.js';
import { GroqEngine } from './groq.js';

export const ENGINES = {
  [WebSpeechEngine.id]: WebSpeechEngine,
  [DeepgramEngine.id]: DeepgramEngine,
  [GroqEngine.id]: GroqEngine
};

/**
 * Orden de motores a probar. En modo automático: Deepgram (si hay clave),
 * Chrome Live (gratis) y Groq (si hay clave) como último recurso.
 */
export function resolveEngineOrder(settings) {
  if (settings.engine !== 'auto') return [settings.engine];
  const order = [];
  if (settings.deepgramApiKey) order.push('deepgram');
  order.push('webspeech');
  if (settings.groqApiKey) order.push('groq');
  return order;
}
