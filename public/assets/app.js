const CHAT_TTL_MS = 120 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;
const DB_NAME = "neon-pulse-room";
const DB_VERSION = 1;
const STORES = { songs: "songs", chat: "chat", user: "user" };

const state = {
  songs: [],
  currentIndex: -1,
  nickname: "",
  ip: "unknown",
  userId: crypto.randomUUID(),
  db: null,
  channel: null,
  chatTimer: null,
  firebase: null,
  users: new Map(),
  remoteSongs: [],
};

const el = {
  audio: document.querySelector("#audio"),
  visualizer: document.querySelector("#visualizer"),
  trackTitle: document.querySelector("#trackTitle"),
  trackSource: document.querySelector("#trackSource"),
  songList: document.querySelector("#songList"),
  songCount: document.querySelector("#songCount"),
  songFile: document.querySelector("#songFile"),
  uploadStatus: document.querySelector("#uploadStatus"),
  clearLocalSongs: document.querySelector("#clearLocalSongs"),
  prevTrack: document.querySelector("#prevTrack"),
  playTrack: document.querySelector("#playTrack"),
  nextTrack: document.querySelector("#nextTrack"),
  nickname: document.querySelector("#nickname"),
  joinForm: document.querySelector("#joinForm"),
  identityLine: document.querySelector("#identityLine"),
  userList: document.querySelector("#userList"),
  onlineCount: document.querySelector("#onlineCount"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  syncMode: document.querySelector("#syncMode"),
  clock: document.querySelector("#clock"),
};

boot();

async function boot() {
  state.db = await openDb();
  state.nickname = await loadNickname();
  el.nickname.value = state.nickname;
  state.ip = await detectIp();
  setupClock();
  await setupFirebaseIfConfigured();
  await setupLocalRealtime();
  await loadSongs();
  bindEvents();
  setupVisualizer();
  await refreshChat();
  startPresence();
  state.chatTimer = setInterval(cleanOldChat, 60 * 1000);
}

function bindEvents() {
  el.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.nickname = sanitizeName(el.nickname.value) || makeGuestName();
    el.nickname.value = state.nickname;
    await saveNickname(state.nickname);
    announcePresence();
    renderIdentity();
  });

  el.songFile.addEventListener("change", async () => {
    const file = el.songFile.files?.[0];
    if (!file) return;
    await addUploadedSong(file);
    el.songFile.value = "";
  });

  el.clearLocalSongs.addEventListener("click", async () => {
    if (!confirm("清空当前浏览器保存的上传歌曲？内置歌曲不会删除。")) return;
    await tx(STORES.songs, "readwrite", (store) => store.clear());
    await loadSongs();
    el.uploadStatus.textContent = "本地上传已清空。";
  });

  el.prevTrack.addEventListener("click", () => playByOffset(-1));
  el.nextTrack.addEventListener("click", () => playByOffset(1));
  el.playTrack.addEventListener("click", () => {
    if (state.currentIndex < 0 && state.songs.length) {
      playSong(0);
      return;
    }
    if (el.audio.paused) el.audio.play();
    else el.audio.pause();
  });
  el.audio.addEventListener("ended", () => playByOffset(1));

  el.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = "";
    await sendChat(text);
  });
}

async function loadSongs() {
  const builtIns = await buildBuiltInSongs();
  const uploaded = await getAll(STORES.songs);
  state.songs = [...builtIns, ...state.remoteSongs, ...uploaded.map(songFromStoredRecord)];
  renderSongs();
  if (state.currentIndex < 0 && state.songs.length) {
    selectSong(0, false);
  }
}

async function buildBuiltInSongs() {
  return [
    await synthSong("Neon Alley 88", "内置原创合成曲", 96, 22, [55, 82.41, 110, 164.81], "#00f5ff"),
    await synthSong("Chrome Rain", "内置原创合成曲", 82, 24, [65.41, 98, 130.81, 196], "#ff2bd6"),
    await synthSong("Midnight Firewall", "内置原创合成曲", 118, 20, [73.42, 110, 146.83, 220], "#25ff9f"),
  ];
}

async function synthSong(title, source, bpm, duration, notes, color) {
  const sampleRate = 44100;
  const total = sampleRate * duration;
  const channels = 2;
  const buffer = new ArrayBuffer(44 + total * channels * 2);
  const view = new DataView(buffer);
  writeWavHeader(view, total, channels, sampleRate);
  const beat = 60 / bpm;
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const step = Math.floor(t / beat) % notes.length;
    const bass = Math.sin(2 * Math.PI * notes[step] * t) * 0.32;
    const lead = Math.sin(2 * Math.PI * notes[(step + 2) % notes.length] * 2 * t) * 0.12;
    const hat = ((Math.random() * 2 - 1) * (Math.sin(2 * Math.PI * (bpm / 60) * 4 * t) > 0.92 ? 0.18 : 0));
    const kickPhase = (t % beat) / beat;
    const kick = Math.sin(2 * Math.PI * (42 + 80 * (1 - kickPhase)) * t) * Math.max(0, 1 - kickPhase * 8) * 0.55;
    const envelope = Math.min(1, t * 2) * Math.min(1, (duration - t) * 2);
    const left = clamp16((bass + lead + kick + hat) * envelope);
    const right = clamp16((bass * 0.9 + lead * 1.2 + kick + hat * 0.8) * envelope);
    const offset = 44 + i * channels * 2;
    view.setInt16(offset, left, true);
    view.setInt16(offset + 2, right, true);
  }
  const blob = new Blob([buffer], { type: "audio/wav" });
  return {
    id: `builtin-${slug(title)}`,
    title,
    source,
    color,
    url: URL.createObjectURL(blob),
    builtin: true,
    size: blob.size,
  };
}

function writeWavHeader(view, samples, channels, sampleRate) {
  const bytesPerSample = 2;
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples * channels * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples * channels * bytesPerSample, true);
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function clamp16(value) {
  return Math.max(-1, Math.min(1, value)) * 0x7fff;
}

async function addUploadedSong(file) {
  if (!file.type.startsWith("audio/")) {
    el.uploadStatus.textContent = "请选择音频文件。";
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    el.uploadStatus.textContent = "文件超过 30MB，GitHub Pages 演示模式建议压缩后上传。";
    return;
  }
  const record = {
    id: `local-${crypto.randomUUID()}`,
    title: file.name.replace(/\.[^.]+$/, ""),
    source: "本地上传",
    type: file.type || "audio/mpeg",
    size: file.size,
    createdAt: Date.now(),
    blob: file,
  };
  await tx(STORES.songs, "readwrite", (store) => store.put(record));
  await maybeUploadToFirebase(record);
  await loadSongs();
  el.uploadStatus.textContent = `已保存：${record.title}`;
}

function songFromStoredRecord(record) {
  return {
    ...record,
    url: URL.createObjectURL(record.blob),
    builtin: false,
  };
}

function renderSongs() {
  el.songCount.textContent = `${state.songs.length} tracks`;
  el.songList.innerHTML = state.songs.map((song, index) => `
    <button class="song-item ${index === state.currentIndex ? "active" : ""}" data-index="${index}" type="button">
      <span>
        <span class="song-title">${escapeHtml(song.title)}</span>
        <span class="song-sub">${escapeHtml(song.source)} · ${formatBytes(song.size || 0)}</span>
      </span>
      <span>${song.builtin ? "SYS" : "UP"}</span>
    </button>
  `).join("");
  el.songList.querySelectorAll(".song-item").forEach((item) => {
    item.addEventListener("click", () => playSong(Number(item.dataset.index)));
  });
}

function selectSong(index, autoplay) {
  const song = state.songs[index];
  if (!song) return;
  state.currentIndex = index;
  el.audio.src = song.url;
  el.trackTitle.textContent = song.title;
  el.trackSource.textContent = song.source;
  renderSongs();
  if (autoplay) el.audio.play().catch(() => {});
}

function playSong(index) {
  selectSong(index, true);
}

function playByOffset(offset) {
  if (!state.songs.length) return;
  const next = state.currentIndex < 0 ? 0 : (state.currentIndex + offset + state.songs.length) % state.songs.length;
  playSong(next);
}

async function setupLocalRealtime() {
  state.channel = new BroadcastChannel("neon-pulse-room");
  state.channel.onmessage = async (event) => {
    if (event.data?.type === "chat") {
      await refreshChat();
    }
    if (event.data?.type === "presence") {
      upsertUser(event.data.user);
    }
  };
}

async function setupFirebaseIfConfigured() {
  const config = window.NEON_FIREBASE_CONFIG;
  if (!config) {
    el.syncMode.textContent = "LOCAL MODE";
    return;
  }
  try {
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const dbMod = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js");
    const storageMod = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js");
    const app = appMod.initializeApp(config);
    const realtimeDb = dbMod.getDatabase(app);
    const storage = storageMod.getStorage(app);
    state.firebase = { dbMod, storageMod, realtimeDb, storage };
    el.syncMode.textContent = "FIREBASE LIVE";
    dbMod.onValue(dbMod.ref(realtimeDb, "chat"), async (snapshot) => {
      const values = snapshot.val() || {};
      await renderChat(Object.values(values).filter(Boolean));
    });
    dbMod.onValue(dbMod.ref(realtimeDb, "presence"), (snapshot) => {
      const values = snapshot.val() || {};
      renderUsers(Object.values(values).filter(Boolean));
    });
    dbMod.onValue(dbMod.ref(realtimeDb, "songs"), async (snapshot) => {
      const values = snapshot.val() || {};
      state.remoteSongs = Object.values(values).filter(Boolean).map((song) => ({
        ...song,
        source: "云端上传",
        builtin: false,
      }));
      await loadSongs();
    });
  } catch (error) {
    console.warn(error);
    el.syncMode.textContent = "LOCAL MODE";
  }
}

function startPresence() {
  if (!state.nickname) state.nickname = makeGuestName();
  el.nickname.value = state.nickname;
  renderIdentity();
  announcePresence();
  setInterval(announcePresence, HEARTBEAT_MS);
}

async function announcePresence() {
  const user = {
    id: state.userId,
    name: sanitizeName(state.nickname),
    ip: state.ip,
    seenAt: Date.now(),
  };
  upsertUser(user);
  state.channel?.postMessage({ type: "presence", user });
  if (state.firebase) {
    const { dbMod, realtimeDb } = state.firebase;
    const userRef = dbMod.ref(realtimeDb, `presence/${state.userId}`);
    await dbMod.set(userRef, user);
    dbMod.onDisconnect(userRef).remove();
  }
}

function upsertUser(user) {
  if (!user?.id) return;
  state.users.set(user.id, user);
  const fresh = [...state.users.values()].filter((item) => Date.now() - item.seenAt < HEARTBEAT_MS * 3);
  renderUsers(fresh);
}

function renderUsers(users) {
  el.onlineCount.textContent = `${users.length} online`;
  el.userList.innerHTML = users.map((user) => `
    <div class="user-item">
      <div class="user-name">${escapeHtml(user.name || "匿名用户")}</div>
      <div class="user-ip">IP: ${escapeHtml(user.ip || "unknown")}</div>
    </div>
  `).join("");
}

async function sendChat(text) {
  const message = {
    id: crypto.randomUUID(),
    name: sanitizeName(state.nickname) || makeGuestName(),
    ip: state.ip,
    text: sanitizeText(text),
    createdAt: Date.now(),
  };
  await tx(STORES.chat, "readwrite", (store) => store.put(message));
  state.channel?.postMessage({ type: "chat" });
  if (state.firebase) {
    const { dbMod, realtimeDb } = state.firebase;
    await dbMod.set(dbMod.ref(realtimeDb, `chat/${message.id}`), message);
  }
  await refreshChat();
}

async function refreshChat() {
  const localMessages = await getAll(STORES.chat);
  await renderChat(localMessages);
}

async function renderChat(messages) {
  const now = Date.now();
  const fresh = messages
    .filter((message) => now - Number(message.createdAt) < CHAT_TTL_MS)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  el.chatLog.innerHTML = fresh.map((message) => `
    <div class="chat-item">
      <div>
        <span class="chat-name">${escapeHtml(message.name || "匿名用户")}</span>
        <span class="chat-time">${new Date(message.createdAt).toLocaleTimeString()} · ${escapeHtml(message.ip || "unknown")}</span>
      </div>
      <p class="chat-text">${escapeHtml(message.text || "")}</p>
    </div>
  `).join("");
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

async function cleanOldChat() {
  const messages = await getAll(STORES.chat);
  const old = messages.filter((message) => Date.now() - Number(message.createdAt) >= CHAT_TTL_MS);
  if (!old.length) return;
  await tx(STORES.chat, "readwrite", (store) => old.forEach((message) => store.delete(message.id)));
  if (state.firebase) {
    const { dbMod, realtimeDb } = state.firebase;
    old.forEach((message) => dbMod.remove(dbMod.ref(realtimeDb, `chat/${message.id}`)));
  }
  await refreshChat();
}

async function maybeUploadToFirebase(record) {
  if (!state.firebase) return;
  try {
    const { storageMod, storage } = state.firebase;
    const fileRef = storageMod.ref(storage, `songs/${record.id}-${record.title}`);
    await storageMod.uploadBytes(fileRef, record.blob, { contentType: record.type });
    const url = await storageMod.getDownloadURL(fileRef);
    const { dbMod, realtimeDb } = state.firebase;
    await dbMod.set(dbMod.ref(realtimeDb, `songs/${record.id}`), {
      id: record.id,
      title: record.title,
      type: record.type,
      size: record.size,
      createdAt: record.createdAt,
      url,
    });
  } catch (error) {
    console.warn(error);
    el.uploadStatus.textContent = "本地已保存，云端上传失败，请检查 Firebase Storage 规则。";
  }
}

function setupVisualizer() {
  const canvas = el.visualizer;
  const ctx = canvas.getContext("2d");
  const draw = () => {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#060817";
    ctx.fillRect(0, 0, width, height);
    const time = performance.now() / 700;
    for (let i = 0; i < 90; i += 1) {
      const x = (i / 89) * width;
      const wave = Math.sin(i * 0.35 + time) * 46 + Math.sin(i * 0.09 + time * 1.7) * 22;
      const y = height / 2 + wave;
      const bar = Math.abs(wave) + 12;
      ctx.strokeStyle = i % 3 === 0 ? "#ff2bd6" : "#00f5ff";
      ctx.globalAlpha = 0.45 + (i % 8) / 14;
      ctx.beginPath();
      ctx.moveTo(x, height / 2);
      ctx.lineTo(x, y - bar / 2);
      ctx.stroke();
      ctx.fillStyle = i % 2 ? "#25ff9f" : "#f7f052";
      ctx.fillRect(x - 1.5, y, 3, 3);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  };
  draw();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.songs)) db.createObjectStore(STORES.songs, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.chat)) db.createObjectStore(STORES.chat, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.user)) db.createObjectStore(STORES.user, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = action(store);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function loadNickname() {
  const records = await getAll(STORES.user);
  return records.find((item) => item.key === "nickname")?.value || makeGuestName();
}

async function saveNickname(value) {
  await tx(STORES.user, "readwrite", (store) => store.put({ key: "nickname", value }));
}

async function detectIp() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    const data = await response.json();
    return data.ip || "unknown";
  } catch {
    return "local";
  }
}

function renderIdentity() {
  el.identityLine.textContent = `${state.nickname} · ${state.ip}`;
}

function setupClock() {
  setInterval(() => {
    el.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, 1000);
}

function sanitizeName(value) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 24);
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function makeGuestName() {
  return `Runner-${Math.floor(1000 + Math.random() * 9000)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatBytes(value) {
  if (!value) return "generated";
  const units = ["B", "KB", "MB", "GB"];
  let number = value;
  let index = 0;
  while (number > 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${number.toFixed(index ? 1 : 0)} ${units[index]}`;
}
