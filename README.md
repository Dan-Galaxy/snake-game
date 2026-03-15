# Snake Game

A classic Snake game built with vanilla HTML, CSS, and JavaScript.

## Play Locally

1. Open `index.html` in your browser.
2. Use Arrow keys or `W`, `A`, `S`, `D` to move.
3. On mobile, use the on-screen direction buttons.

### Run With npm

1. Install dependencies: `npm install`
2. Start the local server: `npm start`
3. Open `http://localhost:8000`

## Rules

- Eat food to grow and increase your score.
- The snake wraps through walls and appears from the opposite side.
- Random timed pickups appear after some food: blue speeds you up, gold slows you down.
- You only lose when your head hits your own body.
- Speed gradually increases as your score rises.
- Best score and lifetime stats are saved in browser local storage.

## Extra Controls

- Press `P` to pause or resume.
- Use the Sound button to mute/unmute effects.

## Project Files

- `index.html`: Game structure and UI elements.
- `styles.css`: Layout, theme, responsive styling.
- `script.js`: Game loop, collision logic, controls, scoring.