'use strict';

/* ================================================================
   Beregning (ren logik — ingen DOM). Alle beløb regnes i øre for at
   undgå afrundingsfejl med kommatal.
   ================================================================ */

// Læser et tal skrevet på dansk eller engelsk: "12.500", "12500", "12,5", "12.5"
function parseNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sum(arr) {
  return arr.reduce((s, x) => s + x, 0);
}

// Afrunder en liste af tal til heltal, så summen bevares (største-rest-metoden)
function roundPreservingSum(values) {
  const clean = values.map(v => Math.round(v * 1e6) / 1e6);
  const floors = clean.map(Math.floor);
  let deficit = Math.round(sum(clean)) - sum(floors);
  const order = clean
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (const { i } of order) {
    if (deficit <= 0) break;
    result[i] += 1;
    deficit -= 1;
  }
  return result;
}

// Finder få overførsler: først præcise match, derefter største skyldner → største modtager
function minimizeTransfers(list) {
  const debtors = list.filter(x => x.net < 0).map(x => ({ name: x.name, amt: -x.net }));
  const creditors = list.filter(x => x.net > 0).map(x => ({ name: x.name, amt: x.net }));
  const transfers = [];

  for (const d of debtors) {
    const c = creditors.find(c => c.amt > 0 && c.amt === d.amt);
    if (c) {
      transfers.push({ from: d.name, to: c.name, amount: d.amt });
      c.amt = 0;
      d.amt = 0;
    }
  }

  for (;;) {
    const d = debtors.reduce((m, x) => (x.amt > (m ? m.amt : 0) ? x : m), null);
    const c = creditors.reduce((m, x) => (x.amt > (m ? m.amt : 0) ? x : m), null);
    if (!d || !c) break;
    const amount = Math.min(d.amt, c.amt);
    transfers.push({ from: d.name, to: c.name, amount });
    d.amt -= amount;
    c.amt -= amount;
  }

  return transfers.sort((a, b) => a.from.localeCompare(b.from, 'da') || b.amount - a.amount);
}

function computeSettlement(players, settings, adjust) {
  const rate = settings.buyinChips > 0 ? (settings.buyinKr * 100) / settings.buyinChips : 0; // øre pr. chip
  const rows = players.map(p => ({
    id: p.id,
    name: p.name,
    boughtOre: Math.round(sum(p.buyins) * 100),
    chips: parseNum(p.chips),
  }));
  const totalBoughtOre = sum(rows.map(r => r.boughtOre));
  const totalChips = sum(rows.map(r => r.chips || 0));
  const expectedChips = rate > 0 ? totalBoughtOre / rate : 0;
  const diffChips = totalChips - expectedChips;
  const balanced = Math.abs(diffChips) < 1e-6;
  const missing = rows.filter(r => r.chips === null).map(r => r.name);

  const result = { rate, rows, totalBoughtOre, totalChips, expectedChips, diffChips, balanced, missing, transfers: null };

  if (rows.length < 2 || missing.length || totalBoughtOre <= 0 || totalChips <= 0 || rate <= 0) return result;
  if (!balanced && !adjust) return result;

  // Ved forskel fordeles den forholdsmæssigt: værdien af én chip justeres, så alt går op
  const orePerChip = balanced ? rate : totalBoughtOre / totalChips;
  const unit = settings.roundWhole ? 100 : 1;
  const exact = rows.map(r => (r.chips * orePerChip - r.boughtOre) / unit);
  const nets = roundPreservingSum(exact).map(n => n * unit);
  rows.forEach((r, i) => {
    r.netOre = nets[i];
  });

  result.orePerChip = orePerChip;
  result.transfers = minimizeTransfers(rows.map(r => ({ name: r.name, net: r.netOre })));
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { parseNum, roundPreservingSum, minimizeTransfers, computeSettlement };
}

/* ================================================================
   Brugerflade
   ================================================================ */

if (typeof document !== 'undefined') {
  const STORAGE_KEY = 'pokerapp-v1';
  const nfKr = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const nfKr2 = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfNum = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 });

  const $ = sel => document.querySelector(sel);

  let state = load();
  let currentView = 'players';
  let amountTarget = null;

  function defaultState() {
    return {
      settings: { buyinKr: 100, buyinChips: 100, roundWhole: true },
      players: [],
      known: [],
      adjust: false,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      const d = defaultState();
      return {
        settings: { ...d.settings, ...(s.settings || {}) },
        players: Array.isArray(s.players) ? s.players : [],
        known: Array.isArray(s.known) ? s.known : [],
        adjust: !!s.adjust,
      };
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* privat browsing e.l. — appen virker stadig, den husker bare ikke */
    }
  }

  // ---------- Hjælpere ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function kr(ore, { sign = false } = {}) {
    const v = ore / 100;
    const txt = (ore % 100 === 0 ? nfKr : nfKr2).format(Math.abs(v)) + ' kr';
    if (!sign) return (v < 0 ? '−' : '') + txt;
    return (v > 0 ? '+' : v < 0 ? '−' : '±') + txt;
  }

  function chipsTxt(n) {
    return nfNum.format(n) + ' chips';
  }

  function rateOre() {
    const s = state.settings;
    return s.buyinChips > 0 ? (s.buyinKr * 100) / s.buyinChips : 0;
  }

  function sameRate() {
    return state.settings.buyinKr === state.settings.buyinChips;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function findPlayer(id) {
    return state.players.find(p => p.id === id);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  // ---------- Navigation ----------
  function show(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => (v.hidden = v.id !== 'view-' + view));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (currentView === 'players') renderPlayers();
    if (currentView === 'count') renderCount();
    if (currentView === 'settle') renderSettle();
  }

  // ---------- Indkøb ----------
  function renderPlayers() {
    const inGame = new Set(state.players.map(p => p.name.toLowerCase()));
    const suggestions = state.known.filter(n => !inGame.has(n.toLowerCase()));
    $('#known-players').innerHTML = suggestions
      .map(n => `<button class="pill" data-add-known="${esc(n)}">+ ${esc(n)}</button>`)
      .join('');

    const list = $('#player-list');
    if (!state.players.length) {
      list.innerHTML = `<div class="card empty">Tilføj spillerne ovenfor.<br>Hver spiller får automatisk ét indkøb på ${kr(state.settings.buyinKr * 100)}.</div>`;
    } else {
      list.innerHTML = state.players.map(playerCard).join('');
    }

    const totalOre = Math.round(sum(state.players.map(p => sum(p.buyins))) * 100);
    const totalChips = rateOre() > 0 ? totalOre / rateOre() : 0;
    $('#buyin-summary').innerHTML = `
      <div class="line"><span>Spillere</span><b>${state.players.length}</b></div>
      <div class="line"><span>Samlet købt ind for</span><b>${kr(totalOre)}</b></div>
      ${sameRate() ? '' : `<div class="line"><span>Chips i spil</span><b>${chipsTxt(totalChips)}</b></div>`}
    `;
  }

  function playerCard(p) {
    const totalOre = Math.round(sum(p.buyins) * 100);
    const chips = rateOre() > 0 ? totalOre / rateOre() : 0;
    const buyins = p.buyins.length
      ? p.buyins.map((b, i) => `<button class="buyin" data-remove-buyin="${i}" data-id="${p.id}">${kr(Math.round(b * 100))}</button>`).join('')
      : '<span class="muted small">Ingen indkøb endnu</span>';
    return `
      <div class="card">
        <div class="player-head">
          <span class="player-name">${esc(p.name)}</span>
          <span class="player-total">${kr(totalOre)}${sameRate() ? '' : ' · ' + chipsTxt(chips)}</span>
          <button class="icon-btn remove-player" data-act="remove" data-id="${p.id}" aria-label="Fjern ${esc(p.name)}">✕</button>
        </div>
        <div class="buyins">${buyins}</div>
        <div class="player-actions">
          <button class="btn primary small grow" data-act="buyin" data-id="${p.id}">+ Indkøb (${kr(state.settings.buyinKr * 100)})</button>
          <button class="btn small" data-act="custom" data-id="${p.id}">+ Andet beløb</button>
        </div>
      </div>`;
  }

  function addPlayer(name) {
    name = name.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast(`${name} er allerede med`);
      return;
    }
    state.players.push({ id: uid(), name, buyins: [state.settings.buyinKr], chips: '' });
    if (!state.known.some(n => n.toLowerCase() === name.toLowerCase())) {
      state.known.push(name);
      state.known.sort((a, b) => a.localeCompare(b, 'da'));
    }
    save();
    renderPlayers();
  }

  $('#add-player-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#new-player-name');
    addPlayer(input.value);
    input.value = '';
  });

  $('#known-players').addEventListener('click', e => {
    const btn = e.target.closest('[data-add-known]');
    if (btn) addPlayer(btn.dataset.addKnown);
  });

  $('#player-list').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove-buyin]');
    if (rm) {
      const p = findPlayer(rm.dataset.id);
      const i = Number(rm.dataset.removeBuyin);
      if (p && confirm(`Fjern indkøb på ${kr(Math.round(p.buyins[i] * 100))} fra ${p.name}?`)) {
        p.buyins.splice(i, 1);
        save();
        renderPlayers();
      }
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = findPlayer(btn.dataset.id);
    if (!p) return;

    if (btn.dataset.act === 'buyin') {
      p.buyins.push(state.settings.buyinKr);
      save();
      renderPlayers();
      toast(`${p.name}: +${kr(state.settings.buyinKr * 100)}`);
    } else if (btn.dataset.act === 'custom') {
      openAmountDialog(p);
    } else if (btn.dataset.act === 'remove') {
      if (confirm(`Fjern ${p.name} fra spillet?`)) {
        state.players = state.players.filter(x => x !== p);
        save();
        renderPlayers();
      }
    }
  });

  // ---------- Eget beløb ----------
  function openAmountDialog(p) {
    amountTarget = p.id;
    $('#amount-title').textContent = `Indkøb for ${p.name}`;
    $('#amount-input').value = '';
    $('#amount-hint').textContent = sameRate() ? '' : `1 chip = ${kr(rateOre())}`;
    $('#amount-dialog').showModal();
    setTimeout(() => $('#amount-input').focus(), 50);
  }

  $('#amount-dialog').addEventListener('close', () => {
    const dlg = $('#amount-dialog');
    if (dlg.returnValue !== 'ok') return;
    const p = findPlayer(amountTarget);
    const v = parseNum($('#amount-input').value);
    if (!p || !v) return;
    p.buyins.push(v);
    save();
    renderPlayers();
    toast(`${p.name}: +${kr(Math.round(v * 100))}`);
  });

  // ---------- Optælling ----------
  function renderCount() {
    const list = $('#count-list');
    if (!state.players.length) {
      list.innerHTML = '<div class="empty">Ingen spillere endnu.</div>';
    } else {
      list.innerHTML = state.players
        .map(
          p => `
        <div class="count-row">
          <span class="name">${esc(p.name)}</span>
          <input type="text" inputmode="decimal" placeholder="Chips" value="${esc(p.chips)}" data-chips="${p.id}" aria-label="Chips for ${esc(p.name)}">
          <span class="sub" data-sub="${p.id}"></span>
        </div>`
        )
        .join('');
    }
    updateCountInfo();
  }

  function updateCountInfo() {
    const res = computeSettlement(state.players, state.settings, false);
    res.rows.forEach(r => {
      const el = document.querySelector(`[data-sub="${r.id}"]`);
      if (!el) return;
      let txt = `Købt ind for ${kr(r.boughtOre)}`;
      if (!sameRate() && res.rate > 0) txt += ` (${chipsTxt(r.boughtOre / res.rate)})`;
      if (r.chips !== null && res.rate > 0) {
        const net = Math.round(r.chips * res.rate - r.boughtOre);
        const cls = net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero';
        txt += ` · <span class="${cls}">${kr(net, { sign: true })}</span>`;
      }
      el.innerHTML = txt;
    });

    let status = '';
    if (!state.players.length) {
      status = '';
    } else if (res.missing.length) {
      status = `<div class="alert warn">Mangler optælling for: ${res.missing.map(esc).join(', ')}</div>`;
    } else if (res.balanced) {
      status = '<div class="alert ok">✓ Chipsene stemmer med indkøbet</div>';
    } else {
      const d = res.diffChips;
      status = `<div class="alert warn">Der er talt ${nfNum.format(Math.abs(d))} chips for ${d > 0 ? 'mange' : 'lidt'}. Tæl evt. igen — ellers kan forskellen fordeles på afregningssiden.</div>`;
    }

    $('#count-summary').innerHTML = `
      <div class="line"><span>Chips købt</span><b>${nfNum.format(res.expectedChips)}</b></div>
      <div class="line"><span>Chips talt</span><b>${nfNum.format(res.totalChips)}</b></div>
      ${status}
    `;
  }

  $('#count-list').addEventListener('input', e => {
    const id = e.target.dataset.chips;
    if (!id) return;
    const p = findPlayer(id);
    if (!p) return;
    p.chips = e.target.value;
    save();
    updateCountInfo();
  });

  $('#count-list').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.dataset.chips) return;
    const inputs = [...document.querySelectorAll('[data-chips]')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  });

  $('#btn-go-settle').addEventListener('click', () => show('settle'));

  // ---------- Afregning ----------
  function renderSettle() {
    const el = $('#settle-content');
    const res = computeSettlement(state.players, state.settings, state.adjust);

    if (state.players.length < 2) {
      el.innerHTML = '<div class="card empty">Der skal være mindst to spillere.</div>';
      return;
    }
    if (res.totalBoughtOre <= 0) {
      el.innerHTML = '<div class="card empty">Ingen har købt ind endnu.</div>';
      return;
    }
    if (res.missing.length) {
      el.innerHTML = `
        <div class="card">
          <h2>Mangler optælling</h2>
          <p class="muted">Skriv antal chips for: ${res.missing.map(esc).join(', ')}</p>
          <button class="btn primary" data-goto="count">Gå til optælling</button>
        </div>`;
      return;
    }
    if (res.totalChips <= 0) {
      el.innerHTML = `
        <div class="card">
          <h2>Ingen chips talt</h2>
          <p class="muted">Alle står til 0 chips. Tjek optællingen.</p>
          <button class="btn primary" data-goto="count">Gå til optælling</button>
        </div>`;
      return;
    }
    if (!res.transfers) {
      const d = res.diffChips;
      el.innerHTML = `
        <div class="card">
          <h2>Chipsene stemmer ikke</h2>
          <p class="muted">Der er købt ${nfNum.format(res.expectedChips)} chips, men talt ${nfNum.format(res.totalChips)} —
          altså ${nfNum.format(Math.abs(d))} chips for ${d > 0 ? 'mange' : 'lidt'}.</p>
          <div class="stack">
            <button class="btn" data-goto="count">Tæl igen</button>
            <button class="btn primary" id="btn-adjust">Fordel forskellen forholdsmæssigt</button>
          </div>
          <p class="muted small" style="margin-top:10px">Fordeling betyder, at værdien af én chip justeres en smule, så pengene går op.</p>
        </div>`;
      return;
    }

    const rows = res.rows.slice().sort((a, b) => b.netOre - a.netOre);
    const adjustNote =
      !res.balanced
        ? `<div class="alert warn">Forskel på ${nfNum.format(Math.abs(res.diffChips))} chips er fordelt: 1 chip = ${kr(res.orePerChip)} i stedet for ${kr(res.rate)}.
           <br><button class="btn small" id="btn-unadjust">Fortryd fordeling</button></div>`
        : '';

    const transfers = res.transfers.length
      ? res.transfers
          .map(
            t => `
          <div class="transfer">
            <span class="from">${esc(t.from)}</span>
            <span class="mid"><span class="amount">${kr(t.amount)}</span><span class="arrow">sender til →</span></span>
            <span class="to">${esc(t.to)}</span>
          </div>`
          )
          .join('')
      : '<p class="empty">Ingen skal overføre noget 🎉</p>';

    el.innerHTML = `
      <div class="card">
        <h2>Overførsler</h2>
        ${transfers}
        <button class="btn primary wide" id="btn-share">Del resultat</button>
      </div>
      <div class="card">
        <h2>Resultat</h2>
        ${rows
          .map(r => {
            const cls = r.netOre > 0 ? 'plus' : r.netOre < 0 ? 'minus' : 'zero';
            return `<div class="result-row"><span>${esc(r.name)}</span><span class="${cls}">${kr(r.netOre, { sign: true })}</span></div>`;
          })
          .join('')}
        ${adjustNote}
      </div>`;
  }

  function shareText(res) {
    const date = new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = [`♠ Pokeraften ${date}`, '', 'Overførsler:'];
    if (res.transfers.length) res.transfers.forEach(t => lines.push(`• ${t.from} → ${t.to}: ${kr(t.amount)}`));
    else lines.push('Ingen skal overføre noget');
    lines.push('', 'Resultat:');
    res.rows
      .slice()
      .sort((a, b) => b.netOre - a.netOre)
      .forEach(r => lines.push(`${r.name}: ${kr(r.netOre, { sign: true })}`));
    return lines.join('\n');
  }

  $('#settle-content').addEventListener('click', async e => {
    const go = e.target.closest('[data-goto]');
    if (go) return show(go.dataset.goto);

    if (e.target.id === 'btn-adjust') {
      state.adjust = true;
      save();
      renderSettle();
    } else if (e.target.id === 'btn-unadjust') {
      state.adjust = false;
      save();
      renderSettle();
    } else if (e.target.id === 'btn-share') {
      const res = computeSettlement(state.players, state.settings, state.adjust);
      if (!res.transfers) return;
      const text = shareText(res);
      if (navigator.share) {
        try {
          await navigator.share({ text });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        toast('Kopieret — indsæt i jeres gruppechat');
      } catch (err) {
        prompt('Kopiér teksten:', text);
      }
    }
  });

  // ---------- Indstillinger ----------
  function renderSettings() {
    const s = state.settings;
    $('#set-buyin-kr').value = nfNum.format(s.buyinKr).replace(/\./g, '');
    $('#set-buyin-chips').value = nfNum.format(s.buyinChips).replace(/\./g, '');
    $('#set-round').checked = s.roundWhole;
    $('#set-rate').textContent = rateOre() > 0 ? `1 chip = ${kr(rateOre())}` : 'Antal chips skal være større end 0';
    renderSavedNames();
  }

  function renderSavedNames() {
    $('#saved-names').innerHTML = state.known.length
      ? state.known.map(n => `<button type="button" class="pill removable" data-forget="${esc(n)}">${esc(n)}</button>`).join('')
      : '<span class="muted small">Ingen gemte navne endnu</span>';
  }

  $('#btn-settings').addEventListener('click', () => {
    renderSettings();
    $('#settings-dialog').showModal();
  });

  function onSettingInput() {
    const k = parseNum($('#set-buyin-kr').value);
    const c = parseNum($('#set-buyin-chips').value);
    if (k !== null && k > 0) state.settings.buyinKr = k;
    if (c !== null && c > 0) state.settings.buyinChips = c;
    state.settings.roundWhole = $('#set-round').checked;
    $('#set-rate').textContent = rateOre() > 0 ? `1 chip = ${kr(rateOre())}` : '';
    save();
  }
  ['#set-buyin-kr', '#set-buyin-chips'].forEach(sel => {
    $(sel).addEventListener('input', onSettingInput);
  });
  $('#set-round').addEventListener('change', onSettingInput);

  $('#saved-names').addEventListener('click', e => {
    const btn = e.target.closest('[data-forget]');
    if (!btn) return;
    state.known = state.known.filter(n => n !== btn.dataset.forget);
    save();
    renderSavedNames();
  });

  $('#btn-new-same').addEventListener('click', () => {
    if (!confirm('Start et nyt spil? Indkøb og optælling nulstilles, men spillerne bliver.')) return;
    state.players = state.players.map(p => ({ ...p, buyins: [state.settings.buyinKr], chips: '' }));
    state.adjust = false;
    save();
    $('#settings-dialog').close();
    show('players');
    toast('Nyt spil startet');
  });

  $('#btn-new-empty').addEventListener('click', () => {
    if (!confirm('Start et nyt spil uden spillere? (Gemte navne bliver husket.)')) return;
    state.players = [];
    state.adjust = false;
    save();
    $('#settings-dialog').close();
    show('players');
    toast('Nyt spil startet');
  });

  $('#settings-dialog').addEventListener('close', render);

  // Luk dialog ved tryk på baggrunden
  document.querySelectorAll('dialog').forEach(dlg =>
    dlg.addEventListener('click', e => {
      if (e.target === dlg) dlg.close();
    })
  );

  // ---------- Start ----------
  document.querySelector('.tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) show(tab.dataset.view);
  });

  show('players');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
