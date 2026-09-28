// Strings for the Graphics settings section, in every supported locale.
// The rest of the game ships in English; this panel picks its language from
// navigator.language (falling back by language, then to en-US).

const EN_US = {
  heading: 'Graphics quality',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  cats: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Particles', detail: 'Garden detail',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
  },
  adaptive: 'Adaptive resolution',
  adaptiveHint: 'Lowers the resolution while frames are slow.',
  showFps: 'Show frame rate',
  postNote: 'Post-processing is unavailable on this device, so the game renders without it.',
  sum: {
    noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing',
  },
};

const EN_GB = {
  ...EN_US,
  cats: { ...EN_US.cats, grade: 'Colour grade' },
};

const ES_419 = {
  heading: 'Calidad gráfica',
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Escala de renderizado',
  fromPreset: 'Según el ajuste ({tier})',
  cats: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Partículas', detail: 'Detalle del jardín',
  },
  tiers: {
    off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado',
  },
  adaptive: 'Resolución adaptable',
  adaptiveHint: 'Reduce la resolución cuando los fotogramas van lentos.',
  showFps: 'Mostrar fotogramas por segundo',
  postNote: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
  sum: {
    noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloom: 'resplandor', reflections: 'reflejos', noAa: 'sin antialiasing',
  },
};

const ES_ES = {
  ...ES_419,
  auto: 'Automático (detectado: {tier})',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Escala de renderizado',
  showFps: 'Mostrar fotogramas por segundo',
};

const DE_DE = {
  heading: 'Grafikqualität',
  quality: 'Qualität',
  auto: 'Automatisch (erkannt: {tier})',
  presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
  renderScale: 'Renderskalierung',
  fromPreset: 'Aus Voreinstellung ({tier})',
  cats: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Partikel', detail: 'Gartendetails',
  },
  tiers: {
    off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert',
  },
  adaptive: 'Adaptive Auflösung',
  adaptiveHint: 'Senkt die Auflösung, solange Bilder langsam laufen.',
  showFps: 'Bildrate anzeigen',
  postNote: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spiel wird ohne sie dargestellt.',
  sum: {
    noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
    bloom: 'Bloom', reflections: 'Spiegelungen', noAa: 'keine Kantenglättung',
  },
};

const FR_FR = {
  heading: 'Qualité graphique',
  quality: 'Qualité',
  auto: 'Auto (détectée : {tier})',
  presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
  renderScale: 'Échelle de rendu',
  fromPreset: 'Selon le préréglage ({tier})',
  cats: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules', detail: 'Détails du jardin',
  },
  tiers: {
    off: 'Désactivé', on: 'Activé', low: 'Bas', medium: 'Moyen', high: 'Élevé',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
  },
  adaptive: 'Résolution adaptative',
  adaptiveHint: 'Baisse la résolution quand les images ralentissent.',
  showFps: 'Afficher la fréquence d’images',
  postNote: 'Le post-traitement n’est pas disponible sur cet appareil ; le jeu s’affiche sans.',
  sum: {
    noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloom: 'halo', reflections: 'reflets', noAa: 'sans anticrénelage',
  },
};

const FR_CA = {
  ...FR_FR,
  showFps: 'Afficher le nombre d’images par seconde',
  cats: { ...FR_FR.cats, antialias: 'Anticrénelage' },
};

const PT_BR = {
  heading: 'Qualidade gráfica',
  quality: 'Qualidade',
  auto: 'Automática (detectada: {tier})',
  presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Escala de renderização',
  fromPreset: 'Da predefinição ({tier})',
  cats: {
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Antisserrilhamento', reflections: 'Reflexos', particles: 'Partículas', detail: 'Detalhes do jardim',
  },
  tiers: {
    off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
  },
  adaptive: 'Resolução adaptável',
  adaptiveHint: 'Reduz a resolução quando os quadros ficam lentos.',
  showFps: 'Mostrar taxa de quadros',
  postNote: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
  sum: {
    noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
    bloom: 'brilho', reflections: 'reflexos', noAa: 'sem antisserrilhamento',
  },
};

const IT_IT = {
  heading: 'Qualità grafica',
  quality: 'Qualità',
  auto: 'Automatica (rilevata: {tier})',
  presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Scala di rendering',
  fromPreset: 'Dal preset ({tier})',
  cats: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Particelle', detail: 'Dettagli del giardino',
  },
  tiers: {
    off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
  },
  adaptive: 'Risoluzione adattiva',
  adaptiveHint: 'Abbassa la risoluzione quando i fotogrammi rallentano.',
  showFps: 'Mostra frequenza fotogrammi',
  postNote: 'La post-elaborazione non è disponibile su questo dispositivo; il gioco viene mostrato senza.',
  sum: {
    noShadows: 'senza ombre', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
    bloom: 'bagliore', reflections: 'riflessi', noAa: 'senza antialiasing',
  },
};

export const GFX_STRINGS = {
  'en-US': EN_US, 'en-GB': EN_GB, 'es-419': ES_419, 'es-ES': ES_ES, 'de-DE': DE_DE,
  'fr-FR': FR_FR, 'fr-CA': FR_CA, 'pt-BR': PT_BR, 'it-IT': IT_IT,
};

const FALLBACK = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the closest supported locale for a BCP-47 tag. */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  if (GFX_STRINGS[t]) return t;
  const lower = t.toLowerCase();
  const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === lower);
  if (exact) return exact;
  if (/^en-(gb|ie|au|nz|za|in)/.test(lower)) return 'en-GB';
  if (/^es-es/.test(lower)) return 'es-ES';
  if (/^fr-ca/.test(lower)) return 'fr-CA';
  return FALLBACK[lower.slice(0, 2)] || 'en-US';
}

export function gfxStrings(tag = globalThis.navigator?.language) {
  return GFX_STRINGS[pickLocale(tag)];
}

export function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
}
