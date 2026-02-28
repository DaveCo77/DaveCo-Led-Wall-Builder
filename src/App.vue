<script setup>
import { reactive, computed, ref, nextTick, onMounted } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// --- FIREBASE IMPORTS ---
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase'; // Assumes firebase.js is in your src folder

// --- AUTH STATE ---
const currentUser = ref(null);
const accountLevel = ref('free'); // Defaults to free
const showAuthModal = ref(false);
const authMode = ref('signup'); // 'login' or 'signup'
const authEmail = ref('');
const authPassword = ref('');
const authError = ref('');

// Listen for Login/Logout events automatically
onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser.value = user;
      // Go to the Filing Cabinet and check if they are Pro or Free
      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        accountLevel.value = docSnap.data().accountLevel || 'free';
      } else {
        accountLevel.value = 'free';
      }
    } else {
      currentUser.value = null;
      accountLevel.value = 'free';
    }
  });
});

const handleAuthSubmit = async () => {
  authError.value = '';
  try {
    if (authMode.value === 'signup') {
      // 1. Create the account (The Bouncer)
      const cred = await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
      // 2. Create their folder in the database (The Filing Cabinet)
      await setDoc(doc(db, "users", cred.user.uid), {
        email: authEmail.value,
        accountLevel: 'free', // Everyone starts as free
        createdAt: new Date().toISOString()
      });
    } else {
      // Just log them in
      await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
    }
    // Clean up modal
    showAuthModal.value = false;
    authEmail.value = '';
    authPassword.value = '';
  } catch (err) {
    authError.value = err.message;
  }
};

const handleLogout = async () => {
  await signOut(auth);
};

// --- APP STATE ---
const isDarkMode = ref(true);
const viewMode = ref('power'); 
const flowDirection = ref('vertical'); 
const logoUrl = ref(null);
const logoBgColor = ref('#000000'); 
const pitchOverlayText = ref('');

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
  max_data_port: 16,
  power_reverse: false,
  data_reverse: false
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

  const wallAspectRatio = width_m / height_m;

  const power_input_cables = total_power_circuits;
  const data_input_cables = total_data_ports;
  const power_link_cables = total_tiles - power_input_cables;
  const data_link_cables = total_tiles - data_input_cables;

  return { 
    total_tiles, width_m, height_m, res_w, res_h, tile_res_w, tile_res_h, 
    total_power_circuits, total_data_ports, total_weight, wallAspectRatio,
    power_input_cables, data_input_cables, power_link_cables, data_link_cables
  };
});

const getTileInfo = (n) => {
  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  const row = Math.floor((n - 1) / w); 
  const col = (n - 1) % w;

  const isReverse = viewMode.value === 'power' ? panel.power_reverse : panel.data_reverse;
  const limit = viewMode.value === 'power' ? panel.max_power_circuit : panel.max_data_port;
  const prefix = viewMode.value === 'power' ? 'P' : 'D';

  let order = 0;
  if (flowDirection.value === 'vertical') {
    if (!isReverse) {
      if (col % 2 === 0) order = (col * h) + row + 1;
      else order = (col * h) + (h - 1 - row) + 1;
    } else {
      if (col % 2 === 0) order = (col * h) + (h - 1 - row) + 1;
      else order = (col * h) + row + 1;
    }
  } else {
    if (!isReverse) {
      if (row % 2 === 0) order = (row * w) + col + 1;
      else order = (row * w) + (w - 1 - col) + 1;
    } else {
      if (row % 2 === 0) order = (row * w) + (w - 1 - col) + 1;
      else order = (row * w) + col + 1;
    }
  }

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
          if (!isReverse) {
              if (col % 2 === 0) arrow = (row === h - 1) ? '→' : '↓'; 
              else arrow = (row === 0) ? '→' : '↑'; 
          } else {
              if (col % 2 === 0) arrow = (row === 0) ? '→' : '↑'; 
              else arrow = (row === h - 1) ? '→' : '↓'; 
          }
      } else {
          if (!isReverse) {
              if (row % 2 === 0) arrow = (col === w - 1) ? '↓' : '→'; 
              else arrow = (col === 0) ? '↓' : '←'; 
          } else {
              if (row % 2 === 0) arrow = (col === 0) ? '↓' : '←'; 
              else arrow = (col === w - 1) ? '↓' : '→'; 
          }
      }
  }

  return {
    style: { backgroundColor: color + '33', borderColor: color, color: isDarkMode.value ? '#ffffff' : '#000000' },
    label, arrow, order
  };
};

const handleLogoUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    logoUrl.value = URL.createObjectURL(file);
    viewMode.value = 'visualizer'; 
  }
};

// --- PDF EXPORT FUNCTIONS ---
const exportSpecificPDF = async (mode) => {
  const originalMode = viewMode.value;
  viewMode.value = mode;
  await nextTick();
  
  const element = document.getElementById('preview-canvas');
  const bg = isDarkMode.value ? '#1e1e1e' : '#ffffff';
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: bg });
  const imgData = canvas.toDataURL('image/png');
  const doc = new jsPDF({ orientation: 'landscape' });
  
  if(isDarkMode.value) { doc.setFillColor(30, 30, 30); doc.setTextColor(255, 255, 255); } 
  else { doc.setFillColor(255, 255, 255); doc.setTextColor(0, 0, 0); }
  doc.rect(0, 0, 297, 210, 'F');
  
  doc.setFontSize(22);
  const title = mode === 'power' ? "Power Patch Plan" : "Data Signal Flow";
  doc.text(title, 14, 20);
  doc.setFontSize(10); doc.setTextColor(150, 150, 150);
  doc.text(`${panel.manufacturer} ${panel.model}  |  ${new Date().toLocaleDateString()}`, 14, 28);

  const imgProps = doc.getImageProperties(imgData);
  const pdfWidth = 180;
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  doc.addImage(imgData, 'PNG', 14, 40, pdfWidth, pdfHeight);

  const x = 210; let y = 40;
  const addStat = (l, v) => { doc.setFontSize(9); doc.setTextColor(150,150,150); doc.text(l.toUpperCase(), x, y); doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0); doc.text(v.toString(), x, y+5); y+=15; };
  addStat("Dimensions", `${stats.value.width_m}m (W) x ${stats.value.height_m}m (H)`);
  addStat("Total Resolution", `${stats.value.res_w}px x ${stats.value.res_h}px`);
  y+=5;
  if (mode === 'power') { doc.setTextColor(79, 195, 247); doc.text(`10A Circuits: ${stats.value.total_power_circuits}`, x, y); } 
  else { doc.setTextColor(229, 115, 115); doc.text(`Data Ports: ${stats.value.total_data_ports}`, x, y); }

  doc.save(`${title.replace(' ', '_')}.pdf`);
  viewMode.value = originalMode;
};

const exportPitchPDF = async () => {
  const originalMode = viewMode.value;
  viewMode.value = 'visualizer';
  await nextTick();
  
  setTimeout(async () => {
      const element = document.getElementById('pitch-scene-target');
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: null });
      const imgData = canvas.toDataURL('image/png');
      const doc = new jsPDF({ orientation: 'landscape' });
      
      doc.setFillColor(15, 15, 18); doc.rect(0, 0, 297, 210, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.text("LED Stage Concept", 15, 25);
      doc.setFontSize(11); doc.setTextColor(180, 180, 180);
      doc.text(`Dimensions: ${stats.value.width_m}m x ${stats.value.height_m}m  |  Resolution: ${stats.value.res_w} x ${stats.value.res_h}`, 15, 34);
      
      if (pitchOverlayText.value) {
          doc.setFontSize(14); doc.setTextColor(255, 255, 255);
          doc.text(pitchOverlayText.value, 282, 25, { align: 'right' });
      }

      const imgProps = doc.getImageProperties(imgData);
      const safeWidth = 267; const safeHeight = 150; 
      const widthRatio = safeWidth / imgProps.width; const heightRatio = safeHeight / imgProps.height;
      const bestRatio = Math.min(widthRatio, heightRatio); 
      const renderWidth = imgProps.width * bestRatio; const renderHeight = imgProps.height * bestRatio;
      const xOffset = 15 + ((safeWidth - renderWidth) / 2); const yOffset = 45 + ((safeHeight - renderHeight) / 2);
      
      doc.addImage(imgData, 'PNG', xOffset, yOffset, renderWidth, renderHeight);
      doc.save(`Stage_Concept.pdf`);
      viewMode.value = originalMode;
  }, 100);
};

const exportCableListPDF = () => {
  const doc = new jsPDF({ orientation: 'portrait' });
  if(isDarkMode.value) { doc.setFillColor(30, 30, 30); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(255, 255, 255); } 
  else { doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(0, 0, 0); }

  doc.setFontSize(24); doc.text("Warehouse Pick List", 20, 30);
  doc.setFontSize(12); doc.setTextColor(150, 150, 150); doc.text(`${panel.manufacturer} ${panel.model}`, 20, 40); doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 47);
  doc.setDrawColor(100, 100, 100); doc.line(20, 55, 190, 55);
  doc.setTextColor(isDarkMode.value ? 255 : 0); doc.setFontSize(16); doc.text("Wall Specifications", 20, 70);
  doc.setFontSize(12); doc.text(`Total Panels: ${stats.value.total_tiles}`, 25, 80); doc.text(`Dimensions: ${panel.wall_width_tiles} W  x  ${panel.wall_height_tiles} H`, 25, 88); doc.text(`Physical Size: ${stats.value.width_m}m  x  ${stats.value.height_m}m`, 25, 96); doc.text(`Total Weight: ${stats.value.total_weight} kg`, 25, 104);
  doc.setFontSize(16); doc.text("Cable Requirements", 20, 125);
  doc.setFontSize(14); doc.setTextColor(isDarkMode.value ? 200 : 50); doc.text("Input Cables", 25, 137);
  doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0); doc.text(`[   ]  Power Inputs:  ${stats.value.power_input_cables}`, 30, 147); doc.text(`[   ]  Data Inputs:   ${stats.value.data_input_cables}`, 30, 155);
  doc.setFontSize(14); doc.setTextColor(isDarkMode.value ? 200 : 50); doc.text("Link Cables", 25, 175);
  doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0); doc.text(`[   ]  Power Links:   ${stats.value.power_link_cables}`, 30, 185); doc.text(`[   ]  Data Links:    ${stats.value.data_link_cables}`, 30, 193);
  doc.line(20, 215, 190, 215); doc.setFontSize(10); doc.setTextColor(150, 150, 150); doc.text("Notes:", 20, 225);
  doc.save(`Pick_List.pdf`);
};

const generatePixelMap = () => {
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  canvas.width = stats.value.res_w; canvas.height = stats.value.res_h;
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF'];
  const tileW = stats.value.tile_res_w; const tileH = stats.value.tile_res_h; const fontSize = Math.max(12, Math.floor(tileH / 5));
  ctx.font = `bold ${fontSize}px Arial`; ctx.textBaseline = 'top';
  for (let row = 0; row < panel.wall_height_tiles; row++) {
    for (let col = 0; col < panel.wall_width_tiles; col++) {
      const xPos = col * tileW; const yPos = row * tileH; const colorIndex = (row + col) % colors.length;
      ctx.fillStyle = colors[colorIndex]; ctx.fillRect(xPos, yPos, tileW, tileH);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1; ctx.strokeRect(xPos + 1, yPos + 1, tileW - 2, tileH - 2);
      ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.fillText(`${col + 1},${row + 1}`, xPos + (tileW * 0.05), yPos + (tileH * 0.05)); ctx.shadowColor = "transparent";
    }
  }
  const link = document.createElement('a'); link.download = `PixelMap.jpg`; link.href = canvas.toDataURL('image/jpeg', 0.95); link.click();
};
</script>

<template>
  <div class="app-container" :class="{ 'light-mode': !isDarkMode }">
    
    <div v-if="showAuthModal" class="auth-modal-overlay">
      <div class="auth-modal">
        <h2>{{ authMode === 'signup' ? 'Create Account' : 'Welcome Back' }}</h2>
        
        <div class="auth-tabs">
          <button :class="{active: authMode === 'signup'}" @click="authMode = 'signup'">Sign Up</button>
          <button :class="{active: authMode === 'login'}" @click="authMode = 'login'">Log In</button>
        </div>

        <input type="email" v-model="authEmail" placeholder="Email Address">
        <input type="password" v-model="authPassword" placeholder="Password">
        
        <div v-if="authError" class="auth-error">{{ authError }}</div>
        
        <button @click="handleAuthSubmit" class="auth-submit">
          {{ authMode === 'signup' ? 'Create Free Account' : 'Log In' }}
        </button>
        <button @click="showAuthModal = false" class="close-btn">Cancel</button>
      </div>
    </div>

    <div class="sidebar">
      
      <div class="user-strip">
        <template v-if="currentUser">
          <div class="user-info">
            <span class="user-email">{{ currentUser.email }}</span>
            <span class="badge pro-badge" v-if="accountLevel === 'pro'">PRO</span>
            <span class="badge free-badge" v-else>FREE</span>
          </div>
          <button @click="handleLogout" class="logout-btn">Logout</button>
        </template>
        <template v-else>
          <button @click="showAuthModal = true" class="login-btn">Log In / Sign Up</button>
        </template>
      </div>

      <div class="logo-area">
        <div class="header-row"><h2>WALL BUILDER</h2><button @click="isDarkMode = !isDarkMode" class="theme-toggle">{{ isDarkMode ? '☀' : '☾' }}</button></div>
        <span class="version">PRO v3.0</span>
      </div>
      <div class="scrollable-config">
        
        <div class="config-section">
            <h3>Client Visuals</h3>
            <div class="field"><label>Upload Screen Content</label><input type="file" accept="image/*" @change="handleLogoUpload" class="file-input"></div>
            <div class="field color-field" style="margin-top: 10px;"><label style="margin-bottom: 0;">Screen BG Color</label><input type="color" v-model="logoBgColor" class="color-picker"></div>
            <div class="field" style="margin-top: 10px;"><label>Custom Overlay Text (Optional)</label><input type="text" v-model="pitchOverlayText" placeholder="e.g. Total: $2,500 / day"></div>
        </div>

        <div class="config-section"><h3>Wall Size (Tiles)</h3><div class="input-group"><div class="field"><label>Width</label><input type="number" v-model="panel.wall_width_tiles"></div><div class="field"><label>Height</label><input type="number" v-model="panel.wall_height_tiles"></div></div></div>
        <div class="config-section"><h3>Physical Panel Size (mm)</h3><div class="input-group"><div class="field"><label>Width (mm)</label><input type="number" v-model="panel.width_mm" step="10"></div><div class="field"><label>Height (mm)</label><input type="number" v-model="panel.height_mm" step="10"></div></div></div>
        <div class="config-section"><h3>Patching Limits</h3><div class="field"><label>Max per Power Circuit (10A)</label><input type="number" v-model="panel.max_power_circuit"></div><div class="field"><label>Max per Data Port</label><input type="number" v-model="panel.max_data_port"></div></div>
        
        <div class="config-section">
            <h3>Signal Flow</h3>
            <div class="toggle-group mb-2">
                <button :class="{active: flowDirection === 'vertical'}" @click="flowDirection = 'vertical'">↕ Cols</button>
                <button :class="{active: flowDirection === 'horizontal'}" @click="flowDirection = 'horizontal'">↔ Rows</button>
            </div>
            <div class="field" style="margin-top: 10px;">
                <label>Power Routing Origin</label>
                <div class="toggle-group">
                    <button :class="{active: !panel.power_reverse}" @click="panel.power_reverse = false">{{ flowDirection === 'vertical' ? 'Top Down' : 'Left to Right' }}</button>
                    <button :class="{active: panel.power_reverse}" @click="panel.power_reverse = true">{{ flowDirection === 'vertical' ? 'Bottom Up' : 'Right to Left' }}</button>
                </div>
            </div>
            <div class="field" style="margin-top: 10px;">
                <label>Data Routing Origin</label>
                <div class="toggle-group">
                    <button :class="{active: !panel.data_reverse}" @click="panel.data_reverse = false">{{ flowDirection === 'vertical' ? 'Top Down' : 'Left to Right' }}</button>
                    <button :class="{active: panel.data_reverse}" @click="panel.data_reverse = true">{{ flowDirection === 'vertical' ? 'Bottom Up' : 'Right to Left' }}</button>
                </div>
            </div>
        </div>

        <div class="config-section"><h3>Panel Specs</h3><input v-model="panel.manufacturer" placeholder="Manufacturer" class="mb-2"><input v-model="panel.model" placeholder="Model" class="mb-2"><div class="input-group"><div class="field"><label>Pitch (mm)</label><input type="number" v-model="panel.pitch" step="0.1"></div><div class="field"><label>Weight (kg)</label><input type="number" v-model="panel.weight_kg"></div></div></div>
        <div class="config-section"><h3>Cable Requirements</h3><div class="cable-stats"><div class="c-stat"><span class="label">Pwr Inputs:</span> <span class="val">{{ stats.power_input_cables }}</span></div><div class="c-stat"><span class="label">Data Inputs:</span> <span class="val">{{ stats.data_input_cables }}</span></div><div class="c-stat"><span class="label">Pwr Links:</span> <span class="val">{{ stats.power_link_cables }}</span></div><div class="c-stat"><span class="label">Data Links:</span> <span class="val">{{ stats.data_link_cables }}</span></div></div></div>
      </div>
      
      <div class="export-actions">
        <button @click="exportPitchPDF" class="btn highlight-btn" :disabled="accountLevel !== 'pro'">
          ✨ Pitch Render {{ accountLevel !== 'pro' ? '🔒' : '' }}
        </button>
        <button @click="exportSpecificPDF('power')" class="btn primary">📄 Power</button>
        <button @click="exportSpecificPDF('data')" class="btn secondary">📄 Data</button>
        <button @click="exportCableListPDF" class="btn tertiary" :disabled="accountLevel !== 'pro'">
          📋 Pick List {{ accountLevel !== 'pro' ? '🔒' : '' }}
        </button>
        <button @click="generatePixelMap" class="btn outline" :disabled="accountLevel !== 'pro'">
          🖼️ Pixel Map {{ accountLevel !== 'pro' ? '🔒' : '' }}
        </button>
      </div>
    </div>

    <div class="main-content">
      <div class="stats-bar">
        <div class="stat"><span class="label">Total Tiles</span><span class="val">{{ stats.total_tiles }}</span></div>
        <div class="stat"><span class="label">Physical Size</span><span class="val">{{ stats.width_m }}m × {{ stats.height_m }}m</span></div>
        <div class="stat"><span class="label">Resolution</span><span class="val highlight">{{ stats.res_w }} × {{ stats.res_h }}</span></div>
        <div class="stat"><span class="label">Total Weight</span><span class="val">{{ stats.total_weight }} kg</span></div>
        <div class="stat circuit-stat"><span class="label">Circuits</span><span class="val">{{ stats.total_power_circuits }}</span></div>
         <div class="stat data-stat"><span class="label">Ports</span><span class="val">{{ stats.total_data_ports }}</span></div>
      </div>
      <div class="viz-toolbar">
        <span class="viz-title">{{ viewMode === 'visualizer' ? 'Client Stage Concept' : 'Schematic View' }}</span>
        <div class="view-toggles">
          <button :class="{active: viewMode === 'visualizer'}" @click="viewMode = 'visualizer'" style="color: #ba68c8;">★ Pitch Mode</button>
          <button :class="{active: viewMode === 'power'}" @click="viewMode = 'power'">Power</button>
          <button :class="{active: viewMode === 'data'}" @click="viewMode = 'data'">Data</button>
        </div>
      </div>

      <div class="canvas-wrapper">
        <div id="preview-canvas" class="canvas-bed" :class="{ 'pitch-bed': viewMode === 'visualizer' }">
           <template v-if="viewMode === 'visualizer'">
              <div id="pitch-scene-target" class="pitch-scene-wrapper" :style="{ '--ratio': stats.wallAspectRatio, width: `min(100cqw - 80px, calc((100cqh - 80px) * ${stats.wallAspectRatio}))` }">
                  
                  <div class="pitch-screen" :style="{ backgroundColor: logoBgColor }">
                      <div v-if="logoUrl" class="pitch-logo" :style="{ backgroundImage: `url(${logoUrl})` }"></div>
                      <div v-else class="pitch-placeholder">No Content Loaded</div>
                      <div class="pitch-grid-overlay" :style="{ gridTemplateColumns: `repeat(${panel.wall_width_tiles}, 1fr)`, gridTemplateRows: `repeat(${panel.wall_height_tiles}, 1fr)` }">
                         <div v-for="n in stats.total_tiles" :key="n" class="pitch-faint-tile"></div>
                      </div>
                  </div>
                  
                  <div v-if="pitchOverlayText" class="pitch-badge">{{ pitchOverlayText }}</div>
              </div>
           </template>
           <template v-else>
               <div class="wall-grid" :style="{ '--ratio': stats.wallAspectRatio, gridTemplateColumns: `repeat(${panel.wall_width_tiles}, 1fr)`, gridTemplateRows: `repeat(${panel.wall_height_tiles}, 1fr)` }">
                  <div v-for="n in stats.total_tiles" :key="n" class="tile" :style="getTileInfo(n).style">
                    <span class="tile-id">{{ getTileInfo(n).label }}</span>
                    <span class="arrow">{{ getTileInfo(n).arrow }}</span>
                  </div>
               </div>
           </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container { --bg-app: #121212; --bg-panel: #1e1e1e; --bg-input: #252526; --bg-canvas: #0a0a0a; --bg-bed: #1e1e1e; --border: #333; --text-main: #e0e0e0; --text-muted: #888; --text-input: #ffffff; --primary: #2196f3; --accent: #00e676; display: flex; height: 100vh; width: 100vw; background-color: var(--bg-app); color: var(--text-main); font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
.light-mode { --bg-app: #f5f5f5; --bg-panel: #ffffff; --bg-input: #f0f0f0; --bg-canvas: #e0e0e0; --bg-bed: #ffffff; --border: #ddd; --text-main: #333333; --text-muted: #666; --text-input: #000000; --primary: #1976d2; }

/* AUTH MODAL & USER STRIP CSS */
.auth-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1000; backdrop-filter: blur(5px); }
.auth-modal { background: var(--bg-panel); padding: 30px; border-radius: 8px; width: 100%; max-width: 350px; border: 1px solid var(--border); box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
.auth-modal h2 { margin-top: 0; margin-bottom: 20px; font-size: 1.5rem; text-align: center; }
.auth-error { color: #ef5350; font-size: 0.8rem; margin-bottom: 15px; text-align: center; }
.auth-tabs { display: flex; gap: 10px; margin-bottom: 20px; }
.auth-tabs button { flex: 1; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; padding-bottom: 5px; font-weight: 600; }
.auth-tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }
.auth-submit { width: 100%; background: var(--primary); color: white; border: none; padding: 12px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 10px; }
.close-btn { background: transparent; border: none; color: var(--text-muted); cursor: pointer; width: 100%; margin-top: 10px; font-size: 0.8rem; }

.user-strip { background: var(--bg-input); padding: 10px 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border); }
.user-info { display: flex; flex-direction: column; gap: 4px; }
.user-email { font-size: 0.75rem; font-weight: bold; }
.badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; width: fit-content; }
.pro-badge { background: #ba68c8; color: white; }
.free-badge { background: #555; color: white; }
.login-btn { width: 100%; background: var(--primary); color: white; border: none; padding: 8px; border-radius: 4px; font-weight: bold; cursor: pointer; }
.logout-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-size: 0.7rem; padding: 4px 8px; border-radius: 4px; cursor: pointer; }

/* THE REST OF THE UI CSS */
.sidebar { width: 320px; background-color: var(--bg-panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; gap: 20px; flex-shrink: 0; z-index: 10; }
.logo-area .header-row { display: flex; justify-content: space-between; align-items: center; }
.logo-area h2 { margin: 0; font-size: 1.2rem; letter-spacing: 1px; color: var(--text-main); }
.theme-toggle { background: none; border: 1px solid var(--border); color: var(--text-main); cursor: pointer; border-radius: 4px; padding: 4px 8px;}
.scrollable-config { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px; padding-right: 5px; }
.config-section h3 { font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 5px; }

.input-group { display: flex; gap: 10px; } .field { flex: 1; margin-bottom: 5px; } .field label { display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; }
input { width: 100%; background: var(--bg-input) !important; border: 1px solid var(--border); color: var(--text-input) !important; padding: 8px 10px; border-radius: 4px; font-family: monospace; font-size: 0.9rem; box-sizing: border-box; }
input:focus { outline: none; border-color: var(--primary); } 
input[type="file"] { font-family: inherit; font-size: 0.8rem; padding: 5px; cursor: pointer; } 
.mb-2 { margin-bottom: 10px; }

.toggle-group { display: flex; gap: 5px; background: var(--bg-input); padding: 3px; border-radius: 6px; } .toggle-group button { flex: 1; background: transparent; border: none; color: var(--text-muted); padding: 6px; font-size: 0.8rem; cursor: pointer; border-radius: 4px; transition: 0.2s; } .toggle-group button.active { background: var(--border); color: var(--text-main); font-weight: bold; }
.cable-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem; } .cable-stats .c-stat { display: flex; flex-direction: column; background: var(--bg-input); padding: 8px; border-radius: 4px; border: 1px solid var(--border); } .cable-stats .label { color: var(--text-muted); font-size: 0.7rem; text-transform: uppercase; } .cable-stats .val { color: var(--text-main); font-weight: bold; font-size: 1rem; }

.main-content { flex: 1; display: flex; flex-direction: column; background: var(--bg-app); min-width: 0; }
.stats-bar { display: flex; background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 15px 30px; gap: 40px; overflow-x: auto; flex-shrink: 0; } .stat { display: flex; flex-direction: column; white-space: nowrap; } .stat .label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; } .stat .val { font-size: 1.1rem; color: var(--text-main); font-weight: 500; margin-top: 2px; } .stat .highlight { color: var(--primary); } .circuit-stat .val { color: #81c784; } .data-stat .val { color: #ef5350; }
.viz-toolbar { padding: 10px 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-panel); flex-shrink: 0; } .viz-title { color: var(--text-muted); font-size: 0.9rem; } .view-toggles button { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-muted); padding: 6px 15px; cursor: pointer; } .view-toggles button.active { background: var(--border); color: var(--text-main); }
.canvas-wrapper { flex: 1; display: flex; padding: 20px; background: var(--bg-canvas); overflow: hidden; min-height: 0; } .canvas-bed { background: var(--bg-bed); border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.2); flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px; min-height: 0; min-width: 0; container-type: size; transition: background 0.3s; }

/* PITCH RENDER CSS */
.pitch-bed { background: radial-gradient(circle at center, #1a1a24 0%, #050505 100%); border-color: #000; overflow: visible;}
.pitch-scene-wrapper { position: relative; aspect-ratio: var(--ratio); max-width: 100%; max-height: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.9), 0 0 40px rgba(186, 104, 200, 0.15); }
.pitch-screen { width: 100%; height: 100%; position: relative; overflow: hidden; border: 2px solid #222; transition: background-color 0.3s; }
.pitch-logo { width: 100%; height: 100%; background-size: contain; background-position: center; background-repeat: no-repeat; }
.pitch-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #666; font-size: 1.5rem; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; text-align: center;}
.pitch-grid-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: grid; pointer-events: none; }
.pitch-faint-tile { border: 1px solid rgba(255, 255, 255, 0.08); }
.pitch-badge { position: absolute; bottom: 20px; right: 20px; background: rgba(0, 0, 0, 0.7); color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 1rem; font-weight: 600; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.1); z-index: 15; pointer-events: none; }

.color-field { display: flex; align-items: center; justify-content: space-between; }
.color-picker { width: 40px; height: 30px; padding: 0; border: 1px solid var(--border); cursor: pointer; background: transparent; }

/* TECHNICAL GRID CSS */
.wall-grid { display: grid; gap: 1px; aspect-ratio: var(--ratio); width: min(100cqw - 40px, calc((100cqh - 40px) * var(--ratio))); max-width: 100%; max-height: 100%; }
.tile { background: var(--bg-input); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: clamp(0.6rem, 1.2cqw, 1rem); font-weight: 600; position: relative; }
.tile-id { z-index: 2; } .arrow { font-size: 1.2em; opacity: 0.7; margin-top: -2px; }

/* EXPORT BUTTONS & LOCKING LOGIC */
.export-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; }
.btn { padding: 10px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: center; font-size: 0.8rem; transition: opacity 0.2s; }
.btn:disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(1); }
.primary { background: var(--primary); color: white; } 
.secondary { background: #ef5350; color: white; } 
.tertiary { background: #ba68c8; color: white; } 
.outline { background: transparent; border: 1px solid var(--border); color: var(--text-muted); } 
.outline:hover:not(:disabled) { background: var(--border); }
.highlight-btn { background: linear-gradient(135deg, #ba68c8, #7e57c2); color: white; grid-column: span 2; padding: 14px; font-size: 0.9rem;} 
.highlight-btn:hover:not(:disabled) { filter: brightness(1.2); }
</style>