# Micro Battle

A networked 3D toy-tank battle for up to four players, with bots filling any empty seats. Each player plays on their own machine. It uses only WebGL2, WebAudio and Node built-ins: no libraries, no assets and no build step.

## Running a game

Start the server:

```bash
node microbattle.js
```

The server prints its address on your network, for example `http://192.168.1.20:8080/`. Friends open that address in their browser to join. Then:

- In the lobby, everyone picks a vehicle.
- The match starts when everyone is ready, or when anyone presses **Enter**.
- Empty seats are filled with bots.
- When a round ends (score or time limit), the results show with an intermission picker: everyone can change vehicle and press **Space** when ready. The next round starts when all players are ready, when anyone presses **Enter**, or after 20 seconds. Bots pick a new random vehicle each round.
- Players can join in the middle of a match and take over a bot's seat. If a player leaves, a bot takes over their tank.

The server binds `0.0.0.0` by default so it can be reached from your network. Use `--host 127.0.0.1` to keep it on this machine only.

## Views

Press **C** to switch views, unless the server fixed the view with `--mode` (or is running a view cycle match).

| View | What you see |
|---|---|
| **Chase cam** | The camera sits slightly above and behind your tank, locked to the turret direction. |
| **Commander** | The gunner's sight, with a reticle, range readout, compass, zoom and a hull-direction indicator. The heat seeker can lock on in this view. |
| **Bird's-eye** | A high overview of the battlefield. Scroll to zoom. |

### View cycle match

`--mode cycle` plays a 4-round match. The server sets the view for everyone each round, and **C** is disabled until the last round:

1. Bird's-eye
2. Chase cam
3. Commander
4. Free choice (**C** switches)

Each round ends on the normal rules (`--score-limit`, `--time-limit`, `--lives`). A short intermission then announces the next round's view. After round 4, the results screen shows the match totals (score, rounds won, kills, deaths) and crowns the overall winner. Then a new match starts from round 1.

## Controls

| Key | Action |
|---|---|
| **W A S D** | Drive |
| **← →** | Turn the turret |
| **↑ ↓** | Raise or lower the barrel. For heat seekers and air strikes, this sets the range instead. |
| **Space** | Fire |
| **Q / E** | Previous / next weapon. **1–8** pick a weapon directly. |
| **C** | Change view |
| **V** | Zoom (commander view) |
| **G** | Throw a smoke grenade |
| **M** | Mute |
| **Esc** | Help |

You can also use the mouse:

- **Chase and commander views:** click to capture the mouse, then move it to aim.
- **Bird's-eye view:** point to aim and click to fire.

A gamepad also works.

## Vehicles

| Vehicle | Style | Loadout |
|---|---|---|
| Scout | Fast flanker and spotter, fragile | Rapid fire, flamethrower, air strike, 4 smoke grenades |
| Standard | All-rounder | Standard rounds, high velocity, heat seeker, cluster |
| Artillery | Lobs shells over cover from long range, weak up close | Standard rounds (high arc), cluster, heat seeker, air strike |
| Super Heavy | Slow and heavily armoured, rams hard | Standard rounds (bigger gun), high velocity, flamethrower, MASSIVE |

Weapon crates and supply drops can add any weapon to any vehicle.

## Weapons

| Weapon | Behaviour |
|---|---|
| Standard | The all-purpose shell. Every vehicle except the scout has it. |
| High Velocity | Almost no arc and very fast. Heavy recoil and knockback, and few rounds. |
| Heat Seeker | Fired on a high arc. If you lock on to a target in commander view, it dives onto them. In bird's-eye view, hold tanks inside the dashed circle for about a second to lock each one; firing then launches one seeker per locked tank (ammo permitting). Trees and smoke protect the target. |
| MASSIVE | One shell, with a mushroom cloud that flattens everything nearby. |
| Cluster | Bursts just before it lands and scatters a ring of 12 bomblets. |
| Flamethrower | Very powerful at close range. Heat builds while you fire, and too much heat can set your own fuel on fire. |
| Rapid Fire | Near machine-gun rate of fire on a shallow arc. The spread grows and the barrel kicks, so fire in bursts. |
| Air Strike | Marks a zone that every player can see. Bombers carpet-bomb it 5 seconds later. 20-second cooldown. |
| Smoke grenades | A limited supply. Smoke blocks line of sight and breaks heat-seeker locks. |

Balance is measured with `node tools/balance.mjs`. It covers:

- Per-weapon damage per second and hit rate against still and moving targets.
- Duels between every pair of vehicles.
- Air strike escape times. The zone is sized so a Super Heavy only just makes it out.
- How long the flamethrower runs before its fuel ignites.

## Server options

Run `node microbattle.js --help` for the full list.

| Option | Default | What it does |
|---|---|---|
| `--mode any\|chase\|commander\|birdseye\|cycle` | any | Fix the view for everyone, let each player choose, or play a 4-round view cycle match (see above) |
| `--players N` | 0 | Start automatically once N players have joined |
| `--bots N\|auto` / `--bot-tanks a,b` / `--difficulty easy\|normal\|hard` | auto / random / normal | Bot settings |
| `--no-lobby` | lobby on | Start straight away with bots; players join while the match runs |
| `--map-size N` / `--seed N` / `--trees F` | 360 / random / 1 | Map size, seed and tree density |
| `--score-limit N` / `--time-limit S` / `--lives N` / `--respawn S` | 10 / 300 / 0 / 3.5 | Match rules |
| `--no-pickups` / `--no-powerups` / `--airdrop S` | on / on / 35 | Pickups, power-ups and supply drops |
| `--zoom N` | 120 | Bird's-eye camera height |
| `--season spring\|summer\|autumn\|winter\|random` | summer | Retints the island: spring blossom and petals, summer apples, autumn leaves, winter snow and ice |
| `--quality low\|medium\|high` | medium | Graphics quality |
| `--port N` / `--host H` / `--no-open` | 8080 / 0.0.0.0 | Server settings |
| `--debug` | off | Testing only: players spawn with every weapon |

## Development tools

```bash
node tools/balance.mjs all                     # weapon / vehicle / air strike / flamer balance tables
node tools/sim.mjs --seconds 240 --runs 4      # headless bot matches with per-weapon statistics
node tools/shot.mjs script.json                # starts the server, drives one or more headless browser clients, takes screenshots
```

## How it's built

```
microbattle.js        CLI, static server, WebSocket upgrade
server/ws.js          minimal RFC 6455 WebSocket implementation
server/room.js        lobby and seats, 60 Hz authoritative simulation, 30 Hz snapshots and events
public/js/sim.js      game rules: tanks, physics, weapons, pickups, air strikes, smoke (runs on the server)
public/js/ai.js       bots: A* navigation, ballistics, seeker locks, smoke and escaping strikes
public/js/world.js    seeded terrain, scenery and nav grid; server and clients build an identical world
public/js/client.js   networking, interpolation, turret prediction, cameras, effects and audio events
public/js/hud.js      HUD, gunner scope, lock-on, minimap, lobby and menus
public/js/gl.js, models.js, geo.js, fx.js, audio.js, input.js, defs.js, config.js
```
