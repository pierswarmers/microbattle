// Game data: tank types, weapons, pickups and player colours.

export const PLAYER_COLORS = [
  { name: 'Red', rgb: [1.0, 0.32, 0.28], css: '#ff5247' },
  { name: 'Blue', rgb: [0.3, 0.55, 1.0], css: '#4d8cff' },
  { name: 'Yellow', rgb: [1.0, 0.82, 0.2], css: '#ffd133' },
  { name: 'Green', rgb: [0.35, 0.9, 0.4], css: '#59e666' },
];

/**
 * Each tank type pushes a play style:
 *  - hornet:   hit-and-run flanker. Fast, fragile, rapid machine gun, drops mines while fleeing.
 *  - trooper:  all-rounder. Balanced cannon plus homing rockets.
 *  - bulldog:  brawler. Slow and tough, rams for damage, huge cannon + flamethrower up close.
 *  - thumper:  artillery. Lobs mortars over cover from long range; weak in a knife fight.
 *  - longshot: sniper. Long-range railgun with a zoom scope; must keep distance.
 */
export const TANK_TYPES = {
  hornet: {
    id: 'hornet', name: 'Hornet', role: 'Scout', blurb: 'Fast flanker. Rapid MG + mines.',
    hp: 70, speed: 24, reverse: 14, accel: 34, turn: 2.8, turret: 4.0, pitchSpeed: 1.2,
    pitchMin: -0.12, pitchMax: 0.35, radius: 1.5, mass: 0.7, armor: 1.0,
    weapons: ['mg', 'mines'], zoom: 2.0, scale: 0.9,
  },
  trooper: {
    id: 'trooper', name: 'Trooper', role: 'Medium', blurb: 'All-rounder. Cannon + homing rockets.',
    hp: 110, speed: 17, reverse: 10, accel: 24, turn: 2.1, turret: 2.4, pitchSpeed: 0.8,
    pitchMin: -0.1, pitchMax: 0.4, radius: 1.8, mass: 1.0, armor: 1.0,
    weapons: ['cannon', 'rockets'], zoom: 2.5, scale: 1.0,
  },
  bulldog: {
    id: 'bulldog', name: 'Bulldog', role: 'Heavy', blurb: 'Brawler. Big gun, flamer, rams hard.',
    hp: 180, speed: 13, reverse: 7, accel: 16, turn: 1.45, turret: 1.4, pitchSpeed: 0.6,
    pitchMin: -0.08, pitchMax: 0.3, radius: 2.2, mass: 1.8, armor: 0.85,
    weapons: ['bigcannon', 'flame'], zoom: 2.2, scale: 1.15,
  },
  thumper: {
    id: 'thumper', name: 'Thumper', role: 'Artillery', blurb: 'Lobs mortars over cover. Keep away!',
    hp: 105, speed: 14, reverse: 10, accel: 18, turn: 1.8, turret: 1.9, pitchSpeed: 0.9,
    pitchMin: 0.0, pitchMax: 1.45, radius: 1.9, mass: 1.1, armor: 1.0,
    weapons: ['mortar', 'mg'], zoom: 2.0, scale: 1.0,
  },
  longshot: {
    id: 'longshot', name: 'Longshot', role: 'Sniper', blurb: 'Railgun with deep zoom. Stay far.',
    hp: 80, speed: 16, reverse: 10, accel: 22, turn: 2.0, turret: 1.7, pitchSpeed: 0.6,
    pitchMin: -0.1, pitchMax: 0.3, radius: 1.7, mass: 0.9, armor: 1.0,
    weapons: ['rail', 'mg'], zoom: 5.0, scale: 1.0,
  },
};
export const TANK_ORDER = ['hornet', 'trooper', 'bulldog', 'thumper', 'longshot'];

/** kind: shell (ballistic), bullet, rocket (homing), lob (mortar arc), mine, rail (hitscan), flame. */
export const WEAPONS = {
  cannon: { id: 'cannon', name: 'Cannon', kind: 'shell', dmg: 26, splash: 3.5, splashDmg: 10, speed: 95, gravity: 9, reload: 1.0, maxAmmo: 40, spread: 0.006, recoil: 0.5, shake: 0.25, color: [1, 0.9, 0.5], icon: '●' },
  bigcannon: { id: 'bigcannon', name: 'Big Bertha', kind: 'shell', dmg: 42, splash: 5, splashDmg: 18, speed: 85, gravity: 9, reload: 1.7, maxAmmo: 30, spread: 0.004, recoil: 0.9, shake: 0.45, color: [1, 0.7, 0.3], icon: '⬤', size: 1.6 },
  mg: { id: 'mg', name: 'Machine Gun', kind: 'bullet', dmg: 4.5, speed: 170, gravity: 0, reload: 0.085, maxAmmo: 400, spread: 0.035, recoil: 0.05, shake: 0.03, color: [1, 1, 0.5], icon: '⋮', range: 110 },
  rockets: { id: 'rockets', name: 'Rockets', kind: 'rocket', dmg: 30, splash: 5, splashDmg: 14, speed: 48, gravity: 0, reload: 0.7, maxAmmo: 12, spread: 0.02, recoil: 0.2, shake: 0.15, homing: 2.2, color: [1, 0.5, 0.2], icon: '➤' },
  mortar: { id: 'mortar', name: 'Mortar', kind: 'lob', dmg: 48, splash: 9, splashDmg: 34, speed: 92, gravity: 56, reload: 2.0, maxAmmo: 24, spread: 0.01, recoil: 0.6, shake: 0.3, color: [0.4, 0.4, 0.45], icon: '⌒' },
  mines: { id: 'mines', name: 'Mines', kind: 'mine', dmg: 55, splash: 6, splashDmg: 25, reload: 0.9, maxAmmo: 5, armTime: 1.2, life: 60, color: [1, 0.2, 0.2], icon: '✱' },
  rail: { id: 'rail', name: 'Railgun', kind: 'rail', dmg: 60, reload: 2.4, maxAmmo: 10, range: 260, recoil: 0.8, shake: 0.35, color: [0.4, 1, 1], icon: '⚡' },
  flame: { id: 'flame', name: 'Flamer', kind: 'flame', dmg: 2.4, speed: 30, reload: 0.045, maxAmmo: 220, spread: 0.14, range: 17, recoil: 0, shake: 0.02, burn: 2.5, color: [1, 0.55, 0.1], icon: '♨' },
};

/** Special weapons that can appear in weapon crates. */
export const CRATE_WEAPONS = ['rockets', 'mines', 'flame', 'rail', 'mortar', 'mg'];

export const POWERUPS = {
  speed: { id: 'speed', name: 'Turbo', dur: 9, color: [0.2, 0.9, 1], css: '#33e6ff', icon: '»' },
  shield: { id: 'shield', name: 'Shield', dur: 12, color: [0.5, 0.6, 1], css: '#8899ff', icon: '◈', absorb: 70 },
  damage: { id: 'damage', name: 'Double Damage', dur: 10, color: [1, 0.25, 0.6], css: '#ff4099', icon: '✚✚' },
  rapid: { id: 'rapid', name: 'Rapid Fire', dur: 10, color: [1, 0.85, 0.1], css: '#ffd91a', icon: '⚙' },
  ghost: { id: 'ghost', name: 'Ghost', dur: 8, color: [0.85, 0.85, 0.95], css: '#ddddf2', icon: '◌' },
};
export const POWERUP_ORDER = ['speed', 'shield', 'damage', 'rapid', 'ghost'];

export const PICKUP_KINDS = {
  health: { id: 'health', name: 'Repair Kit', amount: 55, respawn: 16, css: '#ff5a5a' },
  ammo: { id: 'ammo', name: 'Ammo Pack', respawn: 14, css: '#d9c35a' },
  weapon: { id: 'weapon', name: 'Weapon Crate', respawn: 20, css: '#ff9a3c' },
  power: { id: 'power', name: 'Power-up', respawn: 24, css: '#c873ff' },
};
