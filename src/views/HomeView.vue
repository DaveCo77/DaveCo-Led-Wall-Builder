<script setup>
import { reactive, computed, ref, nextTick } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const isDarkMode = ref(true);
const viewMode = ref('power'); // 'power' or 'data'
const flowDirection = ref('vertical'); // 'vertical' or 'horizontal'

const panel = reactive({
  manufacturer: 'ROE',
  model: 'Black Pearl 2',
  width_mm: 500,
  height_mm: 500,
  pitch: 2.8,
  weight_kg: 9.4,
  wall_width_tiles: 12,
  wall_height_tiles: 6,
  max_power_circuit: 6, 
  max_data_port: 16
});

// --- CORE LOGIC ---
const stats = computed(() => {
  const total_tiles = panel.wall_width_tiles * panel.wall_height_tiles;
  const width_m = (panel.wall_width_tiles * panel.width_mm / 1000).toFixed(2);
  const height_m = (panel.wall_height_tiles * panel.height_mm / 1000).toFixed(2);
  const tile_res_w = Math.round(panel.width_mm / panel.pitch);
  const tile_res_h = Math.round(panel.height_mm / panel.pitch);
  const res_w = tile_res_w * panel.wall_width_tiles;
  const res_h = tile_res_h * panel.wall_height_tiles;
  
  const total_power_circuits = Math.ceil(total_tiles / panel.max_power_circuit);
  const total_data_ports = Math.ceil(total_tiles / panel.max_data_port);
  const total_weight = (total_tiles * panel.weight_kg).toFixed(0);

  return { 
    total_tiles, width_m, height_m, res_w, res_h, tile_res_w, tile_res_h, 
    total_power_circuits, total_data_ports, total_weight 
  };
});

const getTileInfo = (n) => {
  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  const row = Math.floor((n - 1) / w); 
  const col = (n - 1) % w;

  let order = 0;
  if (flowDirection.value === 'vertical') {
    if (col % 2 === 0) order = (col * h) + row + 1;
    else order = (col * h) + (h - 1 - row) + 1;
  } else {
    if (row % 2 === 0) order = (row * w) + col + 1;
    else order = (row * w) + (w - 1 - col) + 1;
  }

  const limit = viewMode.value === 'power' ? panel.max_power_circuit : panel.max_data_port;
  const prefix = viewMode.value === 'power' ? 'P' : 'D';
  const groupIndex = Math.ceil(order / limit);
  const label = `${prefix}${groupIndex}`;

  const p_colors = ['#4fc3f7', '#ba68c8', '#81c784', '#ffb74d']; 
  const d_colors = ['#e57373', '#4dd0e1', '#aed581', '#f06292']; 
  const palette = viewMode.value === 'power' ? p_colors : d_colors;
  const color = palette[(groupIndex - 1) % palette.length];

  let arrow = '';
  const isEndOfCircuit = order % limit === 0;
  const isLastTile = order === stats.value.total_tiles;

  if (!isEndOfCircuit && !isLastTile) {
      if (flowDirection.value === 'vertical') {
          if (col % 2 === 0) arrow = (row === h - 1) ? '→' : '↓'; 
          else arrow = (row === 0) ? '→' : '↑'; 
      } else {
          if (row % 2 === 0) arrow = (col === w - 1) ? '↓' : '→'; 
          else arrow = (col === 0) ? '↓' : '←'; 
      }
  }

  // FORCE COLORS: Note we use inline styles to force contrast
  return {
    style: { 
        backgroundColor: color + '33', 
        borderColor: color, 
        color: isDarkMode.value ? '#ffffff' : '#000000' 
    },
    label, arrow, order
  };
};

// --- PDF EXPORT ---
const exportSpecificPDF = async (mode) => {
  const originalMode = viewMode.value;
  viewMode.value = mode;
  await nextTick();
  
  const element = document.getElementById('preview-canvas');
  const bg = isDarkMode.value ? '#1e1e1e' : '#ffffff';
  
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: bg });
  const imgData = canvas.toDataURL('image/png');
  
  const doc = new jsPDF({ orientation: 'landscape' });
  
  if(isDarkMode.value) {
      doc.setFillColor(30, 30, 30);
      doc.setTextColor(255, 255, 255);
  } else {
      doc.setFillColor(255, 255, 255);
      doc.setTextColor(0, 0, 0);
  }
  doc.rect(0, 0, 297, 210, 'F');
  
  doc.setFontSize(22);
  const title = mode === 'power' ? "Power Patch Plan" : "Data Signal Flow";
  doc.text(title, 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text(`${panel.manufacturer} ${panel.model}  |  ${new Date().toLocaleDateString()}`, 14, 28);

  const imgProps = doc.getImageProperties(imgData);
  const pdfWidth = 180;
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  doc.addImage(imgData, 'PNG', 14, 40, pdfWidth, pdfHeight);

  const x = 210; let y = 40;
  const addStat = (l, v) => {
    doc.setFontSize(9); doc.setTextColor(150,150,150); doc.text(l.toUpperCase(), x, y);
    doc.setFontSize(12); 
    doc.setTextColor(isDarkMode.value ? 255 : 0, isDarkMode.value ? 255 : 0, isDarkMode.value ? 255 : 0); 
    doc.text(v.toString(), x, y+5); y+=15;
  };

  addStat("Dimensions", `${stats.value.width_m}m (W) x ${stats.value.height_m}m (H)`);
  addStat("Total Resolution", `${stats.value.res_w}px x ${stats.value.res_h}px`);
  y+=5;
  
  if (mode === 'power') {
    doc.setTextColor(79, 195, 247); 
    doc.text(`10A Circuits: ${stats.value.total_power_circuits}`, x, y);
  } else {
    doc.setTextColor(229, 115, 115); 
    doc.text(`Data Ports: ${stats.value.total_data_ports}`, x, y);
  }

  doc.save(`${title.replace(' ', '_')}.pdf`);
  viewMode.value = originalMode;
};

// --- PIXEL MAP GENERATOR ---
const generatePixelMap = () => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = stats.value.res_w;
  canvas.height = stats.value.res_h;
  
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF'];
  const tileW = stats.value.tile_res_w;
  const tileH = stats.value.tile_res_h;
  const fontSize = Math.max(12, Math.floor(tileH / 5));
  
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textBaseline = 'top';

  for (let row = 0; row < panel.wall_height_tiles; row++) {
    for (let col = 0; col < panel.wall_width_tiles; col++) {
      const xPos = col * tileW;
      const yPos = row * tileH;
      const colorIndex = (row + col) % colors.length;
      
      ctx.fillStyle = colors[colorIndex];
      ctx.fillRect(xPos, yPos, tileW, tileH);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.strokeRect(xPos + 1, yPos + 1, tileW - 2, tileH - 2);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = "black";
      ctx.shadowBlur = 4;
      ctx.fillText(`${col + 1},${row + 1}`, xPos + (tileW * 0.05), yPos + (tileH * 0.05));
      ctx.shadowColor = "transparent";
    }
  }

  const link = document.createElement('a');
  link.download = `PixelMap.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
};
</script>

<template>
  <div class="app-container" :class="{ 'light-mode': !isDarkMode }">
    
    <div class="sidebar">
      <div class="logo-area">
        <div class="header-row">
            <h2>WALL BUILDER</h2>
            <button @click="isDarkMode = !isDarkMode" class="theme-toggle">
                {{ isDarkMode ? '☀' : '☾' }}
            </button>
        </div>
        <span class="version">PRO v2.1</span>
      </div>

      <div class="scrollable-config">
        <div class="config-section">
            <h3>Dimensions (Tiles)</h3>
            <div class="input-group">
            <div class="field">
                <label>Width</label>
                <input type="number" v-model="panel.wall_width_tiles">
            </div>
            <div class="field">
                <label>Height</label>
                <input type="number" v-model="panel.wall_height_tiles">
            </div>
            </div>
        </div>

        <div class="config-section">
            <h3>Patching Limits</h3>
            <div class="field">
            <label>Max per Power Circuit (10A)</label>
            <input type="number" v-model="panel.max_power_circuit">
            </div>
            <div class="field">
            <label>Max per Data Port</label>
            <input type="number" v-model="panel.max_data_port">
            </div>
        </div>

        <div class="config-section">
            <h3>Signal Flow</h3>
            <div class="toggle-group">
            <button :class="{active: flowDirection === 'vertical'}" @click="flowDirection = 'vertical'">↕ Cols</button>
            <button :class="{active: flowDirection === 'horizontal'}" @click="flowDirection = 'horizontal'">↔ Rows</button>
            </div>
        </div>

        <div class="config-section">
            <h3>Panel Specs</h3>
            <input v-model="panel.manufacturer" placeholder="Manufacturer" class="mb-2">
            <input v-model="panel.model" placeholder="Model" class="mb-2">
            <div class="input-group">
            <div class="field"><label>Pitch (mm)</label><input type="number" v-model="panel.pitch" step="0.1"></div>
            <div class="field"><label>Weight (kg)</label><input type="number" v-model="panel.weight_kg"></div>
            </div>
        </div>
      </div>

      <div class="export-actions">
        <button @click="exportSpecificPDF('power')" class="btn primary">📄 Export Power Plan</button>
        <button @click="exportSpecificPDF('data')" class="btn secondary">📄 Export Data Plan</button>
        <button @click="generatePixelMap" class="btn outline">🖼️ Download Pixel Map</button>
      </div>
    </div>

    <div class="main-content">
      
      <div class="stats-bar">
        <div class="stat">
          <span class="label">Total Tiles</span>
          <span class="val">{{ stats.total_tiles }}</span>
        </div>
        <div class="stat">
          <span class="label">Physical Size</span>
          <span class="val">{{ stats.width_m }}m × {{ stats.height_m }}m</span>
        </div>
        <div class="stat">
          <span class="label">Resolution</span>
          <span class="val highlight">{{ stats.res_w }} × {{ stats.res_h }}</span>
        </div>
        <div class="stat">
          <span class="label">Total Weight</span>
          <span class="val">{{ stats.total_weight }} kg</span>
        </div>
        <div class="stat circuit-stat">
          <span class="label">Circuits</span>
          <span class="val">{{ stats.total_power_circuits }}</span>
        </div>
         <div class="stat data-stat">
          <span class="label">Ports</span>
          <span class="val">{{ stats.total_data_ports }}</span>
        </div>
      </div>

      <div class="viz-toolbar">
        <span class="viz-title">Schematic View</span>
        <div class="view-toggles">
          <button :class="{active: viewMode === 'power'}" @click="viewMode = 'power'">Power View</button>
          <button :class="{active: viewMode === 'data'}" @click="viewMode = 'data'">Data View</button>
        </div>
      </div>

      <div class="canvas-wrapper">
        <div id="preview-canvas" class="canvas-bed">
           <div class="wall-grid" :style="{
               gridTemplateColumns: `repeat(${panel.wall_width_tiles}, 1fr)`,
               aspectRatio: `${panel.wall_width_tiles * panel.width_mm} / ${panel.wall_height_tiles * panel.height_mm}`
           }">
              <div v-for="n in stats.total_tiles" :key="n" class="tile" :style="getTileInfo(n).style">
                <span class="tile-id">{{ getTileInfo(n).label }}</span>
                <span class="arrow">{{ getTileInfo(n).arrow }}</span>
              </div>
           </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* FIXED: CSS Variables are now applied to the container, not :root, to ensure they work */
.app-container {
  /* Default Dark Mode */
  --bg-app: #121212;
  --bg-panel: #1e1e1e;
  --bg-input: #252526;
  --bg-canvas: #0a0a0a;
  --bg-bed: #1e1e1e;
  --border: #333;
  --text-main: #e0e0e0;
  --text-muted: #888;
  --text-input: #ffffff; /* Explicit White for Dark Mode Inputs */
  --primary: #2196f3;
  --accent: #00e676;

  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-app);
  color: var(--text-main);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}

/* Light Mode Overrides */
.light-mode {
  --bg-app: #f5f5f5;
  --bg-panel: #ffffff;
  --bg-input: #f0f0f0;
  --bg-canvas: #e0e0e0;
  --bg-bed: #ffffff;
  --border: #ddd;
  --text-main: #333333;
  --text-muted: #666;
  --text-input: #000000;
  --primary: #1976d2;
}

/* SIDEBAR */
.sidebar {
  width: 320px;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex-shrink: 0;
  z-index: 10;
}

.logo-area .header-row { display: flex; justify-content: space-between; align-items: center; }
.logo-area h2 { margin: 0; font-size: 1.2rem; letter-spacing: 1px; color: var(--text-main); }
.theme-toggle { background: none; border: 1px solid var(--border); color: var(--text-main); cursor: pointer; border-radius: 4px; padding: 4px 8px;}

.scrollable-config { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px; padding-right: 5px; }

.config-section h3 {
  font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted);
  margin-bottom: 10px; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 5px;
}

.input-group { display: flex; gap: 10px; }
.field { flex: 1; margin-bottom: 5px; }
.field label { display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; }

/* HIGH CONTRAST INPUTS */
input {
  width: 100%;
  background: var(--bg-input) !important; /* Forced background */
  border: 1px solid var(--border);
  color: var(--text-input) !important; /* Forced color */
  padding: 8px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9rem;
  box-sizing: border-box;
}
input:focus { outline: none; border-color: var(--primary); }
.mb-2 { margin-bottom: 10px; }

.toggle-group { display: flex; gap: 5px; background: var(--bg-input); padding: 3px; border-radius: 6px; }
.toggle-group button {
  flex: 1; background: transparent; border: none; color: var(--text-muted);
  padding: 6px; font-size: 0.8rem; cursor: pointer; border-radius: 4px;
}
.toggle-group button.active { background: var(--border); color: var(--text-main); font-weight: bold; }

/* MAIN CONTENT */
.main-content { flex: 1; display: flex; flex-direction: column; background: var(--bg-app); min-width: 0; }

.stats-bar {
  display: flex; background: var(--bg-panel); border-bottom: 1px solid var(--border);
  padding: 15px 30px; gap: 40px; overflow-x: auto;
}
.stat { display: flex; flex-direction: column; white-space: nowrap; }
.stat .label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.stat .val { font-size: 1.1rem; color: var(--text-main); font-weight: 500; margin-top: 2px; }
.stat .highlight { color: var(--primary); }
.circuit-stat .val { color: #81c784; }
.data-stat .val { color: #ef5350; }

.viz-toolbar { padding: 10px 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
.viz-title { color: var(--text-muted); font-size: 0.9rem; }
.view-toggles button {
  background: var(--bg-input); border: 1px solid var(--border); color: var(--text-muted);
  padding: 6px 15px; cursor: pointer;
}
.view-toggles button.active { background: var(--border); color: var(--text-main); }

/* AUTO-SCALING CANVAS - FIXED */
.canvas-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--bg-canvas);
  overflow: hidden;
}

.canvas-bed {
  background: var(--bg-bed);
  padding: 20px;
  border-radius: 8px;
  border: 1px solid var(--border);
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  /* FIXED: Use explicit sizes to force flex items to expand */
  width: 95%;
  height: 85%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.wall-grid {
  display: grid;
  gap: 1px;
  /* FIXED: Box fitting logic */
  max-width: 100%;
  max-height: 100%;
  margin: auto;
}

.tile {
  background: var(--bg-input);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem; 
  font-weight: 600;
  position: relative;
}
.tile-id { z-index: 2; }
.arrow { font-size: 1rem; opacity: 0.7; margin-top: -2px; }

/* EXPORT BUTTONS */
.export-actions { display: grid; gap: 10px; margin-top: auto; }
.btn { padding: 12px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: left; }
.primary { background: var(--primary); color: white; }
.secondary { background: #ef5350; color: white; }
.outline { background: transparent; border: 1px solid var(--border); color: var(--text-muted); }
.outline:hover { background: var(--border); }
</style>