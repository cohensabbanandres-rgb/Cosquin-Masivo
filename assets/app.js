import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "PEGAR_TU_PROJECT_URL";
const SUPABASE_ANON_KEY = "PEGAR_TU_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Festival Planner (no backend). Group config via ?g=... and votes import via ?import=...
// Exposes: window.FestivalApp = { initIndexPage, initVotePage, initResultsPage }

(function () {
  const LEVELS = [
    { key: "must", label: "Must (4)", w: 4 },
    { key: "would", label: "Would (3)", w: 3 },
    { key: "opt", label: "Optional (2)", w: 2 },
    { key: "no", label: "No (0)", w: 0 },
  ];
  const WEIGHT = { must: 4, would: 3, opt: 2, no: 0 };

  const $ = (s) => document.querySelector(s);

  function showError(msg) {
    const el = $("#error");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
  }

  function params() {
    return new URLSearchParams(location.search);
  }

  function b64urlEncode(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
  function b64urlDecode(b64u) {
    let s = b64u.replaceAll("-", "+").replaceAll("_", "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  // ----- Group config -----
  function groupFromURL() {
    const g = params().get("g");
    if (!g) return null;
    try { return JSON.parse(b64urlDecode(g)); } catch { return null; }
  }

  function groupToURL(group) {
    return b64urlEncode(JSON.stringify(group));
  }

  function saveGroupLocal(group) {
    localStorage.setItem("fp_group", JSON.stringify(group));
  }

  function loadGroupLocal() {
    try {
      const s = localStorage.getItem("fp_group");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }

  function ensureGroup() {
    const gUrl = groupFromURL();
    const gLocal = loadGroupLocal();
    const g = gUrl || gLocal;
    if (g) saveGroupLocal(g);
    return g;
  }

  function groupId(group) {
    // stable-ish id from names (good enough for this use)
    return b64urlEncode(JSON.stringify(group.names));
  }

  // ----- Votes storage (per group/day/person) in localStorage -----
  function voteStoreKey(group, day) {
    return `fp_votes_${groupId(group)}_${day}`;
  }
  function loadVotesAll(group, day) {
    try {
      const s = localStorage.getItem(voteStoreKey(group, day));
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  }
  function saveVotesAll(group, day, obj) {
    localStorage.setItem(voteStoreKey(group, day), JSON.stringify(obj));
  }
  function resetVotes(group) {
    for (const day of ["14", "15"]) localStorage.removeItem(voteStoreKey(group, day));
  }

  // ----- CSV loading/parsing -----
  async function loadDayCSV(day) {
    const path = day === "14" ? "data/day14.csv" : "data/day15.csv";
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`No pude cargar ${path} (HTTP ${res.status})`);
    const text = await res.text();
    return parseCSV(text);
  }

  function parseCSV(text) {
    const delim = text.includes(";") ? ";" : ",";
    const rows = [];
    let cur = "", row = [], inQ = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (ch === '"' && inQ && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === delim && !inQ) { row.push(cur.trim()); cur = ""; continue; }
      if ((ch === "\n" || ch === "\r") && !inQ) {
        if (ch === "\r" && nx === "\n") i++;
        row.push(cur.trim()); cur = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    if (cur.length || row.length) {
      row.push(cur.trim());
      if (row.some(c => c !== "")) rows.push(row);
    }
    if (!rows.length) throw new Error("CSV vacío");

    const header = rows[0].map(h => (h || "").trim());
    const stages = header.slice(1).filter(Boolean);

    const blocks = [];
    for (let r = 1; r < rows.length; r++) {
      const time = (rows[r][0] || "").trim();
      if (!time) continue;

      const bands = [];
      for (let c = 1; c < header.length; c++) {
        const stage = stages[c - 1] || `Stage ${c}`;
        const band = (rows[r][c] || "").trim();
        if (band) bands.push({ time, stage, band });
      }
      blocks.push({ time, bands });
    }

    return { stages, blocks };
  }

  // key per "slot" (time + stage) — 1 band per cell
  function slotKey(day, time, stage) {
    return `${day}__${time}__${stage}`;
  }

  // ----- Index page -----
  function initIndexPage() {
    const countEl = $("#count");
    const namesWrap = $("#namesWrap");
    const who = $("#who");
    const saveBtn = $("#save");
    const copyGroupBtn = $("#copyGroup");
    const groupLinkBox = $("#groupLink");
    const goResultsBtn = $("#goResults");

    function renderNameInputs(n, existingNames = []) {
      namesWrap.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const val = existingNames[i] || "";
        const div = document.createElement("div");
        div.style.marginBottom = "8px";
        div.innerHTML = `<input class="nameInput" placeholder="Nombre ${i + 1}" value="${val.replaceAll('"', "&quot;")}" />`;
        namesWrap.appendChild(div);
      }
    }

    function renderWho(names) {
      who.innerHTML = `<option value="">(Elegí tu nombre)</option>`;
      for (const name of names) {
        const opt = document.createElement("option");
        opt.textContent = name;
        opt.value = name;
        who.appendChild(opt);
      }
    }

    // Load group if present
    const g = ensureGroup();
    if (g && Array.isArray(g.names)) {
      countEl.value = String(g.names.length);
      renderNameInputs(g.names.length, g.names);
      renderWho(g.names);
      copyGroupBtn.style.display = "inline-block";
      goResultsBtn.style.display = "inline-block";
      groupLinkBox.style.display = "block";
      groupLinkBox.value = makeGroupLink(g);
    } else {
      renderNameInputs(Number(countEl.value), []);
    }

    countEl.addEventListener("input", () => {
      const n = Math.max(2, Math.min(15, Number(countEl.value || 2)));
      renderNameInputs(n, []);
    });

    function readNames() {
      const inputs = Array.from(document.querySelectorAll(".nameInput"));
      const names = inputs.map(i => i.value.trim()).filter(Boolean);
      return names;
    }

    function makeGroupLink(group) {
      const gEnc = groupToURL(group);
      const u = new URL(location.href);
      u.pathname = u.pathname.replace(/index\.html$/, "") + "index.html";
      u.search = "";
      u.searchParams.set("g", gEnc);
      return u.toString();
    }

    saveBtn.addEventListener("click", async () => {
      const n = Math.max(2, Math.min(15, Number(countEl.value || 2)));
      const names = readNames();

      if (names.length !== n) {
        alert(`Tenés que completar exactamente ${n} nombres.`);
        return;
      }

      const group = { names };
      saveGroupLocal(group);
      renderWho(names);

      const link = makeGroupLink(group);
      groupLinkBox.style.display = "block";
      groupLinkBox.value = link;
      copyGroupBtn.style.display = "inline-block";
      goResultsBtn.style.display = "inline-block";
      alert("Grupo guardado. Copiá el link del grupo y compartilo.");
    });

    copyGroupBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(groupLinkBox.value);
        copyGroupBtn.textContent = "Copiado!";
        setTimeout(() => (copyGroupBtn.textContent = "Copiar link del grupo"), 1200);
      } catch {
        groupLinkBox.focus(); groupLinkBox.select();
      }
    });

    goResultsBtn.addEventListener("click", () => {
      const group = ensureGroup();
      if (!group) { alert("Primero guardá un grupo."); return; }
      const gEnc = groupToURL(group);
      location.href = `results.html?g=${encodeURIComponent(gEnc)}`;
    });

    function goVote(day) {
      const group = ensureGroup();
      if (!group) { alert("Primero guardá un grupo."); return; }
      const name = who.value.trim();
      if (!name) { alert("Elegí tu nombre."); return; }
      const gEnc = groupToURL(group);
      location.href = `vote.html?day=${day}&name=${encodeURIComponent(name)}&g=${encodeURIComponent(gEnc)}`;
    }

    $("#day14").addEventListener("click", () => goVote("14"));
    $("#day15").addEventListener("click", () => goVote("15"));
  }

  // ----- Vote page -----
  function initVotePage() {
    const p = params();
    const day = p.get("day");
    const name = p.get("name");
    const group = ensureGroup();

    if (!day || !name || !group) {
      showError("Falta day/name/group. Volvé al Home y entrá desde el link del grupo.");
      return;
    }

    $("#title").textContent = `Votar – Día ${day} (${name})`;

    let votes = {}; // votes[slotKey]= levelKey

    loadDayCSV(day)
      .then((data) => {
        renderVoteGrid(day, data, votes);
        setupSubmit(day, name, group, votes);
      })
      .catch((e) => showError(e.message || String(e)));
  }

  function renderVoteGrid(day, data, votes) {
    const holder = $("#grid");
    if (!holder) return;

    if (!data.stages.length || !data.blocks.length) {
      holder.innerHTML = `<div class="small">No hay datos. Revisá el CSV.</div>`;
      return;
    }

    let html = `<div class="grid"><table><thead><tr>`;
    html += `<th class="time">Hora</th>`;
    for (const st of data.stages) html += `<th>${escapeHtml(st)}</th>`;
    html += `</tr></thead><tbody>`;

    for (const block of data.blocks) {
      html += `<tr><td class="time">${escapeHtml(block.time)}</td>`;
      const byStage = {};
      for (const b of block.bands) byStage[b.stage] = b.band;

      for (const st of data.stages) {
        const band = (byStage[st] || "").trim();
        const k = slotKey(day, block.time, st);
        const selected = votes[k] || "no"; // ✅ default = no (0 puntos)

        html += `<td>`;
        if (band) {
          html += `<div class="band">${escapeHtml(band)}</div>`;
          html += `<div class="voteRow" data-key="${escapeHtml(k)}">`;
          for (const L of LEVELS) {
            const active = (selected === L.key) ? "pill active" : "pill";
            html += `<span class="${active}" data-level="${L.key}">${L.label}</span>`;
          }
          html += `</div>`;
        } else {
          html += `<div class="small">—</div>`;
        }
        html += `</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    holder.innerHTML = html;

    // click handlers
    holder.querySelectorAll(".voteRow .pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const row = pill.closest(".voteRow");
        const k = row.getAttribute("data-key");
        const lvl = pill.getAttribute("data-level");

        votes[k] = lvl;

        row.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
      });
    });
  }

  function setupSubmit(day, name, group, votes) {
    const submit = $("#submit");
    const copy = $("#copy");
    const shareBox = $("#share");

    submit.addEventListener("click", async () => {
      // ✅ Aseguramos que lo no votado quede como "no"
      // (no hace falta llenar todo el mapa; el default se aplica igual en results)
      // pero dejamos todo consistente para el import:
      for (const k of Object.keys(votes)) {
        if (!votes[k]) votes[k] = "no";
      }

      submit.disabled = true;

      // payload importable
      const payload = { day, name, votes, g: groupToURL(group) };
      const encoded = b64urlEncode(JSON.stringify(payload));

      const u = new URL(location.href);
      u.pathname = u.pathname.replace(/vote\.html$/, "") + "results.html";
      u.search = "";
      u.searchParams.set("g", groupToURL(group));
      u.searchParams.set("import", encoded);

      const link = u.toString();

      shareBox.style.display = "block";
      shareBox.value = link;
      copy.style.display = "inline-block";

      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          copy.textContent = "Copiado!";
          setTimeout(() => (copy.textContent = "Copiar link"), 1200);
        } catch {
          shareBox.focus(); shareBox.select();
        }
      };

      alert("Listo. Mandá el link al grupo. Andy lo abre y se importa solo.");
    });
  }

  // ----- Results page -----
  function initResultsPage() {
    const group = ensureGroup();
    if (!group) {
      showError("No hay grupo. Entrá desde el link del grupo.");
      return;
    }

    const p = params();
    const importToken = p.get("import");
    const gEnc = p.get("g") || groupToURL(group);

    // If import exists, import automatically into localStorage
    if (importToken) {
      try {
        const payload = JSON.parse(b64urlDecode(importToken));
        if (!payload?.day || !payload?.name || !payload?.votes) throw new Error("Import inválido");

        const day = payload.day;
        const all = loadVotesAll(group, day);
        all[payload.name] = payload.votes;
        saveVotesAll(group, day, all);

        // Clean URL (remove import token) to avoid re-import on refresh
        const u = new URL(location.href);
        u.searchParams.delete("import");
        history.replaceState({}, "", u.toString());
      } catch (e) {
        showError(e.message || String(e));
      }
    }

    updateStatus(group);

    $("#compute").addEventListener("click", () => computeAll(group));
    $("#reset").addEventListener("click", () => {
      if (!confirm("Resetear votos guardados en ESTE navegador?")) return;
      resetVotes(group);
      updateStatus(group);
      $("#out").innerHTML = "";
    });
  }

  function updateStatus(group) {
    const names = group.names;
    const all14 = loadVotesAll(group, "14");
    const all15 = loadVotesAll(group, "15");

    const got14 = names.filter(n => all14[n]).length;
    const got15 = names.filter(n => all15[n]).length;

    $("#status").textContent = `Votos importados — Día 14: ${got14}/${names.length} | Día 15: ${got15}/${names.length}`;
  }

  async function computeAll(group) {
    const out = $("#out");
    out.innerHTML = "";

    for (const day of ["14", "15"]) {
      let data;
      try {
        data = await loadDayCSV(day);
      } catch (e) {
        out.innerHTML += `<div class="card"><h2>Día ${day}</h2><div class="error">${escapeHtml(e.message || e)}</div></div>`;
        continue;
      }

      const allVotes = loadVotesAll(group, day);

      // split A/B auto
      const names = group.names.slice();
      const mid = Math.ceil(names.length / 2);
      const groupA = names.slice(0, mid);
      const groupB = names.slice(mid);

      const resAll = computePlan(day, data, names, allVotes);
      const resA = computePlan(day, data, groupA, allVotes);
      const resB = computePlan(day, data, groupB, allVotes);

      out.innerHTML += renderPlanCard(`Día ${day} — Plan General`, resAll);
      out.innerHTML += renderPlanCard(`Día ${day} — Plan A (${groupA.length} personas)`, resA);
      out.innerHTML += renderPlanCard(`Día ${day} — Plan B (${groupB.length} personas)`, resB);
    }
  }

  function computePlan(day, data, people, allVotesByName) {
    // For each time slot, choose stage with max total happiness
    const chosen = [];
    let total = 0;

    for (const block of data.blocks) {
      // options = each stage has potentially a band
      const options = data.stages.map((st) => {
        const k = slotKey(day, block.time, st);

        let sum = 0;
        for (const person of people) {
          const votes = allVotesByName[person] || {};
          const lvl = votes[k] || "no"; // ✅ default no = 0 si no votó
          sum += WEIGHT[lvl] || 0;
        }
        return { time: block.time, stage: st, score: sum };
      });

      options.sort((a, b) => b.score - a.score);
      const pick = options[0];
      chosen.push(pick);
      total += pick.score;
    }

    return { total, chosen };
  }

  function renderPlanCard(title, res) {
    let html = `<div class="card"><h2>${escapeHtml(title)}</h2>`;
    html += `<div class="small">Total happiness: <b>${res.total}</b></div>`;
    html += `<div class="grid"><table><thead><tr><th class="time">Hora</th><th>Escenario elegido</th><th>Score</th></tr></thead><tbody>`;
    for (const x of res.chosen) {
      html += `<tr><td class="time">${escapeHtml(x.time)}</td><td>${escapeHtml(x.stage)}</td><td>${x.score}</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    return html;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Export
  window.FestivalApp = { initIndexPage, initVotePage, initResultsPage };
})();
