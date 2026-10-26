"use strict";

const TOKEN_KEY = "accountability-token";
const DAY_MS = 86400000;
const WEEKS = 53;

let config = null;
let token = readToken();
const data = {}; // habit id -> { days: { "YYYY-MM-DD": count }, ... }

// ---------- dates (calendar math in UTC so DST never shifts a day) ----------

function toKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromKey(key) {
  return Date.parse(key + "T00:00:00Z");
}

function addDays(key, n) {
  return toKey(fromKey(key) + n * DAY_MS);
}

// The current "study day": before the rollover hour, it still counts as yesterday.
function todayKey() {
  const now = new Date(Date.now() - (config.day_starts_at_hour || 0) * 3600000);
  return toKey(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function prettyDate(key, opts) {
  return new Date(fromKey(key)).toLocaleDateString(undefined,
    Object.assign({ timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }, opts));
}

// ---------- stats ----------

function streaks(days, goal, today) {
  const hit = new Set(Object.keys(days).filter((d) => days[d] >= goal));
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of [...hit].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let d = hit.has(today) ? today : addDays(today, -1);
  while (hit.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  return { current, longest };
}

function average(days) {
  const counts = Object.values(days).filter((n) => n > 0);
  return counts.length ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;
}

function thresholds(habit, days) {
  if (Array.isArray(habit.levels)) return habit.levels;
  const avg = Math.max(average(days), 1);
  return [1, avg * 0.5, avg, avg * 1.5, avg * 2];
}

function level(count, limits) {
  let lvl = 0;
  for (const t of limits) if (count >= t) lvl++;
  return lvl;
}

function plural(habit, n) {
  return n + " " + (n === 1 ? habit.unit_one : habit.unit);
}

// ---------- rendering ----------

function renderAll() {
  const root = document.getElementById("habits");
  root.textContent = "";
  for (const habit of config.habits) root.appendChild(renderHabit(habit));
  document.querySelectorAll(".map-scroll").forEach((el) => { el.scrollLeft = el.scrollWidth; });
  renderOwnerState();
}

function renderHabit(habit) {
  const node = document.getElementById("habit-template").content.firstElementChild.cloneNode(true);
  const days = (data[habit.id] && data[habit.id].days) || {};
  const today = todayKey();
  const limits = thresholds(habit, days);
  const { current, longest } = streaks(days, habit.goal, today);
  const todayCount = days[today] || 0;

  node.id = "habit-" + habit.id;
  node.querySelector(".habit-name").textContent = habit.name;
  node.querySelector(".habit-meta").textContent = metaLine(habit);

  const stat = (name, html) => { node.querySelector('[data-stat="' + name + '"]').innerHTML = html; };
  stat("today", habit.goal > 1
    ? todayCount + " <small>/ " + habit.goal + "</small>"
    : String(todayCount) + (todayCount >= habit.goal ? " <small>✓</small>" : ""));
  stat("current", current + " <small>" + (current === 1 ? "day" : "days") + "</small>");
  stat("longest", longest + " <small>" + (longest === 1 ? "day" : "days") + "</small>");
  stat("average", average(days) + " <small>" + habit.unit + "</small>");

  // Heatmap: 53 week columns, Sunday on top, ending with the current week.
  const grid = node.querySelector(".grid");
  const months = node.querySelector(".months");
  const detail = node.querySelector(".detail");
  const endDow = new Date(fromKey(today)).getUTCDay();
  const start = addDays(today, -(WEEKS - 1) * 7 - endDow);
  const colWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) +
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap"));
  let lastMonth = -1;
  let filled = 0;

  for (let d = start, i = 0; d <= today; d = addDays(d, 1), i++) {
    const count = days[d] || 0;
    const lvl = level(count, limits);
    const cell = document.createElement("div");
    cell.className = "cell" + (d === today ? " today" : "");
    if (lvl > 0) {
      cell.style.background = habit.colors[Math.min(lvl, habit.colors.length) - 1];
      filled++;
    }
    const label = prettyDate(d, { weekday: "short" }) + ": " + (count ? plural(habit, count) : "nothing logged");
    cell.title = label;
    cell.dataset.date = d;
    const show = () => {
      grid.querySelectorAll(".selected").forEach((c) => c.classList.remove("selected"));
      cell.classList.add("selected");
      detail.textContent = label;
    };
    cell.addEventListener("click", show);
    cell.addEventListener("mouseenter", () => { detail.textContent = label; });
    grid.appendChild(cell);

    const date = new Date(fromKey(d));
    if (date.getUTCDate() <= 7 && date.getUTCDay() === 0 && date.getUTCMonth() !== lastMonth) {
      lastMonth = date.getUTCMonth();
      const m = document.createElement("span");
      m.textContent = date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
      m.style.left = Math.floor(i / 7) * colWidth + "px";
      months.appendChild(m);
    }
  }
  grid.setAttribute("aria-label", habit.name + " heatmap: " + filled + " active days in the past year");

  const legend = node.querySelector(".legend-cells");
  for (const c of ["var(--empty)"].concat(habit.colors)) {
    const i = document.createElement("i");
    i.style.background = c;
    legend.appendChild(i);
  }

  if (habit.manual && token) setupControls(node, habit);
  return node;
}

function metaLine(habit) {
  const info = data[habit.id] || {};
  if (!habit.manual) {
    return info.last_updated ? "Synced from Anki · " + new Date(info.last_updated).toLocaleString(undefined,
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Synced from Anki";
  }
  return "Goal: " + plural(habit, habit.goal) + " a day";
}

function setupControls(node, habit) {
  const controls = node.querySelector(".controls");
  const status = node.querySelector(".status");
  const quick = node.querySelector(".quick");
  controls.hidden = false;

  for (const amount of habit.buttons || [1]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "primary";
    b.textContent = "+" + plural(habit, amount) + " today";
    b.addEventListener("click", () => save(habit, todayKey(), (n) => n + amount, controls, status));
    quick.appendChild(b);
  }

  const form = node.querySelector(".edit-form");
  const dateInput = node.querySelector(".edit-date");
  const countInput = node.querySelector(".edit-count");
  const days = (data[habit.id] && data[habit.id].days) || {};
  dateInput.value = todayKey();
  dateInput.max = todayKey();
  countInput.value = days[todayKey()] || 0;
  dateInput.addEventListener("change", () => { countInput.value = days[dateInput.value] || 0; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = Math.max(0, Math.floor(Number(countInput.value) || 0));
    save(habit, dateInput.value, () => value, controls, status);
  });
}

function renderOwnerState() {
  document.getElementById("owner-state").textContent = token ? "Logged in to check in. " : "";
  document.getElementById("login-toggle").textContent = token ? "Log out" : "Log in";
}

// ---------- GitHub ----------

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}

function writeToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* storage blocked; token lasts for this visit only */ }
  token = value;
}

async function gh(path, options = {}) {
  const res = await fetch("https://api.github.com/repos/" + config.owner + "/" + config.repo + path, {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok && !(options.allow404 && res.status === 404)) {
    const err = new Error("GitHub returned " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.status === 404 ? null : res.json();
}

function decode(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encode(text) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function readRemote(habit) {
  const info = await gh("/contents/" + habit.file + "?ref=" + encodeURIComponent(config.branch), { allow404: true });
  if (!info) return { sha: null, json: { days: {} } };
  return { sha: info.sha, json: JSON.parse(decode(info.content)) };
}

async function save(habit, date, update, controls, status) {
  const buttons = controls.querySelectorAll("button");
  buttons.forEach((b) => { b.disabled = true; });
  status.textContent = "Saving…";
  try {
    for (let attempt = 0; ; attempt++) {
      // Always start from the latest file so check-ins from other devices are kept.
      const { sha, json } = await readRemote(habit);
      json.days = json.days || {};
      const value = update(json.days[date] || 0);
      if (value > 0) json.days[date] = value;
      else delete json.days[date];
      json.days = Object.fromEntries(Object.entries(json.days).sort());
      json.last_updated = new Date().toISOString();
      try {
        await gh("/contents/" + habit.file, {
          method: "PUT",
          body: {
            message: "Log " + habit.name + " " + date + ": " + plural(habit, value),
            content: encode(JSON.stringify(json, null, 2) + "\n"),
            branch: config.branch,
            ...(sha ? { sha } : {}),
          },
        });
      } catch (err) {
        if ((err.status === 409 || err.status === 422) && attempt < 2) continue;
        throw err;
      }
      data[habit.id] = json;
      renderAll();
      const section = document.getElementById("habit-" + habit.id);
      section.querySelector(".status").textContent =
        "Saved " + plural(habit, value) + " for " + prettyDate(date) + ".";
      return;
    }
  } catch (err) {
    status.textContent = err.status === 401 || err.status === 403
      ? "Your token was rejected. Log out and log in with a valid token."
      : "Could not save (" + err.message + "). Try again.";
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// ---------- login ----------

function setupLogin() {
  const box = document.getElementById("login");
  const toggle = document.getElementById("login-toggle");
  const input = document.getElementById("token");
  const status = document.getElementById("login-status");

  toggle.addEventListener("click", () => {
    if (token) {
      writeToken("");
      renderAll();
      return;
    }
    box.hidden = !box.hidden;
    if (!box.hidden) input.focus();
  });
  document.getElementById("login-cancel").addEventListener("click", () => { box.hidden = true; });
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    status.textContent = "Checking…";
    const previous = token;
    token = value;
    try {
      const repo = await gh("");
      if (!repo.permissions || !repo.permissions.push) throw new Error("no write access");
      writeToken(value);
      input.value = "";
      status.textContent = "";
      box.hidden = true;
      await loadData();
      renderAll();
    } catch (err) {
      token = previous;
      status.textContent = "That token can't write to this repo. Check its repository access and Contents permission.";
    }
  });
}

// ---------- startup ----------

async function loadData() {
  await Promise.all(config.habits.map(async (habit) => {
    if (token) {
      // Logged in: read straight from GitHub so recent check-ins show immediately.
      try {
        data[habit.id] = (await readRemote(habit)).json;
        return;
      } catch (err) { /* fall back to the published copy */ }
    }
    try {
      const res = await fetch(habit.file + "?t=" + Date.now(), { cache: "no-store" });
      data[habit.id] = res.ok ? await res.json() : { days: {} };
    } catch (err) {
      data[habit.id] = data[habit.id] || { days: {} };
    }
  }));
}

async function init() {
  try {
    config = await (await fetch("habits.json?t=" + Date.now(), { cache: "no-store" })).json();
  } catch (err) {
    document.getElementById("habits").innerHTML = '<p class="muted">Could not load habits.json.</p>';
    return;
  }
  document.getElementById("title").textContent = config.title;
  document.title = config.title;
  setupLogin();
  await loadData();
  renderAll();
}

init();
