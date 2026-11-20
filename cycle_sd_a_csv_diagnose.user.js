// ==UserScript==
// @name         cycle_sd CSV Dot Downloader
// @namespace    local.tools.cycle_sd
// @version      0.2.0
// @description  Click a dot to choose cycle_sd_b/cycle_sd_c/cycle_sd_d, download matching tables as CSV, then remove injected UI.
// @match        *://logistics.amazon.co.uk/internal/*
// @author       Akshay(akparaks)
// @run-at       document-idle
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/<USER>/<REPO>/<BRANCH>/cycle_sd_a_csv_diagnose.user.js
// @downloadURL  https://raw.githubusercontent.com/<USER>/<REPO>/<BRANCH>/cycle_sd_a_csv_diagnose.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Auto-update: replace <USER>, <REPO>, and <BRANCH> in @updateURL/@downloadURL with your GitHub raw script URL.
  const TARGETS = ['cycle_sd_b', 'cycle_sd_c', 'cycle_sd_d'];
  const ROOT_ID = 'cycle-sd-dot-root';

  if (window.top !== window.self) return;
  if (document.getElementById(ROOT_ID)) return;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style' && v && typeof v === 'object') {
        Object.assign(node.style, v);
      } else if (k === 'className') {
        node.className = v;
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v);
      } else if (v !== undefined && v !== null) {
        node.setAttribute(k, String(v));
      }
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function textOf(node) {
    if (!node) return '';
    return (node.innerText ?? node.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function cssPath(node, maxDepth = 5) {
    if (!node || node.nodeType !== 1) return '';
    const parts = [];
    let cur = node;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < maxDepth) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${CSS.escape(cur.id)}`;
        parts.unshift(part);
        break;
      }
      if (cur.classList && cur.classList.length) {
        const classes = Array.from(cur.classList).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
        part += classes;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function getTableMatrix(table) {
    const matrix = [];
    const rows = Array.from(table.rows || []);
    for (let r = 0; r < rows.length; r++) {
      if (!matrix[r]) matrix[r] = [];
      let c = 0;
      for (const cell of Array.from(rows[r].cells || [])) {
        while (matrix[r][c] != null) c++;
        const value = textOf(cell);
        const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
        for (let rr = 0; rr < rowspan; rr++) {
          for (let cc = 0; cc < colspan; cc++) {
            const tr = r + rr;
            const tc = c + cc;
            if (!matrix[tr]) matrix[tr] = [];
            matrix[tr][tc] = (rr === 0 && cc === 0) ? value : '';
          }
        }
        c += colspan;
      }
    }
    return matrix.map(row => row.map(v => (v == null ? '' : String(v))));
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function matrixToCsv(matrix) {
    return matrix.map(row => row.map(csvEscape).join(',')).join('\r\n');
  }

  function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function uniqueNodes(nodes) {
    const seen = new Set();
    const out = [];
    for (const n of nodes) {
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  function findCandidateRoots(target) {
    const t = String(target || '').toLowerCase();
    const candidates = [];
    const byId = document.getElementById(target);
    if (byId) candidates.push(byId);

    try {
      document.querySelectorAll(`[id*="${target}" i], [name*="${target}" i], [class*="${target}" i], [data-id*="${target}" i], [data-name*="${target}" i]`).forEach(n => candidates.push(n));
    } catch (_) {}

    try {
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
      let count = 0;
      while (walker.nextNode() && count < 4000) {
        count++;
        const n = walker.currentNode;
        const id = (n.id || '').toLowerCase();
        const cls = (typeof n.className === 'string' ? n.className : '').toLowerCase();
        const name = (n.getAttribute && (n.getAttribute('name') || '')).toLowerCase();
        if (id.includes(t) || cls.includes(t) || name.includes(t)) candidates.push(n);
      }
    } catch (_) {}

    return uniqueNodes(candidates);
  }

  function findTargetTables(target) {
    const t = String(target || '').toLowerCase();
    const roots = findCandidateRoots(target);
    const tables = [];

    for (const root of roots) {
      if (!root || root.nodeType !== 1) continue;
      if (root.tagName === 'TABLE') tables.push(root);
      if (root.querySelectorAll) root.querySelectorAll('table').forEach(tbl => tables.push(tbl));
      if (root.closest) {
        const parentTable = root.closest('table');
        if (parentTable) tables.push(parentTable);
      }
    }

    if (!tables.length) {
      document.querySelectorAll('table').forEach(tbl => {
        const sig = [
          tbl.id,
          tbl.className,
          tbl.getAttribute && tbl.getAttribute('name'),
          tbl.getAttribute && tbl.getAttribute('aria-label'),
          textOf(tbl.caption),
          textOf(tbl.closest ? tbl.closest('section,div,article,main') : null).slice(0, 400)
        ].filter(Boolean).join(' ').toLowerCase();
        if (sig.includes(t)) tables.push(tbl);
      });
    }

    return uniqueNodes(tables);
  }

  async function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch (_) {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
    return false;
  }

  function buildDiagnostics(target) {
    const roots = findCandidateRoots(target);
    const tables = findTargetTables(target);
    return {
      script: { name: 'cycle_sd CSV Dot Downloader', version: '0.2.0', target, collectedAt: new Date().toISOString() },
      page: { url: location.href, title: document.title, readyState: document.readyState },
      matches: { candidateRootCount: roots.length, tableCount: tables.length },
      frameworks: {
        dataTables: !!document.querySelector('.dataTables_wrapper, .dt-container, table.dataTable'),
        agGrid: !!document.querySelector('.ag-root, .ag-center-cols-container, [class*="ag-theme"]'),
        handsontable: !!document.querySelector('.handsontable, .ht_master'),
        tabulator: !!document.querySelector('.tabulator'),
        reactTableLike: !!document.querySelector('[role="grid"], [role="table"]'),
        iframes: document.querySelectorAll('iframe').length,
      },
      candidateRoots: roots.slice(0, 20).map((r, i) => ({
        index: i,
        tag: r.tagName ? r.tagName.toLowerCase() : null,
        id: r.id || null,
        name: r.getAttribute ? r.getAttribute('name') : null,
        className: typeof r.className === 'string' ? r.className : null,
        cssPath: cssPath(r),
        childTableCount: r.querySelectorAll ? r.querySelectorAll('table').length : 0,
        roleRows: r.querySelectorAll ? r.querySelectorAll('[role="row"]').length : 0,
        roleCells: r.querySelectorAll ? r.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"]').length : 0,
        textPreview: textOf(r).slice(0, 250),
      })),
      tables: tables.map((t, i) => {
        const headerRow = t.querySelector('thead tr') || t.rows[0];
        const headers = headerRow ? Array.from(headerRow.cells || []).map(textOf).slice(0, 30) : [];
        return {
          index: i,
          id: t.id || null,
          className: typeof t.className === 'string' ? t.className : null,
          rowCount: t.rows ? t.rows.length : null,
          headerPreview: headers,
          sampleRows: getTableMatrix(t).slice(0, 3),
          cssPath: cssPath(t),
        };
      }),
      notes: [
        ...(!roots.length ? [`No elements matched '${target}'.`] : []),
        ...(roots.length && !tables.length ? [`Found candidate element(s) for '${target}' but no <table> elements; data may be in a non-table grid or loaded dynamically.`] : []),
        ...(document.querySelectorAll('iframe').length ? ['Page contains iframe(s); target content may be inside a frame.'] : []),
      ],
    };
  }

  function removeEverything() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
  }

  function downloadForTarget(target) {
    const tables = findTargetTables(target);
    if (!tables.length) {
      alert(`No tables found for '${target}'. Use Diagnose to inspect the page structure.`);
      return false;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let exported = 0;
    tables.forEach((table, i) => {
      const matrix = getTableMatrix(table);
      if (!matrix.length) return;
      const csv = matrixToCsv(matrix);
      const suffix = tables.length === 1 ? '' : `_table${i + 1}`;
      downloadText(`${target}${suffix}_${stamp}.csv`, csv);
      exported++;
    });
    if (!exported) {
      alert(`Matched table(s) for '${target}' were empty.`);
      return false;
    }
    return true;
  }

  async function diagnoseForTarget(target) {
    const diag = buildDiagnostics(target);
    const json = JSON.stringify(diag, null, 2);
    console.log(`[${target} diagnose]`, diag);
    const copied = await copyToClipboard(json);
    try {
      window.prompt(copied ? `Diagnostics for ${target} copied to clipboard (Ctrl+C if needed):` : `Diagnostics for ${target} (copy manually):`, json);
    } catch (_) {
      alert(copied ? `Diagnostics for ${target} copied to clipboard.` : `Diagnostics for ${target} logged to console.`);
    }
  }

  function closeChooser() {
    const chooser = document.getElementById('cycle-sd-dot-chooser');
    if (chooser) chooser.remove();
  }

  function showChooser() {
    closeChooser();
    const chooser = el('div', {
      id: 'cycle-sd-dot-chooser',
      style: {
        position: 'fixed',
        right: '14px',
        bottom: '48px',
        zIndex: '2147483647',
        background: '#fff',
        color: '#111',
        border: '1px solid #bbb',
        borderRadius: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,.2)',
        padding: '8px',
        font: '12px Arial, sans-serif',
        minWidth: '170px',
      }
    }, [
      el('div', { style: { fontWeight: 'bold', marginBottom: '6px' } }, ['Download CSV for:']),
      ...TARGETS.map(t => el('button', {
        type: 'button',
        style: { display: 'block', width: '100%', margin: '4px 0', padding: '5px 8px', cursor: 'pointer' },
        onclick: () => {
          closeChooser();
          downloadForTarget(t);
          removeEverything();
        }
      }, [t])),
      el('button', {
        type: 'button',
        title: 'Collect diagnostics (does not remove UI until you close this chooser flow)',
        style: { display: 'block', width: '100%', margin: '6px 0 0', padding: '5px 8px', cursor: 'pointer' },
        onclick: async () => {
          const choice = window.prompt(`Diagnose which target? (${TARGETS.join(', ')})`, TARGETS[0]);
          if (!choice) return;
          const normalized = String(choice).trim().toLowerCase();
          const target = TARGETS.find(t => t.toLowerCase() === normalized);
          if (!target) {
            alert(`Please enter one of: ${TARGETS.join(', ')}`);
            return;
          }
          closeChooser();
          await diagnoseForTarget(target);
          // Keep dot available after diagnose so user can still download once structure is known.
        }
      }, ['Diagnose...']),
      el('button', {
        type: 'button',
        style: { display: 'block', width: '100%', margin: '4px 0 0', padding: '5px 8px', cursor: 'pointer' },
        onclick: () => {
          closeChooser();
          removeEverything();
        }
      }, ['Cancel & Remove']),
    ]);

    document.documentElement.appendChild(chooser);
  }

  function createDot() {
    const root = el('div', { id: ROOT_ID });
    const dot = el('button', {
      type: 'button',
      title: 'Download cycle_sd CSV',
      'aria-label': 'Download cycle_sd CSV',
      style: {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        border: '1px solid #333',
        background: '#1e88e5',
        padding: '0',
        margin: '0',
        cursor: 'pointer',
        zIndex: '2147483647',
        boxShadow: '0 2px 6px rgba(0,0,0,.3)',
      },
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const existing = document.getElementById('cycle-sd-dot-chooser');
        if (existing) closeChooser(); else showChooser();
      }
    });
    root.appendChild(dot);
    document.documentElement.appendChild(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDot, { once: true });
  } else {
    createDot();
  }
})();
