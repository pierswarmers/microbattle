// Game data: vehicle types, weapons, power-ups and player colours. Shared by server and client.

export const PLAYER_COLORS = [
  { name: 'Red', rgb: [1.0, 0.32, 0.28], css: '#ff5247' },
  { name: 'Blue', rgb: [0.3, 0.55, 1.0], css: '#4d8cff' },
  { name: 'Yellow', rgb: [1.0, 0.82, 0.2], css: '#ffd133' },
  { name: 'Green', rgb: [0.35, 0.9, 0.4], css: '#59e666' },
];

/**
 * Vehicle types. Each pushes a play style:
 *  - scout:      fast flanker and spotter. Rapid fire, flamer, calls in air strikes, lots of smoke.
 *  - standard:   all-rounder. Standard rounds, a few high-velocity shots, heat seekers, cluster.
 *  - artillery:  high-elevation gun that lobs over cover; cluster, seekers and air strikes. Fragile up close.
 *  - superheavy: slow, huge armour, rams hard; high-velocity gun, flamer and the one-shot MASSIVE.
 * gun: multipliers applied to the standard round (super heavy's main gun is bigger and slower).
 */
export const TANK_TYPES = {
  scout: {
    id: 'scout', name: 'Scout', role: 'Fast flanker', blurb: 'Rapid fire, flamer, calls air strikes.',
    hp: 100, speed: 24, reverse: 14, accel: 34, turn: 2.8, turret: 4.0, pitchSpeed: 1.2,
    pitchMin: -0.1, pitchMax: 0.4, radius: 1.5, mass: 0.7, armor: 1.0, smoke: 4,
    weapons: ['rapid', 'flame', 'strike'], zoom: 2.0, scale: 0.9, gun: { dmg: 1, reload: 1, speed: 1 },
  },
  standard: {
    id: 'standard', name: 'Standard', role: 'All-rounder', blurb: 'Standard + high-velocity, seekers, cluster.',
    hp: 125, speed: 17, reverse: 10, accel: 24, turn: 2.1, turret: 2.4, pitchSpeed: 0.8,
    pitchMin: -0.1, pitchMax: 0.45, radius: 1.8, mass: 1.0, armor: 1.0, smoke: 3,
    weapons: ['standard', 'highvel', 'seeker', 'cluster'], zoom: 3.0, scale: 1.0, gun: { dmg: 1, reload: 1, speed: 1 },
  },
  artillery: {
    id: 'artillery', name: 'Artillery', role: 'Long-range lobber', blurb: 'High-arc gun, cluster, seekers, air strike.',
    hp: 150, speed: 14.5, reverse: 10, accel: 18, turn: 1.9, turret: 2.4, pitchSpeed: 1.2,
    pitchMin: -0.06, pitchMax: 1.3, radius: 1.9, mass: 1.1, armor: 1.0, smoke: 2,
    weapons: ['standard', 'cluster', 'seeker', 'strike'], zoom: 2.5, scale: 1.0, gun: { dmg: 1.45, reload: 1.1, speed: 1.0, gravity: 4, splash: 1.6 }, bonus: { cluster: 1, strike: 1, seeker: 2 },
  },
  superheavy: {
    id: 'superheavy', name: 'Super Heavy', role: 'Armoured brawler', blurb: 'Huge gun, flamer, rams, MASSIVE.',
    hp: 180, speed: 10.5, reverse: 6, accel: 13, turn: 1.3, turret: 1.2, pitchSpeed: 0.55,
    pitchMin: -0.08, pitchMax: 0.32, radius: 2.4, mass: 2.2, armor: 0.88, smoke: 3,
    weapons: ['standard', 'highvel', 'flame', 'massive'], zoom: 2.2, scale: 1.2, gun: { dmg: 1.35, reload: 1.3, speed: 1 }, bonus: { highvel: -3 },
  },
};
export const TANK_ORDER = ['scout', 'standard', 'artillery', 'superheavy'];

/**
 * kind:
 *  shell   - ballistic round (standard, high velocity, massive)
 *  bullet  - rapid fire: shallow arc, spread blooms with sustained fire
 *  seeker  - launched steeply; homes on a commander lock during descent; trees intercept it
 *  cluster - shell that bursts above the ground into bomblets
 *  flame   - short-range fire stream; builds heat that can ignite your own tank
 *  strike  - flare that marks a target; a bomber run hits the zone `delay` seconds later
 * start: ammo on spawn; maxAmmo: cap (pickups can't exceed it).
 */
export const WEAPONS = {
  standard: { id: 'standard', name: 'Standard', short: 'STD', key: '1', kind: 'shell', dmg: 24, splash: 3.5, splashDmg: 10, speed: 100, gravity: 14, reload: 1.1, maxAmmo: 40, start: 40, spread: 0.006, recoil: 0.5, shake: 0.2, color: [1, 0.9, 0.5] },
  highvel: { id: 'highvel', name: 'High Velocity', short: 'HV', key: '2', kind: 'shell', hv: true, dmg: 52, splash: 2.5, splashDmg: 12, speed: 290, gravity: 3, reload: 2.8, maxAmmo: 10, start: 8, spread: 0.001, recoil: 1.0, shake: 0.55, knock: 9, selfKnock: 5, color: [0.7, 0.95, 1] },
  seeker: { id: 'seeker', name: 'Heat Seeker', short: 'SEEK', key: '3', kind: 'seeker', dmg: 44, splash: 5, splashDmg: 18, speed: 48, gravity: 18, launchPitch: 1.0, homing: 5, reload: 2.2, maxAmmo: 6, start: 5, lockTime: 0.5, range: 200, minRange: 22, recoil: 0.3, shake: 0.15, color: [1, 0.5, 0.2] },
  massive: { id: 'massive', name: 'MASSIVE', short: 'NUKE', key: '4', kind: 'shell', nuke: true, dmg: 130, splash: 22, splashDmg: 110, speed: 62, gravity: 16, reload: 6, maxAmmo: 1, start: 1, spread: 0.004, recoil: 1.2, shake: 0.6, size: 2.2, color: [1, 0.85, 0.2] },
  cluster: { id: 'cluster', name: 'Cluster', short: 'CLSTR', key: '5', kind: 'cluster', dmg: 18, splash: 3, splashDmg: 8, speed: 72, gravity: 18, reload: 3.0, maxAmmo: 4, start: 3, spread: 0.004, recoil: 0.6, shake: 0.25, bomblets: 12, bombletSplash: 4.5, bombletDmg: 16, burstHeight: 12, spreadR: 10, color: [1, 0.6, 0.9] },
  flame: { id: 'flame', name: 'Flamethrower', short: 'FLAME', key: '6', kind: 'flame', dmg: 3.0, speed: 32, reload: 0.045, maxAmmo: 200, start: 200, spread: 0.14, range: 20, burn: 2.5, burnDps: 8, recoil: 0, shake: 0.02, color: [1, 0.55, 0.1] },
  rapid: { id: 'rapid', name: 'Rapid Fire', short: 'RAPID', key: '7', kind: 'bullet', dmg: 4.6, speed: 150, gravity: 6, reload: 0.07, maxAmmo: 300, start: 300, spread: 0.012, bloom: 0.009, maxBloom: 0.1, recover: 0.3, kick: 0.012, range: 130, recoil: 0.06, shake: 0.03, color: [1, 1, 0.5] },
  strike: { id: 'strike', name: 'Air Strike', short: 'STRIKE', key: '8', kind: 'strike', speed: 60, gravity: 20, launchPitch: 0.8, reload: 1, cooldown: 20, maxAmmo: 2, start: 1, radius: 34, delay: 5, bombs: 40, bombSplash: 9, bombDmg: 75,
    // bomber run: jets fly lanes (side offsets) at jetAlt over the zone centre, crossing it `jetCross` s before the countdown ends;
    // each bomb leaves the nearest jet's belly carrying bombFwd m/s of forward speed and fans out sideways to its impact point
    jetSpeed: 110, jetAlt: 22, jetLead: 140, jetLanes: [-18, 0, 18], jetCross: 0.42, bombFwd: 28, bombG: 36,
    range: 220, minRange: 15, recoil: 0.2, shake: 0.1, color: [1, 0.2, 0.2] },
};
export const WEAPON_ORDER = ['standard', 'highvel', 'seeker', 'massive', 'cluster', 'flame', 'rapid', 'strike'];

/** Weapons that can appear in weapon crates, with relative weights (MASSIVE is rare). */
export const CRATE_WEAPONS = [['highvel', 3], ['seeker', 3], ['cluster', 3], ['flame', 2], ['rapid', 2], ['strike', 1.5], ['massive', 0.6]];

export const SMOKE = { radius: 11, grow: 1.2, life: 14, cooldown: 1.5 };
/** Flamethrower heat: builds while firing; each second there's base + heat*perHeat chance of a fuel fire. */
export const FLAME_HEAT = { perSec: 1, cool: 0.6, base: 0.02, perHeat: 0.07, max: 4 };

export const POWERUPS = {
  speed: { id: 'speed', name: 'Turbo', dur: 9, color: [0.2, 0.9, 1], css: '#33e6ff' },
  shield: { id: 'shield', name: 'Shield', dur: 12, color: [0.5, 0.6, 1], css: '#8899ff', absorb: 70 },
  damage: { id: 'damage', name: 'Double Damage', dur: 10, color: [1, 0.25, 0.6], css: '#ff4099' },
  rapid: { id: 'rapid', name: 'Fast Reload', dur: 10, color: [1, 0.85, 0.1], css: '#ffd91a' },
  ghost: { id: 'ghost', name: 'Ghost', dur: 8, color: [0.85, 0.85, 0.95], css: '#ddddf2' },
};
export const POWERUP_ORDER = ['speed', 'shield', 'damage', 'rapid', 'ghost'];

export const PICKUP_KINDS = {
  health: { id: 'health', name: 'Repair Kit', amount: 55, respawn: 16, css: '#ff5a5a' },
  ammo: { id: 'ammo', name: 'Ammo Pack', respawn: 14, css: '#d9c35a' },
  weapon: { id: 'weapon', name: 'Weapon Crate', respawn: 20, css: '#ff9a3c' },
  power: { id: 'power', name: 'Power-up', respawn: 24, css: '#c873ff' },
};

export function pickWeighted(list, r) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  for (const [id, w] of list) { if ((x -= w) <= 0) return id; }
  return list[list.length - 1][0];
}

/** Turret / barrel mount points per vehicle (tank-local units before type scale). Shared so the server knows muzzle positions. */
export const TANK_GEOM = {
  scout: { turretY: 1.2, barrelY: 0.28, barrelZ: 0.45, barrelLen: 1.9 },
  standard: { turretY: 1.45, barrelY: 0.32, barrelZ: 0.8, barrelLen: 2.7 },
  artillery: { turretY: 1.4, barrelY: 0.45, barrelZ: 0.1, barrelLen: 2.0 },
  superheavy: { turretY: 1.7, barrelY: 0.4, barrelZ: 1.0, barrelLen: 3.1 },
};

/** Muzzle speed and gravity of a weapon fired by a vehicle (artillery's standard gun is a heavy lobber). */
export function shotSpeed(def, wid) { return (WEAPONS[wid].speed || 100) * (wid === 'standard' ? def.gun.speed || 1 : 1); }
export function shotGravity(def, wid) { return (WEAPONS[wid].gravity || 0) * (wid === 'standard' ? def.gun.gravity || 1 : 1); }
/** Weapons aimed by range (↑↓ / mouse distance) rather than barrel elevation for this vehicle. */
export function rangeAimed(def, wid) {
  const k = WEAPONS[wid].kind;
  return k === 'seeker' || k === 'strike' || (def.pitchMax > 1 && (k === 'shell' || k === 'cluster') && !WEAPONS[wid].hv);
}
