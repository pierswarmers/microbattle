# Micro Battle

Toy-tank battles for up to four players on one screen, with bots filling the empty seats. It's written in plain WebGL2 and WebAudio with no libraries, assets or build step.

```bash
node microbattle.js
```

This starts a small local server and opens the game in your browser. You need Node 18 or newer and a browser with WebGL2.

## Camera modes

- **Bird's-eye** (`--mode birdseye`): a shared top-down camera, Micro Machines style, with a big world and small tanks. The camera follows the players. When they get too far apart to share one screen it splits automatically, and it merges again when they come back together.
- **Tank commander** (`--mode commander`): each player looks through their own gunner's sight. The sight shows a reticle, range and elevation readouts, a compass, zoom and a hull-direction indicator. The screen splits into one view per player.

## Options

Every setting can be passed on the command line. Run `node microbattle.js --help` for the full list.

| Option | Default | What it does |
|---|---|---|
| `--mode birdseye\|commander` | birdseye | Camera mode |
| `--players N` | 1 | Number of human players already joined (0–4). Others can join in the lobby |
| `--bots N\|auto` | auto | Number of bots. `auto` fills the match up to 4 tanks |
| `--tanks a,b,..` | – | Tank for each player, P1 to P4: `hornet`, `trooper`, `bulldog`, `thumper`, `longshot` |
| `--bot-tanks a,b,..` | random | Tanks for the bots |
| `--difficulty easy\|normal\|hard` | normal | Bot skill |
| `--map-size N` / `--seed N` / `--trees F` | 360 / random / 1 | Map size, map seed and scenery density |
| `--score-limit N` / `--time-limit S` / `--lives N` | 10 / 300 / 0 | Win conditions. Setting `--lives` above 0 makes it last tank standing |
| `--respawn S` | 3.5 | Seconds before a destroyed tank respawns |
| `--no-pickups` / `--no-powerups` / `--airdrop S` | on / on / 35 | Pickups, power-ups, and seconds between supply drops |
| `--no-lobby` / `--lobby-timeout S` | lobby on | Skip the join lobby, or start it automatically after S seconds |
| `--split` | auto | Always use split-screen in bird's-eye view |
| `--zoom N` / `--max-zoom N` | 52 / 150 | Bird's-eye camera height |
| `--no-stabilizer` | on | Turret turns with the hull instead of holding its aim |
| `--quality low\|medium\|high` / `--no-shadows` | medium | Graphics settings |
| `--volume F` / `--no-music` / `--mute` | 0.7 | Audio settings |
| `--port N` / `--host H` / `--no-open` | 8080 | Server settings |

Examples:

```bash
node microbattle.js --mode commander --players 2 --tanks bulldog,longshot
node microbattle.js --players 0 --difficulty hard          # watch four bots fight
node microbattle.js --players 3 --no-lobby --lives 3 --map-size 500 --seed 42
```

You can also set options in the page URL, for example `?mode=commander&players=2`.

## Controls

| | Drive | Turret | Barrel | Fire | Weapon | Zoom |
|---|---|---|---|---|---|---|
| P1 | W A S D | Q E | R F | Space | C | V |
| P2 | I J K L | U O | Y H | N | M | B |
| P3 | Arrow keys | , . | ] ' | Enter | \\ | / |
| P4 | Gamepad | | | | | |

Player 1 can also use the mouse:

- **Bird's-eye:** point to aim, click to fire, scroll to change weapon.
- **Commander:** click the screen to lock the mouse for mouse-look.

Gamepads work for any player:

| Control | Gamepad |
|---|---|
| Drive | Left stick |
| Aim | Right stick |
| Fire | RT or A |
| Change weapon | LB or RB |
| Zoom | LT |

Other keys:

| Key | Action |
|---|---|
| Esc or P | Pause |
| `` ` `` | Mute |
| X | Debug overlay |

In the lobby:

- Press your fire key to join.
- Steer left or right to choose a tank.
- Press **G** (or Start on a gamepad) to begin.

## Tanks

| Tank | Role | How to play it |
|---|---|---|
| Hornet | Scout | Very fast and fragile. Rapid-fire machine gun, plus mines to drop when you're being chased |
| Trooper | Medium | All-rounder. Cannon plus homing rockets |
| Bulldog | Heavy | Slow and tough. Huge cannon, flamethrower, and heavy damage when it rams |
| Thumper | Artillery | Mortar that arcs over cover, with a machine gun for close defence |
| Longshot | Sniper | Railgun that pierces through tanks, and a deep zoom |

## Pickups

- **Repair kits** restore health.
- **Ammo packs** refill your ammunition.
- **Weapon crates** give you rockets, mines, a flamer, a railgun, a mortar or a machine gun.
- **Power-ups:**
  - **Turbo:** extra speed.
  - **Shield:** absorbs damage.
  - **Double Damage:** your hits do twice the damage.
  - **Rapid Fire:** faster reloading.
  - **Ghost:** bots ignore you.
- **Supply drops** parachute in from time to time.
- **Crates and red barrels** can be destroyed. Barrels explode in chain reactions.

## Project layout

```
microbattle.js     CLI launcher and static server (Node built-ins only)
public/index.html  page shell
public/js/
  main.js     boot, config, test hooks (window.MB)
  config.js   option definitions shared by the CLI and the browser
  game.js     match flow, tanks, physics, weapons, pickups, cameras
  ai.js       bot brains: targeting, A* navigation, ballistics
  world.js    terrain, ponds, paths, scenery, collision and nav grids
  gl.js       instanced WebGL2 renderer (shadows, fog, sky, toon fire)
  models.js   procedural low-poly meshes   geo.js  geometry builder
  fx.js       particles, decals, comic pop text   audio.js  synthesized SFX and music
  hud.js      HUD, gunner scope, minimap, lobby, menus
  input.js    keyboard, mouse and gamepad   defs.js  tank, weapon and pickup data
tools/shot.mjs  headless Chromium screenshot/test driver (DevTools protocol, zero deps)
```
