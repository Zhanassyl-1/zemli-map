const TILE_SIZE = 32;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 1000;
const CENTER_X = Math.floor(MAP_WIDTH / 2);
const CENTER_Y = Math.floor(MAP_HEIGHT / 2);
const VIEW_RADIUS = 15;

let scale = 0.8;
let cameraX = CENTER_X * TILE_SIZE * scale - window.innerWidth / 2;
let cameraY = CENTER_Y * TILE_SIZE * scale - window.innerHeight / 2;
let actionMode = null;

let needsRedraw = true;
let lastCameraX = cameraX;
let lastCameraY = cameraY;
let lastScale = scale;

const biomeMap = new Array(MAP_WIDTH).fill(null).map(() => new Array(MAP_HEIGHT));

const player = {
  race: "knights",
  homeX: 0,
  homeY: 0
};

const buildingsMap = {};
let towerRadius = 0;
let selectedBuilding = null;
let selectedCost = "";

const resources = {
  wood: 100,
  stone: 50,
  iron: 30,
  gold: 20
};

const buildingEmoji = {
  lumber: "🪓",
  mine: "⛏️",
  farm: "🌾",
  barracks: "⚔️",
  wall: "🧱",
  tower: "🗼",
  gold: "💰"
};

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

function fract(v) {
  return v - Math.floor(v);
}

function hash2(x, y, seed) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 13.37)) * 43758.5453123;
  return fract(n);
}

function smoothNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const u = tx * tx * (3 - 2 * tx);
  const v = ty * ty * (3 - 2 * ty);

  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);

  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;
  return nx0 * (1 - v) + nx1 * v;
}

function fbm(x, y, octaves, baseFreq, lacunarity, gain, seed) {
  let amp = 1;
  let freq = baseFreq;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function generateFixedMap() {
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const ny = (y - CENTER_Y) / MAP_HEIGHT;
    const lat = Math.abs((y - CENTER_Y) / CENTER_Y);

    for (let x = 0; x < MAP_WIDTH; x++) {
      const nx = (x - CENTER_X) / MAP_WIDTH;

      const continental = fbm(nx * 7.0, ny * 7.0, 5, 1.0, 2.0, 0.5, 17) * 2 - 1;
      const regional = fbm(nx * 16.0, ny * 16.0, 4, 1.0, 2.1, 0.52, 71) * 2 - 1;
      const local = fbm(nx * 40.0, ny * 40.0, 3, 1.0, 2.2, 0.55, 131) * 2 - 1;

      const edgeDist = Math.sqrt((nx * 1.1) * (nx * 1.1) + (ny * 0.95) * (ny * 0.95));
      const edgeMask = 1.0 - Math.max(0, edgeDist - 0.35) * 0.9;
      const elevation = (continental * 0.62 + regional * 0.28 + local * 0.10) * edgeMask;

      if (elevation <= -0.03) {
        biomeMap[x][y] = "WATER";
        continue;
      }
      if (elevation <= 0.03) {
        biomeMap[x][y] = "COAST";
        continue;
      }

      const moisture = fbm(nx * 25, ny * 25, 4, 1.0, 2.0, 0.5, 401);
      const mountainNoise = fbm(nx * 30, ny * 30, 3, 1.0, 2.2, 0.55, 777);
      const centerDist = Math.sqrt(nx * nx + ny * ny) / 0.5;
      const desertBias = Math.max(0, 1 - centerDist);
      const temp = 1 - lat;

      if (lat > 0.78) biomeMap[x][y] = "SNOW";
      else if (mountainNoise > 0.66 || elevation > 0.33) biomeMap[x][y] = "MOUNTAIN";
      else if (desertBias > 0.55 && temp > 0.62 && moisture < 0.56) biomeMap[x][y] = "DESERT";
      else if (temp > 0.68 && moisture > 0.58) biomeMap[x][y] = "JUNGLE";
      else if (moisture > 0.57) biomeMap[x][y] = "FOREST";
      else biomeMap[x][y] = "PLAINS";
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

function getSpawnForRace(race) {
  const targetBiome = {
    knights: "PLAINS",
    samurai: "FOREST",
    vikings: "COAST",
    mongols: "STEPPE",
    desert: "DESERT",
    aztecs: "JUNGLE"
  }[race];

  if (!targetBiome) return { x: 0, y: 0 };

  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    if (biomeMap[x]?.[y] === targetBiome) {
      return { x: x - CENTER_X, y: y - CENTER_Y };
    }
  }
  return { x: 0, y: 0 };
}

function getViewRadius() {
  return VIEW_RADIUS + towerRadius;
}

function addTower() {
  towerRadius += 10;
  needsRedraw = true;
}

function isInViewRange(centerX, centerY, targetX, targetY) {
  const dx = Math.abs(centerX - targetX);
  const dy = Math.abs(centerY - targetY);
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= getViewRadius();
}

function addBuilding(building) {
  buildingsMap[`${building.x},${building.y}`] = building;
}

function getBuilding(x, y) {
  return buildingsMap[`${x},${y}`] || null;
}

function parseCost(costString) {
  const result = {};
  const re = /(\d+)\s*(wood|stone|iron|gold)/g;
  let match = null;
  while ((match = re.exec((costString || "").toLowerCase())) !== null) {
    result[match[2]] = (result[match[2]] || 0) + Number(match[1]);
  }
  return result;
}

function canAfford(costString) {
  const required = parseCost(costString);
  return Object.keys(required).every((key) => (resources[key] || 0) >= required[key]);
}

function spendResources(costString) {
  const required = parseCost(costString);
  Object.keys(required).forEach((key) => {
    resources[key] = Math.max(0, (resources[key] || 0) - required[key]);
  });
}

function drawResources(ctx) {
  ctx.fillStyle = "#FFFFFF";
  ctx.font = '16px "Courier New"';
  ctx.fillText(`🪵 ${resources.wood} 🪨 ${resources.stone} ⛏️ ${resources.iron} 💰 ${resources.gold}`, 10, 30);
}

function updateInventoryButtons() {
  document.querySelectorAll(".inv-btn").forEach((btn) => {
    const cost = btn.dataset.cost || "";
    btn.disabled = !canAfford(cost);
  });
}

function worldToScreenAroundPlayer(relX, relY, canvas) {
  const tile = TILE_SIZE * scale;
  const dx = relX - player.homeX;
  const dy = relY - player.homeY;
  return {
    x: dx * tile + canvas.width / 2 - tile / 2,
    y: dy * tile + canvas.height / 2 - tile / 2
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

function updateCameraForPlayer(canvas) {
  const tile = TILE_SIZE * scale;
  cameraX = (player.homeX + CENTER_X) * tile - canvas.width / 2;
  cameraY = (player.homeY + CENTER_Y) * tile - canvas.height / 2;
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

  const centerX = player.homeX + CENTER_X;
  const centerY = player.homeY + CENTER_Y;
  const radius = getViewRadius();
  const half = tile / 2;

  ctx.imageSmoothingEnabled = false;

  const startCol = Math.max(0, centerX - radius);
  const startRow = Math.max(0, centerY - radius);
  const endCol = Math.min(MAP_WIDTH, centerX + radius + 1);
  const endRow = Math.min(MAP_HEIGHT, centerY + radius + 1);

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      if (!isInViewRange(centerX, centerY, col, row)) continue;
      const screenX = ((col - centerX) * tile) + canvas.width / 2 - half;
      const screenY = ((row - centerY) * tile) + canvas.height / 2 - half;
      const biome = biomeMap[col]?.[row] || "WATER";
      ctx.fillStyle = getBiomeColor(biome);
      ctx.fillRect(screenX, screenY, tile + 1, tile + 1);
    }
  }

  return { tile };
}

function drawBuildings(ctx, canvas, view) {
  if (!view) return;
  const { tile } = view;

  for (const key in buildingsMap) {
    const b = buildingsMap[key];
    const worldX = b.x + CENTER_X;
    const worldY = b.y + CENTER_Y;
    const centerX = player.homeX + CENTER_X;
    const centerY = player.homeY + CENTER_Y;
    if (!isInViewRange(centerX, centerY, worldX, worldY)) continue;

    const pos = worldToScreenAroundPlayer(b.x, b.y, canvas);
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
    updateCameraForPlayer(canvas);
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  generateFixedMap();

  player.race = parseRace();
  const spawn = getSpawnForRace(player.race);
  player.homeX = spawn.x;
  player.homeY = spawn.y;

  addBuilding({ x: player.homeX, y: player.homeY, width: 2, height: 2, color: "#8B8B8B", emoji: "🏰" });

  updateCameraForPlayer(canvas);
  updateInventoryButtons();

  document.querySelectorAll(".inv-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      document.querySelectorAll(".inv-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedBuilding = btn.dataset.type || null;
      selectedCost = btn.dataset.cost || "";
      setActionMode("build");
    });
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left - canvas.width / 2;
    const clickY = e.clientY - rect.top - canvas.height / 2;
    const tileX = Math.round(clickX / (TILE_SIZE * scale));
    const tileY = Math.round(clickY / (TILE_SIZE * scale));
    const relX = player.homeX + tileX;
    const relY = player.homeY + tileY;
    const biome = getBiome(relX, relY);

    if (coordsEl) coordsEl.textContent = `X: ${relX}, Y: ${relY}`;
    if (biomeInfo) biomeInfo.textContent = biome;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    scale = e.deltaY < 0 ? scale * 1.1 : scale / 1.1;
    scale = Math.max(0.3, Math.min(2.5, scale));
    updateCameraForPlayer(canvas);
  }, { passive: false });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left - canvas.width / 2;
    const clickY = e.clientY - rect.top - canvas.height / 2;
    const tileX = Math.round(clickX / (TILE_SIZE * scale));
    const tileY = Math.round(clickY / (TILE_SIZE * scale));
    const targetX = player.homeX + tileX;
    const targetY = player.homeY + tileY;

    if (actionMode === "build") {
      if (!selectedBuilding) {
        alert("Выбери постройку в инвентаре");
        return;
      }
      if (!canAfford(selectedCost)) {
        alert("Не хватает ресурсов!");
        updateInventoryButtons();
        return;
      }
      if (targetX + CENTER_X < 0 || targetX + CENTER_X >= MAP_WIDTH || targetY + CENTER_Y < 0 || targetY + CENTER_Y >= MAP_HEIGHT) {
        return;
      }
      if (getBuilding(targetX, targetY)) {
        alert("Здесь уже есть постройка");
        return;
      }

      spendResources(selectedCost);
      addBuilding({
        x: targetX,
        y: targetY,
        width: 1,
        height: 1,
        emoji: buildingEmoji[selectedBuilding] || "🏠",
        type: selectedBuilding
      });
      if (selectedBuilding === "tower") {
        addTower();
      }
      updateInventoryButtons();
      needsRedraw = true;
      console.log(`🏗️ Построить на (${targetX}, ${targetY})`);
      return;
    }
    if (actionMode === "army") {
      console.log(`⚔️ Отправить армию на (${targetX}, ${targetY})`);
      return;
    }
    if (actionMode === "move") {
      console.log(`🚚 Переместить в (${targetX}, ${targetY})`);
    }
  });

  document.getElementById("actionBuild")?.addEventListener("click", () => setActionMode("build"));
  document.getElementById("actionMove")?.addEventListener("click", () => setActionMode("move"));
  document.getElementById("actionArmy")?.addEventListener("click", () => setActionMode("army"));
  document.getElementById("actionHome")?.addEventListener("click", () => {
    updateCameraForPlayer(canvas);
  });

  function animate() {
    const cameraChanged = cameraX !== lastCameraX || cameraY !== lastCameraY || scale !== lastScale;
    if (needsRedraw || cameraChanged) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const view = drawMap(ctx, canvas);
      drawBuildings(ctx, canvas, view);
      drawResources(ctx);

      lastCameraX = cameraX;
      lastCameraY = cameraY;
      lastScale = scale;
      needsRedraw = false;
    }
    requestAnimationFrame(animate);
  }

  animate();
};
