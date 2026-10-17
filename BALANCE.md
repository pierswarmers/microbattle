# Balance pass (Oct 2026)

Measured with the headless harnesses, hard bots:

- `node tools/balance.mjs duels --runs 20` – 1v1, 20 × 150 s per matchup, pickups on
- `node tools/balance.mjs weapons|strike|flame`
- `node tools/sim.mjs --seconds 240 --runs 4 --difficulty hard --seed {1,11,21,31}` – 16 four-bot free-for-alls (64 tanks)

## Harness fixes

- `balance.mjs` printed `NaN` everywhere unless `--runs` was given (`indexOf('--runs')` was -1, so it parsed the node path).
- The flamer test reused seed 11 for all 60 runs, so it measured one run 60 times. Each run now gets its own seed.
- The air strike table has a new `distAtImpact` column: how far from the centre each vehicle is when the bombs start to land. Use it to size the zone.

## Changes (all in `public/js/defs.js`)

| What | Before | After | Why |
|---|---|---|---|
| High Velocity dmg / reload / ammo (start, max) | 52 / 2.8 s / 8, 10 | 46 / 3.1 s / 6, 8 | It dealt 32 % of all FFA damage with 8 % of the shots. |
| Super Heavy HV bonus | −3 (5 rounds) | −2 (4 rounds) | Keeps Super Heavy's HV count close to before after the cut to the base ammo. |
| Heat Seeker dmg / splash r / splashDmg | 44 / 5 / 18 | 48 / 6 / 24 | It only hit 23 % of its shots in FFA. Near misses and tree clips now still count. |
| Flamer burn time / burn dps | 2.5 s / 8 | 3 s / 10 | 3.4 % damage share. Being in range for a moment now pays off more. |
| Flamer self-ignition `perHeat` | 0.07 | 0.055 | Average time to self-ignite goes from 5.8 s to 6.4 s of the 9 s of fuel. Still a risk, but you get a full burst. |
| Air strike radius | 34 | 40 | Super Heavy starting in the centre is about 41 m out when the bombs land (see below). It now only just makes it out, instead of clearing the zone by 7 m. |
| Scout hp | 100 | 110 | Scout lost to Standard (35/65) and to Super Heavy. |
| Artillery hp / turret speed | 150 / 2.4 | 160 / 2.8 | Scout beat Artillery 71/29. The faster turret lets Artillery track flankers. It is still meant to be weak up close. |

## Before / after

### 1v1 duels (kills, 20 × 150 s)

| Matchup | Before | Win % | After | Win % |
|---|---|---|---|---|
| scout v standard | 48 : 88 | 35 / 65 | 68 : 72 | 49 / 51 |
| scout v artillery | 87 : 36 | **71 / 29** | 72 : 53 | 58 / 42 |
| scout v superheavy | 56 : 66 | 46 / 54 | 57 : 63 | 48 / 53 |
| standard v artillery | 65 : 62 | 51 / 49 | 70 : 57 | 55 / 45 |
| standard v superheavy | 66 : 69 | 49 / 51 | 53 : 55 | 49 / 51 |
| artillery v superheavy | 53 : 57 | 48 / 52 | 50 : 57 | 47 / 53 |

The worst matchup goes from 71/29 to 58/42. Scout still has the edge on Artillery up close, as intended.

### Free-for-all (16 matches × 4 bots, K/D per vehicle)

| Vehicle | Before | After |
|---|---|---|
| standard | 1.13 | 0.85 |
| scout | 0.87 | 1.05 |
| superheavy | 1.06 | 1.21 |
| artillery | 0.83 | 0.96 |

FFA numbers are noisy: vehicles are assigned at random, so each sample is only 13 to 21 tanks.

### Weapon share of all FFA damage

| Weapon | Hit % before | Hit % after | Damage share before | Damage share after |
|---|---|---|---|---|
| high velocity | 55 | 56 | **32.2 %** | 25.3 % |
| rapid | 50 | 48 | 18.2 % | 19.1 % |
| standard | 35 | 37 | 16.2 % | 18.6 % |
| cluster | (bomblets) | | 13.8 % | 13.2 % |
| seeker | 23 | 29 | 6.6 % | 8.2 % |
| massive | 69 | 73 | 5.9 % | 6.9 % |
| flame | 36 | 43 | 3.4 % | 4.9 % |
| strike | 35 | 35 | 3.8 % | 3.9 % |

High Velocity is still the hardest-hitting shot (about 25 damage per shot fired), but it no longer dominates. Air strike and flamer have low damage shares by design. The strike denies an area and the flamer finishes targets up close: at 10 m it deals 57 dps on a still target.

### Time to kill (still target, hard bot, from the weapons table)

| Weapon | DPS | Kill a 125 hp Standard in |
|---|---|---|
| flamer (10 m) | 57 | ~2.2 s, plus the burn |
| rapid (25–60 m) | 31–34 | ~4 s |
| standard (40 m) | 22 | ~6 s |
| HV (3 hits) | 15 | ~6.2 s |
| seeker | 20 | ~6 s, but only 5 rounds |
| MASSIVE | 130 direct | one-shots Scout and Standard, not Artillery or Super Heavy |

### Air strike (start in the centre, drive straight out; bombs start landing at 5 s)

| Vehicle | Distance when bombs land | Zone before | Zone after |
|---|---|---|---|
| scout | 88 m | 34 | 40 |
| standard | 73 m | 34 | 40 |
| artillery | 54 m | 34 | 40 |
| superheavy | 41 m | 34 (7 m clear) | 40 (on the edge) |

Everyone escapes, and Super Heavy takes about 20–45 splash damage on the way out. A tank that stays in the zone dies 16/16. If the strike `delay` changes, set `radius` to about Super Heavy's `distAtImpact`.
