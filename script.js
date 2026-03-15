// Cache DOM elements used by the game UI.
const board = document.getElementById("board");
const boardWrap = document.querySelector(".board-wrap");
const ctx = board.getContext("2d");
const scoreEl = document.getElementById("score");
const bestScoreEl = document.getElementById("best-score");
const speedEl = document.getElementById("speed");
const gamesPlayedEl = document.getElementById("games-played");
const longestSnakeEl = document.getElementById("longest-snake");
const muteBtn = document.getElementById("mute-btn");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const restartBtn = document.getElementById("restart-btn");
const controlButtons = document.querySelectorAll(".controls button");

// Core board settings and tuning constants.
const gridCount = 20;
const cellSize = board.width / gridCount;
const baseSpeedMs = 128;
const minSpeedMs = 64;
const maxSpeedMs = 230;
const speedEffectStepMs = 16;
const effectMinLifeMs = 3000;
const effectMaxLifeMs = 7800;
const metaStorageKey = "snakeMeta";
const mutedStorageKey = "snakeMuted";

// State machine for gameplay flow.
const GAME_STATE = {
  READY: "ready",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "game_over"
};

// Keyboard mapping for movement controls.
const keyToDir = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 }
};

// Mutable game state.
let snake;
let direction;
let nextDirection;
let food;
let effectItem;
let score;
let speedOffsetMs = 0;
let tickMs = baseSpeedMs;
let gameState = GAME_STATE.READY;
let loopId = null;
let particles = [];

// Persistent stats and audio prefs.
let meta = loadMeta();
let isMuted = localStorage.getItem(mutedStorageKey) === "1";
let audioCtx = null;

// Keep HUD in sync with persisted values.
bestScoreEl.textContent = String(meta.bestScore);
gamesPlayedEl.textContent = String(meta.gamesPlayed);
longestSnakeEl.textContent = String(meta.longestSnake);
speedEl.textContent = `${tickMs}ms`;
updateMuteButton();

function loadMeta() {
  const fallback = {
    bestScore: Number(localStorage.getItem("snakeBestScore") || 0),
    gamesPlayed: 0,
    longestSnake: 3,
    totalScore: 0
  };

  try {
    const raw = localStorage.getItem(metaStorageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return {
      bestScore: Number(parsed.bestScore || fallback.bestScore),
      gamesPlayed: Number(parsed.gamesPlayed || 0),
      longestSnake: Math.max(3, Number(parsed.longestSnake || 3)),
      totalScore: Number(parsed.totalScore || 0)
    };
  } catch {
    return fallback;
  }
}

function saveMeta() {
  localStorage.setItem(metaStorageKey, JSON.stringify(meta));
  localStorage.setItem("snakeBestScore", String(meta.bestScore));
}

function updateMetaHud() {
  bestScoreEl.textContent = String(meta.bestScore);
  gamesPlayedEl.textContent = String(meta.gamesPlayed);
  longestSnakeEl.textContent = String(meta.longestSnake);
}

function updateMuteButton() {
  muteBtn.textContent = isMuted ? "Sound: Off" : "Sound: On";
  muteBtn.setAttribute("aria-pressed", String(isMuted));
}

// Lazily create audio context only when a player interacts.
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playTone(freq, durationMs, type = "sine", volume = 0.04) {
  if (isMuted) {
    return;
  }

  ensureAudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

function playFoodSound() {
  playTone(620, 80, "triangle", 0.05);
}

function playEffectSound(type) {
  if (type === "fast") {
    playTone(900, 85, "square", 0.045);
    return;
  }

  playTone(280, 110, "sawtooth", 0.04);
}

function playGameOverSound() {
  playTone(260, 90, "sawtooth", 0.045);
  setTimeout(() => playTone(180, 140, "sawtooth", 0.04), 90);
}

function showOverlay(title, text, buttonText = "Play") {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  restartBtn.textContent = buttonText;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function stopLoop() {
  if (loopId) {
    clearInterval(loopId);
    loopId = null;
  }
}

function startLoop() {
  stopLoop();
  loopId = setInterval(update, tickMs);
}

function setGameState(nextState) {
  gameState = nextState;

  if (nextState === GAME_STATE.PLAYING) {
    hideOverlay();
    startLoop();
    return;
  }

  stopLoop();

  if (nextState === GAME_STATE.READY) {
    showOverlay("Snake", "Use Arrow keys or WASD to start. Press P to pause.", "Play");
  } else if (nextState === GAME_STATE.PAUSED) {
    showOverlay("Paused", "Press P to continue or use Resume.", "Resume");
  } else if (nextState === GAME_STATE.GAME_OVER) {
    showOverlay("Game Over", "Press Play to try again.", "Play Again");
  }
}

function animateScorePop() {
  scoreEl.classList.remove("pulse");
  void scoreEl.offsetWidth;
  scoreEl.classList.add("pulse");
}

function triggerShake() {
  boardWrap.classList.remove("shake");
  void boardWrap.offsetWidth;
  boardWrap.classList.add("shake");
}

function spawnParticles(cell, color, amount = 8) {
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 0.18 + 0.07) * cellSize;
    particles.push({
      x: (cell.x + 0.5) * cellSize,
      y: (cell.y + 0.5) * cellSize,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: Math.random() * 7 + 9,
      color
    });
  }
}

function updateParticles() {
  particles = particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * 0.08,
      y: particle.y + particle.vy * 0.08,
      vx: particle.vx * 0.93,
      vy: particle.vy * 0.93,
      life: particle.life - 1
    }))
    .filter((particle) => particle.life > 0);
}

function renderParticles() {
  particles.forEach((particle) => {
    const alpha = Math.min(1, particle.life / 10);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function isSnakeCell(candidate) {
  return snake.some((segment) => segment.x === candidate.x && segment.y === candidate.y);
}

function randomFreeCell() {
  while (true) {
    const candidate = {
      x: Math.floor(Math.random() * gridCount),
      y: Math.floor(Math.random() * gridCount)
    };

    const onSnake = isSnakeCell(candidate);
    const onFood = food && food.x === candidate.x && food.y === candidate.y;
    const onEffect = effectItem && effectItem.x === candidate.x && effectItem.y === candidate.y;

    if (!onSnake && !onFood && !onEffect) {
      return candidate;
    }
  }
}

function randomFoodPosition() {
  return randomFreeCell();
}

// Weighted effect generation with score-driven bias.
function effectTypeByWeight() {
  const fastWeight = Math.min(0.7, 0.42 + score * 0.01);
  return Math.random() < fastWeight ? "fast" : "slow";
}

function shouldSpawnEffect() {
  const chance = Math.min(0.62, 0.26 + score * 0.012);
  return Math.random() < chance;
}

function effectLifetimeMs() {
  return Math.max(effectMinLifeMs, effectMaxLifeMs - score * 110);
}

function spawnEffectItem() {
  effectItem = {
    ...randomFreeCell(),
    type: effectTypeByWeight(),
    expiresAt: Date.now() + effectLifetimeMs()
  };
}

function baseSpeedForScore(nextScore) {
  const fasterBy = Math.floor(nextScore / 4) * 4;
  return Math.max(minSpeedMs, baseSpeedMs - fasterBy);
}

function clampTickMs(nextTickMs) {
  return Math.min(maxSpeedMs, Math.max(minSpeedMs, nextTickMs));
}

function recalcTickSpeed() {
  const target = clampTickMs(baseSpeedForScore(score) + speedOffsetMs);
  if (target === tickMs) {
    return;
  }

  tickMs = target;
  speedEl.textContent = `${tickMs}ms`;
  if (gameState === GAME_STATE.PLAYING) {
    startLoop();
  }
}

function applyEffect(type) {
  if (type === "fast") {
    speedOffsetMs -= speedEffectStepMs;
  } else {
    speedOffsetMs += speedEffectStepMs;
  }

  recalcTickSpeed();
}

function paintRoundedRect(x, y, size, radius, color) {
  ctx.fillStyle = color;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radius);
    ctx.fill();
    return;
  }

  ctx.fillRect(x, y, size, size);
}

function drawSnakeSegment(segment, index) {
  const inset = 2;
  const size = cellSize - inset * 2;
  const x = segment.x * cellSize + inset;
  const y = segment.y * cellSize + inset;
  const radius = index === 0 ? 6 : 4;

  if (index === 0) {
    const headGradient = ctx.createLinearGradient(x, y, x + size, y + size);
    headGradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue("--snake-head"));
    headGradient.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue("--snake"));
    paintRoundedRect(x, y, size, radius, headGradient);

    const eyeOffset = size * 0.22;
    const eyeSize = 2.4;
    const centerX = x + size / 2;
    const centerY = y + size / 2;
    const dx = direction.x;
    const dy = direction.y;
    const sideX = -dy;
    const sideY = dx;

    const eye1X = centerX + dx * eyeOffset + sideX * 3;
    const eye1Y = centerY + dy * eyeOffset + sideY * 3;
    const eye2X = centerX + dx * eyeOffset - sideX * 3;
    const eye2Y = centerY + dy * eyeOffset - sideY * 3;

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(eye1X, eye1Y, eyeSize, 0, Math.PI * 2);
    ctx.arc(eye2X, eye2Y, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  paintRoundedRect(
    x,
    y,
    size,
    radius,
    getComputedStyle(document.documentElement).getPropertyValue("--snake")
  );
}

function drawFood() {
  const centerX = (food.x + 0.5) * cellSize;
  const centerY = (food.y + 0.5) * cellSize;
  const radius = cellSize * 0.25;
  const glow = ctx.createRadialGradient(centerX, centerY, 1, centerX, centerY, cellSize * 0.55);

  glow.addColorStop(0, "rgba(220, 38, 38, 0.95)");
  glow.addColorStop(1, "rgba(220, 38, 38, 0.16)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, cellSize * 0.52, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--food");
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawEffect() {
  if (!effectItem) {
    return;
  }

  const now = Date.now();
  const centerX = (effectItem.x + 0.5) * cellSize;
  const centerY = (effectItem.y + 0.5) * cellSize;
  const pulse = 1 + Math.sin(now / 120) * 0.12;
  const baseColor =
    effectItem.type === "fast"
      ? getComputedStyle(document.documentElement).getPropertyValue("--boost-fast")
      : getComputedStyle(document.documentElement).getPropertyValue("--boost-slow");

  if (effectItem.expiresAt - now < 1600 && Math.floor(now / 140) % 2 === 0) {
    return;
  }

  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, cellSize * 0.23 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = baseColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, cellSize * 0.35 * pulse, 0, Math.PI * 2);
  ctx.stroke();
}

function renderGrid() {
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--board");
  ctx.fillRect(0, 0, board.width, board.height);

  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--grid");
  ctx.lineWidth = 1;

  for (let i = 1; i < gridCount; i += 1) {
    const pos = i * cellSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, board.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(board.width, pos);
    ctx.stroke();
  }
}

function render() {
  renderGrid();
  drawFood();
  drawEffect();
  snake.forEach((segment, index) => drawSnakeSegment(segment, index));
  renderParticles();
}

function isOpposite(newDir) {
  return direction.x + newDir.x === 0 && direction.y + newDir.y === 0;
}

function startPlayingIfNeeded() {
  if (gameState === GAME_STATE.READY) {
    setGameState(GAME_STATE.PLAYING);
  }
}

function togglePause() {
  if (gameState === GAME_STATE.PLAYING) {
    setGameState(GAME_STATE.PAUSED);
  } else if (gameState === GAME_STATE.PAUSED) {
    setGameState(GAME_STATE.PLAYING);
  }
}

function setDirection(newDir) {
  if (gameState === GAME_STATE.GAME_OVER) {
    return;
  }

  startPlayingIfNeeded();
  if (gameState !== GAME_STATE.PLAYING) {
    return;
  }

  if (!isOpposite(newDir)) {
    nextDirection = newDir;
  }
}

function recordGameOverStats() {
  meta.gamesPlayed += 1;
  meta.longestSnake = Math.max(meta.longestSnake, snake.length);
  meta.totalScore += score;
  meta.bestScore = Math.max(meta.bestScore, score);
  saveMeta();
  updateMetaHud();
}

function gameOver() {
  triggerShake();
  playGameOverSound();
  recordGameOverStats();
  setGameState(GAME_STATE.GAME_OVER);
}

function resetGame() {
  stopLoop();
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 }
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  speedOffsetMs = 0;
  tickMs = baseSpeedMs;
  food = randomFoodPosition();
  effectItem = null;
  particles = [];

  scoreEl.textContent = "0";
  speedEl.textContent = `${tickMs}ms`;
  updateMetaHud();
  render();
  setGameState(GAME_STATE.READY);
}

function update() {
  if (gameState !== GAME_STATE.PLAYING) {
    return;
  }

  const now = Date.now();
  updateParticles();

  if (effectItem && effectItem.expiresAt <= now) {
    effectItem = null;
  }

  direction = nextDirection;
  const head = {
    x: (snake[0].x + direction.x + gridCount) % gridCount,
    y: (snake[0].y + direction.y + gridCount) % gridCount
  };

  const willEatFood = head.x === food.x && head.y === food.y;
  const bodyForCollision = willEatFood ? snake : snake.slice(0, -1);
  const hitSelf = bodyForCollision.some((segment) => segment.x === head.x && segment.y === head.y);

  if (hitSelf) {
    gameOver();
    return;
  }

  snake.unshift(head);
  if (!willEatFood) {
    snake.pop();
  } else {
    score += 1;
    scoreEl.textContent = String(score);
    animateScorePop();
    playFoodSound();
    spawnParticles(head, "#dc2626", 10);

    food = randomFoodPosition();
    if (!effectItem && shouldSpawnEffect()) {
      spawnEffectItem();
    }

    recalcTickSpeed();
    if (score > meta.bestScore) {
      meta.bestScore = score;
      saveMeta();
      updateMetaHud();
    }
  }

  const hitEffect = effectItem && head.x === effectItem.x && head.y === effectItem.y;
  if (hitEffect) {
    playEffectSound(effectItem.type);
    spawnParticles(head, effectItem.type === "fast" ? "#2563eb" : "#ca8a04", 12);
    applyEffect(effectItem.type);
    effectItem = null;
  }

  render();
}

document.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (event.code === "Space") {
    event.preventDefault();
    if (gameState === GAME_STATE.GAME_OVER) {
      ensureAudioContext();
      resetGame();
    }
    return;
  }

  if (key === "p") {
    event.preventDefault();
    togglePause();
    return;
  }

  const newDir = keyToDir[key];
  if (!newDir) {
    return;
  }

  event.preventDefault();
  ensureAudioContext();
  setDirection(newDir);
});

controlButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    ensureAudioContext();
    const { dir } = btn.dataset;
    const mapped =
      dir === "up"
        ? { x: 0, y: -1 }
        : dir === "down"
          ? { x: 0, y: 1 }
          : dir === "left"
            ? { x: -1, y: 0 }
            : { x: 1, y: 0 };

    setDirection(mapped);
  });
});

muteBtn.addEventListener("click", () => {
  isMuted = !isMuted;
  localStorage.setItem(mutedStorageKey, isMuted ? "1" : "0");
  updateMuteButton();
});

restartBtn.addEventListener("click", () => {
  ensureAudioContext();
  if (gameState === GAME_STATE.PAUSED) {
    setGameState(GAME_STATE.PLAYING);
    return;
  }

  resetGame();
});

// Initial paint and welcome prompt.
resetGame();
