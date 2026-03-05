const TILE_SIZE = 32;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 1000;
const CENTER_X = Math.floor(MAP_WIDTH / 2);
const CENTER_Y = Math.floor(MAP_HEIGHT / 2);
const LOAD_RADIUS = 10;

let scale = 0.8;
let cameraX = CENTER_X * TILE_SIZE * scale - window.innerWidth / 2;
let cameraY = CENTER_Y * TILE_SIZE * scale - window.innerHeight / 2;
let actionMode = null;

let needsRedraw = true;
let lastCameraX = cameraX;
let lastCameraY = cameraY;
let lastScale = scale;

const biomeMap = new Array(MAP_WIDTH).fill(null).map(() => new Array(MAP_HEIGHT));
const loadedChunks = new Set();

let lastLoadedCenterX = 0;
let lastLoadedCenterY = 0;

const player = {
  race: "knights",
  homeX: 0,
  homeY: 0
};

const buildingsMap = {};

const BIOME_COLORS = {
  WATER: "#0a2f6a",
  COAST: "#1e6fb0",
  DESERT: "#e9b35f",
  PLAINS: "#90be6d",
  FOREST: "#2d6a4f",
  JUNGLE: "#1b4d1b",
  MOUNTAIN: "#8b7d6b",
  SNOW: "#e9ecef",
  STEPPE: "#b8c27a"
};

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
  tg.setHeaderColor("#1a1a1a");
  tg.setBackgroundColor("#1a1a1a");
  tg.ready();
}

function hash2(x, y, seed) {
  const s = Math.sin((x * 127.1 + y * 311.7 + seed * 17.31) * 0.1) * 43758.5453123;
  return s - Math.floor(s);
}

function getBiomeBySeed(x, y) {
  const nx = (x - CENTER_X) / MAP_WIDTH;
  const ny = (y - CENTER_Y) / MAP_HEIGHT;

  const continental = hash2(x, y, 1) * 0.55 + hash2(x >> 1, y >> 1, 2) * 0.45;
  const moisture = hash2(x + 37, y + 91, 3) * 0.6 + hash2(x >> 2, y >> 2, 4) * 0.4;
  const roughness = hash2(x + 119, y + 61, 5);

  const lat = Math.abs((y - CENTER_Y) / CENTER_Y);
  const radial = Math.sqrt(nx * nx + ny * ny);
  const seaBias = Math.max(0, radial - 0.25) * 0.8;
  const landValue = continental - seaBias;

  if (landValue < 0.35) return "WATER";
  if (landValue < 0.40) return "COAST";

  if (lat > 0.82) return "SNOW";
  if (roughness > 0.86) return "MOUNTAIN";

  if (landValue > 0.70 && moisture < 0.34) return "DESERT";
  if (moisture > 0.72 && lat < 0.55) return "JUNGLE";
  if (moisture > 0.58) return "FOREST";
  if (moisture < 0.30) return "STEPPE";
  return "PLAINS";
}

function generateFixedMap() {
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      biomeMap[x][y] = getBiomeBySeed(x, y);
    }
  }
}

function getBiome(relX, relY) {
  const wx = relX + CENTER_X;
  const wy = relY + CENTER_Y;
  return biomeMap[wx]?.[wy] || "WATER";
}

function getBiomeColor(biome) {
  return BIOME_COLORS[biome] || "#111";
}

function updateLoadedChunks(centerX, centerY) {
  loadedChunks.clear();
  for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
    for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
      loadedChunks.add(`${centerX + dx},${centerY + dy}`);
    }
  }
}

function isCellLoaded(x, y) {
  return loadedChunks.has(`${x},${y}`);
}

function getSpawnForRace(race) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = CENTER_X + Math.floor(Math.random() * 200 - 100);
    const y = CENTER_Y + Math.floor(Math.random() * 200 - 100);
    const biome = biomeMap[x]?.[y];

    if (race === "knights" && biome === "PLAINS") return { x: x - CENTER_X, y: y - CENTER_Y };
    if (race === "samurai" && biome === "FOREST") return { x: x - CENTER_X, y: y - CENTER_Y };
    if (race === "vikings" && (biome === "WATER" || biome === "COAST")) return { x: x - CENTER_X, y: y - CENTER_Y };
    if (race === "mongols" && biome === "STEPPE") return { x: x - CENTER_X, y: y - CENTER_Y };
    if (race === "desert" && biome === "DESERT") return { x: x - CENTER_X, y: y - CENTER_Y };
    if (race === "aztecs" && biome === "JUNGLE") return { x: x - CENTER_X, y: y - CENTER_Y };
  }
  return { x: 0, y: 0 };
}

function addBuilding(building) {
  buildingsMap[`${building.x},${building.y}`] = building;
}

function worldToScreen(relX, relY) {
  const tile = TILE_SIZE * scale;
  return {
    x: ((relX + CENTER_X) * tile) - cameraX,
    y: ((relY + CENTER_Y) * tile) - cameraY
  };
}

function centerCameraOnRelativeArea(relX, relY, width = 1, height = 1, canvas = null) {
  const tile = TILE_SIZE * scale;
  const viewportW = canvas ? canvas.width : window.innerWidth;
  const viewportH = canvas ? canvas.height : window.innerHeight;
  const worldCenterX = relX + CENTER_X + width / 2;
  const worldCenterY = relY + CENTER_Y + height / 2;
  cameraX = worldCenterX * tile - viewportW / 2;
  cameraY = worldCenterY * tile - viewportH / 2;
  needsRedraw = true;
}

function setActionMode(mode) {
  actionMode = mode;
  document.querySelectorAll(".action-btn").forEach((btn) => btn.classList.remove("active"));
  if (mode === "build") document.getElementById("actionBuild")?.classList.add("active");
  if (mode === "move") document.getElementById("actionMove")?.classList.add("active");
  if (mode === "army") document.getElementById("actionArmy")?.classList.add("active");
}

function drawMap(ctx, canvas) {
  const tile = TILE_SIZE * scale;
  if (tile <= 0.01) return null;

  let startCol = Math.floor(cameraX / tile);
  let startRow = Math.floor(cameraY / tile);
  let endCol = startCol + Math.ceil(canvas.width / tile) + 2;
  let endRow = startRow + Math.ceil(canvas.height / tile) + 2;

  startCol = Math.max(0, startCol);
  startRow = Math.max(0, startRow);
  endCol = Math.min(MAP_WIDTH, endCol);
  endRow = Math.min(MAP_HEIGHT, endRow);

  ctx.imageSmoothingEnabled = false;

  for (let row = startRow; row < endRow; row++) {
    const y = row * tile - cameraY;
    for (let col = startCol; col < endCol; col++) {
      const x = col * tile - cameraX;
      const worldX = col - CENTER_X;
      const worldY = row - CENTER_Y;

      if (isCellLoaded(worldX, worldY)) {
        const biome = biomeMap[col]?.[row] || "WATER";
        ctx.fillStyle = getBiomeColor(biome);
      } else {
        ctx.fillStyle = "#111";
      }
      ctx.fillRect(x, y, tile + 1, tile + 1);
    }
  }

  return { tile };
}

function drawBuildings(ctx, canvas, view) {
  if (!view) return;
  const { tile } = view;

  for (const key in buildingsMap) {
    const b = buildingsMap[key];
    if (!isCellLoaded(b.x, b.y)) continue;

    const pos = worldToScreen(b.x, b.y);
    const bw = (b.width || 1) * tile;
    const bh = (b.height || 1) * tile;

    if (pos.x > canvas.width || pos.y > canvas.height || pos.x + bw < 0 || pos.y + bh < 0) {
      continue;
    }

    const stickerX = pos.x + bw / 2;
    const stickerY = pos.y + bh / 2;

    ctx.beginPath();
    ctx.arc(stickerX, stickerY, Math.max(8, tile * 0.52), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(20, tile * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Courier New",sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(b.emoji || "🏰", stickerX, stickerY);
  }
}

function checkAndLoadChunks(canvas) {
  const tile = TILE_SIZE * scale;
  const centerTileX = Math.floor((cameraX + canvas.width / 2) / tile) - CENTER_X;
  const centerTileY = Math.floor((cameraY + canvas.height / 2) / tile) - CENTER_Y;

  if (
    Math.abs(centerTileX - lastLoadedCenterX) > LOAD_RADIUS / 2 ||
    Math.abs(centerTileY - lastLoadedCenterY) > LOAD_RADIUS / 2
  ) {
    updateLoadedChunks(centerTileX, centerTileY);
    lastLoadedCenterX = centerTileX;
    lastLoadedCenterY = centerTileY;
    needsRedraw = true;
  }
}

function parseRace() {
  const urlRace = new URLSearchParams(window.location.search).get("race");
  if (urlRace) return urlRace.toLowerCase();

  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam) return String(startParam).toLowerCase();

  return "knights";
}

window.onload = function () {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const biomeInfo = document.getElementById("biomeInfo");
  const coordsEl = document.getElementById("coords");

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    needsRedraw = true;
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  generateFixedMap();

  player.race = parseRace();
  const spawn = getSpawnForRace(player.race);
  player.homeX = spawn.x;
  player.homeY = spawn.y;

  updateLoadedChunks(player.homeX, player.homeY);
  lastLoadedCenterX = player.homeX;
  lastLoadedCenterY = player.homeY;

  addBuilding({ x: player.homeX, y: player.homeY, width: 2, height: 2, color: "#8B8B8B", emoji: "🏰" });

  centerCameraOnRelativeArea(player.homeX, player.homeY, 2, 2, canvas);

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    cameraX -= dx;
    cameraY -= dy;
    lastX = e.clientX;
    lastY = e.clientY;
    needsRedraw = true;
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = Math.floor((mx + cameraX) / (TILE_SIZE * scale));
    const wy = Math.floor((my + cameraY) / (TILE_SIZE * scale));

    const relX = wx - CENTER_X;
    const relY = wy - CENTER_Y;
    const biome = getBiome(relX, relY);

    if (coordsEl) coordsEl.textContent = `X: ${relX}, Y: ${relY}`;
    if (biomeInfo) biomeInfo.textContent = biome;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX + cameraX) / (TILE_SIZE * scale);
    const worldY = (mouseY + cameraY) / (TILE_SIZE * scale);

    scale = e.deltaY < 0 ? scale * 1.1 : scale / 1.1;
    scale = Math.max(0.3, Math.min(2.5, scale));

    cameraX = worldX * TILE_SIZE * scale - mouseX;
    cameraY = worldY * TILE_SIZE * scale - mouseY;
    needsRedraw = true;
  }, { passive: false });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = (clickX + cameraX) / (TILE_SIZE * scale);
    const worldY = (clickY + cameraY) / (TILE_SIZE * scale);
    const tileX = Math.floor(worldX) - CENTER_X;
    const tileY = Math.floor(worldY) - CENTER_Y;

    if (actionMode === "build") console.log(`🏗️ Построить на (${tileX}, ${tileY})`);
    if (actionMode === "move") console.log(`🚚 Переместить в (${tileX}, ${tileY})`);
    if (actionMode === "army") console.log(`⚔️ Отправить армию на (${tileX}, ${tileY})`);
  });

  document.getElementById("actionBuild")?.addEventListener("click", () => setActionMode("build"));
  document.getElementById("actionMove")?.addEventListener("click", () => setActionMode("move"));
  document.getElementById("actionArmy")?.addEventListener("click", () => setActionMode("army"));
  document.getElementById("actionHome")?.addEventListener("click", () => {
    centerCameraOnRelativeArea(player.homeX, player.homeY, 2, 2, canvas);
  });

  function animate() {
    const cameraChanged = cameraX !== lastCameraX || cameraY !== lastCameraY || scale !== lastScale;
    if (needsRedraw || cameraChanged) {
      checkAndLoadChunks(canvas);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const view = drawMap(ctx, canvas);
      drawBuildings(ctx, canvas, view);

      lastCameraX = cameraX;
      lastCameraY = cameraY;
      lastScale = scale;
      needsRedraw = false;
    }
    requestAnimationFrame(animate);
  }

  animate();
};
