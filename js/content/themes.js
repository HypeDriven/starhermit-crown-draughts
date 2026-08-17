// Visual themes and the cosmetic catalog.
//
// Themes alter materials, lighting, ambience and environment dressing only —
// never hitboxes, timing, information or power. Cosmetics unlock through the
// mastery track (stars earned in Journey) and are pure presentation.

export const THEMES = {
  'royal-garden': {
    id: 'royal-garden', name: 'Royal Garden', blurb: 'Warm afternoon light over trimmed hedges.',
    skyTop: 0x7fb2e0, skyBottom: 0xf6e3c0, fog: 0xd8cba8, fogDensity: 0.016,
    sun: { color: 0xffe7c4, intensity: 3.1, position: [14, 22, 10] },
    hemi: { sky: 0xbdd7f0, ground: 0x6d7c53, intensity: 1.05 },
    ground: 0x5d7a44, path: 0xbfae8e, hedge: 0x3f6032, flowerA: 0xd4667a, flowerB: 0xe8d060,
    stoneLight: 0xd9cdb4, stoneDark: 0x4a4f58, frame: 0x8a7a5c, water: 0x7fb8c9,
    accent: 0xd4af37,
    ambience: { wind: 0.5, birds: 0.8, water: 0.4 },
    music: { root: 220.0, scale: [0, 2, 4, 7, 9], tempo: 0.11 },
    env: { trees: true, fountain: true, lanterns: false, petals: true, snow: false, torches: false },
  },
  'dusk-conservatory': {
    id: 'dusk-conservatory', name: 'Dusk Conservatory', blurb: 'Lantern light and long violet shadows.',
    skyTop: 0x2c2547, skyBottom: 0xc96f4a, fog: 0x4a3a55, fogDensity: 0.02,
    sun: { color: 0xff9d66, intensity: 2.0, position: [-16, 9, 6] },
    hemi: { sky: 0x584a78, ground: 0x2e2a30, intensity: 0.85 },
    ground: 0x3d4a35, path: 0x7a6a58, hedge: 0x2c4429, flowerA: 0x9a5fd0, flowerB: 0xe08a4a,
    stoneLight: 0xc4b49e, stoneDark: 0x3a3d4e, frame: 0x6a5a48, water: 0x4a6a8a,
    accent: 0xffb46b,
    ambience: { wind: 0.3, birds: 0.15, water: 0.3, crickets: 0.7 },
    music: { root: 196.0, scale: [0, 3, 5, 7, 10], tempo: 0.08 },
    env: { trees: true, fountain: true, lanterns: true, petals: false, snow: false, torches: false },
  },
  'ember-court': {
    id: 'ember-court', name: 'Ember Court', blurb: 'Autumn gold, braziers, and drifting leaves.',
    skyTop: 0x8a5a3a, skyBottom: 0xe8b46a, fog: 0xb08050, fogDensity: 0.018,
    sun: { color: 0xffc27a, intensity: 2.7, position: [10, 14, -14] },
    hemi: { sky: 0xd0a070, ground: 0x5a3a28, intensity: 0.95 },
    ground: 0x6a5a30, path: 0xa88a62, hedge: 0x5a4a22, flowerA: 0xc74a2a, flowerB: 0xe0a030,
    stoneLight: 0xd8c0a0, stoneDark: 0x503c34, frame: 0x7a5a3c, water: 0x8a7a5a,
    accent: 0xe07830,
    ambience: { wind: 0.7, birds: 0.3, water: 0.2, fire: 0.6 },
    music: { root: 174.61, scale: [0, 2, 3, 7, 8], tempo: 0.1 },
    env: { trees: true, fountain: false, lanterns: false, petals: true, snow: false, torches: true },
  },
  'frost-arbor': {
    id: 'frost-arbor', name: 'Frost Arbor', blurb: 'Pale sun on snow-dusted stone.',
    skyTop: 0x9ab8d8, skyBottom: 0xe8f0f8, fog: 0xc8d8e8, fogDensity: 0.024,
    sun: { color: 0xf0f4ff, intensity: 2.4, position: [-8, 20, 12] },
    hemi: { sky: 0xcfe0f4, ground: 0x8898a8, intensity: 1.1 },
    ground: 0xb8c4cc, path: 0x9aa8b4, hedge: 0x4a5c50, flowerA: 0x7ab8d8, flowerB: 0xd8e8f0,
    stoneLight: 0xe0e4e8, stoneDark: 0x3c4450, frame: 0x788698, water: 0x9ac8e0,
    accent: 0x7ac0e8,
    ambience: { wind: 0.85, birds: 0.1, water: 0.0 },
    music: { root: 246.94, scale: [0, 2, 5, 7, 9], tempo: 0.07 },
    env: { trees: true, fountain: false, lanterns: false, petals: false, snow: true, torches: false },
  },
  'tide-terrace': {
    id: 'tide-terrace', name: 'Tide Terrace', blurb: 'Sea air over pale coral stone.',
    skyTop: 0x5aa8c8, skyBottom: 0xe8e0c0, fog: 0xa8c8c0, fogDensity: 0.017,
    sun: { color: 0xfff0d0, intensity: 2.9, position: [16, 18, -8] },
    hemi: { sky: 0xa8d0e0, ground: 0x5a6a58, intensity: 1.05 },
    ground: 0x5a7a58, path: 0xc8b898, hedge: 0x38604a, flowerA: 0xe8788a, flowerB: 0x68c8b8,
    stoneLight: 0xe0d4bc, stoneDark: 0x3c5058, frame: 0x8a8270, water: 0x58a8b8,
    accent: 0x40b0a8,
    ambience: { wind: 0.6, birds: 0.5, water: 0.8 },
    music: { root: 233.08, scale: [0, 2, 4, 6, 9], tempo: 0.12 },
    env: { trees: false, fountain: true, lanterns: false, petals: true, snow: false, torches: false },
  },
};

export const DEFAULT_THEME = 'royal-garden';

// ---------------------------------------------------------------------------
// Cosmetic catalog. slot: material | trail | surround | flourish
// ---------------------------------------------------------------------------

export const COSMETICS = [
  { id: 'marble-ivory', slot: 'material', name: 'Ivory Marble', unlockStars: 0, desc: 'The house stone of the garden.' },
  { id: 'slate-onyx', slot: 'material', name: 'Onyx Slate', unlockStars: 0, desc: 'Dark court stone, cool to the touch.' },
  { id: 'trail-petals', slot: 'trail', name: 'Petal Drift', unlockStars: 0, desc: 'Rose petals follow your pieces.' },
  { id: 'surround-fountain', slot: 'surround', name: 'Fountain Court', unlockStars: 0, desc: 'The classic playing court.' },
  { id: 'flourish-none', slot: 'flourish', name: 'No Flourish', unlockStars: 0, desc: 'A plain profile.' },

  { id: 'material-jade', slot: 'material', name: 'Jade Inlay', unlockStars: 12, desc: 'Greenstone from the east wall.' },
  { id: 'trail-sparks', slot: 'trail', name: 'Ember Sparks', unlockStars: 20, desc: 'A faint ember trail on your moves.' },
  { id: 'surround-lanterns', slot: 'surround', name: 'Lantern Walk', unlockStars: 30, desc: 'Paper lanterns ring the board.' },
  { id: 'flourish-laurel', slot: 'flourish', name: 'Laurel Flourish', unlockStars: 40, desc: 'A laurel ring for your profile.' },
  { id: 'material-amber', slot: 'material', name: 'Amber Glass', unlockStars: 55, desc: 'Warm translucent amber pieces.' },
  { id: 'trail-snow', slot: 'trail', name: 'Snowfall', unlockStars: 70, desc: 'Soft snow follows your pieces.' },
  { id: 'surround-maze', slot: 'surround', name: 'Maze Walls', unlockStars: 85, desc: 'Tall hedge walls enclose the court.' },
  { id: 'flourish-crown', slot: 'flourish', name: 'Crown Flourish', unlockStars: 100, desc: 'A stone crown above your name.' },
  { id: 'material-moonstone', slot: 'material', name: 'Moonstone', unlockStars: 120, desc: 'Pale shimmer for masters of the court.' },
];

/** The long-term mastery track: total journey stars → reward. */
export const MASTERY_TRACK = [
  { stars: 5, reward: 'title', label: 'Garden Guest' },
  { stars: 12, reward: 'material-jade', label: 'Jade Inlay' },
  { stars: 20, reward: 'trail-sparks', label: 'Ember Sparks' },
  { stars: 30, reward: 'surround-lanterns', label: 'Lantern Walk' },
  { stars: 40, reward: 'flourish-laurel', label: 'Laurel Flourish' },
  { stars: 55, reward: 'material-amber', label: 'Amber Glass' },
  { stars: 70, reward: 'trail-snow', label: 'Snowfall' },
  { stars: 85, reward: 'surround-maze', label: 'Maze Walls' },
  { stars: 100, reward: 'flourish-crown', label: 'Crown Flourish' },
  { stars: 120, reward: 'material-moonstone', label: 'Moonstone' },
  { stars: 144, reward: 'title', label: 'Keeper of the Court' },
];

export function cosmeticsUnlockedAt(stars) {
  return COSMETICS.filter((c) => c.unlockStars <= stars).map((c) => c.id);
}

export function nextMilestone(stars) {
  return MASTERY_TRACK.find((m) => m.stars > stars) || null;
}
