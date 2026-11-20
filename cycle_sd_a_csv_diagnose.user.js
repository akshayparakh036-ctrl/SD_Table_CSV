// ==UserScript==
// @name         cycle_sd CSV Dot Downloader
// @namespace    local.tools.cycle_sd
// @version      0.2.0
// @description  Click a dot to choose cycle_sd_b/cycle_sd_c/cycle_sd_d, download matching tables as CSV, then remove injected UI.
// @match        *://logistics.amazon.co.uk/internal/*
// @author       Akshay(akparaks)
// @run-at       document-idle
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/akshayparakh036-ctrl/SD_Table_CSV/refs/heads/main/cycle_sd_a_csv_diagnose.user.js
// @downloadURL  https://raw.githubusercontent.com/akshayparakh036-ctrl/SD_Table_CSV/refs/heads/main/cycle_sd_a_csv_diagnose.user.js
// ==/UserScript==
(function () {
  'use strict';

  // Auto-update: replace <USER>, <REPO>, and <BRANCH> in @updateURL/@downloadURL with your GitHub raw script URL.
  const TARGETS = ['cycle_sd_a', 'cycle_sd_b', 'cycle_sd_c', 'cycle_sd_d'];
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
