# Skyfront: Global Conflict

A browser combat game set on a small, round, voxel-style planet. You can fly a jet, an attack plane or a helicopter, or command a tank, a destroyer or a mobile missile launcher. Air, ground and naval enemies fight back. When you fire a guided weapon you steer it yourself from a missile camera.

Built with plain JavaScript and [three.js](https://threejs.org/). No build step.

## Running it

The game uses ES modules, so open it through a local web server rather than by double-clicking the file:

```bash
# any of these, from the repository folder
npx serve .
python -m http.server 8000
```

Then open `http://localhost:8000` (or the port shown) in Chrome or Edge. three.js is loaded from the jsDelivr CDN, so you need an internet connection the first time.

You can also host the folder on GitHub Pages (Settings → Pages → deploy from branch) and play it from there.

### Controller

Connect your controller (USB or Bluetooth) before opening the page, then press any button. The title screen shows when the game sees it. Ant Esports and other XInput pads work with the default layout. If buttons are mixed up (for example in DirectInput mode), open **Controls & Controller**: it has a live button/axis tester and lets you remap every action, invert pitch or look, and change the deadzone and stick curve.

## The planet

- Radius 5,000 units. A fighter at cruise speed circles the globe in about 11 minutes, and in about 6 on full afterburner.
- Procedural continents, oceans, mountains, forests, ice caps, 38 cities and drifting voxel clouds, with muted colours.
- The sun follows you, so it is always daytime where you are.

## Roles

| Role | Moves with | Weapons |
|---|---|---|
| Fighter Jet | Arcade flight model with flight assist | Gun, AAM, AGM |
| Attack Plane | Slower and armoured | Heavy cannon, glide bombs, AGM, rockets |
| Helicopter | Hovers; the nose follows your aim | Chain gun, ATGM, rockets |
| Tank | Drives on land; the turret follows the camera | Auto-ranging 120mm cannon, ATGM |
| Destroyer | Sails on water with a throttle telegraph | 127mm deck gun, cruise missiles, SAMs, CIWS |
| Missile Command | Mobile launcher truck | MG, long-range cruise missiles, interceptor SAMs |

### You steer every guided weapon

Pressing the guided-weapon button launches the missile, bomb or ATGM and switches to its camera. Your vehicle flies or holds position on autopilot while you steer.

- **Left stick**: steer. **RT**: boost (burns fuel faster). **LT**: fine aim.
- **X**: release. The weapon then homes on your locked target by itself and the camera returns to your vehicle. Tap **B** then **X** to fire-and-forget.
- **B** again: detonate early.
- Manually steered missiles ignore enemy flares. Released (auto-guided) ones can be decoyed.
- Cruise missiles can fly a quarter of the way around the planet. Enemy SAMs and flak shoot at them, so fly low (below about 28 m).

## Threats: counter or evade

The threat system works like the shield colours in Hogwarts Legacy:

- **Yellow** (IR missiles, ATGMs, anti-ship missiles): press **COUNTER** (Y) at the right moment. A timing ring shrinks toward the centre of the screen; press when it says *NOW*. Flares, smoke or CIWS defeat the threat. Press too early and it keeps tracking you, and the counter needs a few seconds to recharge.
- **Red** (radar SAMs, torpedoes, artillery barrages): counters do nothing, so you have to move.
  - Radar missiles: break hard at right angles just before impact, or drop behind terrain or into the weeds.
  - Torpedoes: turn parallel to their track.
  - Artillery: drive out of the red circle on the ground.

Enemies show a *being tracked* and then *locked* warning before they fire, which gives you time to react. Successful counters and evasions trigger a short slow-motion effect and score a bonus.

## Default controller layout (XInput)

| | Aircraft | Helicopter | Tank / Ship / Launcher |
|---|---|---|---|
| Left stick | Pitch / roll | Fly (cyclic) | Drive / steer |
| Right stick | Look around | Aim & turn | Aim turret / camera |
| RT / LT | Boost / brake | Climb / descend | – |
| LB / RB | Rudder | Yaw | – |
| A | Guns | Gun | Cannon / MG |
| B | Guided weapon | Guided weapon | Guided weapon |
| X | Next target | Next target | Next target |
| Y | **Counter** | **Counter** | **Counter** |
| D-pad ◀ ▶ | Switch special weapon | ← | ← |
| D-pad ▲ | Camera | Camera | Camera |
| L3 | Flight assist on/off | | |
| Start / Back | Pause / mission info | | |

Keyboard and mouse also work: W/A/S/D, Q/E, Shift/Z, Space, F, R, C, Tab, V and the mouse. See the in-game Controls screen.

## Campaign

The world is split into 16 regions held by the **Allied Coalition** or the **Red Dominion**. Pick a role, then choose one of the generated missions on the war map:

Precision Strike · Air Superiority (with an enemy ace) · Bomber Intercept · Naval Strike · Armour Column · Hold the Line (defend waves) · Low-Level Recon · Convoy Escort · Deep Strike (cruise missiles across the globe) · Fleet Engagement · Shore Bombardment · Air Defence.

Winning weakens enemy regions and eventually liberates them. Losing lets the enemy push back. Progress is saved in your browser.

**Open War** is endless free play: enemies keep spawning around you.

## Code layout

```
index.html, style.css
src/main.js       boot + main loop
src/game.js       world, spawning, threats/counter logic, environment
src/planet.js     cube-sphere terrain, biomes, trees, cities, clouds, map image
src/player.js     player vehicles (flight / heli / ground / ship models, weapons, targeting)
src/units.js      enemy & allied AI (fighters, aces, bombers, gunships, tanks, AA, SAM, artillery, ships, structures)
src/weapons.js    bullets/shells/flak + guided missiles (manual, homing, decoys, torpedoes)
src/missions.js   mission types, objectives, spawn logic
src/campaign.js   regions, front lines, war progress
src/camera.js     chase / orbit-aim / missile / death cameras
src/hud.js        canvas HUD (radar, markers, threat rings, lock warnings)
src/ui.js         menus, war map, controller remapping
src/input.js      gamepad + keyboard/mouse
src/fx.js, audio.js, models.js, data.js, noise.js, util.js
```

Tuning for speeds, damage and turn rates lives in `src/data.js`.
