/* Cosquin Rock Planner – standalone, no services
   Exposes: window.CosquinApp = { initVotePage, initResultsPage }
*/
(function () {
  const WEIGHTS = { must: 4, would: 3, optional: 2, no: 0 };
  const LEVELS = [
    { key: "must", label: "Must see" },
    { key: "would", label: "Would like" },
    { key: "optional", label: "Optional" },
    { key: "no", label: "No" },
  ];

  // ---------- small utils ----------
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function getParams() {
    const u = new URL(window.location.href);
    return Object.fromEntries(u.searchParams.entries());
  }

  function setParam(key, value) {
    const u = new URL(window.location.href);
    if (value == null || value === "") u.searchParams.delete(key);
    else u.searchParams.set(key, value);
    window.history.replaceState({}, "", u.toString());
  }

  // base64url helpers
  function b64urlEncode(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
  function b64urlDecode(b64url) {
    const b64 = b64url.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((b64url.length + 3) % 4);
    const str = decodeURIComponent(escape(atob(b64)));
    return str;
  }

  function showError(msg) {
    const el = qs("#error");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
  }

  // ---------- CSV loading / parsing ----------
  async function loadDay(day) {
    const path = day === "14" ? "data/day14.csv" : "data/day15.csv";
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`No pude cargar ${path} (HTTP ${res.status})`);
    const text = await res.text();
    return parseCSV(text);
  }

  function parseCSV(text) {
    // Detect delimiter: if there are semicolons, use ; (Google Sheets / Excel ES)
    const delimiter = text.includes(";") ? ";" : ",";

    // minimal CSV parser with quotes
    const rows = [];
    let cur = "";
    let row = [];
    let inQ = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nx = text[i + 1];

      if (ch === '"' && inQ && nx === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === delimiter && !inQ) {
        row.push(cur.trim());
        cur = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQ) {
        if (ch === "\r" && nx === "\n") i++;
        row.push(cur.trim());
        cur = "";
        if (row.some((c) => c !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    if (cur.length || row.length) {
      row.push(cur.trim());
      if (row.some((c) => c !== "")) rows.push(row);
    }
    if (!rows.length) throw new Error("CSV vacío");

    const header = rows[0].map((h) => (h || "").trim());
    const timeHeader = header[0] || "time";
    const stages = header.slice(1).filter(Boolean);

    const blocks = [];
    for (let r = 1; r < rows.length; r++) {
      const t = (rows[r][0] || "").trim();
      if (!t) continue;

      const cells = [];
      for (let c = 1; c < rows[r].length; c++) {
        const band = (rows[r][c] || "").trim();
        const stage = stages[c - 1];
        cells.push({ time: t, stage: stage || `Stage ${c}`, band });
      }
      blocks.push({ time: t, cells });
    }

    return { timeHeader, stages, blocks };
  }

  // ---------- Voting (grid) ----------
  function voteKey(day, time, stage) {
    // a stable key for a time + stage cell
    return `${day}__${time}__${stage}`;
  }

  function renderGrid(day, data, votes, locked) {
    const holder = qs("#grid");
    if (!holder) return;

    const stages = data.stages;
    const blocks = data.blocks;

    if (!stages.length || !blocks.length) {
      holder.innerHTML = `<div class="small">No hay datos para mostrar (stages=${stages.length}, blocks=${blocks.length}). Revisá el CSV.</div>`;
      return;
    }

    let html = `<div class="grid"><table><thead><tr>`;
    html += `<th class="time">${esc(data.timeHeader || "time")}</th>`;
    for (const st of stages) html += `<th>${esc(st)}</th>`;
    html += `</tr></thead><tbody>`;

    for (const b of blocks) {
      html += `<tr>`;
      html += `<td class="time">${esc(b.time)}</td>`;
      for (let i = 0; i < stages.length; i++) {
        const st = stages[i];
        const cell = b.cells[i] || { band: "" };
        const band = (cell.band || "").trim();

        const k = voteKey(day, b.time, st);
        const selected = votes[k] || "";

        html += `<td>`;
        if (band) {
          html += `<div class="band">${esc(band)}</div>`;
          html += `<div class="voteRow" data-key="${esc(k)}">`;
          for (const lvl of LEVELS) {
            const active = selected === lvl.key ? "pill active" : "pill";
            const dis = locked ? `data-locked="1"` : "";
            html += `<span class="${active}" data-level="${lvl.key}" ${dis}>${esc(lvl.label)}</span>`;
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

    // attach handlers
    qsa(".voteRow .pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        if (locked) return;
        if (pill.getAttribute("data-locked") === "1") return;

        const row = pill.closest(".voteRow");
        const k = row.getAttribute("data-key");
        const lvl = pill.getAttribute("data-level");

        votes[k] = lvl;

        // update UI in that row
        row.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
      });
    });
  }

  function lockUI() {
    qsa(".pill").forEach((p) => p.setAttribute("data-locked", "1"));
    const btn = qs("#submit");
    if (btn) btn.disabled = true;
  }

  function generateShareLink(payload) {
    const encoded = b64urlEncode(JSON.stringify(payload));
    const u = new URL(window.location.href);
    u.searchParams.set("share", encoded);
    // keep day/name
    return u.toString();
  }

  function tryLoadShare() {
    const params = getParams();
    if (!params.share) return null;
    try {
      const json = b64urlDecode(params.share);
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // ---------- Results (force plan + A/B) ----------
  function scoreOf(levelKey) {
    return WEIGHTS[levelKey] ?? 0;
  }

  function computePlans(dayData, allPeopleVotes) {
    // Build per time block options: each stage has a band -> option
    // Option score = sum of each person's preference for that cell key
    const times = dayData.blocks.map((b) => b.time);
    const stages = dayData.stages;

    const perTimeOptions = times.map((t) => {
      const options = [];
      for (const st of stages) {
        const k = voteKey(dayData.day, t, st);
        let total = 0;
        const perPerson = {};
        for (const [person, votes] of Object.entries(allPeopleVotes)) {
          const lvl = votes[k] || "no";
          const s = scoreOf(lvl);
          total += s;
          perPerson[person] = s;
        }
        options.push({ time: t, stage: st, key: k, total, perPerson });
      }
      // sort best to worst
      options.sort((a, b) => b.total - a.total);
      return options;
    });

    // Force plan = best option per time
    const force = perTimeOptions.map((opts) => opts[0]);

    // Create candidate schedules by swapping one time slot to its 2nd best
    const candidates = [];
    for (let i = 0; i < perTimeOptions.length; i++) {
      const opts = perTimeOptions[i];
      if (opts.length < 2) continue;
      const cand = force.slice();
      cand[i] = opts[1];
      candidates.push(cand);
    }

    function scheduleScore(schedule) {
      return schedule.reduce((sum, o) => sum + (o?.total || 0), 0);
    }

    candidates.sort((a, b) => scheduleScore(b) - scheduleScore(a));

    const A = candidates[0] || force;
    const B = candidates[1] || force;

    return { force, A, B, perTimeOptions };
  }

  function renderPlan(title, plan, dayData) {
    const lines = [];
    let total = 0;
    for (const o of plan) {
      total += o.total || 0;
      lines.push(`${o.time} — ${o.stage}`);
    }

    let html = `<div class="card"><h2>${esc(title)}</h2>`;
    html += `<div class="small">Score total: ${total}</div>`;
    html += `<div class="grid"><table><thead><tr><th class="time">Hora</th><th>Escenario elegido</th></tr></thead><tbody>`;
    for (const o of plan) {
      html += `<tr><td class="time">${esc(o.time)}</td><td>${esc(o.stage)}</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    return html;
  }

  // ---------- Public init functions ----------
  async function initVotePage() {
    const params = getParams();
    const day = params.day || "14";
    const name = params.name || "Anon";

    const title = qs("#title");
    if (title) title.textContent = `Vote – Day ${day} (${name})`;

    // load data
    let data;
    try {
      data = await loadDay(day);
    } catch (e) {
      showError(e?.message || String(e));
      return;
    }

    // votes object
    let votes = {};

    // if share exists, load and lock
    const shared = tryLoadShare();
    let locked = false;
    if (shared && shared.votes && shared.day === day) {
      votes = shared.votes;
      locked = true;
      lockUI();
    }

    renderGrid(day, data, votes, locked);

    // submit button
    const submit = qs("#submit");
    const copyBtn = qs("#copy");
    const shareBox = qs("#share");

    if (submit) {
      submit.addEventListener("click", () => {
        // lock
        lockUI();

        const payload = { day, name, votes };
        const link = generateShareLink(payload);

        if (shareBox) {
          shareBox.style.display = "block";
          shareBox.value = link;
        }
        if (copyBtn) {
          copyBtn.style.display = "inline-block";
          copyBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(link);
              copyBtn.textContent = "Copied!";
              setTimeout(() => (copyBtn.textContent = "Copy Share Link"), 1200);
            } catch {
              // fallback: highlight textarea
              if (shareBox) {
                shareBox.focus();
                shareBox.select();
              }
            }
          };
        }
      });
    }
  }

  async function initResultsPage() {
    // expects:
    // - textarea#links (one per line)
    // - div#out14 , div#out15 (or #out)
    const linksEl = qs("#links");
    const btn = qs("#compute");
    const out = qs("#out") || document.body;

    async function compute() {
      const text = (linksEl?.value || "").trim();
      if (!text) {
        showError("Pegá los links (uno por línea).");
        return;
      }

      // parse links
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      const byDay = { "14": {}, "15": {} };

      for (const line of lines) {
        try {
          const u = new URL(line);
          const share = u.searchParams.get("share");
          if (!share) continue;
          const payload = JSON.parse(b64urlDecode(share));
          if (!payload?.day || !payload?.name || !payload?.votes) continue;
          if (payload.day === "14" || payload.day === "15") {
            byDay[payload.day][payload.name] = payload.votes;
          }
        } catch {
          // ignore bad lines
        }
      }

      let html = "";

      for (const day of ["14", "15"]) {
        // Load day schedule
        let dayData;
        try {
          dayData = await loadDay(day);
        } catch (e) {
          html += `<div class="card"><h2>Day ${day}</h2><div class="error">No pude cargar day${day}.csv</div></div>`;
          continue;
        }
          dayData.day = day;

        const people = Object.keys(byDay[day]);
        html += `<div class="card"><h1>Results — Day ${day}</h1><div class="small">Votos cargados: ${people.length}</div></div>`;

        if (!people.length) {
          html += `<div class="card"><div class="small">No hay votos para este día.</div></div>`;
          continue;
        }

        const plans = computePlans(dayData, byDay[day]);

        html += renderPlan("Force plan (best total happiness)", plans.force, dayData);
        html += renderPlan("Plan A (best alternative)", plans.A, dayData);
        html += renderPlan("Plan B (second alternative)", plans.B, dayData);
      }

      out.innerHTML = html;
    }

    if (btn) btn.addEventListener("click", compute);
    // auto compute if links already pasted
    if (linksEl && linksEl.value.trim()) compute();
  }

  // ✅ Export to window
  window.CosquinApp = { initVotePage, initResultsPage };

})();
