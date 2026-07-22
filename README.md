# BomberPhone 💣

A classic Bomberman-style arcade game built for [Cloud Phone](https://cloudphone.dev) — the remote-browser platform that brings web apps to feature phones. No special SDK, no touchscreen, just standard Web APIs running at 240×320.

Blast through crates, dodge enemies, grab power-ups, and clear the grid to advance through progressively harder levels.

## Features

- Classic grid-based Bomberman gameplay — destructible crates, chain-reacting bombs, power-ups
- Full T9 keypad + softkey (LSK/RSK) navigation, matching Cloud Phone / feature-phone UX conventions
- Title menu, pause menu, in-game Help, and About pages
- Sound effects via Web Audio (togglable)
- Runs at the smallest Cloud Phone resolution: 240×320
- Zero build step — plain HTML, CSS, and JavaScript, split into small readable modules
- Works in any modern desktop/mobile browser for easy testing, not just Cloud Phone

## Controls

| Key | Action |
|---|---|
| `2` | Move up |
| `8` | Move down |
| `4` | Move left |
| `6` | Move right |
| `5` | Place bomb / confirm |
| `0` | Pause / resume |
| **Menu** (LSK) | Open pause menu |
| **Back** (RSK) | Close menu / go back |

Arrow keys work as aliases for `2/8/4/6`, and `Enter`/`Space` alias `5`, for testing on a regular keyboard.

## Project structure

```
bomberphone/
├── index.html    # game screen (canvas) — title menu, gameplay, pause menu
├── help.html     # how-to-play / controls reference
├── about.html    # about the game
├── style.css     # shared device chrome + screen styles
├── keypad.js     # shared input layer: T9 keypad, softkeys, keyboard
├── game.js       # game engine — state, physics, rendering
├── help.js       # help page scroll/navigation
└── about.js      # about page scroll/navigation
```

## Running it

No build tools required. Everything is static.

**Locally:**
```bash
cd bomberphone
python3 -m http.server 8000
```
Then open `http://localhost:8000` in a browser.

**On Cloud Phone:**
Deploy the `bomberphone/` folder to any static host (GitHub Pages, Netlify, S3, etc.) and register the URL as a Cloud Phone widget. Everything is relative, so no path changes are needed.

## How to play

- Move around the grid and place bombs (`5`) to destroy brown crates.
- Bombs explode after a short fuse — get clear before the blast.
- Bombs chain-react, so a blast can set off a nearby bomb too.
- Destroyed crates sometimes drop power-ups:
  - **B** — one extra bomb you can place at a time
  - **F** — bigger blast radius
  - **♥** — extra life
- Defeat every enemy on the level to advance. Enemies get faster and more numerous each level.
- You have 3 lives. Game over when they run out — your score and level reached are shown.

## License

MIT — do whatever you like with it.
