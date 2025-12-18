const mainUserElem = document.getElementById("mainUserName");
const userRoleElem = document.getElementById("userRole");
const premiumBadge = document.getElementById("premiumBadge");
const avatarImg = document.getElementById("avatarImg");
const msStatus = document.getElementById("msStatus");
const msButton = document.getElementById("loginMicrosoft");
const banealandBtn = document.getElementById("banealandBtn");
const banealandDot = document.getElementById("banealandDot");
const versionSelect = document.getElementById("versionSelect");
const launchBtn = document.getElementById("launchBtn");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const consoleLog = document.getElementById("consoleLog");
const toastContainer = document.getElementById("toastContainer");
const settingsToggle = document.getElementById("settingsToggle");
const settingsModal = document.getElementById("settingsModal");
const settingsClose = document.getElementById("settingsClose");
const profileTabsContainer = document.querySelector(".profile-tabs");
const profileTabs = {
  vanilla: document.getElementById("profileTabVanilla"),
  modpack: document.getElementById("profileTabModpack")
};
const updateModal = document.getElementById("updateModal");
const updateModalText = document.getElementById("updateModalText");
const updateClose = document.getElementById("updateClose");

const logoutBtn = document.getElementById("logoutBtn");
const ramSelect = document.getElementById("ramSelect");
const fovRange = document.getElementById("fovRange");
const fovValue = document.getElementById("fovValue");
const sensRange = document.getElementById("sensRange");
const sensValue = document.getElementById("sensValue");
const gammaRange = document.getElementById("gammaRange");
const gammaValue = document.getElementById("gammaValue");
const musicRange = document.getElementById("musicRange");
const musicValue = document.getElementById("musicValue");
const fpsSelect = document.getElementById("fpsSelect");
const renderRange = document.getElementById("renderRange");
const renderValue = document.getElementById("renderValue");
const simRange = document.getElementById("simRange");
const simValue = document.getElementById("simValue");
const sneakCapture = document.getElementById("sneakCapture");
const sprintCapture = document.getElementById("sprintCapture");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const closeToggle = document.getElementById("closeToggle");
const vsyncToggle = document.getElementById("vsyncToggle");
const saveSettingsBtn = document.getElementById("saveSettings");

let settingsData = { vanilla: {}, modpack: {} };
let activeProfile = "vanilla";
let isPremium = false;
const fallbackVersions = ["1.21.11", "1.21", "1.20.1", "1.16.4", "1.12.2", "1.8.9"];

function setAvatar(user) {
  const u = user || {};
  const m = u.microsoft || {};
  const rawUuid = m.profile?.id || m.profile?.uuid || m.mclcAuth?.selected_profile?.id || m.mclcAuth?.uuid || "";
  const id = (rawUuid || "").replace(/-/g, "");
  const name = (u.game_name || "").replace(/[^A-Za-z0-9_]/g, "") || "Steve";

  const candidates = [
    `https://crafatar.com/avatars/${id || name}?size=128&overlay&default=MHF_Steve`,
    `https://minotar.net/helm/${name}/128`,
    `https://mc-heads.net/avatar/${id || name}/128`
  ];

  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) return;
    avatarImg.src = candidates[idx++];
  };
  avatarImg.onerror = tryNext;
  tryNext();
}

function populateVersions(list) {
  versionSelect.innerHTML = "";
  (list || fallbackVersions).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    versionSelect.appendChild(opt);
  });
  versionSelect.value = "1.20.1";
}

function setPremiumMode(premium) {
  isPremium = !!premium;
  if (premiumBadge) premiumBadge.style.display = premium ? "inline-block" : "none";
}

function setModpackUpdate(needsUpdate, info = {}) {
  if (banealandDot) {
    if (needsUpdate) banealandDot.classList.add("show"); else banealandDot.classList.remove("show");
  }
  if (needsUpdate) {
    const remote = info.remoteVersion || "desconocida";
    const local = info.localVersion || "ninguna";
    if (updateModalText) updateModalText.textContent = `Se detectó una actualización del modpack (local ${local} -> remoto ${remote}). Se aplicará al lanzar Banealand.`;
    if (updateModal && !updateModal.classList.contains("open")) updateModal.classList.add("open");
    showToast("Hay una actualización del modpack disponible. Se aplicará al abrir Banealand.", "success");
  } else {
    if (updateModal) updateModal.classList.remove("open");
  }
}

async function checkModpackUpdate() {
  try {
    const res = await window.api.checkModpackUpdate();
    if (!res?.success) return;
    setModpackUpdate(!!res.needsUpdate, res);
  } catch (_) {
    // silencioso
  }
}

async function loadUserData() {
  const user = await window.api.getUserData();
  if (!user) {
    showToast("Necesitas iniciar sesion primero.", "error");
    window.location.href = "./index.html";
    return;
  }

  mainUserElem.innerText = user.game_name || "Jugador";
  setPremiumMode(!!user.microsoft);
  userRoleElem.innerText = isPremium ? "Microsoft" : (user.role || "Offline");
  setAvatar(user);

  if (isPremium) {
    msButton.textContent = "Cuenta Microsoft vinculada";
    msButton.disabled = true;
    msStatus.textContent = `Sesion Microsoft activa: ${user.microsoft.profile?.name || user.game_name || "Premium"}`;
  } else {
    msStatus.textContent = "Sesion no verificada.";
    msButton.textContent = "Vincular Microsoft";
    msButton.disabled = false;
  }
}

launchBtn.addEventListener("click", async () => {
  const runOffline = !isPremium;
  setProgress("Lanzando...", null);
  const res = await window.api.launchGame({ offlineMode: runOffline, version: versionSelect.value });
  if (!res?.success) showToast(res?.message || "No se pudo iniciar el juego.", "error");
});

msButton.addEventListener("click", async () => {
  const result = await window.api.loginMicrosoft();
  if (!result.success) {
    showToast(result.message || "No se pudo iniciar sesion con Microsoft.", "error");
    return;
  }
  await loadUserData();
});

logoutBtn?.addEventListener("click", async () => {
  await window.api.logout();
});

banealandBtn?.addEventListener("click", async () => {
  versionSelect.value = "1.12.2";
  const runOffline = !isPremium;
  setProgress("Lanzando modpack...", null);
  const res = await window.api.launchGame({ offlineMode: runOffline, version: "1.12.2", modpack: "banealand" });
  if (!res?.success) showToast(res?.message || "No se pudo iniciar el modpack banealand.", "error");
  else await checkModpackUpdate();
});

function openSettingsModal() { settingsModal?.classList.add("open"); }
function closeSettingsModal() { settingsModal?.classList.remove("open"); }
settingsToggle?.addEventListener("click", openSettingsModal);
settingsClose?.addEventListener("click", closeSettingsModal);
settingsModal?.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });

function setProgress(message, value) {
  if (progressText) progressText.textContent = message;
  if (progressBar) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      progressBar.classList.add("indeterminate");
      progressBar.style.width = "30%";
    } else {
      progressBar.classList.remove("indeterminate");
      const pct = Math.max(0, Math.min(100, value));
      progressBar.style.width = `${pct}%`;
    }
  }
}

function appendLog(line) {
  if (!consoleLog) return;
  const div = document.createElement("div");
  div.textContent = line.trim();
  consoleLog.appendChild(div);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

window.api.onLaunchStatus((data) => {
  if (!data) return;
  if (data.type === "progress") {
    setProgress(data.message || "Descargando...", data.progress);
  } else if (data.type === "status") {
    setProgress(data.message || "Procesando...", null);
  } else if (data.type === "error") {
    setProgress(data.message || "Error", 0);
  }
});

window.api.onLaunchLog((payload) => {
  if (!payload?.line) return;
  appendLog(payload.line);
});

function toggleMini(el, value) {
  if (!el) return;
  if (value) el.classList.add("active"); else el.classList.remove("active");
}

function applySettingsToUI(profile) {
  const s = profile || {};
  ramSelect.value = String(s.ramMB ?? 4000);
  fovRange.value = s.fov ?? 90;
  sensRange.value = s.sensitivity ?? 0.5;
  fovValue.textContent = fovRange.value;
  sensValue.textContent = `${Math.round((s.sensitivity ?? 0.5) * 100)}%`;
  setCaptureValue(sneakCapture, s.keySneak || "key.keyboard.left.shift");
  setCaptureValue(sprintCapture, s.keySprint || "key.keyboard.left.control");
  toggleMini(fullscreenToggle, !!s.fullscreen);
  toggleMini(closeToggle, !!s.closeLauncher);
  toggleMini(vsyncToggle, !!s.enableVsync);
  gammaRange.value = Math.round((s.gamma ?? 0.5) * 100);
  gammaValue.textContent = `${gammaRange.value}%`;
  musicRange.value = typeof s.musicVol === "number" ? s.musicVol : 50;
  musicValue.textContent = `${musicRange.value}%`;
  fpsSelect.value = typeof s.maxFps === "number" ? String(s.maxFps) : "120";
  renderRange.value = s.renderDistance ?? 12;
  renderValue.textContent = renderRange.value;
  simRange.value = s.simulationDistance ?? 12;
  simValue.textContent = simRange.value;
}

function setActiveProfile(profile) {
  activeProfile = profile;
  Object.entries(profileTabs).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === profile) btn.classList.add("active"); else btn.classList.remove("active");
  });
  applySettingsToUI(settingsData[profile] || {});
}

async function refreshSettings() {
  const data = await window.api.getSettings();
  settingsData = {
    vanilla: data?.vanilla || {},
    modpack: data?.modpack || {}
  };
  const target = settingsData[activeProfile] ? activeProfile : "vanilla";
  setActiveProfile(target);
}

function currentSettings() {
  return {
    ramMB: Number(ramSelect.value),
    fov: Number(fovRange.value),
    sensitivity: Number(sensRange.value),
    keySneak: sneakCapture?.dataset.key,
    keySprint: sprintCapture?.dataset.key,
    fullscreen: fullscreenToggle?.classList.contains("active"),
    closeLauncher: closeToggle?.classList.contains("active"),
    enableVsync: vsyncToggle?.classList.contains("active"),
    gamma: Number(gammaRange.value) / 100,
    musicVol: Number(musicRange.value),
    maxFps: Number(fpsSelect.value),
    renderDistance: Number(renderRange.value),
    simulationDistance: Number(simRange.value)
  };
}

fovRange?.addEventListener("input", () => fovValue.textContent = fovRange.value);
sensRange?.addEventListener("input", () => sensValue.textContent = `${Math.round(sensRange.value * 100)}%`);
gammaRange?.addEventListener("input", () => gammaValue.textContent = `${gammaRange.value}%`);
musicRange?.addEventListener("input", () => musicValue.textContent = `${musicRange.value}%`);
renderRange?.addEventListener("input", () => renderValue.textContent = renderRange.value);
simRange?.addEventListener("input", () => simValue.textContent = simRange.value);
fullscreenToggle?.addEventListener("click", () => fullscreenToggle.classList.toggle("active"));
closeToggle?.addEventListener("click", () => closeToggle.classList.toggle("active"));
vsyncToggle?.addEventListener("click", () => vsyncToggle.classList.toggle("active"));

saveSettingsBtn?.addEventListener("click", async () => {
  const values = currentSettings();
  const payload = { profile: activeProfile, values };
  const res = await window.api.saveSettings(payload);
  if (!res?.success) {
    showToast(res?.message || "No se pudo guardar la configuracion", "error");
  } else {
    settingsData[activeProfile] = { ...(settingsData[activeProfile] || {}), ...values };
    const verifyMsg = res?.snapshot?.verify ? " (verificado)" : "";
    const profileLabel = activeProfile === "modpack" ? "Modpack" : "Vanilla";
    showToast(`Config ${profileLabel} guardada en ${res.path || "options.txt"}${verifyMsg}`, "success");
  }
});

function setCaptureValue(btn, keyCode) {
  if (!btn) return;
  btn.dataset.key = keyCode;
  btn.textContent = prettyKey(keyCode);
}

const keyMap = {
  shiftleft: "key.keyboard.left.shift",
  shiftright: "key.keyboard.right.shift",
  controlleft: "key.keyboard.left.control",
  controlright: "key.keyboard.right.control",
  altleft: "key.keyboard.left.alt",
  altright: "key.keyboard.right.alt",
  space: "key.keyboard.space",
  enter: "key.keyboard.enter",
  backspace: "key.keyboard.backspace",
  tab: "key.keyboard.tab",
  capslock: "key.keyboard.caps.lock",
  escape: "key.keyboard.escape",
  arrowup: "key.keyboard.up",
  arrowdown: "key.keyboard.down",
  arrowleft: "key.keyboard.left",
  arrowright: "key.keyboard.right"
};

function prettyKey(code) {
  if (!code) return "Sin asignar";
  const map = {
    "key.keyboard.left.shift": "Shift izq.",
    "key.keyboard.left.control": "Ctrl izq.",
    "key.keyboard.c": "C",
    "key.keyboard.v": "V",
    "key.keyboard.r": "R"
  };
  return map[code] || code.replace("key.keyboard.", "").toUpperCase();
}

let capturing = null;
function startCapture(btn) {
  capturing = btn;
  btn.textContent = "Presiona una tecla...";
  btn.classList.add("active");
}

[sneakCapture, sprintCapture].forEach(btn => {
  btn?.addEventListener("click", () => startCapture(btn));
});

window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  e.preventDefault();
  const btn = capturing;
  capturing = null;
  btn.classList.remove("active");

  if (e.key === "Escape") {
    const defaults = {
      [sneakCapture?.id]: "key.keyboard.left.shift",
      [sprintCapture?.id]: "key.keyboard.left.control"
    };
    setCaptureValue(btn, defaults[btn.id]);
    return;
  }

  const raw = (e.code || e.key || "").toLowerCase();
  let keyCode = keyMap[raw.replace("key", "").replace(/[^a-z]/g, "")];
  if (!keyCode && raw.startsWith("key")) keyCode = `key.keyboard.${raw.replace("key", "")}`;
  else if (!keyCode && raw.length === 1) keyCode = `key.keyboard.${raw}`;
  else if (!keyCode) keyCode = `key.keyboard.${raw.replace(/\s+/g, ".")}`;
  setCaptureValue(btn, keyCode);
});

function showToast(message, type = "info") {
  if (!toastContainer) { alert(message); return; }
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = message;
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

profileTabs.vanilla?.addEventListener("click", () => setActiveProfile("vanilla"));
profileTabs.modpack?.addEventListener("click", () => setActiveProfile("modpack"));

// Mover logout visualmente junto a las pestañas
if (logoutBtn && profileTabsContainer) {
  logoutBtn.classList.add("profile-tab");
  profileTabsContainer.appendChild(logoutBtn);
}

updateClose?.addEventListener("click", () => {
  if (updateModal) updateModal.classList.remove("open");
});

populateVersions(fallbackVersions);
loadUserData();
refreshSettings();
checkModpackUpdate();
