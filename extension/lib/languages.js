/**
 * Idiomas disponibles.
 * - speech: código BCP-47 para el reconocimiento de voz de Chrome.
 * - deepgramModel: modelo de Deepgram que soporta el idioma.
 */
export const LANGUAGES = [
  { code: 'en', label: 'Inglés', short: 'EN', speech: 'en-US', deepgramModel: 'nova-3' },
  { code: 'es', label: 'Español', short: 'ES', speech: 'es-ES', deepgramModel: 'nova-3' },
  { code: 'pt', label: 'Portugués', short: 'PT', speech: 'pt-BR', deepgramModel: 'nova-3' },
  { code: 'fr', label: 'Francés', short: 'FR', speech: 'fr-FR', deepgramModel: 'nova-3' },
  { code: 'de', label: 'Alemán', short: 'DE', speech: 'de-DE', deepgramModel: 'nova-3' },
  { code: 'it', label: 'Italiano', short: 'IT', speech: 'it-IT', deepgramModel: 'nova-3' },
  { code: 'nl', label: 'Neerlandés', short: 'NL', speech: 'nl-NL', deepgramModel: 'nova-3' },
  { code: 'ja', label: 'Japonés', short: 'JA', speech: 'ja-JP', deepgramModel: 'nova-3' },
  { code: 'ru', label: 'Ruso', short: 'RU', speech: 'ru-RU', deepgramModel: 'nova-3' },
  { code: 'hi', label: 'Hindi', short: 'HI', speech: 'hi-IN', deepgramModel: 'nova-3' },
  { code: 'ko', label: 'Coreano', short: 'KO', speech: 'ko-KR', deepgramModel: 'nova-2' },
  { code: 'zh', label: 'Chino', short: 'ZH', speech: 'zh-CN', deepgramModel: 'nova-2' },
  { code: 'tr', label: 'Turco', short: 'TR', speech: 'tr-TR', deepgramModel: 'nova-2' },
  { code: 'pl', label: 'Polaco', short: 'PL', speech: 'pl-PL', deepgramModel: 'nova-2' }
];

export function getLanguage(code) {
  return LANGUAGES.find((lang) => lang.code === code) ?? LANGUAGES[0];
}

export function fillLanguageSelect(select, selected) {
  select.replaceChildren(
    ...LANGUAGES.map((lang) => new Option(lang.label, lang.code, false, lang.code === selected))
  );
}
