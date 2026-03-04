// Pixel world map (no textures), generated fully in-browser.
const TILE_SIZE = 32;
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const CENTER_X = Math.floor(MAP_WIDTH / 2);
const CENTER_Y = Math.floor(MAP_HEIGHT / 2);

let cameraX = CENTER_X * TILE_SIZE - window.innerWidth / 2;
let cameraY = CENTER_Y * TILE_SIZE - window.innerHeight / 2;
let scale = 0.7;

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
  tg.setHeaderColor('#1a1a1a');
  tg.setBackgroundColor('#1a1a1a');
  tg.ready();
  console.log("✅ Telegram WebApp активен");
}

const BIOME = {
  OCEAN: 0,
  SHALLOW: 1,
  DESERT: 2,
  PLAINS: 3,
  FOREST: 4,
  JUNGLE: 5,
  MOUNTAIN: 6,
  SNOW: 7
};

const COLORS = {
  [BIOME.OCEAN]: '#0a2f6a',
  [BIOME.SHALLOW]: '#1e6fb0',
  [BIOME.DESERT]: '#e9b35f',
  [BIOME.PLAINS]: '#90be6d',
  [BIOME.FOREST]: '#2d6a4f',
  [BIOME.JUNGLE]: '#1b4d1b',
  [BIOME.MOUNTAIN]: '#8b7d6b',
  [BIOME.SNOW]: '#e9ecef'
};

const biomeMap = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
const elevationMap = new Float32Array(MAP_WIDTH * MAP_HEIGHT);

function idx(x, y) {
  return y * MAP_WIDTH + x;
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

function generateElevationAndThreshold() {
  console.log('🌍 Generating elevation...');
  const bins = 2048;
  const hist = new Uint32Array(bins);
  let minV = Infinity;
  let maxV = -Infinity;

  for (let y = 0; y < MAP_HEIGHT; y++) {
    const ny = (y - CENTER_Y) / MAP_HEIGHT;
    for (let x = 0; x < MAP_WIDTH; x++) {
      const nx = (x - CENTER_X) / MAP_WIDTH;

      // Multi-continent shape + islands.
      const continental = fbm(nx * 7.0, ny * 7.0, 5, 1.0, 2.0, 0.5, 17) * 2 - 1;
      const regional = fbm(nx * 16.0, ny * 16.0, 4, 1.0, 2.1, 0.52, 71) * 2 - 1;
      const local = fbm(nx * 40.0, ny * 40.0, 3, 1.0, 2.2, 0.55, 131) * 2 - 1;

      // Slight radial dampening to avoid fully filled edges.
      const edgeDist = Math.sqrt((nx * 1.1) * (nx * 1.1) + (ny * 0.95) * (ny * 0.95));
      const edgeMask = 1.0 - Math.max(0, edgeDist - 0.35) * 0.9;

      const e = (continental * 0.62 + regional * 0.28 + local * 0.10) * edgeMask;
      const id = idx(x, y);
      elevationMap[id] = e;
      if (e < minV) minV = e;
      if (e > maxV) maxV = e;
    }
    if (y % 250 === 0) console.log(`⏳ Elevation ${Math.round((y / MAP_HEIGHT) * 100)}%`);
  }

  // Histogram pass for target: water 40%, land 60%.
  const range = maxV - minV || 1;
  for (let i = 0; i < elevationMap.length; i++) {
    const b = Math.max(0, Math.min(bins - 1, Math.floor(((elevationMap[i] - minV) / range) * (bins - 1))));
    hist[b]++;
  }

  const targetWater = Math.floor(elevationMap.length * 0.40);
  let cum = 0;
  let waterBin = 0;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= targetWater) {
      waterBin = b;
      break;
    }
  }

  const threshold = minV + (waterBin / (bins - 1)) * range;
  console.log(`✅ Elevation ready. Land threshold=${threshold.toFixed(4)}`);
  return threshold;
}

function assignBiomes(landThreshold) {
  console.log('🧭 Assigning biomes...');

  // First pass: land/water + core land biomes.
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const lat = Math.abs((y - CENTER_Y) / CENTER_Y); // 0 equator, 1 poles
    for (let x = 0; x < MAP_WIDTH; x++) {
      const id = idx(x, y);
      const e = elevationMap[id];

      if (e <= landThreshold) {
        biomeMap[id] = BIOME.OCEAN;
        continue;
      }

      const nx = (x - CENTER_X) / MAP_WIDTH;
      const ny = (y - CENTER_Y) / MAP_HEIGHT;

      const moisture = fbm(nx * 25, ny * 25, 4, 1.0, 2.0, 0.5, 401);
      const mountainNoise = fbm(nx * 30, ny * 30, 3, 1.0, 2.2, 0.55, 777);

      const centerDist = Math.sqrt(nx * nx + ny * ny) / 0.5;
      const desertBias = Math.max(0, 1 - centerDist); // strongest near center

      const temp = 1 - lat;

      if (lat > 0.78) {
        biomeMap[id] = BIOME.SNOW;
      } else if (mountainNoise > 0.66 || e > landThreshold + 0.45) {
        biomeMap[id] = BIOME.MOUNTAIN;
      } else if (desertBias > 0.55 && temp > 0.62 && moisture < 0.56) {
        biomeMap[id] = BIOME.DESERT;
      } else if (temp > 0.68 && moisture > 0.58) {
        biomeMap[id] = BIOME.JUNGLE;
      } else if (moisture > 0.57) {
        biomeMap[id] = BIOME.FOREST;
      } else {
        biomeMap[id] = BIOME.PLAINS;
      }
    }
    if (y % 250 === 0) console.log(`⏳ Biomes ${Math.round((y / MAP_HEIGHT) * 100)}%`);
  }

  // Second pass: shallow water ring around land.
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      const id = idx(x, y);
      if (biomeMap[id] !== BIOME.OCEAN) continue;
      const n1 = biomeMap[idx(x + 1, y)] !== BIOME.OCEAN;
      const n2 = biomeMap[idx(x - 1, y)] !== BIOME.OCEAN;
      const n3 = biomeMap[idx(x, y + 1)] !== BIOME.OCEAN;
      const n4 = biomeMap[idx(x, y - 1)] !== BIOME.OCEAN;
      const n5 = biomeMap[idx(x + 1, y + 1)] !== BIOME.OCEAN;
      const n6 = biomeMap[idx(x - 1, y - 1)] !== BIOME.OCEAN;
      if (n1 || n2 || n3 || n4 || n5 || n6) biomeMap[id] = BIOME.SHALLOW;
    }
  }

  console.log('✅ Biomes ready.');
}

function biomeName(code) {
  switch (code) {
    case BIOME.OCEAN: return 'Океан';
    case BIOME.SHALLOW: return 'Мелководье';
    case BIOME.DESERT: return 'Пустыня';
    case BIOME.PLAINS: return 'Равнина';
    case BIOME.FOREST: return 'Лес';
    case BIOME.JUNGLE: return 'Джунгли';
    case BIOME.MOUNTAIN: return 'Скалы';
    case BIOME.SNOW: return 'Снег';
    default: return 'Неизвестно';
  }
}

function drawMap(ctx, canvas) {
  const tile = TILE_SIZE * scale;
  if (tile <= 0.01) return;

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
    const y = (row * tile) - cameraY;
    for (let col = startCol; col < endCol; col++) {
      const x = (col * tile) - cameraX;
      const b = biomeMap[idx(col, row)];
      ctx.fillStyle = COLORS[b] || '#90be6d';
      ctx.fillRect(x, y, tile + 1, tile + 1);
    }
  }
}

window.onload = function () {
  console.log('🎮 Starting world generation...');
  const threshold = generateElevationAndThreshold();
  assignBiomes(threshold);

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const biomeInfo = document.getElementById('biomeInfo');
  const coordsEl = document.getElementById('coords');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    cameraX -= dx;
    cameraY -= dy;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = Math.floor((mx + cameraX) / (TILE_SIZE * scale));
    const wy = Math.floor((my + cameraY) / (TILE_SIZE * scale));

    const relX = wx - CENTER_X;
    const relY = wy - CENTER_Y;
    const inside = wx >= 0 && wy >= 0 && wx < MAP_WIDTH && wy < MAP_HEIGHT;
    const b = inside ? biomeMap[idx(wx, wy)] : BIOME.OCEAN;

    if (coordsEl) coordsEl.textContent = `X: ${relX}, Y: ${relY}`;
    if (biomeInfo) biomeInfo.textContent = biomeName(b);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX + cameraX) / (TILE_SIZE * scale);
    const worldY = (mouseY + cameraY) / (TILE_SIZE * scale);

    const zoomFactor = 1.1;
    if (e.deltaY < 0) scale *= zoomFactor;
    else scale /= zoomFactor;

    cameraX = (worldX * TILE_SIZE * scale) - mouseX;
    cameraY = (worldY * TILE_SIZE * scale) - mouseY;
  });

  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const center = document.getElementById('center');

  if (zoomIn) zoomIn.onclick = () => { scale *= 1.4; };
  if (zoomOut) zoomOut.onclick = () => { scale /= 1.4; };
  if (center) center.onclick = () => {
    cameraX = CENTER_X * TILE_SIZE - window.innerWidth / 2;
    cameraY = CENTER_Y * TILE_SIZE - window.innerHeight / 2;
  };

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap(ctx, canvas);
    requestAnimationFrame(animate);
  }

  animate();
};
