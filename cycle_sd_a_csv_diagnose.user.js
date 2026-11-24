// ==UserScript==
// @name         cycle_sd CSV Dot Downloader (TEST - no watchdog)
// @namespace    local.tools.cycle_sd.test
// @version      1.6.0-test
// @description  Test copy: table-title buttons download individual CSVs. No auto-update watchdog.
// @match        *://logistics.amazon.co.uk/internal/*
// @author       Akshay(akparaks)
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const TARGETS = ['cycle_sd_a', 'cycle_sd_b', 'cycle_sd_c', 'cycle_sd_d'];
  const ROOT_ID = 'cycle-sd-dot-root-test';
  const CHOOSER_ID = 'cycle-sd-dot-chooser-test';

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

  function cleanLabel(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function safeFileName(value) {
    return cleanLabel(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'table';
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
      document.querySelectorAll(`[id*="${target}" i], [name*="${target}" i], [class*="${target}" i], [data-id*="${target}" i], [data-name*="${target}" i], [title*="${target}" i], [aria-label*="${target}" i]`).forEach(n => candidates.push(n));
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
        const title = (n.getAttribute && (n.getAttribute('title') || '')).toLowerCase();
        const aria = (n.getAttribute && (n.getAttribute('aria-label') || '')).toLowerCase();
        if (id.includes(t) || cls.includes(t) || name.includes(t) || title.includes(t) || aria.includes(t)) candidates.push(n);
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
          tbl.getAttribute && tbl.getAttribute('title'),
          tbl.getAttribute && tbl.getAttribute('data-title'),
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

  function tableTitle(table, fallbackIndex) {
    if (!table) return `Table ${fallbackIndex}`;

    const candidates = [
      cleanLabel(table.getAttribute && table.getAttribute('title')),
      cleanLabel(table.caption && textOf(table.caption)),
      cleanLabel(table.getAttribute && table.getAttribute('aria-label')),
      cleanLabel(table.getAttribute && table.getAttribute('data-title')),
      cleanLabel(table.getAttribute && table.getAttribute('name')),
    ];

    // A nearby heading is often the visible "title" of a table.
    let sibling = table.previousElementSibling;
    for (let i = 0; i < 3 && sibling; i++) {
      if (/^H[1-6]$/.test(sibling.tagName) || sibling.getAttribute('role') === 'heading') {
        candidates.push(cleanLabel(textOf(sibling)));
        break;
      }
      sibling = sibling.previousElementSibling;
    }

    const titledAncestor = table.closest ? table.closest('[title], [aria-label]') : null;
    if (titledAncestor) {
      candidates.push(cleanLabel(titledAncestor.getAttribute('title')));
      candidates.push(cleanLabel(titledAncestor.getAttribute('aria-label')));
    }

    return candidates.find(Boolean) || `Table ${fallbackIndex}`;
  }

  // Discover cycle_sd_a-d tables first, then every remaining table, listed individually by title.
  function discoverTableEntries() {
    const entries = [];
    const seen = new Set();

    function add(table, target) {
      if (!table || seen.has(table)) return;
      seen.add(table);
      entries.push({ table, label: tableTitle(table, entries.length + 1), target });
    }

    for (const target of TARGETS) {
      findTargetTables(target).forEach(table => add(table, target));
    }
    document.querySelectorAll('table').forEach(table => add(table, ''));

    return entries;
  }

  function downloadTable(table, label, target) {
    const matrix = getTableMatrix(table);
    if (!matrix.length) {
      alert(`Table '${label}' is empty.`);
      return false;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = [target, safeFileName(label)].filter(Boolean).join('_');
    downloadText(`${base}_${stamp}.csv`, matrixToCsv(matrix));
    return true;
  }

  function downloadAll(entries) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let exported = 0;
    entries.forEach((item, i) => {
      const matrix = getTableMatrix(item.table);
      if (!matrix.length) return;
      const base = [item.target, safeFileName(item.label)].filter(Boolean).join('_');
      downloadText(`${String(i + 1).padStart(2, '0')}_${base}_${stamp}.csv`, matrixToCsv(matrix));
      exported++;
    });
    if (!exported) alert('No non-empty tables found.');
    return exported > 0;
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
    const chooser = document.getElementById(CHOOSER_ID);
    if (chooser) chooser.remove();
  }

  function showChooser() {
    closeChooser();
    const entries = discoverTableEntries();
    const children = [
      el('div', { style: { fontWeight: 'bold', marginBottom: '6px' } }, [`Tables found (${entries.length}) — click a title to download CSV`]),
    ];

    if (!entries.length) {
      children.push(el('div', { style: { color: '#666', lineHeight: '1.4' } }, ['No tables found on this page.']));
    } else {
      children.push(el('button', {
        type: 'button',
        style: {
          display: 'block', width: '100%', margin: '4px 0', padding: '4px 8px', cursor: 'pointer',
          background: '#eef5ff', border: '1px solid #9dc1ef', borderRadius: '4px', textAlign: 'left',
        },
        onclick: () => {
          closeChooser();
          downloadAll(entries);
        },
      }, [`Download all CSVs (${entries.length})`]));

      for (const item of entries) {
        const rows = item.table.rows ? item.table.rows.length : 0;
        const tip = [item.target, item.label, rows ? `${rows} rows` : ''].filter(Boolean).join(' — ');
        children.push(el('button', {
          type: 'button',
          title: tip,
          style: {
            display: 'block', width: '100%', margin: '4px 0', padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
            background: '#fff', border: '1px solid #ccc', borderRadius: '4px',
          },
          onclick: () => {
            closeChooser();
            downloadTable(item.table, item.label, item.target);
          },
        }, [item.label]));
      }
    }

    const chooser = el('div', {
      id: CHOOSER_ID,
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
        minWidth: '260px',
        maxWidth: '320px',
        maxHeight: '70vh',
        overflowY: 'auto',
      }
    }, children);

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
        const existing = document.getElementById(CHOOSER_ID);
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
