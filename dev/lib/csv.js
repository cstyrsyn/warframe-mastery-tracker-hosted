// csv.js — shared CSV parsing and JS string-escaping utilities for dev scripts
'use strict';

// RFC 4180-compliant field splitter with "" escape support.
// Returns raw (untrimmed) fields; callers trim as needed.
function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// Normalize unicode whitespace and strip non-printable chars.
function cleanStr(s) {
  return (s || '')
    .replace(/[ ​‌‍ 　﻿­]/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Format s as a double-quoted JS string literal.
function jsD(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Escape string content for embedding inside single-quoted JS literals.
// Does NOT add surrounding quotes — use jsS for a complete literal.
function jsEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '');
}

// Format s as a single-quoted JS string literal.
function jsS(s) {
  return "'" + jsEsc(String(s)) + "'";
}

// Format an array of strings as a JS array literal of single-quoted strings.
function jsSArr(arr) {
  return '[' + arr.map(jsS).join(',') + ']';
}

module.exports = { parseCSVLine, cleanStr, jsD, jsEsc, jsS, jsSArr };
