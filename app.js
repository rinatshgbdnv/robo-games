// Отрисовка, эффекты, редакторы программ, прогресс и отправка наград боту.
import * as E from "./engine.js";

const tg = window.Telegram?.WebApp;
const $ = s => document.querySelector(s);
const GAME_INFO = {
  robot: { name: "Робо-Мейсон", ico: "🤖", tags: "алгоритм · циклы", grad: "linear-gradient(135deg,#34e7ff,#8b5cff)" },
  factory: { name: "Фабрика конфет", ico: "🍬", tags: "условия · И · ИЛИ", grad: "linear-gradient(135deg,#ff4fa3,#ffd23f)" },
  bugs: { name: "Охота на баги", ico: "🐞", tags: "отладка", grad: "linear-gradient(135deg,#7dff6a,#0d9bd8)" },
};

// ---------- прогресс: Telegram CloudStorage, запасной — localStorage ----------
let progress = { done: {}, claimed: [] }; // done: {"robot:1": звёзды}
const cloud = tg?.CloudStorage && tg.isVersionAtLeast?.("6.9") ? tg.CloudStorage : null;

function lsGet() { try { return JSON.parse(localStorage.getItem("p") || "null"); } catch { return null; } }
function lsSet(v) { try { localStorage.setItem("p", v); } catch { /* приватный режим */ } }

function merge(a, b) {
  const arr = x => Array.isArray(x?.claimed) ? x.claimed.filter(k => typeof k === "string") : [];
  const out = { done: {}, claimed: [...new Set([...arr(a), ...arr(b)])] };
  for (const src of [a, b]) {  // битое хранилище не должно ронять приложение
    const d = src?.done && typeof src.done === "object" ? src.done : {};
    for (const [k, v] of Object.entries(d)) if (Number.isFinite(v)) out.done[k] = Math.max(out.done[k] || 0, v);
  }
  return out;
}

function loadProgress() {
  return new Promise(res => {
    const local = lsGet();
    if (!cloud) return res(merge(local, null));
    const t = setTimeout(() => res(merge(local, null)), 1500);
    cloud.getItem("p", (err, v) => {
      clearTimeout(t);
      let remote = null;
      try { remote = !err && v ? JSON.parse(v) : null; } catch { /* битое — игнор */ }
      res(merge(local, remote));
    });
  });
}

// Перед записью в облако читаем его и сливаем: если при старте облако не успело ответить,
// неполная локальная копия не затрёт прогресс с другого устройства. Нет ответа облака — не пишем в него.
function saveProgress() {
  lsSet(JSON.stringify(progress));
  return new Promise(res => {
    if (!cloud) return res();
    const t = setTimeout(res, 1500);
    cloud.getItem("p", (err, v) => {
      if (err) { clearTimeout(t); return res(); }
      let remote = null;
      try { remote = v ? JSON.parse(v) : null; } catch { /* битое — перезапишем */ }
      progress = merge(progress, remote);
      const out = JSON.stringify(progress);
      lsSet(out);
      cloud.setItem("p", out, () => { clearTimeout(t); res(); });
    });
  });
}

const doneCount = g => Object.keys(progress.done).filter(k => k.startsWith(g + ":")).length;
const unclaimed = () => Object.keys(progress.done).filter(k => !progress.claimed.includes(k));

// ---------- звук ----------
const SFX_NAMES = ["click", "step", "bump", "fall", "pickup", "win", "conveyor", "drop_ok", "drop_bad", "reward"];
const sfx = {};
let muted = false;
try { muted = localStorage.getItem("mute") === "1"; } catch { /* нет хранилища */ }
for (const n of SFX_NAMES) { const a = new Audio(`sfx/${n}.mp3`); a.preload = "auto"; a.onerror = () => { sfx[n] = null; }; sfx[n] = a; }
const music = new Audio("sfx/music.mp3");
music.loop = true; music.volume = 0.22;
music.onerror = () => { music.dead = true; };

function play(n, vol = 0.8) {
  if (muted || !sfx[n]) return;
  const a = sfx[n].cloneNode();
  a.volume = vol;
  a.play().catch(() => {});
}
function startMusic() { if (!muted && !music.dead) music.play().catch(() => {}); }
function setMute(m) {
  muted = m;
  try { localStorage.setItem("mute", m ? "1" : "0"); } catch { /* нет хранилища */ }
  document.querySelectorAll("[data-mute]").forEach(b => { b.textContent = m ? "🔇" : "🔊"; });
  if (m) music.pause(); else startMusic();
}
document.addEventListener("pointerdown", startMusic, { once: true });
const haptic = (kind = "light") => {
  if (!tg?.isVersionAtLeast?.("6.1")) return;
  try {
    if (kind === "success" || kind === "error") tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch { /* старый клиент */ }
};

// ---------- экраны ----------
let view = 0; // номер захода на экран: запоздалый win() не откроется поверх другого
function show(id) {
  view++;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id));
  running = false; stopDemo(); tut = null;
  if (id === "home") renderHome();
  if (id === "levels") renderLevels();
  scrollTo(0, 0);
}
let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

let game = "robot", li = 0, level = null;

function renderHome() {
  $("#cards").innerHTML = "";
  for (const [g, info] of Object.entries(GAME_INFO)) {
    const total = E.GAMES[g].length, done = doneCount(g);
    const stars = Object.entries(progress.done).filter(([k]) => k.startsWith(g + ":")).reduce((s, [, v]) => s + v, 0);
    const el = document.createElement("div");
    el.className = "game-card";
    el.style.setProperty("--grad", info.grad);
    el.innerHTML = `<div class="ico">${info.ico}</div><div style="flex:1"><div class="name">${info.name}</div>
      <div class="tags">${info.tags} · ⭐ ${stars}/${total * 3}</div><div class="bar"><i style="width:${100 * done / total}%"></i></div></div>`;
    el.onclick = () => { play("click"); haptic(); game = g; show("levels"); };
    $("#cards").append(el);
  }
  const n = unclaimed().length, r = $("#reward");
  if (n) {
    r.innerHTML = `🎉 Новых побед: ${n}<br><button class="btn gold big pulse" id="claim" style="margin-top:10px">🎁 Забрать награды</button>
      <small>Игры закроются, а бот положит секунды в копилку 🎥</small>`;
    $("#claim").onclick = claim;
  } else {
    r.innerHTML = `🎥 За каждый новый уровень — секунды видео в копилку<small>Пройди уровень, и здесь появится кнопка «Забрать»</small>`;
    // Бот засчитывает повторы как 0, поэтому переотправить безопасно — на случай паузы или тихих часов.
    if (Object.keys(progress.done).length) {
      r.insertAdjacentHTML("beforeend", `<button class="btn ghost" id="claim" style="margin-top:10px">Награда не пришла? Отправить ещё раз</button>`);
      $("#claim").onclick = claim;
    }
  }
}

async function claim() {
  play("reward"); haptic("success");
  if (!tg?.sendData || tg.platform === "unknown") { // открыто не в Telegram
    toast("Открой игры кнопкой «🎮 Игры» в боте — тогда награда дойдёт"); return;
  }
  const done = Object.keys(progress.done);
  progress.claimed = done;
  await saveProgress();
  // ponytail: бот не перепроверяет решение — подделать данные можно только своим клиентом Telegram; потолок 72 с
  tg.sendData(JSON.stringify({ v: 1, done }));
}

function renderLevels() {
  const info = GAME_INFO[game], list = E.GAMES[game];
  $("#lv-title").textContent = `${info.ico} ${info.name}`;
  const grid = $("#lv-grid");
  grid.innerHTML = "";
  list.forEach((lv, i) => {
    const key = `${game}:${i + 1}`, stars = progress.done[key] || 0;
    const open = i === 0 || progress.done[`${game}:${i}`];
    const el = document.createElement("div");
    el.className = "lvl" + (open ? "" : " lock") + (open && !stars ? " next" : "");
    el.innerHTML = open ? `${i + 1}<small>${stars ? "⭐".repeat(stars) : "&nbsp;"}</small>` : "🔒";
    el.onclick = () => {
      if (!open) { toast("Сначала пройди предыдущий уровень 🔒"); haptic("error"); return; }
      play("click"); haptic(); startLevel(i);
    };
    grid.append(el);
  });
}

// ---------- холст и эффекты ----------
if (!CanvasRenderingContext2D.prototype.roundRect) { // старые Android WebView
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}
const cv = $("#stage"), ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1;
const parts = [];
let shake = 0, flash = null, running = false, lastT = 0;

function sizeCanvas(h) {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = cv.parentElement.clientWidth; H = h;
  cv.width = W * DPR; cv.height = H * DPR; cv.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function emit(x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = o.angle ?? Math.random() * Math.PI * 2, sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
    parts.push({
      x, y, vx: Math.cos(a) * sp + (o.vx || 0), vy: Math.sin(a) * sp + (o.vy || 0),
      g: o.g ?? 0.08, life: 1, decay: o.decay ?? (0.015 + Math.random() * 0.02),
      size: (o.size ?? 4) * (0.6 + Math.random() * 0.8), kind: o.kind || "spark",
      color: Array.isArray(o.color) ? o.color[i % o.color.length] : (o.color || "#fff"),
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, text: o.text,
    });
  }
}
const CONFETTI = ["#ff4fa3", "#34e7ff", "#ffd23f", "#7dff6a", "#8b5cff", "#ff8a3d"];
function confetti() {
  for (let i = 0; i < 140; i++) emit(Math.random() * W, -10, 1, { kind: "confetti", color: CONFETTI, speed: 2, g: 0.06, decay: 0.006, size: 7, vy: 2 });
  [0, 350, 700].forEach((d, k) => setTimeout(() => {
    const x = W * (0.25 + 0.25 * k), y = H * 0.35;
    emit(x, y, 50, { color: CONFETTI, speed: 5, g: 0.05, decay: 0.015, size: 3 });
    emit(x, y, 1, { kind: "ring", color: "#fff", speed: 0, g: 0, decay: 0.03, size: 10 });
  }, d));
}
function smoke(x, y) { emit(x, y, 14, { kind: "smoke", color: "#aab", speed: 1.2, g: -0.03, decay: 0.02, size: 10 }); }
function burst(x, y, color) {
  emit(x, y, 26, { color, speed: 4, g: 0.04, size: 3 });
  emit(x, y, 1, { kind: "ring", color, speed: 0, g: 0, decay: 0.04, size: 6 });
}
function floatText(x, y, text, color = "#fff") { emit(x, y, 1, { kind: "text", text, color, speed: 0, vy: -1.2, g: 0, decay: 0.018, size: 18 }); }

function drawParts() {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr; p.life -= p.decay;
    if (p.kind === "confetti") { p.vx *= 0.99; p.x += Math.sin(p.rot * 2) * 0.6; }
    if (p.life <= 0 || p.y > H + 40) { parts.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    if (p.kind === "spark") {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, 7); ctx.fill();
    } else if (p.kind === "confetti") {
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.rot * 3)) + 1);
    } else if (p.kind === "smoke") {
      ctx.fillStyle = p.color; ctx.globalAlpha *= 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - p.life), 0, 7); ctx.fill();
    } else if (p.kind === "ring") {
      ctx.strokeStyle = p.color; ctx.lineWidth = 4 * p.life; ctx.shadowColor = p.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size + (1 - p.life) * 70, 0, 7); ctx.stroke();
    } else if (p.kind === "text") {
      ctx.font = `900 ${p.size}px Nunito, sans-serif`; ctx.textAlign = "center";
      ctx.fillStyle = p.color; ctx.shadowColor = "#000"; ctx.shadowBlur = 6; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
}

function frame(t) {
  const dt = Math.min(50, t - lastT); lastT = t;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (shake > 0.3) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; } else shake = 0;
  if (level && $("#play").classList.contains("on")) (game === "factory" ? drawFactory : drawBoard)(t, dt);
  drawParts();
  ctx.restore();
  if (flash) {
    ctx.fillStyle = flash.color; ctx.globalAlpha = flash.a; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    flash.a *= 0.9; if (flash.a < 0.02) flash = null;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const anim = (ms, fn) => new Promise(res => {
  const t0 = performance.now();
  const tick = now => {
    if (!running) return res(); // запуск прерван — кадр не трогает уже новое поле
    const k = Math.min(1, (now - t0) / ms);
    fn(k);
    if (k < 1 && running) requestAnimationFrame(tick); else res();
  };
  requestAnimationFrame(tick);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = k => 1 - Math.pow(1 - k, 3);

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ---------- робот: поле ----------
let map = null, tile = 40, ox = 0, oy = 0, bot = null, picked = new Set();

function resetBoard() {
  map = E.parseMap(level.map);
  // по высоте — не больше ~42% экрана, чтобы программа и палитра влезали под полем без прокрутки
  tile = Math.min(64, Math.floor((cv.parentElement.clientWidth - 24) / map.w), Math.max(30, Math.floor(innerHeight * 0.42 / map.h)));
  sizeCanvas(Math.max(tile * map.h + 24, 150));
  ox = (W - tile * map.w) / 2; oy = (H - tile * map.h) / 2;
  bot = { x: map.start[0], y: map.start[1], dir: "R", sx: 1, sy: 1, rot: 0, alpha: 1, hop: 0 };
  picked = new Set();
}
const cx = x => ox + (x + 0.5) * tile, cy = y => oy + (y + 0.5) * tile;

function drawBoard(t) {
  const pad = 2;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const c = map.cells[y][x], px = ox + x * tile, py = oy + y * tile, s = tile - pad * 2;
    if (c === "#") {
      const g = ctx.createLinearGradient(px, py, px, py + tile);
      g.addColorStop(0, "#6b4bd6"); g.addColorStop(1, "#2d1677");
      ctx.fillStyle = g; rr(px + pad, py + pad, s, s, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.18)"; rr(px + pad + 4, py + pad + 3, s - 8, s * 0.3, 6); ctx.fill();
      continue;
    }
    const glow = 0.5 + 0.5 * Math.sin(t / 700 + x * 0.7 + y * 0.9);
    ctx.fillStyle = `rgba(52,231,255,${0.07 + glow * 0.06})`; rr(px + pad, py + pad, s, s, 10); ctx.fill();
    ctx.strokeStyle = `rgba(52,231,255,${0.25 + glow * 0.25})`; ctx.lineWidth = 1.5; ctx.stroke();
    if (c === "O") {
      const g = ctx.createRadialGradient(cx(x), cy(y), 2, cx(x), cy(y), s / 2);
      g.addColorStop(0, "#000"); g.addColorStop(0.7, "#14002e"); g.addColorStop(1, "rgba(139,92,255,.6)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx(x), cy(y), s / 2.2, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(cx(x), cy(y)); ctx.rotate(t / 600);
      ctx.strokeStyle = "rgba(200,150,255,.5)"; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, s / 3.2, k * 2.1, k * 2.1 + 1.2); ctx.stroke(); }
      ctx.restore();
    }
    if (c === "G") {
      const ready = map.bones.every(([bx, by]) => picked.has(`${bx},${by}`));
      ctx.save(); ctx.shadowColor = ready ? "#ffd23f" : "transparent"; ctx.shadowBlur = 20 + glow * 15;
      ctx.globalAlpha = ready ? 1 : 0.55;
      ctx.font = `${tile * 0.62}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🏠", cx(x), cy(y) + 2); ctx.restore();
    }
    if (c === "B" && !picked.has(`${x},${y}`)) {
      ctx.save(); ctx.shadowColor = "#fff6c0"; ctx.shadowBlur = 14;
      ctx.font = `${tile * 0.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🦴", cx(x), cy(y) + Math.sin(t / 300 + x) * 3); ctx.restore();
    }
  }
  if (running && Math.random() < 0.3) emit(cx(bot.x), cy(bot.y) + tile * 0.25, 1, { color: "#34e7ff", speed: 0.6, g: 0.02, size: 2.5 });
  drawBot(cx(bot.x), cy(bot.y) - bot.hop, tile * 0.36, t);
}

function drawBot(x, y, r, t) {
  ctx.save();
  ctx.globalAlpha = bot.alpha;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.ellipse(x, y + r * 1.05 + bot.hop, r * 0.85, r * 0.25, 0, 0, 7); ctx.fill();
  ctx.translate(x, y); ctx.rotate(bot.rot); ctx.scale(bot.sx, bot.sy);
  const flip = bot.dir === "L" ? -1 : 1;
  // уши летучей мыши — это французский бульдог
  ctx.fillStyle = "#5a6b8c";
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * r * 0.35, -r * 0.6); ctx.lineTo(s * r * 0.95, -r * 1.25); ctx.lineTo(s * r * 0.95, -r * 0.3); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#ff9ec7";
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * r * 0.5, -r * 0.6); ctx.lineTo(s * r * 0.85, -r * 1.05); ctx.lineTo(s * r * 0.85, -r * 0.5); ctx.closePath(); ctx.fill();
  }
  // антенна
  ctx.strokeStyle = "#cfd8ea"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, -r * 1.35); ctx.stroke();
  ctx.fillStyle = `hsl(${(t / 8) % 360},100%,65%)`; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(0, -r * 1.4, r * 0.14, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  // голова
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, "#eef3ff"); g.addColorStop(1, "#8fa3c7");
  ctx.fillStyle = g; rr(-r, -r * 0.95, r * 2, r * 1.9, r * 0.7); ctx.fill();
  // визор
  ctx.fillStyle = "#1a1f3d"; rr(-r * 0.75, -r * 0.5, r * 1.5, r * 0.65, r * 0.3); ctx.fill();
  const look = { U: [0, -0.08], D: [0, 0.08], L: [-0.12, 0], R: [0.12, 0] }[bot.dir];
  const blink = (t % 3200) < 120 ? 0.15 : 1;
  ctx.fillStyle = "#34e7ff"; ctx.shadowColor = "#34e7ff"; ctx.shadowBlur = 10;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(s * r * 0.35 + look[0] * r * flip, -r * 0.18 + look[1] * r, r * 0.14, r * 0.17 * blink, 0, 0, 7); ctx.fill();
  }
  ctx.shadowBlur = 0;
  // нос и щёки
  ctx.fillStyle = "#2b2b3a"; ctx.beginPath(); ctx.ellipse(0, r * 0.32, r * 0.2, r * 0.13, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(255,120,170,.6)";
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 0.62, r * 0.38, r * 0.13, 0, 7); ctx.fill(); }
  ctx.restore();
}

// ---------- робот: редактор программы ----------
let program = [], stepper = null;
const keyOf = p => p.join(".");

function renderProg() {
  const box = $("#prog");
  if (!box) return;
  box.innerHTML = "";
  const dnd = game !== "bugs";
  const build = (list, prefix, el) => {
    if (!list.length) el.insertAdjacentHTML("beforeend", `<span class="empty">${prefix.length ? "сюда" : "Тяни стрелки сюда 👇"}</span>`);
    list.forEach((b, i) => {
      const path = [...prefix, i];
      if (b.op === "loop") {
        const lp = document.createElement("div");
        lp.className = "loop";
        lp.dataset.path = keyOf(path);
        const edited = game === "bugs" && origAt(path)?.n !== b.n;
        lp.innerHTML = `<div class="loop-h"><span class="ic">🔁</span><span class="pm">−</span><span class="n${edited ? " edited" : ""}">×${b.n}</span><span class="pm" data-d="1">+</span>${dnd ? '<span class="x">✖</span>' : ""}</div><div class="body" data-list="${keyOf(path)}"></div>`;
        const [minus, plus] = lp.querySelectorAll(".pm"), lo = game === "bugs" ? 1 : 2;
        const setN = (d, e) => { e.stopPropagation(); if (busy()) return; const n = Math.min(9, Math.max(lo, b.n + d)); if (n === b.n) return; b.n = n; play("click"); haptic(); edited_(); };
        minus.onclick = e => setN(-1, e); plus.onclick = e => setN(1, e); lp.querySelector(".n").onclick = e => setN(1, e);
        if (dnd) {
          lp.querySelector(".loop-h").onpointerdown = e => { if (!e.target.closest(".pm,.n,.x")) dragStart(e, { path }); };
          lp.querySelector(".x").onclick = e => { e.stopPropagation(); if (busy()) return; list.splice(i, 1); play("click"); edited_(); };
        }
        build(b.body, path, lp.querySelector(".body"));
        el.append(lp);
      } else {
        const ch = document.createElement("span");
        const edited = game === "bugs" && origAt(path)?.op !== b.op;
        ch.className = "chip" + (edited ? " edited" : "");
        ch.dataset.path = keyOf(path);
        ch.textContent = E.ARROW[b.op];
        if (dnd) ch.onpointerdown = e => dragStart(e, { path }); // тап по блоку ничего не стирает
        else ch.onclick = () => {
          if (busy()) return;
          b.op = E.CYCLE[(E.CYCLE.indexOf(b.op) + 1) % 4];
          play("click"); haptic(); edited_();
        };
        el.append(ch);
      }
    });
  };
  build(program, [], box);
  const count = $("#count");
  if (count) count.textContent = game === "bugs" ? `правок: ${E.countEdits(level.program, program)}`
    : `блоков: ${E.countBlocks(program)}${level.max < 99 ? ` / ${level.max}` : ""}`;
}

function origAt(path) {
  let l = level.program, b = null;
  for (const i of path) { b = l[i]; l = b?.body || []; }
  return b;
}

function edited_() {
  stepper = null; resetBoard(); setMsg(""); renderProg();
  $(".palette")?.scrollIntoView({ block: "nearest" }); // программа выросла — палитра не уходит под край (smooth в WebView срабатывает не всегда)
}

function full() {
  if (E.countBlocks(program) < level.max) return false;
  toast(`Больше ${level.max} блоков нельзя — попробуй цикл 🔁`); haptic("error"); play("drop_bad", 0.5);
  return true;
}

// тап по палитре — блок в конец программы
function addBlock(op) {
  if (busy() || full()) return;
  program.push(E.newBlock(op));
  play("click"); haptic(); edited_();
}

function robotEditor() {
  const palette = game === "bugs" ? "" : `<div class="palette">
    ${["U", "D", "L", "R"].map(d => `<button class="btn" data-add="${d}">${E.ARROW[d]}</button>`).join("")}
    ${li >= 4 ? '<button class="btn" data-add="loop" style="background:linear-gradient(180deg,#ff7ac0,#d61f79);box-shadow:0 5px 0 #8a0f4c">🔁</button>' : ""}
  </div>`;
  $("#editor").innerHTML = `<div class="panel"><div class="panel-h"><span>${game === "bugs" ? "🐞 Программа с ошибкой — тапай, чтобы чинить" : "📜 Твоя программа"}</span><span id="count"></span></div>
    <div class="prog" id="prog" data-list=""></div>${palette}</div>`;
  document.querySelectorAll("[data-add]").forEach(b => {
    b.onclick = () => { if (dragged) { dragged = false; return; } addBlock(b.dataset.add); };
    b.onpointerdown = e => dragStart(e, { op: b.dataset.add });
  });
  renderProg();
}

// ---------- перетаскивание: куда отпустишь, туда и встанет ----------
let drag = null, dragged = false; // dragged: после перетаскивания браузер шлёт click по кнопке палитры — его глотаем
const ghost = $("#ghost"), slotEl = $("#slot");
const pathOf = s => s ? s.split(".").map(Number) : [];
const kidsOf = el => [...el.children].filter(c => c.dataset.path !== undefined);
const within = (el, x, y, pad = 0) => {
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
};
const labelOf = src => src.op ? (src.op === "loop" ? "🔁" : E.ARROW[src.op])
  : (b => b.op === "loop" ? `🔁 ×${b.n}` : E.ARROW[b.op])(E.listAt(program, src.path.slice(0, -1))[src.path.at(-1)]);

function dragStart(e, src) {
  dragged = false;
  if (busy() || e.button > 0) return;
  drag = { src, x0: e.clientX, y0: e.clientY, on: false, el: e.currentTarget, id: e.pointerId };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* старый WebView */ }
}

// Место под пальцем: {trash} над палитрой, {bad} внутри самого переносимого цикла, {el, list, index} в программе.
function dropAt(x, y, src) {
  const pal = $(".palette");
  if (pal && within(pal, x, y)) return src.path ? { trash: true } : null;
  const panel = $("#editor .panel");
  if (!panel || !within(panel, x, y)) return null;
  let el = $("#prog");
  for (const b of document.querySelectorAll("#prog .body"))
    if (within(b, x, y, 6) && pathOf(b.dataset.list).length > pathOf(el.dataset.list).length) el = b;
  const list = pathOf(el.dataset.list);
  if (src.path && E.isPrefix(src.path, list)) return { bad: true };
  const kids = kidsOf(el);
  let index = kids.findIndex(k => { const r = k.getBoundingClientRect(); return y < r.top || (y <= r.bottom && x < r.left + r.width / 2); });
  if (index < 0) index = kids.length;
  return { el, list, index };
}

function slotRect(el, index) {
  const kids = kidsOf(el), r = (kids[index] || kids.at(-1) || el).getBoundingClientRect();
  const x = kids[index] ? r.left - 4 : kids.length ? r.right + 4 : r.left + 8;
  return { x, y: r.top + (kids.length ? 0 : 4), h: Math.min(r.height, 44) - (kids.length ? 0 : 8) };
}

function showSlot(d) {
  document.querySelectorAll(".drop").forEach(e => e.classList.remove("drop"));
  ghost.classList.toggle("bad", !!d?.bad);
  slotEl.classList.toggle("on", !!d?.el);
  if (!d?.el) return;
  d.el.classList.add("drop");
  const s = slotRect(d.el, d.index);
  Object.assign(slotEl.style, { left: s.x - 3 + "px", top: s.y + "px", height: s.h + "px" });
}

function dragHide() {
  ghost.classList.remove("on", "bad"); showSlot(null);
  $("#prog")?.classList.remove("dragmode");
  $(".palette")?.classList.remove("trash");
  document.querySelectorAll(".dragging").forEach(e => e.classList.remove("dragging"));
}

document.addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; // меньше — это тап
    drag.on = true; dragged = true;
    $("#prog").classList.add("dragmode"); // у тел циклов открывается место справа — чтобы класть после последнего блока
    ghost.textContent = labelOf(drag.src); ghost.classList.add("on");
    (drag.src.path ? drag.el.closest(".chip,.loop") : drag.el).classList.add("dragging");
    if (drag.src.path) $(".palette")?.classList.add("trash");
    haptic();
  }
  Object.assign(ghost.style, { left: e.clientX + "px", top: e.clientY + "px" });
  drag.drop = dropAt(e.clientX, e.clientY, drag.src);
  showSlot(drag.drop);
});
const dragEnd = ok => e => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (!d.on) return;
  d.drop = dropAt(e.clientX, e.clientY, d.src); // цель по точке отпускания, пока геометрия ещё в режиме перетаскивания
  dragHide();
  if (ok && d.drop && !busy()) applyDrop(d.src, d.drop);
};
document.addEventListener("pointerup", dragEnd(true));
document.addEventListener("pointercancel", dragEnd(false));

function applyDrop(src, d) {
  if (d.bad) { toast("Цикл нельзя положить в самого себя 🙃"); haptic("error"); return; }
  if (d.trash) { E.removeBlock(program, src.path); play("drop_bad", 0.4); haptic("medium"); edited_(); return; }
  if (src.op) { if (full()) return; E.insertBlock(program, d.list, d.index, E.newBlock(src.op)); }
  else E.moveBlock(program, src.path, d.list, d.index);
  play("click"); haptic(); edited_();
}

function mark(path, cls) {
  document.querySelectorAll(".chip.active,.loop.active").forEach(e => e.classList.remove("active"));
  if (!path) return;
  for (let k = 1; k < path.length; k++) document.querySelector(`.loop[data-path="${keyOf(path.slice(0, k))}"]`)?.classList.add("active");
  document.querySelector(`.chip[data-path="${keyOf(path)}"]`)?.classList.add(cls);
}

async function playEvent(ev) {
  if (ev.t === "move") {
    const fx = bot.x, fy = bot.y;
    bot.dir = ev.dir; play("step", 0.5);
    await anim(240, k => {
      const e = ease(k);
      bot.x = fx + (ev.x - fx) * e; bot.y = fy + (ev.y - fy) * e;
      bot.hop = Math.sin(k * Math.PI) * tile * 0.18; bot.sx = 1 + Math.sin(k * Math.PI) * 0.08; bot.sy = 1 / bot.sx;
    });
    bot.hop = 0; bot.sx = bot.sy = 1;
  } else if (ev.t === "pick") {
    picked.add(`${ev.x},${ev.y}`); play("pickup"); haptic("medium");
    burst(cx(ev.x), cy(ev.y), "#fff6a0"); floatText(cx(ev.x), cy(ev.y) - 10, "+🦴");
  } else if (ev.t === "bump") {
    const [dx, dy] = E.DIRS[ev.dir], fx = bot.x, fy = bot.y;
    bot.dir = ev.dir;
    await anim(120, k => { bot.x = fx + dx * 0.3 * k; bot.y = fy + dy * 0.3 * k; });
    play("bump"); haptic("error"); shake = 14; flash = { color: "#ff4d6d", a: 0.35 };
    smoke(cx(bot.x + dx * 0.2), cy(bot.y + dy * 0.2)); emit(cx(bot.x), cy(bot.y), 12, { color: "#ffd23f", speed: 3, size: 2 });
    await anim(160, k => { bot.x = fx + dx * 0.3 * (1 - k); bot.y = fy + dy * 0.3 * (1 - k); });
  } else if (ev.t === "fall") {
    play("fall"); haptic("error"); flash = { color: "#8b5cff", a: 0.3 };
    await anim(600, k => { bot.rot = k * 8; bot.sx = bot.sy = 1 - k * 0.9; bot.alpha = 1 - k; });
    emit(cx(ev.x), cy(ev.y), 18, { color: "#c8a0ff", speed: 2, g: -0.02, size: 3 });
  } else if (ev.t === "goal") {
    await anim(400, k => { bot.hop = Math.sin(k * Math.PI) * tile * 0.6; bot.rot = k * Math.PI * 2; });
    bot.rot = 0; bot.hop = 0;
  }
}

const FAIL = {
  bump: "Бум! Мейсон врезался в стену 💥 Какая команда виновата?",
  fall: "Ой, яма! 🕳 Найди шаг, на котором он падает.",
  notgoal: "Команды кончились, а до будки не дошёл 🤔",
  bones: "Будка рядом, но не все косточки собраны 🦴",
  toolong: "Слишком много шагов — программа ходит по кругу 🔁",
  wrong: "Конфета попала не в ту корзину 🙈",
};

async function runRobotProg(stepMode) {
  if (!stepMode || !stepper) {
    resetBoard(); setMsg("");
    $(".stage-wrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
    stepper = { res: E.runRobot(level, program), i: 0 };
    if (!program.length) { toast("Сначала собери программу 👇"); stepper = null; return; }
  }
  running = true; lock(true);
  const { res } = stepper;
  const until = stepMode ? Math.min(res.trace.length, nextStop(res.trace, stepper.i)) : res.trace.length;
  while (stepper && stepper.i < until && running) {
    const ev = res.trace[stepper.i++];
    mark(ev.path, ev.t === "bump" || ev.t === "fall" ? "bad" : "active");
    await playEvent(ev);
  }
  lock(false);
  if (!running || !stepper) return;
  if (stepper.i >= res.trace.length) {
    if (res.win) { const s = game === "bugs" ? E.bugStars(level, program) : E.robotStars(level, program); tut ? tutWin() : win(s); }
    else {
      setMsg(FAIL[res.reason], "bad"); haptic("error");
      if (res.reason === "notgoal" || res.reason === "bones") play("drop_bad", 0.6);
      const last = res.trace[res.trace.length - 1];
      if (last) mark(last.path, "bad");
    }
    stepper = null; running = false;
  } else running = false;
}
// шаг = один блок-команда: move/bump/fall вместе с pick/goal, которые идут сразу за ним
function nextStop(trace, i) {
  let j = i + 1;
  while (j < trace.length && (trace[j].t === "pick" || trace[j].t === "goal" || trace[j].t === "fall")) j++;
  return j;
}

// ---------- фабрика ----------
const CANDY_COL = { r: "#ff4d6d", b: "#4d8dff", g: "#3ddc84", y: "#ffd23f" };
const VAL_LABEL = {
  c: { r: "🔴 красная", b: "🔵 синяя", g: "🟢 зелёная", y: "🟡 жёлтая" },
  s: { c: "● круглая", s: "■ квадратная", t: "★ звёздочка", h: "♥ сердечко" },
  w: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, String(n)])),
};
let rules = null, fstate = null;

function resetFactory() {
  sizeCanvas(330);
  fstate = { queue: level.items.map(E.parseCandy), cur: null, inBin: {}, belt: 0, fired: null };
  for (const b of Object.keys(level.bins)) fstate.inBin[b] = [];
}

function drawCandy(x, y, r, c, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = CANDY_COL[c.c]; ctx.shadowColor = CANDY_COL[c.c]; ctx.shadowBlur = 12;
  ctx.beginPath();
  if (c.s === "c") ctx.arc(0, 0, r, 0, 7);
  else if (c.s === "s") ctx.roundRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8, r * 0.35);
  else if (c.s === "t") for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r * 1.1; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
  else { ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.6, -r * 1.3, 0, -r * 0.45); ctx.bezierCurveTo(r * 0.6, -r * 1.3, r * 1.6, -r * 0.2, 0, r * 0.9); }
  ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.3, r * 0.17, -0.6, 0, 7); ctx.fill();
  if (level.tools.attrs.includes("w")) {
    ctx.rotate(-rot); ctx.font = `900 ${r * 0.85}px Nunito, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(c.w, 0, r * 0.08); ctx.fillStyle = "#fff"; ctx.fillText(c.w, 0, r * 0.08);
  }
  ctx.restore();
}

function binRects() {
  const keys = Object.keys(level.bins), n = keys.length, gap = 10, bw = (W - gap * (n + 1)) / n;
  return keys.map((k, i) => ({ k, x: gap + i * (bw + gap), y: 190, w: bw, h: 128 }));
}

function wrap(text, x, y, maxW, lh) {
  const words = text.split(" "); let line = "", yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function drawFactory(t, dt) {
  const beltY = 70, beltX2 = W - 60;
  if (running) fstate.belt += dt * 0.08;
  // лента
  ctx.save(); rr(10, beltY - 22, beltX2 - 10, 44, 22); ctx.fillStyle = "#1c1238"; ctx.fill(); ctx.clip();
  ctx.strokeStyle = "rgba(139,92,255,.5)"; ctx.lineWidth = 8;
  for (let x = -40 + (fstate.belt % 30); x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, beltY + 22); ctx.lineTo(x + 20, beltY - 22); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = "#8b5cff"; ctx.lineWidth = 2; rr(10, beltY - 22, beltX2 - 10, 44, 22); ctx.stroke();
  // сортировщик
  const glow = fstate.fired !== null ? 1 : 0.4 + 0.2 * Math.sin(t / 300);
  ctx.save(); ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = 25 * glow;
  ctx.fillStyle = `rgba(255,210,63,${0.25 + glow * 0.4})`;
  ctx.beginPath(); ctx.moveTo(beltX2 - 10, beltY - 36); ctx.lineTo(W - 8, beltY - 36); ctx.lineTo(W - 22, beltY + 40); ctx.lineTo(beltX2 + 4, beltY + 40); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.font = "900 13px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
  ctx.fillText("🤖", W - 33, beltY + 5);
  if (fstate.fired !== null) ctx.fillText(fstate.fired < 0 ? "ИНАЧЕ" : `правило ${fstate.fired + 1}`, W - 40, beltY - 44);
  // очередь
  fstate.queue.forEach((c, i) => { const x = beltX2 - 45 - i * 42 + (fstate.shift || 0); if (x > 0) drawCandy(x, beltY, 14, c); });
  // корзины
  for (const b of binRects()) {
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, "rgba(255,255,255,.16)"); g.addColorStop(1, "rgba(255,255,255,.04)");
    ctx.fillStyle = g; rr(b.x, b.y, b.w, b.h, 16); ctx.fill();
    ctx.strokeStyle = b.hl ? b.hl : "rgba(255,255,255,.25)"; ctx.lineWidth = b.hl ? 3 : 1.5; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "800 13px Nunito, sans-serif"; ctx.textAlign = "center";
    wrap(level.bins[b.k], b.x + b.w / 2, b.y + 20, b.w - 12, 15);
    fstate.inBin[b.k].forEach((c, i) => drawCandy(b.x + 18 + (i % 4) * ((b.w - 36) / 3), b.y + b.h - 18 - Math.floor(i / 4) * 24, 10, c));
  }
  if (fstate.cur) drawCandy(fstate.cur.x, fstate.cur.y, 14, fstate.cur.c, fstate.cur.rot);
}

async function runFactoryProg(stepMode) {
  if (!stepMode || !stepper) {
    resetFactory(); setMsg("");
    stepper = { res: E.runFactory(level, { rules, else: rules.else }), i: 0 };
  }
  running = true; lock(true); play("conveyor", 0.35);
  const { res } = stepper, beltY = 70, beltX2 = W - 60;
  const until = stepMode ? stepper.i + 1 : res.trace.length;
  while (stepper && stepper.i < until && running) {
    const tr = res.trace[stepper.i++];
    fstate.queue.shift();
    fstate.cur = { c: tr.candy, x: beltX2 - 45, y: beltY, rot: 0 };
    await anim(380, k => { fstate.cur.x = beltX2 - 45 + 70 * ease(k); fstate.shift = 42 * (1 - k); });
    fstate.shift = 0; fstate.fired = tr.rule;
    markRule(tr.rule, "active");
    const b = binRects().find(r => r.k === tr.bin), sx = fstate.cur.x, sy = fstate.cur.y, tx = b.x + b.w / 2, ty = b.y + b.h - 30;
    await anim(520, k => { fstate.cur.x = sx + (tx - sx) * k; fstate.cur.y = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 60; fstate.cur.rot = k * 6; });
    fstate.cur = null; fstate.fired = null; fstate.inBin[tr.bin].push(tr.candy);
    if (tr.ok) {
      play("drop_ok", 0.6); haptic("light"); burst(tx, ty, CANDY_COL[tr.candy.c]); b.hl = null;
    } else {
      play("drop_bad"); haptic("error"); shake = 12; flash = { color: "#ff4d6d", a: 0.3 }; smoke(tx, ty);
      floatText(tx, ty - 30, "✖", "#ff4d6d"); markRule(tr.rule, "bad");
      const c = tr.candy, want = level.bins[tr.want];
      setMsg(`${FAIL.wrong} ${VAL_LABEL.c[c.c].split(" ")[0]} ${VAL_LABEL.s[c.s]}${level.tools.attrs.includes("w") ? ` (вес ${c.w})` : ""} должна ехать в «${want}»`, "bad");
      stepper = null; running = false; lock(false); return;
    }
  }
  lock(false);
  if (!running || !stepper) return;
  if (stepper.i >= res.trace.length) { stepper = null; win(E.factoryStars(level, rules)); }
  running = false;
}

function markRule(i, cls) {
  document.querySelectorAll(".rule").forEach(e => e.classList.remove("active", "bad"));
  if (i === undefined) return;
  document.querySelector(`.rule[data-i="${i}"]`)?.classList.add(cls);
}

function atomHtml(a, path) {
  const T = level.tools;
  const cmps = a.k === "w" ? T.cmps : T.cmps.filter(c => c === "=" || c === "≠");
  return `<select data-a="${path}" data-f="k">${T.attrs.map(k => `<option value="${k}"${k === a.k ? " selected" : ""}>${E.ATTRS[k]}</option>`).join("")}</select>
    <select data-a="${path}" data-f="cmp">${cmps.map(c => `<option${c === a.cmp ? " selected" : ""}>${c}</option>`).join("")}</select>
    <select data-a="${path}" data-f="v">${Object.entries(VAL_LABEL[a.k]).map(([v, l]) => `<option value="${v}"${String(a.v) === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
}
const binOpts = sel => Object.entries(level.bins).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
const firstVal = k => k === "w" ? 5 : Object.keys(VAL_LABEL[k])[0];
const newAtom = () => ({ k: level.tools.attrs[0], cmp: "=", v: firstVal(level.tools.attrs[0]) });

function factoryEditor() {
  const T = level.tools;
  const html = rules.map((r, i) => {
    const cond = r.cond.op ? r.cond : null;
    const opSel = T.ops.length ? `<select data-op="${i}"><option value="">—</option>${T.ops.map(o => `<option${cond?.op === o ? " selected" : ""}>${o}</option>`).join("")}</select>` : "";
    return `<div class="rule" data-i="${i}"><span class="kw">ЕСЛИ</span> ${atomHtml(cond ? cond.a : r.cond, `${i}.a`)} ${opSel}
      ${cond ? atomHtml(cond.b, `${i}.b`) : ""} <span class="kw">→</span> <select data-bin="${i}">${binOpts(r.bin)}</select>
      <button class="x" data-del="${i}">✖</button></div>`;
  }).join("");
  $("#editor").innerHTML = `<div class="panel"><div class="panel-h"><span>📜 Правила сортировщика</span><span>правил: ${rules.length} / ${T.maxRules}</span></div>
    ${html}
    ${rules.length < T.maxRules ? '<button class="btn ghost" id="add-rule" style="width:100%;margin-bottom:8px">➕ Правило ЕСЛИ</button>' : ""}
    <div class="rule" data-i="-1"><span class="kw else">ИНАЧЕ</span> <span class="kw">→</span> <select data-else>${binOpts(rules.else)}</select></div></div>`;
  const atomOf = path => { const [i, side] = path.split("."); const c = rules[+i].cond; return c.op ? c[side] : c; };
  document.querySelectorAll("[data-a]").forEach(s => s.onchange = () => {
    const a = atomOf(s.dataset.a), f = s.dataset.f;
    if (f === "k") { a.k = s.value; a.v = firstVal(a.k); if (a.k !== "w" && a.cmp !== "=" && a.cmp !== "≠") a.cmp = "="; }
    else if (f === "v") a.v = a.k === "w" ? Number(s.value) : s.value;
    else a.cmp = s.value;
    fEdited();
  });
  document.querySelectorAll("[data-op]").forEach(s => s.onchange = () => {
    const r = rules[+s.dataset.op], base = r.cond.op ? r.cond.a : r.cond;
    r.cond = s.value ? { a: base, op: s.value, b: r.cond.op ? r.cond.b : newAtom() } : base;
    fEdited();
  });
  document.querySelectorAll("[data-bin]").forEach(s => s.onchange = () => { rules[+s.dataset.bin].bin = s.value; fEdited(false); });
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { if (busy()) return; rules.splice(+b.dataset.del, 1); fEdited(); });
  $("[data-else]").onchange = e => { rules.else = e.target.value; fEdited(false); };
  $("#add-rule")?.addEventListener("click", () => { if (busy()) return; rules.push({ cond: newAtom(), bin: Object.keys(level.bins).at(-1) /* как ИНАЧЕ: не решает за неё */ }); fEdited(); });
}
function fEdited(rerender = true) { play("click", 0.5); haptic(); stepper = null; resetFactory(); setMsg(""); if (rerender) factoryEditor(); }

// ---------- общий ход уровня ----------
function setMsg(t, cls = "") { const m = $("#msg"); m.textContent = t; m.className = "msg " + cls; }
const busy = () => running || !!demo;
function lock(on) {
  ["#b-run", "#b-step", "#b-reset"].forEach(s => { $(s).disabled = on || !!demo; });
  document.querySelectorAll("#editor select").forEach(s => { s.disabled = on; });
}

function startLevel(i, noTut) {
  if (game === "robot" && !noTut && E.TUTORIALS[i] && !tutDone.has(i)) return startTut(i);
  li = i; level = E.GAMES[game][i]; stepper = null; running = false;
  $("#pl-title").textContent = `${GAME_INFO[game].ico} ${i + 1}. ${level.title}`;
  $("#hint").textContent = "💡 " + level.hint;
  $("#hint").classList.remove("hide"); $("#tut").classList.add("hide");
  $("#b-help").classList.toggle("hide", game !== "robot");
  setMsg("");
  show("play");
  if (game === "factory") {
    rules = []; rules.else = Object.keys(level.bins).at(-1);
    resetFactory(); factoryEditor();
  } else {
    program = game === "bugs" ? E.clone(level.program) : [];
    resetBoard(); robotEditor();
  }
}

// ---------- обучение: демо пальцем, потом мини-задача «сама» ----------
let tut = null, demo = null; // demo — метка идущего демо: сменилась — демо прерывается
let tutDone = new Set();
try { tutDone = new Set(JSON.parse(localStorage.getItem("tut") || "[]")); } catch { /* нет хранилища */ }
const F = $("#finger");
const STOP = {};
const pause = async ms => { const d = demo; await sleep(ms); if (!d || d !== demo) throw STOP; };
const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

function markTut(i) { tutDone.add(i); try { localStorage.setItem("tut", JSON.stringify([...tutDone])); } catch { /* нет хранилища */ } }

function plate(text, btns) {
  $("#tut-t").textContent = text;
  const box = $("#tut-b");
  box.innerHTML = "";
  for (const [label, cls, fn] of btns) {
    const b = document.createElement("button");
    b.className = "btn " + cls; b.textContent = label;
    b.onclick = () => { play("click"); fn(); };
    box.append(b);
  }
}

function stopDemo() {
  demo = null;
  F.classList.remove("on", "press"); F.querySelector(".carry").textContent = "";
  dragHide(); lock(false); // демо держало кнопки выключенными
}

function startTut(i) {
  li = i; show("play");
  tut = { i, T: E.TUTORIALS[i] };
  $("#pl-title").textContent = `🎓 Учимся: ${tut.T.title}`;
  $("#hint").classList.add("hide"); $("#tut").classList.remove("hide"); $("#b-help").classList.add("hide");
  runDemo();
}

async function fingerTo([x, y], ms = 700) {
  F.style.transitionDuration = ms + "ms";
  F.style.left = x + "px"; F.style.top = y + "px";
  await pause(ms + 60);
}
async function press() { F.classList.add("press"); play("click", 0.5); await pause(200); F.classList.remove("press"); await pause(150); }

async function fingerDo(s) {
  const at = p => document.querySelector(`.chip[data-path="${keyOf(p)}"], .loop[data-path="${keyOf(p)}"] > .loop-h`);
  const src = s.add || s.tap ? $(`[data-add="${s.add || s.tap}"]`)
    : s.plus ? document.querySelector(`.loop[data-path="${keyOf(s.plus)}"] > .loop-h > .pm[data-d="1"]`)
    : at(s.move || s.trash);
  await fingerTo(center(src)); await press();
  if (!(s.add || s.move || s.trash)) return;
  F.querySelector(".carry").textContent = labelOf(s.add ? { op: s.add } : { path: s.move || s.trash });
  if (s.trash) { $(".palette").classList.add("trash"); await fingerTo(center($(".palette")), 900); }
  else {
    $("#prog").classList.add("dragmode");
    const el = document.querySelector(`[data-list="${keyOf(s.to[0])}"]`), r = slotRect(el, s.to[1]);
    showSlot({ el, index: s.to[1] });
    await fingerTo([r.x, r.y + r.h / 2], 900);
  }
  F.querySelector(".carry").textContent = ""; dragHide();
}

async function runDemo() {
  const t = tut;
  stopDemo(); demo = {};
  level = { map: t.T.demo, max: 99, best: 99 }; program = []; stepper = null; running = false;
  setMsg(""); mark(null); resetBoard(); robotEditor(); lock(false);
  plate("Смотри, как это делается 👀", [["Пропустить", "ghost", startTry]]);
  try {
    F.style.transitionDuration = "0ms";
    [F.style.left, F.style.top] = center($("#editor")).map(v => v + "px");
    F.classList.add("on");
    await pause(1200);
    for (const s of t.T.steps) {
      if (s.say) { $("#tut-t").textContent = s.say; await pause(1700); }
      if (s.run) {
        await fingerTo(center($("#b-run"))); await press(); F.classList.remove("on");
        await runRobotProg(false); await pause(1200);
        continue;
      }
      await fingerDo(s);
      E.applyStep(program, s); play("click"); haptic(); edited_();
      await pause(500);
    }
  } catch (e) { if (e !== STOP) throw e; return; }
  startTry();
}

function startTry() {
  const t = tut;
  stopDemo();
  if (!t) return;
  level = { map: t.T.try.map, max: t.T.try.max, best: 99 }; program = []; stepper = null; running = false;
  setMsg(""); mark(null); resetBoard(); robotEditor(); lock(false);
  plate(`Твоя очередь! ${t.T.try.say}`, [["👀 Показать ещё раз", "ghost", runDemo], ["Пропустить", "ghost", () => { markTut(t.i); startLevel(t.i, true); }]]);
}

function tutWin() {
  if (demo) return; // в демо робот дошёл сам — дальше ведёт runDemo
  const i = tut.i;
  markTut(i);
  play("win"); haptic("success"); confetti(); setMsg("Получилось! 🎉", "good");
  plate("Здорово! Теперь настоящий уровень 💪", [["Поехали ➡️", "gold", () => startLevel(i, true)]]);
}

$("#b-help").onclick = () => {
  play("click");
  startTut(Math.max(...Object.keys(E.TUTORIALS).map(Number).filter(k => k <= li)));
};

async function win(stars) {
  const key = `${game}:${li + 1}`, first = !progress.done[key];
  progress.done[key] = Math.max(progress.done[key] || 0, stars);
  saveProgress();
  play("win"); haptic("success"); confetti(); setMsg("Получилось! 🎉", "good");
  const v = view;
  await sleep(700);
  if (v !== view) return;
  $("#w-title").textContent = ["", "Получилось!", "Здорово!", "Идеально!"][stars];
  $("#w-stars").innerHTML = [1, 2, 3].map(k => `<span class="${k <= stars ? "" : "off"}" style="animation-delay:${k * 0.18}s">⭐</span>`).join("");
  const tip = stars < 3 ? (game === "bugs" ? "Можно починить меньшим числом правок 😉" : game === "factory" ? "А можно обойтись меньшим числом правил?" : "А можно короче? Попробуй с меньшим числом блоков 😉") : "";
  $("#w-text").innerHTML = (first ? "Новая награда — забери её на главной 🎁<br>" : "") + tip;
  $("#w-next").textContent = li + 1 < E.GAMES[game].length ? "Дальше ➡️" : "К играм 🏠";
  $("#win").classList.add("on");
}

$("#w-next").onclick = () => {
  $("#win").classList.remove("on"); play("click");
  if (li + 1 < E.GAMES[game].length) startLevel(li + 1); else show("home");
};
$("#w-again").onclick = () => { $("#win").classList.remove("on"); play("click"); startLevel(li); };
$("#b-run").onclick = () => { play("click"); haptic(); (game === "factory" ? runFactoryProg : runRobotProg)(false); };
$("#b-step").onclick = () => { play("click"); haptic(); (game === "factory" ? runFactoryProg : runRobotProg)(true); };
$("#b-reset").onclick = () => {
  play("click"); stepper = null; setMsg(""); mark(null); markRule();
  if (game === "factory") resetFactory();
  else { if (game === "bugs") { program = E.clone(level.program); renderProg(); } resetBoard(); }
};
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => { play("click"); show(b.dataset.back); });
document.querySelectorAll("[data-mute]").forEach(b => b.onclick = () => setMute(!muted));
window.addEventListener("resize", () => {
  if (!level || !$("#play").classList.contains("on") || running) return;
  stepper = null; setMsg(""); mark(null); markRule(); /* поле сброшено — пошаговый запуск начинаем заново */
  (game === "factory" ? resetFactory : resetBoard)();
});

// ---------- старт ----------
if (tg) {
  tg.ready(); tg.expand();
  if (tg.isVersionAtLeast?.("7.7")) tg.disableVerticalSwipes?.(); // иначе свайп вниз при перетаскивании закрывает игры
  if (tg.isVersionAtLeast?.("6.1")) { tg.setHeaderColor("#1b0b45"); tg.setBackgroundColor("#1b0b45"); }
}
setMute(muted);
progress = await loadProgress();
renderHome();
