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
    ctx.fillText(`${panel.manufacturer} ${panel.model}`.toUpperCase(), 800, 430);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(`${stats.value.res_w} × ${stats.value.res_h} px (${stats.value.width_m}m × ${stats.value.height_m}m)`, 800, 485);
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
  doc.text(`${panel.manufacturer} ${panel.model}  |  Topology: ${flowLabel}  |  ${new Date().toLocaleDateString()}`, 14, 28);

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
  addStat("Dimensions", `${stats.value.width_m}m (W) x ${stats.value.height_m}m (H)`);
  addStat("Total Resolution", `${stats.value.res_w}px x ${stats.value.res_h}px`);
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
    doc.text(`Dimensions: ${stats.value.width_m}m x ${stats.value.height_m}m  |  Resolution: ${stats.value.res_w} x ${stats.value.res_h}  |  Curve: ${curveAngle.value}°`, 15, 34);

    if (pitchOverlayText.value) {
      doc.setFontSize(14); doc.setTextColor(255, 255, 255);
      doc.text(pitchOverlayText.value, 282, 25, { align: 'right' });
    }

    const imgProps = doc.getImageProperties(imgData);
    const safeWidth = 267; const safeHeight = 150;
    const bestRatio = Math.min(safeWidth / imgProps.width, safeHeight / imgProps.height);
    const renderWidth = imgProps.width * bestRatio; const renderHeight = imgProps.height * bestRatio;
    const xOffset = 15 + ((safeWidth - renderWidth) / 2); const yOffset = 45 + ((safeHeight - renderHeight) / 2);

    doc.addImage(imgData, 'PNG', xOffset, yOffset, renderWidth, renderHeight);
    doc.save(`Stage_Concept.pdf`);
    viewMode.value = originalMode;
  }, 100);
};

const exportCableListPDF = () => {
  const doc = new jsPDF({ orientation: 'portrait' });
  if (isDarkMode.value) { doc.setFillColor(30, 30, 30); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(255, 255, 255); }
  else { doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 297, 'F'); doc.setTextColor(0, 0, 0); }

  doc.setFontSize(24); doc.text("Warehouse Pick List", 20, 30);
  doc.setFontSize(12); doc.setTextColor(150, 150, 150);
  doc.text(`${panel.manufacturer} ${panel.model}`, 20, 40);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 47);
  doc.setDrawColor(100, 100, 100); doc.line(20, 55, 190, 55);
  doc.setTextColor(isDarkMode.value ? 255 : 0); doc.setFontSize(16); doc.text("Wall Specifications", 20, 70);
  doc.setFontSize(12);
  doc.text(`Total Active Panels: ${stats.value.total_tiles}`, 25, 80);
  doc.text(`Array Grid: ${panel.wall_width_tiles} W  x  ${panel.wall_height_tiles} H`, 25, 88);
  doc.text(`Physical Size: ${stats.value.width_m}m  x  ${stats.value.height_m}m`, 25, 96);
  doc.text(`Total Weight: ${stats.value.total_weight} kg`, 25, 104);
  doc.setFontSize(16); doc.text("Cable Requirements", 20, 125);
  doc.setFontSize(14); doc.setTextColor(isDarkMode.value ? 200 : 50); doc.text("Input Cables (Home Runs)", 25, 137);
  doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0);
  doc.text(`[   ]  Power Inputs:  ${stats.value.power_input_cables}`, 30, 147);
  doc.text(`[   ]  Data Inputs:   ${stats.value.data_input_cables}`, 30, 155);
  doc.setFontSize(14); doc.setTextColor(isDarkMode.value ? 200 : 50); doc.text("Link Cables (Daisy Chain)", 25, 175);
  doc.setFontSize(12); doc.setTextColor(isDarkMode.value ? 255 : 0);
  doc.text(`[   ]  Power Links:   ${stats.value.power_link_cables}`, 30, 185);
  doc.text(`[   ]  Data Links:    ${stats.value.data_link_cables}`, 30, 193);
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
      if (removedTiles.has(`${col},${row}`)) continue;
      const xPos = col * tileW; const yPos = row * tileH; const colorIndex = (row + col) % colors.length;
      ctx.fillStyle = colors[colorIndex]; ctx.fillRect(xPos, yPos, tileW, tileH);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1; ctx.strokeRect(xPos + 1, yPos + 1, tileW - 2, tileH - 2);
      ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = "black"; ctx.shadowBlur = 4;
      ctx.fillText(`${col + 1},${row + 1}`, xPos + (tileW * 0.05), yPos + (tileH * 0.05));
      ctx.shadowColor = "transparent";
    }
  }
  if (loadedLogoImg) {
    const drawW = canvas.width * 0.35;
    const drawH = drawW * (loadedLogoImg.height / loadedLogoImg.width);
    ctx.drawImage(loadedLogoImg, (canvas.width - drawW) / 2, (canvas.height - drawH) / 2, drawW, drawH);
  }
  const link = document.createElement('a'); link.download = `PixelMap_${stats.value.res_w}x${stats.value.res_h}.jpg`; link.href = canvas.toDataURL('image/jpeg', 0.95); link.click();
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
        <div class="header-row">
          <h2>WALL BUILDER</h2>
          <button @click="isDarkMode = !isDarkMode" class="theme-toggle">{{ isDarkMode ? '☀' : '☾' }}</button>
        </div>
        <span class="version">PRO v4.0 • 3D SPATIAL</span>
      </div>

      <div class="scrollable-config">
        <div class="config-section">
          <h3>Client Visuals & Logo</h3>
          <div class="field"><label>Upload Logo / Screen Content</label><input type="file" accept="image/*" @change="handleLogoUpload" class="file-input"></div>
          <div class="field color-field" style="margin-top: 10px;"><label style="margin-bottom: 0;">Screen BG Color</label><input type="color" v-model="logoBgColor" class="color-picker"></div>
          <div class="field" style="margin-top: 10px;"><label>Custom Overlay Text (Optional)</label><input type="text" v-model="pitchOverlayText" placeholder="e.g. Total: $2,500 / day"></div>
        </div>

        <div class="config-section">
          <h3>3D Stage & Rigging</h3>
          <div class="field">
            <label>Inter-Column Curve ({{ curveAngle > 0 ? '+' : '' }}{{ curveAngle }}°)</label>
            <input type="range" v-model.number="curveAngle" min="-10" max="10" step="0.5">
          </div>
          <div class="field">
            <label>Rigging Trim Height ({{ trimHeight.toFixed(1) }}m)</label>
            <input type="range" v-model.number="trimHeight" min="0" max="4" step="0.2">
          </div>
          <div class="toggle-group" style="margin-top: 6px;">
            <button @click="applyIslandPreset('full')">Solid</button>
            <button @click="applyIslandPreset('arch')">Arch</button>
            <button @click="applyIslandPreset('split')">Twin Split</button>
          </div>
        </div>

        <div class="config-section">
          <h3>Wall Size (Tiles)</h3>
          <div class="input-group">
            <div class="field"><label>Width</label><input type="number" v-model.number="panel.wall_width_tiles" min="1" max="32"></div>
            <div class="field"><label>Height</label><input type="number" v-model.number="panel.wall_height_tiles" min="1" max="16"></div>
          </div>
        </div>

        <div class="config-section">
          <h3>Physical Panel Size (mm)</h3>
          <div class="input-group">
            <div class="field"><label>Width (mm)</label><input type="number" v-model.number="panel.width_mm" step="10"></div>
            <div class="field"><label>Height (mm)</label><input type="number" v-model.number="panel.height_mm" step="10"></div>
          </div>
        </div>

        <div class="config-section">
          <h3>Patching Limits</h3>
          <div class="field"><label>Max per Power Circuit (10A)</label><input type="number" v-model.number="panel.max_power_circuit" min="1"></div>
          <div class="field"><label>Max per Data Port</label><input type="number" v-model.number="panel.max_data_port" min="1"></div>
        </div>

        <div class="config-section">
          <h3>Signal Flow</h3>
          <div class="toggle-group mb-2">
            <button :class="{active: flowDirection === 'row_lr'}" @click="flowDirection = 'row_lr'" title="Dedicated row feeds so daisy-chains strictly run Left to Right">Row L→R</button>
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

        <div class="config-section">
          <h3>Panel Specs</h3>
          <input v-model="panel.manufacturer" placeholder="Manufacturer" class="mb-2">
          <input v-model="panel.model" placeholder="Model" class="mb-2">
          <div class="input-group">
            <div class="field"><label>Pitch (mm)</label><input type="number" v-model.number="panel.pitch" step="0.1"></div>
            <div class="field"><label>Weight (kg)</label><input type="number" v-model.number="panel.weight_kg" step="0.1"></div>
          </div>
        </div>

        <div class="config-section">
          <h3>Cable Requirements</h3>
          <div class="cable-stats">
            <div class="c-stat"><span class="label">Pwr Inputs:</span> <span class="val">{{ stats.power_input_cables }}</span></div>
            <div class="c-stat"><span class="label">Data Inputs:</span> <span class="val">{{ stats.data_input_cables }}</span></div>
            <div class="c-stat"><span class="label">Pwr Links:</span> <span class="val">{{ stats.power_link_cables }}</span></div>
            <div class="c-stat"><span class="label">Data Links:</span> <span class="val">{{ stats.data_link_cables }}</span></div>
          </div>
        </div>
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
        <div class="stat"><span class="label">Active Tiles</span><span class="val">{{ stats.total_tiles }}</span></div>
        <div class="stat"><span class="label">Physical Size</span><span class="val">{{ stats.width_m }}m × {{ stats.height_m }}m</span></div>
        <div class="stat"><span class="label">Resolution</span><span class="val highlight">{{ stats.res_w }} × {{ stats.res_h }}</span></div>
        <div class="stat"><span class="label">Total Weight</span><span class="val">{{ stats.total_weight }} kg</span></div>
        <div class="stat circuit-stat"><span class="label">Circuits</span><span class="val">{{ stats.total_power_circuits }}</span></div>
        <div class="stat data-stat"><span class="label">Ports</span><span class="val">{{ stats.total_data_ports }}</span></div>
      </div>

      <div class="viz-toolbar">
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="viz-title">
            {{ viewMode === '3d' ? '3D Spatial Stage Pre-Vis (Click any cabinet to toggle Island)' : viewMode === 'visualizer' ? '2D Client Stage Concept' : 'Schematic Patch View (Click tile to toggle Island)' }}
          </span>
          <template v-if="viewMode === '3d'">
            <button class="cam-btn" @click="set3DCameraView('front')">Front FOH</button>
            <button class="cam-btn" @click="set3DCameraView('rear')">Rear Patch</button>
            <button class="cam-btn" @click="showScaleHuman3D = !showScaleHuman3D">{{ showScaleHuman3D ? '👷 Hide Tech' : '👷 Show Tech' }}</button>
          </template>
        </div>
        <div class="view-toggles">
          <button :class="{active: viewMode === '3d'}" @click="viewMode = '3d'" style="color: #29b6f6;">🧊 3D Stage</button>
          <button :class="{active: viewMode === 'visualizer'}" @click="viewMode = 'visualizer'" style="color: #ba68c8;">★ 2D Pitch</button>
          <button :class="{active: viewMode === 'power'}" @click="viewMode = 'power'">Power</button>
          <button :class="{active: viewMode === 'data'}" @click="viewMode = 'data'">Data</button>
        </div>
      </div>

      <div class="canvas-wrapper">
        <div id="preview-canvas" class="canvas-bed" :class="{ 'pitch-bed': viewMode === 'visualizer' || viewMode === '3d' }">
          <!-- 3D STAGE VIEWPORT -->
          <div v-show="viewMode === '3d'" ref="threeContainer" class="three-viewport"></div>

          <!-- 2D PITCH MODE -->
          <template v-if="viewMode === 'visualizer'">
            <div id="pitch-scene-target" class="pitch-scene-wrapper" :style="{ '--ratio': stats.wallAspectRatio, width: `min(100cqw - 80px, calc((100cqh - 80px) * ${stats.wallAspectRatio}))` }">
              <div class="pitch-screen" :style="{ backgroundColor: logoBgColor }">
                <div v-if="logoUrl" class="pitch-logo" :style="{ backgroundImage: `url(${logoUrl})` }"></div>
                <div v-else class="pitch-placeholder">No Content Loaded</div>
                <div class="pitch-grid-overlay" :style="{ gridTemplateColumns: `repeat(${panel.wall_width_tiles}, 1fr)`, gridTemplateRows: `repeat(${panel.wall_height_tiles}, 1fr)` }">
                  <div v-for="n in stats.raw_total" :key="n" class="pitch-faint-tile"></div>
                </div>
              </div>
              <div v-if="pitchOverlayText" class="pitch-badge">{{ pitchOverlayText }}</div>
            </div>
          </template>

          <!-- 2D POWER / DATA SCHEMATIC GRID -->
          <template v-else-if="viewMode === 'power' || viewMode === 'data'">
            <div class="wall-grid" :style="{ '--ratio': stats.wallAspectRatio, gridTemplateColumns: `repeat(${panel.wall_width_tiles}, 1fr)`, gridTemplateRows: `repeat(${panel.wall_height_tiles}, 1fr)` }">
              <div v-for="n in stats.raw_total" :key="n" class="tile" :style="getTileInfo(n).style" @click="toggleTileRemoved(getTileInfo(n).col, getTileInfo(n).row)">
                <span v-if="getTileInfo(n).isStart" class="start-pill">IN</span>
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

/* SIDEBAR & CONFIG CSS */
.sidebar { width: 320px; background-color: var(--bg-panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; gap: 16px; flex-shrink: 0; z-index: 10; }
.logo-area .header-row { display: flex; justify-content: space-between; align-items: center; }
.logo-area h2 { margin: 0; font-size: 1.2rem; letter-spacing: 1px; color: var(--text-main); }
.version { font-size: 0.7rem; color: #29b6f6; font-weight: 700; letter-spacing: 0.5px; }
.theme-toggle { background: none; border: 1px solid var(--border); color: var(--text-main); cursor: pointer; border-radius: 4px; padding: 4px 8px; }
.scrollable-config { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 18px; padding-right: 5px; }
.config-section h3 { font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 5px; }

.input-group { display: flex; gap: 10px; } .field { flex: 1; margin-bottom: 5px; } .field label { display: block; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; }
input { width: 100%; background: var(--bg-input) !important; border: 1px solid var(--border); color: var(--text-input) !important; padding: 8px 10px; border-radius: 4px; font-family: monospace; font-size: 0.9rem; box-sizing: border-box; }
input[type="range"] { padding: 2px 0; cursor: pointer; }
input:focus { outline: none; border-color: var(--primary); }
input[type="file"] { font-family: inherit; font-size: 0.8rem; padding: 5px; cursor: pointer; }
.mb-2 { margin-bottom: 10px; }

.toggle-group { display: flex; gap: 5px; background: var(--bg-input); padding: 3px; border-radius: 6px; }
.toggle-group button { flex: 1; background: transparent; border: none; color: var(--text-muted); padding: 6px; font-size: 0.78rem; cursor: pointer; border-radius: 4px; transition: 0.2s; }
.toggle-group button.active { background: var(--border); color: var(--text-main); font-weight: bold; }

.cable-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem; }
.cable-stats .c-stat { display: flex; flex-direction: column; background: var(--bg-input); padding: 8px; border-radius: 4px; border: 1px solid var(--border); }
.cable-stats .label { color: var(--text-muted); font-size: 0.7rem; text-transform: uppercase; }
.cable-stats .val { color: var(--text-main); font-weight: bold; font-size: 1rem; }

/* MAIN VIEWPORT & TOOLBAR */
.main-content { flex: 1; display: flex; flex-direction: column; background: var(--bg-app); min-width: 0; }
.stats-bar { display: flex; background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 15px 30px; gap: 40px; overflow-x: auto; flex-shrink: 0; }
.stat { display: flex; flex-direction: column; white-space: nowrap; }
.stat .label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.stat .val { font-size: 1.1rem; color: var(--text-main); font-weight: 500; margin-top: 2px; }
.stat .highlight { color: var(--primary); } .circuit-stat .val { color: #81c784; } .data-stat .val { color: #ef5350; }

.viz-toolbar { padding: 10px 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-panel); flex-shrink: 0; }
.viz-title { color: var(--text-muted); font-size: 0.85rem; }
.cam-btn { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-main); font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
.cam-btn:hover { border-color: var(--primary); }
.view-toggles button { background: var(--bg-input); border: 1px solid var(--border); color: var(--text-muted); padding: 6px 15px; cursor: pointer; }
.view-toggles button.active { background: var(--border); color: var(--text-main); font-weight: 600; }

.canvas-wrapper { flex: 1; display: flex; padding: 20px; background: var(--bg-canvas); overflow: hidden; min-height: 0; }
.canvas-bed { background: var(--bg-bed); border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.2); flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px; min-height: 0; min-width: 0; container-type: size; transition: background 0.3s; position: relative; }
.three-viewport { width: 100%; height: 100%; border-radius: 6px; overflow: hidden; }

/* PITCH RENDER CSS */
.pitch-bed { background: radial-gradient(circle at center, #1a1a24 0%, #050505 100%); border-color: #000; overflow: hidden; padding: 0; }
.pitch-scene-wrapper { position: relative; aspect-ratio: var(--ratio); max-width: 100%; max-height: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.9), 0 0 40px rgba(186, 104, 200, 0.15); margin: 20px; }
.pitch-screen { width: 100%; height: 100%; position: relative; overflow: hidden; border: 2px solid #222; transition: background-color 0.3s; }
.pitch-logo { width: 100%; height: 100%; background-size: contain; background-position: center; background-repeat: no-repeat; }
.pitch-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #666; font-size: 1.5rem; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; text-align: center; }
.pitch-grid-overlay { position: absolute; inset: 0; display: grid; pointer-events: none; }
.pitch-faint-tile { border: 1px solid rgba(255, 255, 255, 0.08); }
.pitch-badge { position: absolute; bottom: 20px; right: 20px; background: rgba(0, 0, 0, 0.7); color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 1rem; font-weight: 600; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.1); z-index: 15; pointer-events: none; }

.color-field { display: flex; align-items: center; justify-content: space-between; }
.color-picker { width: 40px; height: 30px; padding: 0; border: 1px solid var(--border); cursor: pointer; background: transparent; }

/* TECHNICAL GRID CSS */
.wall-grid { display: grid; gap: 2px; aspect-ratio: var(--ratio); width: min(100cqw - 40px, calc((100cqh - 40px) * var(--ratio))); max-width: 100%; max-height: 100%; }
.tile { background: var(--bg-input); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: clamp(0.55rem, 1.1cqw, 0.95rem); font-weight: 600; position: relative; cursor: pointer; user-select: none; }
.tile:hover { filter: brightness(1.2); }
.start-pill { position: absolute; top: 2px; left: 2px; background: #00e676; color: #000; font-size: 0.55em; font-weight: 800; padding: 1px 3px; border-radius: 2px; }
.tile-id { z-index: 2; } .arrow { font-size: 1.2em; opacity: 0.85; margin-top: -2px; }

/* EXPORT BUTTONS */
.export-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; }
.btn { padding: 10px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: center; font-size: 0.8rem; transition: opacity 0.2s; }
.btn:disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(1); }
.primary { background: var(--primary); color: white; }
.secondary { background: #ef5350; color: white; }
.tertiary { background: #ba68c8; color: white; }
.outline { background: transparent; border: 1px solid var(--border); color: var(--text-muted); }
.outline:hover:not(:disabled) { background: var(--border); }
.highlight-btn { background: linear-gradient(135deg, #ba68c8, #7e57c2); color: white; grid-column: span 2; padding: 14px; font-size: 0.9rem; }
.highlight-btn:hover:not(:disabled) { filter: brightness(1.2); }
</style>
