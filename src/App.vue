<script setup>
import { reactive, computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Three.js loaded via ESM CDN so you don't even need to edit package.json!
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// --- FIREBASE IMPORTS ---
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

// --- AUTH STATE ---
const currentUser = ref(null);
const accountLevel = ref('free');
const showAuthModal = ref(false);
const authMode = ref('signup');
const authEmail = ref('');
const authPassword = ref('');
const authError = ref('');

onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser.value = user;
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
      const cred = await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
      await setDoc(doc(db, "users", cred.user.uid), {
        email: authEmail.value,
        accountLevel: 'free',
        createdAt: new Date().toISOString()
      });
    } else {
      await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
    }
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
const viewMode = ref('3d'); // '3d' | 'visualizer' | 'power' | 'data'
const flowDirection = ref('row_lr'); // 'row_lr' (Mate's Crew-Safe mode) | 'vertical' | 'horizontal'
const logoUrl = ref(null);
const logoBgColor = ref('#090d16');
const pitchOverlayText = ref('');
let loadedLogoImg = null;

// 3D Specific State
const curveAngle = ref(2.0);
const trimHeight = ref(1.0);
const showRearSnake3D = ref(true);
const showScaleHuman3D = ref(true);
const removedTiles = reactive(new Set()); // Stores "col,row" keys for islands

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

const toggleTileRemoved = (col, row) => {
  const key = `${col},${row}`;
  if (removedTiles.has(key)) removedTiles.delete(key);
  else removedTiles.add(key);
  build3DWall();
};

const applyIslandPreset = (preset) => {
  removedTiles.clear();
  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  if (preset === 'arch') {
    const mid = Math.floor(w / 2);
    for (let c = Math.max(0, mid - 2); c <= Math.min(w - 1, mid + 1); c++) {
      for (let r = Math.floor(h / 2); r < h; r++) removedTiles.add(`${c},${r}`);
    }
  } else if (preset === 'split') {
    const mid = Math.floor(w / 2);
    for (let r = 0; r < h; r++) {
      removedTiles.add(`${mid - 1},${r}`);
      if (w > 4) removedTiles.add(`${mid},${r}`);
    }
  }
  build3DWall();
};

// --- CORE PATCHING & TOPOLOGY ENGINE ---
// Builds exact ordered chains for both Power and Data (supporting Row L->R, Vert Snake, Horiz Snake, and Islands)
const buildPatchChains = (mode) => {
  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  const isReverse = mode === 'power' ? panel.power_reverse : panel.data_reverse;
  const limit = Math.max(1, mode === 'power' ? panel.max_power_circuit : panel.max_data_port);
  const chains = [];

  if (flowDirection.value === 'row_lr') {
    // Mate's Crew-Proof Mode: Each row starts a fresh port/circuit so daisy-chains strictly run horizontally!
    for (let r = 0; r < h; r++) {
      const colsOrder = [...Array(w).keys()];
      if (isReverse) colsOrder.reverse();
      let currentRowChain = [];
      for (const c of colsOrder) {
        const key = `${c},${r}`;
        if (!removedTiles.has(key)) {
          currentRowChain.push({ c, r, key });
          if (currentRowChain.length === limit) {
            chains.push(currentRowChain);
            currentRowChain = [];
          }
        }
      }
      if (currentRowChain.length > 0) chains.push(currentRowChain);
    }
  } else if (flowDirection.value === 'vertical') {
    const orderedNodes = [];
    for (let c = 0; c < w; c++) {
      let rowsOrder = [...Array(h).keys()];
      const goUp = (!isReverse && c % 2 === 1) || (isReverse && c % 2 === 0);
      if (goUp) rowsOrder.reverse();
      for (const r of rowsOrder) {
        const key = `${c},${r}`;
        if (!removedTiles.has(key)) orderedNodes.push({ c, r, key });
      }
    }
    for (let i = 0; i < orderedNodes.length; i += limit) {
      chains.push(orderedNodes.slice(i, i + limit));
    }
  } else {
    // Horizontal snake
    const orderedNodes = [];
    for (let r = 0; r < h; r++) {
      let colsOrder = [...Array(w).keys()];
      const goLeft = (!isReverse && r % 2 === 1) || (isReverse && r % 2 === 0);
      if (goLeft) colsOrder.reverse();
      for (const c of colsOrder) {
        const key = `${c},${r}`;
        if (!removedTiles.has(key)) orderedNodes.push({ c, r, key });
      }
    }
    for (let i = 0; i < orderedNodes.length; i += limit) {
      chains.push(orderedNodes.slice(i, i + limit));
    }
  }

  return chains;
};

const powerChains = computed(() => buildPatchChains('power'));
const dataChains = computed(() => buildPatchChains('data'));

// Lookup table for fast 2D tile rendering
const patchMapByMode = computed(() => {
  const mode = viewMode.value === 'power' ? 'power' : 'data';
  const chains = mode === 'power' ? powerChains.value : dataChains.value;
  const prefix = mode === 'power' ? 'P' : 'D';
  const p_colors = ['#4fc3f7', '#ba68c8', '#81c784', '#ffb74d'];
  const d_colors = ['#e57373', '#4dd0e1', '#aed581', '#f06292'];
  const palette = mode === 'power' ? p_colors : d_colors;

  const lookup = {};
  chains.forEach((chain, gIdx) => {
    const color = palette[gIdx % palette.length];
    chain.forEach((node, sIdx) => {
      let arrow = '•';
      if (sIdx < chain.length - 1) {
        const next = chain[sIdx + 1];
        if (next.c > node.c) arrow = '→';
        else if (next.c < node.c) arrow = '←';
        else if (next.r > node.r) arrow = '↓';
        else if (next.r < node.r) arrow = '↑';
      }
      lookup[node.key] = {
        label: `${prefix}${gIdx + 1}-${sIdx + 1}`,
        shortLabel: `${prefix}${gIdx + 1}`,
        isStart: sIdx === 0,
        arrow,
        color
      };
    });
  });
  return lookup;
});

const stats = computed(() => {
  const raw_total = panel.wall_width_tiles * panel.wall_height_tiles;
  const total_tiles = Math.max(0, raw_total - removedTiles.size);
  const width_m = (panel.wall_width_tiles * panel.width_mm / 1000).toFixed(2);
  const height_m = (panel.wall_height_tiles * panel.height_mm / 1000).toFixed(2);
  const tile_res_w = Math.round(panel.width_mm / panel.pitch);
  const tile_res_h = Math.round(panel.height_mm / panel.pitch);
  const res_w = tile_res_w * panel.wall_width_tiles;
  const res_h = tile_res_h * panel.wall_height_tiles;

  const total_power_circuits = powerChains.value.length;
  const total_data_ports = dataChains.value.length;
  const total_weight = (total_tiles * panel.weight_kg).toFixed(0);
  const wallAspectRatio = (panel.wall_width_tiles * panel.width_mm) / (panel.wall_height_tiles * panel.height_mm);

  const power_input_cables = total_power_circuits;
  const data_input_cables = total_data_ports;
  const power_link_cables = Math.max(0, total_tiles - power_input_cables);
  const data_link_cables = Math.max(0, total_tiles - data_input_cables);

  return {
    raw_total, total_tiles, width_m, height_m, res_w, res_h, tile_res_w, tile_res_h,
    total_power_circuits, total_data_ports, total_weight, wallAspectRatio,
    power_input_cables, data_input_cables, power_link_cables, data_link_cables
  };
});

const getTileInfo = (n) => {
  const w = panel.wall_width_tiles;
  const row = Math.floor((n - 1) / w);
  const col = (n - 1) % w;
  const key = `${col},${row}`;

  if (removedTiles.has(key)) {
    return {
      isRemoved: true,
      col, row,
      style: {
        backgroundColor: 'transparent',
        borderColor: 'rgba(150,150,150,0.2)',
        borderStyle: 'dashed',
        color: '#666'
      },
      label: 'VOID',
      arrow: ''
    };
  }

  const info = patchMapByMode.value[key];
  if (!info) return { isRemoved: false, col, row, style: {}, label: '', arrow: '' };

  return {
    isRemoved: false,
    col, row,
    isStart: info.isStart,
    style: {
      backgroundColor: info.color + '33',
      borderColor: info.color,
      color: isDarkMode.value ? '#ffffff' : '#000000'
    },
    label: info.label,
    arrow: info.arrow
  };
};

const handleLogoUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      logoUrl.value = e.target.result;
      const img = new Image();
      img.onload = () => {
        loadedLogoImg = img;
        build3DWall();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
};

// ============================================================================
// THREE.JS 3D SPATIAL ENGINE (ViewMode === '3d')
// ============================================================================
const threeContainer = ref(null);
let scene, camera, renderer, controls, raycaster, mouse, animId;
let wallGroup = new THREE.Group();
let rasterCanvas, rasterTexture;

const updateRasterCanvasTexture = () => {
  if (!rasterCanvas) rasterCanvas = document.createElement('canvas');
  rasterCanvas.width = 1600;
  rasterCanvas.height = 900;
  const ctx = rasterCanvas.getContext('2d');

  // Background fill
  ctx.fillStyle = logoBgColor.value || '#090d16';
  ctx.fillRect(0, 0, 1600, 900);

  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  const cellW = 1600 / w;
  const cellH = 900 / h;

  // Draw subtle cabinet grid & coordinates
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      if (!logoUrl.value) {
        ctx.fillStyle = (c + r) % 2 === 0 ? '#0f172a' : '#162033';
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c * cellW, r * cellH, cellW, cellH);

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`C${c + 1}:R${r + 1}`, c * cellW + 8, r * cellH + 22);
    }
  }

  // If user uploaded a Logo / Screen Content, render it prominently
  if (loadedLogoImg) {
    const pad = 80;
    const availW = 1600 - pad * 2;
    const availH = 900 - pad * 2;
    const imgRatio = loadedLogoImg.width / loadedLogoImg.height;
    let drawW = availW;
    let drawH = drawW / imgRatio;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * imgRatio;
    }
    ctx.drawImage(loadedLogoImg, (1600 - drawW) / 2, (900 - drawH) / 2, drawW, drawH);
  } else {
    // Default Calibration Sync Lines & Circle
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(1600, 900);
    ctx.moveTo(0, 900); ctx.lineTo(1600, 0);
    ctx.stroke();

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(800, 450, 240, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
    ctx.fillRect(480, 360, 640, 180);
    ctx.strokeStyle = '#22d3ee';
    ctx.strokeRect(480, 360, 640, 180);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${panel.manufacturer}${panel.model}`.toUpperCase(), 800, 430);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(`${stats.value.res_w} ×${stats.value.res_h} px (${stats.value.width_m}m × ${stats.value.height_m}m)`, 800, 485);
    ctx.textAlign = 'left';
  }

  // Optional Pitch Overlay Badge on 3D Wall
  if (pitchOverlayText.value) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(1180, 810, 390, 65);
    ctx.strokeStyle = '#ba68c8';
    ctx.strokeRect(1180, 810, 390, 65);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pitchOverlayText.value, 1375, 852);
    ctx.textAlign = 'left';
  }

  if (!rasterTexture) {
    rasterTexture = new THREE.CanvasTexture(rasterCanvas);
    rasterTexture.colorSpace = THREE.SRGBColorSpace;
  } else {
    rasterTexture.needsUpdate = true;
  }
};

// Articulated 1.80m Stage Tech Mannequin with Hardhat & Hi-Vis Vest
const createArticulatedStageTech = () => {
  const human = new THREE.Group();
  const denimMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.7 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
  const hivisMat = new THREE.MeshStandardMaterial({ color: 0xa3e635, emissive: 0x365314, roughness: 0.4 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd6a786, roughness: 0.5 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.2, metalness: 0.1 });

  [-0.1, 0.1].forEach(x => {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.22), bootMat);
    boot.position.set(x, 0.05, 0.03);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.68, 8, 16), denimMat);
    leg.position.set(x, 0.48, 0);
    human.add(boot, leg);
  });

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.2), denimMat);
  pelvis.position.set(0, 0.88, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.50, 0.22), hivisMat);
  torso.position.set(0, 1.20, 0);
  const hStripe = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.04, 0.23), stripeMat);
  hStripe.position.set(0, 1.08, 0);
  human.add(pelvis, torso, hStripe);

  [-0.24, 0.24].forEach((x, idx) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.52, 8, 16), shirtMat);
    arm.position.set(x, 1.15, 0);
    arm.rotation.z = idx === 0 ? 0.08 : -0.08;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), skinMat);
    hand.position.set(x * 1.1, 0.84, 0);
    human.add(arm, hand);
  });

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 12), skinMat);
  neck.position.set(0, 1.50, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 20), skinMat);
  head.position.set(0, 1.63, 0);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.128, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
  dome.position.set(0, 1.65, 0);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.015, 20), helmetMat);
  brim.position.set(0, 1.65, 0.02);
  human.add(neck, head, dome, brim);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.80), stripeMat);
  pole.position.set(-0.38, 0.90, 0);
  const topTick = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.015), stripeMat);
  topTick.position.set(-0.38, 1.80, 0);
  human.add(pole, topTick);

  return human;
};

const build3DWall = () => {
  if (!scene) return;
  updateRasterCanvasTexture();

  scene.remove(wallGroup);
  wallGroup = new THREE.Group();

  const w = panel.wall_width_tiles;
  const h = panel.wall_height_tiles;
  const cabW = panel.width_mm / 1000;
  const cabH = panel.height_mm / 1000;

  // Forward kinematics for curved / faceted columns
  const transforms = [];
  let curX = 0, curZ = 0, curAngle = 0;
  const radStep = THREE.MathUtils.degToRad(curveAngle.value);

  for (let c = 0; c < w; c++) {
    const centerX = curX + (cabW / 2) * Math.cos(curAngle);
    const centerZ = curZ - (cabW / 2) * Math.sin(curAngle);
    transforms.push({ x: centerX, z: centerZ, rotY: curAngle });
    curX += cabW * Math.cos(curAngle);
    curZ -= cabW * Math.sin(curAngle);
    curAngle += radStep;
  }

  const avgX = transforms.reduce((s, t) => s + t.x, 0) / transforms.length;
  const avgZ = transforms.reduce((s, t) => s + t.z, 0) / transforms.length;
  transforms.forEach(t => { t.x -= avgX; t.z -= avgZ; });

  const rearCenters = new Map();

  for (let c = 0; c < w; c++) {
    const colT = transforms[c];
    for (let r = 0; r < h; r++) {
      const key = `${c},${r}`;
      if (removedTiles.has(key)) continue;

      const posY = trimHeight.value + (h - 1 - r + 0.5) * cabH;
      const geo = new THREE.BoxGeometry(cabW * 0.985, cabH * 0.985, 0.08);
      const uvAttr = geo.attributes.uv;
      const uMin = c / w, uMax = (c + 1) / w;
      const vMin = (h - 1 - r) / h, vMax = (h - r) / h;

      uvAttr.setXY(16, uMin, vMax);
      uvAttr.setXY(17, uMax, vMax);
      uvAttr.setXY(18, uMin, vMin);
      uvAttr.setXY(19, uMax, vMin);
      uvAttr.needsUpdate = true;

      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.5 });
      const screenMat = new THREE.MeshBasicMaterial({ map: rasterTexture });
      const rearMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });

      const mesh = new THREE.Mesh(geo, [bodyMat, bodyMat, bodyMat, bodyMat, screenMat, rearMat]);
      mesh.position.set(colT.x, posY, colT.z);
      mesh.rotation.y = colT.rotY;
      mesh.userData = { key, c, r };
      wallGroup.add(mesh);

      const rearOffset = new THREE.Vector3(0, 0, -0.065).applyAxisAngle(new THREE.Vector3(0, 1, 0), colT.rotY);
      rearCenters.set(key, new THREE.Vector3(colT.x, posY, colT.z).add(rearOffset));
    }

    // Rigging Bumper Header & Hoists
    const bumperY = trimHeight.value + h * cabH + 0.06;
    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(cabW * 0.98, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 })
    );
    bumper.position.set(colT.x, bumperY, colT.z);
    bumper.rotation.y = colT.rotY;
    wallGroup.add(bumper);

    if (c % 4 === 0 || c === w - 1) {
      const hoist = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e })
      );
      hoist.position.set(colT.x, bumperY + 0.7, colT.z);
      wallGroup.add(hoist);
    }
  }

  // Draw 3D Rear Data Splines matching the active Signal Flow mode
  if (showRearSnake3D.value) {
    dataChains.value.forEach((chain, idx) => {
      const pts = chain.map(n => rearCenters.get(n.key)).filter(Boolean);
      if (pts.length > 0) {
        const startDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0x00e676 })
        );
        startDot.position.copy(pts[0]);
        wallGroup.add(startDot);
      }
      if (pts.length > 1) {
        const path = new THREE.CatmullRomCurve3(pts);
        const tubeGeo = new THREE.TubeGeometry(path, pts.length * 6, 0.018, 8, false);
        const hueColor = new THREE.Color().setHSL((idx * 0.19) % 1, 0.85, 0.58);
        const tubeMat = new THREE.MeshBasicMaterial({ color: flowDirection.value === 'row_lr' ? hueColor : 0xffb74d });
        wallGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
      }
    });
  }

  // Articulated 1.80m Stage Tech
  if (showScaleHuman3D.value) {
    const tech = createArticulatedStageTech();
    tech.position.set(-(w * cabW) / 2 - 0.85, 0, 0.45);
    wallGroup.add(tech);
  }

  scene.add(wallGroup);
};

const set3DCameraView = (side) => {
  if (!camera || !controls) return;
  const cabH = panel.height_mm / 1000;
  const cabW = panel.width_mm / 1000;
  const targetY = trimHeight.value + (panel.wall_height_tiles * cabH) / 2;
  const dist = Math.max(5.5, panel.wall_width_tiles * cabW * 1.25);
  controls.target.set(0, targetY, 0);
  camera.position.set(0, targetY + 0.4, side === 'front' ? dist : -dist);
  controls.update();
};

const initThreeJS = () => {
  const container = threeContainer.value;
  if (!container) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(isDarkMode.value ? 0x090d16 : 0xdde3ea);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(2.4, 2.8, 7.2);

  // preserveDrawingBuffer: true is required so html2canvas / jsPDF can snapshot the 3D WebGL canvas!
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 2.1, 0);

  scene.add(new THREE.GridHelper(24, 48, 0x2a364f, 0x151d2e));
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
  dirLight.position.set(6, 12, 8);
  scene.add(dirLight);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  let downPos = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(wallGroup.children);
    const hit = hits.find(h => h.object.userData?.key);
    if (hit) {
      toggleTileRemoved(hit.object.userData.c, hit.object.userData.r);
    }
  });

  build3DWall();

  const animate = () => {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
};

window.addEventListener('resize', () => {
  if (!threeContainer.value || !renderer || !camera) return;
  camera.aspect = threeContainer.value.clientWidth / threeContainer.value.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(threeContainer.value.clientWidth, threeContainer.value.clientHeight);
});

watch(
  [
    () => panel.wall_width_tiles, () => panel.wall_height_tiles,
    () => panel.width_mm, () => panel.height_mm, () => panel.pitch,
    () => panel.manufacturer, () => panel.model,
    () => panel.max_data_port, () => panel.data_reverse,
    flowDirection, curveAngle, trimHeight, showRearSnake3D, showScaleHuman3D,
    logoBgColor, pitchOverlayText, isDarkMode
  ],
  () => {
    if (scene) {
      scene.background = new THREE.Color(isDarkMode.value ? 0x090d16 : 0xdde3ea);
      build3DWall();
    }
  }
);

onMounted(() => {
  nextTick(() => initThreeJS());
});

onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId);
});

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

  if (isDarkMode.value) { doc.setFillColor(30, 30, 30); doc.setTextColor(255, 255, 255); }
  else { doc.setFillColor(255, 255, 255); doc.setTextColor(0, 0, 0); }
  doc.rect(0, 0, 297, 210, 'F');

  doc.setFontSize(22);
  const title = mode === 'power' ? "Power Patch Plan" : "Data Signal Flow";
  doc.text(title, 14, 20);
  doc.setFontSize(10); doc.setTextColor(150, 150, 150);
  const flowLabel = flowDirection.value === 'row_lr' ? 'Row L->R (Crew-Safe)' : flowDirection.value;
  doc.text(`${panel.manufacturer}${panel.model}  |  Topology: ${flowLabel}  \vert{}${new Date().toLocaleDateString()}`, 14, 28);

  const imgProps = doc.getImageProperties(imgData);
  const pdfWidth = 180;
  const pdfHeight = Math.min(155, (imgProps.height * pdfWidth) / imgProps.width);
  doc.addImage(imgData, 'PNG', 14, 40, pdfWidth, pdfHeight);

  const x = 210; let y = 40;
  const addStat = (l, v) => {
    doc.setFontSize(9); doc.setTextColor(150, 150, 150); doc.text(l.toUpperCase(), x, y);
    doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0); doc.text(v.toString(), x, y + 5);
    y += 15;
  };
  addStat("Dimensions", `${stats.value.width_m}m (W) x${stats.value.height_m}m (H)`);
  addStat("Total Resolution", `${stats.value.res_w}px x${stats.value.res_h}px`);
  addStat("Active Tiles", `${stats.value.total_tiles} panels`);
  y += 5;
  if (mode === 'power') {
    doc.setTextColor(79, 195, 247);
    doc.text(`10A Circuits: ${stats.value.total_power_circuits}`, x, y);
  } else {
    doc.setTextColor(229, 115, 115);
    doc.text(`Data Ports: ${stats.value.total_data_ports}`, x, y);
  }

  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
  viewMode.value = originalMode;
};

const exportPitchPDF = async () => {
  const originalMode = viewMode.value;
  // If user is in 3D mode, snapshot the 3D Stage! Otherwise snapshot the 2D Pitch visualizer.
  if (viewMode.value !== '3d' && viewMode.value !== 'visualizer') {
    viewMode.value = '3d';
    await nextTick();
  }

  setTimeout(async () => {
    let imgData;
    if (viewMode.value === '3d' && renderer) {
      renderer.render(scene, camera);
      imgData = renderer.domElement.toDataURL('image/png');
    } else {
      const element = document.getElementById('pitch-scene-target');
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: null });
      imgData = canvas.toDataURL('image/png');
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFillColor(15, 15, 18); doc.rect(0, 0, 297, 210, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.text("LED Stage Concept", 15, 25);
    doc.setFontSize(11); doc.setTextColor(180, 180, 180);
    doc.text(`Dimensions: ${stats.value.width_m}m x${stats.value.height_m}m  |
