import { extname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import * as yaml from 'js-yaml';
import * as TOML from 'smol-toml';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: false,
});

const xmlOrderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: true,
  trimValues: false,
});

const EXT_LANG = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.r': 'r',
  '.lua': 'lua', '.sql': 'sql', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.ps1': 'powershell', '.psm1': 'powershell', '.cmd': 'dos', '.bat': 'dos',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.xhtml': 'xml', '.vue': 'xml', '.svelte': 'xml',
  '.json': 'json', '.jsonc': 'json', '.jsonl': 'json', '.ndjson': 'json',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.tex': 'latex', '.bib': 'plaintext', '.diff': 'diff', '.patch': 'diff',
  '.proto': 'protobuf', '.graphql': 'graphql', '.gql': 'graphql',
  '.dockerfile': 'dockerfile', '.makefile': 'makefile', '.mk': 'makefile',
};

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
};

export function mimeForExt(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

export function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function sanitizeHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<(iframe|object|embed|applet|base|meta|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1=$2#$2');
  return s;
}

export function decodeTextBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf-8'), encoding: 'UTF-8 BOM' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('gb18030').decode(buf), encoding: 'GB18030' };
  }
}

export function classifyExtension(fileName) {
  const lower = fileName.toLowerCase();
  const ext = extname(lower);
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.odt') return 'odt';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.doc') return 'doc_legacy';
  if (['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv'].includes(ext)) return 'spreadsheet';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.odp') return 'odp';
  if (ext === '.epub') return 'epub';
  if (ext === '.ipynb') return 'ipynb';
  if (['.md', '.markdown', '.mdx'].includes(ext)) return 'markdown';
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.svg') return 'svg';
  if (['.json', '.jsonc', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.xml'].includes(ext)) return 'structured';
  if (['.sqlite', '.sqlite3', '.db'].includes(ext)) return 'sqlite';
  if (['.zip', '.jar', '.whl', '.apk'].includes(ext)) return 'archive';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus'].includes(ext)) return 'audio';
  if (['.mp4', '.webm', '.mov', '.m4v', '.mkv'].includes(ext)) return 'video';
  if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) return 'font';
  if (['.exe', '.dll', '.so', '.dylib', '.bin', '.pyc', '.wasm', '.7z', '.rar'].includes(ext)) return 'binary';
  return 'code';
}

export function renderMarkdownHtml(text) {
  const toc = [];
  const slugCounts = new Map();
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const plain = inner.replace(/<[^>]+>/g, '').trim();
        const base = plain.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'sec';
        const cnt = (slugCounts.get(base) || 0) + 1;
        slugCounts.set(base, cnt);
        const id = cnt === 1 ? base : `${base}-${cnt}`;
        toc.push({ level: depth, text: plain, id });
        return `<h${depth} id="${escHtml(id)}">${inner}</h${depth}>\n`;
      },
      code({ text: codeText, lang }) {
        const cleanLang = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        let highlighted;
        if (cleanLang && hljs.getLanguage(cleanLang)) {
          highlighted = hljs.highlight(codeText, { language: cleanLang, ignoreIllegals: true }).value;
        } else {
          highlighted = escHtml(codeText);
        }
        return `<pre class="code-block"><code class="hljs language-${escHtml(cleanLang || 'text')}">${highlighted}</code></pre>\n`;
      },
    },
  });
  const html = sanitizeHtml(m.parse(String(text ?? '')));
  return { html, toc };
}

export function highlightCode(text, ext, fileName) {
  const MAX_HL_BYTES = 512 * 1024;
  const base = basename(fileName).toLowerCase();
  let lang = EXT_LANG[ext.toLowerCase()];
  if (!lang) {
    if (base === 'dockerfile') lang = 'dockerfile';
    else if (base === 'makefile') lang = 'makefile';
    else if (base.startsWith('.env')) lang = 'ini';
  }
  const safeText = String(text ?? '');
  if (safeText.length > MAX_HL_BYTES) {
    return { lang: lang || 'plaintext', lines: safeText.split(/\r?\n/).map(escHtml), truncatedHighlight: true };
  }
  let html;
  if (lang && hljs.getLanguage(lang)) {
    html = hljs.highlight(safeText, { language: lang, ignoreIllegals: true }).value;
  } else {
    html = escHtml(safeText);
  }
  return { lang: lang || 'plaintext', html, truncatedHighlight: false };
}

export async function parseDocxReader(buf) {
  const result = await mammoth.convertToHtml({ buffer: buf });
  return {
    html: sanitizeHtml(result.value || '<p class="muted">（文档内容为空）</p>'),
    messages: (result.messages || []).map((m) => m.message).slice(0, 20),
  };
}

export function parseWorkbook(buf, ext, opts = {}) {
  const lower = ext.toLowerCase();
  let wb;
  let encoding = 'binary';
  if (lower === '.csv' || lower === '.tsv') {
    const dec = decodeTextBuffer(buf);
    encoding = dec.encoding;
    wb = XLSX.read(dec.text, { type: 'string', FS: lower === '.tsv' ? '\t' : undefined, raw: false });
  } else {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellNF: true, cellStyles: false });
  }
  const sheetNames = wb.SheetNames || [];
  const idx = Math.max(0, Math.min(Number(opts.sheetIndex) || 0, Math.max(0, sheetNames.length - 1)));
  const sheetName = sheetNames[idx] || '';
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws || !ws['!ref']) {
    return { sheetNames, sheetIndex: idx, sheetName, encoding, totalRows: 0, filteredRows: 0, totalCols: 0, page: 0, pageSize: 200, rows: [], merges: [] };
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const totalRows = Math.max(0, range.e.r - range.s.r + 1);
  const totalCols = Math.min(200, Math.max(0, range.e.c - range.s.c + 1));
  const filterText = String(opts.filter || '').trim().toLowerCase();
  const pageSize = Math.min(500, Math.max(50, Number(opts.pageSize) || 200));
  const page = Math.max(0, Number(opts.page) || 0);

  const allRows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    let rowMatch = !filterText;
    for (let c = range.s.c; c < range.s.c + totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      let display = '';
      let formula = '';
      if (cell) {
        if (cell.t === 'd' && cell.v instanceof Date) {
          display = Number.isNaN(cell.v.getTime()) ? String(cell.w ?? '') : cell.v.toISOString().slice(0, 19).replace('T', ' ');
        } else {
          display = cell.w != null ? String(cell.w) : (cell.v != null ? String(cell.v) : '');
        }
        if (cell.f) formula = '=' + cell.f;
      }
      if (!rowMatch && display.toLowerCase().includes(filterText)) rowMatch = true;
      cells.push(formula ? { v: display, f: formula } : display);
    }
    if (rowMatch) {
      allRows.push({ rowNum: r + 1, cells });
    }
  }

  const start = page * pageSize;
  const pagedRows = allRows.slice(start, start + pageSize);
  const merges = (ws['!merges'] || []).slice(0, 500).map((m) => ({
    sr: m.s.r, sc: m.s.c, er: m.e.r, ec: m.e.c,
  }));

  return {
    sheetNames,
    sheetIndex: idx,
    sheetName,
    encoding,
    totalRows,
    filteredRows: allRows.length,
    totalCols,
    page,
    pageSize,
    rows: pagedRows,
    merges,
  };
}

function asArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function resolveZipPath(baseFile, target) {
  if (!target) return '';
  const cleanTarget = String(target).replace(/\\/g, '/');
  if (cleanTarget.startsWith('/')) return cleanTarget.slice(1);
  const parts = baseFile.replace(/\\/g, '/').split('/');
  parts.pop();
  for (const seg of cleanTarget.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

async function readZipRels(zip, partPath) {
  const dir = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/') + 1) : '';
  const file = partPath.includes('/') ? partPath.slice(partPath.lastIndexOf('/') + 1) : partPath;
  const relPath = `${dir}_rels/${file}.rels`;
  const entry = zip.file(relPath);
  const map = new Map();
  if (!entry) return map;
  const parsed = xmlParser.parse(await entry.async('string'));
  for (const rel of asArray(parsed?.Relationships?.Relationship)) {
    if (rel['@_Id'] && rel['@_Target']) {
      map.set(rel['@_Id'], {
        target: resolveZipPath(partPath, rel['@_Target']),
        type: rel['@_Type'] || '',
      });
    }
  }
  return map;
}

async function zipImageToDataUri(zip, path) {
  if (!path) return null;
  const entry = zip.file(path);
  if (!entry) return null;
  const buf = await entry.async('nodebuffer');
  const mime = mimeForExt(extname(path));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function extractPptxParagraphs(txBody) {
  if (!txBody) return [];
  const paragraphs = [];
  for (const p of asArray(txBody['a:p'])) {
    const pPr = p['a:pPr'] || {};
    const align = pPr['@_algn'] || '';
    const lvl = Number(pPr['@_lvl'] || 0);
    const hasBullet = Boolean(pPr['a:buChar'] || pPr['a:buAutoNum']) && !pPr['a:buNone'];
    const runs = [];
    const walkRuns = (node) => {
      for (const r of asArray(node['a:r'])) {
        const rPr = r['a:rPr'] || {};
        const txt = r['a:t'] != null ? String(typeof r['a:t'] === 'object' ? r['a:t']['#text'] ?? '' : r['a:t']) : '';
        if (!txt) continue;
        const sz = rPr['@_sz'] ? Number(rPr['@_sz']) / 100 : null;
        const bold = rPr['@_b'] === '1' || rPr['@_b'] === true;
        const italic = rPr['@_i'] === '1' || rPr['@_i'] === true;
        const colorHex = rPr['a:solidFill']?.['a:srgbClr']?.['@_val'];
        runs.push({ text: txt, sz, bold, italic, color: colorHex ? `#${colorHex}` : null });
      }
      for (const fld of asArray(node['a:fld'])) {
        const txt = fld['a:t'] != null ? String(typeof fld['a:t'] === 'object' ? fld['a:t']['#text'] ?? '' : fld['a:t']) : '';
        if (txt) runs.push({ text: txt });
      }
    };
    walkRuns(p);
    if (p['a:br']) runs.push({ text: '\n' });
    const fullText = runs.map((r) => r.text).join('');
    if (fullText.trim() || paragraphs.length > 0) {
      paragraphs.push({ align, lvl, hasBullet, runs });
    }
  }
  return paragraphs;
}

export async function parsePptx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const presXml = zip.file('ppt/presentation.xml');
  let slidePaths = [];
  let slideWidth = 9144000;
  let slideHeight = 5143500;

  if (presXml) {
    const pres = xmlParser.parse(await presXml.async('string'))?.['p:presentation'];
    const sldSz = pres?.['p:sldSz'];
    if (sldSz?.['@_cx'] && sldSz?.['@_cy']) {
      slideWidth = Number(sldSz['@_cx']);
      slideHeight = Number(sldSz['@_cy']);
    }
    const rels = await readZipRels(zip, 'ppt/presentation.xml');
    for (const sldId of asArray(pres?.['p:sldIdLst']?.['p:sldId'])) {
      const rId = sldId['@_r:id'];
      const rel = rels.get(rId);
      if (rel?.target && zip.file(rel.target)) slidePaths.push(rel.target);
    }
  }
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0));
  }

  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const sPath = slidePaths[i];
    const sldRaw = xmlParser.parse(await zip.file(sPath).async('string'))?.['p:sld'];
    const sRels = await readZipRels(zip, sPath);
    const spTree = sldRaw?.['p:cSld']?.['p:spTree'] || {};

    let bg = null;
    const bgClr = sldRaw?.['p:cSld']?.['p:bg']?.['p:bgPr']?.['a:solidFill']?.['a:srgbClr']?.['@_val'];
    if (bgClr) bg = `#${bgClr}`;

    const elements = [];
    const collectShapes = async (group, ox = 0, oy = 0, sx = 1, sy = 1) => {
      for (const sp of asArray(group['p:sp'])) {
        const xfrm = sp['p:spPr']?.['a:xfrm'];
        const off = xfrm?.['a:off'];
        const ext = xfrm?.['a:ext'];
        const x = off ? (ox + Number(off['@_x'] || 0) * sx) : 0;
        const y = off ? (oy + Number(off['@_y'] || 0) * sy) : 0;
        const w = ext ? Number(ext['@_cx'] || 0) * sx : slideWidth * 0.8;
        const h = ext ? Number(ext['@_cy'] || 0) * sy : slideHeight * 0.15;
        const paragraphs = extractPptxParagraphs(sp['p:txBody']);
        const fillHex = sp['p:spPr']?.['a:solidFill']?.['a:srgbClr']?.['@_val'];
        if (paragraphs.length > 0 || fillHex) {
          elements.push({
            kind: 'text',
            xPct: (x / slideWidth) * 100,
            yPct: (y / slideHeight) * 100,
            wPct: (w / slideWidth) * 100,
            hPct: (h / slideHeight) * 100,
            fill: fillHex ? `#${fillHex}` : null,
            paragraphs,
          });
        }
      }
      for (const pic of asArray(group['p:pic'])) {
        const rId = pic['p:blipFill']?.['a:blip']?.['@_r:embed'];
        const rel = rId ? sRels.get(rId) : null;
        const dataUri = rel ? await zipImageToDataUri(zip, rel.target) : null;
        if (!dataUri) continue;
        const xfrm = pic['p:spPr']?.['a:xfrm'];
        const off = xfrm?.['a:off'];
        const ext = xfrm?.['a:ext'];
        elements.push({
          kind: 'image',
          xPct: off ? ((ox + Number(off['@_x'] || 0) * sx) / slideWidth) * 100 : 10,
          yPct: off ? ((oy + Number(off['@_y'] || 0) * sy) / slideHeight) * 100 : 10,
          wPct: ext ? ((Number(ext['@_cx'] || 0) * sx) / slideWidth) * 100 : 50,
          hPct: ext ? ((Number(ext['@_cy'] || 0) * sy) / slideHeight) * 100 : 50,
          dataUri,
        });
      }
      for (const gf of asArray(group['p:graphicFrame'])) {
        const tbl = gf['a:graphic']?.['a:graphicData']?.['a:tbl'];
        if (!tbl) continue;
        const xfrm = gf['p:xfrm'];
        const off = xfrm?.['a:off'];
        const ext = xfrm?.['a:ext'];
        const rows = [];
        for (const tr of asArray(tbl['a:tr'])) {
          const row = [];
          for (const tc of asArray(tr['a:tc'])) {
            const paras = extractPptxParagraphs(tc['a:txBody']);
            row.push(paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n'));
          }
          rows.push(row);
        }
        elements.push({
          kind: 'table',
          xPct: off ? ((ox + Number(off['@_x'] || 0) * sx) / slideWidth) * 100 : 5,
          yPct: off ? ((oy + Number(off['@_y'] || 0) * sy) / slideHeight) * 100 : 15,
          wPct: ext ? ((Number(ext['@_cx'] || 0) * sx) / slideWidth) * 100 : 90,
          hPct: ext ? ((Number(ext['@_cy'] || 0) * sy) / slideHeight) * 100 : 60,
          rows,
        });
      }
      for (const grp of asArray(group['p:grpSp'])) {
        await collectShapes(grp, ox, oy, sx, sy);
      }
    };
    await collectShapes(spTree);

    let notes = '';
    for (const rel of sRels.values()) {
      if (rel.type.includes('notesSlide') && zip.file(rel.target)) {
        const nXml = xmlParser.parse(await zip.file(rel.target).async('string'));
        const noteParas = [];
        for (const sp of asArray(nXml?.['p:notes']?.['p:cSld']?.['p:spTree']?.['p:sp'])) {
          const ps = extractPptxParagraphs(sp['p:txBody']);
          for (const p of ps) {
            const txt = p.runs.map((r) => r.text).join('').trim();
            if (txt && !/^\d+$/.test(txt)) noteParas.push(txt);
          }
        }
        notes = noteParas.join('\n');
        break;
      }
    }

    slides.push({
      index: i + 1,
      aspectRatio: slideWidth / slideHeight,
      bg,
      elements,
      notes,
    });
  }
  return { slideCount: slides.length, slides };
}

function collectXmlText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectXmlText).join('');
  if (typeof node === 'object') {
    let out = '';
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@_')) continue;
      if (k === '#text') out += String(v);
      else out += collectXmlText(v);
    }
    return out;
  }
  return '';
}

function odfOrderedToText(children) {
  let out = '';
  for (const item of asArray(children)) {
    if (item['#text'] != null) out += escHtml(item['#text']);
    else if (item['text:s']) out += ' '.repeat(Number(item[':@']?.['@_text:c'] || 1));
    else if (item['text:tab']) out += '\t';
    else if (item['text:line-break']) out += '<br>';
    else if (item['text:a']) {
      const href = item[':@']?.['@_xlink:href'] || '#';
      const inner = odfOrderedToText(item['text:a']);
      out += `<a href="${escHtml(href)}" target="_blank" rel="noopener">${inner}</a>`;
    } else if (item['text:span']) {
      out += odfOrderedToText(item['text:span']);
    } else {
      for (const [k, v] of Object.entries(item)) {
        if (k !== ':@') out += odfOrderedToText(v);
      }
    }
  }
  return out;
}

async function odfOrderedNodesToHtml(nodes, zip) {
  let html = '';
  for (const node of asArray(nodes)) {
    if (node['text:h']) {
      const lvl = Math.min(6, Math.max(1, Number(node[':@']?.['@_text:outline-level'] || 1)));
      html += `<h${lvl}>${odfOrderedToText(node['text:h'])}</h${lvl}>\n`;
    } else if (node['text:p']) {
      const inner = odfOrderedToText(node['text:p']);
      let frameImgs = '';
      for (const ch of asArray(node['text:p'])) {
        if (ch['draw:frame']) {
          for (const sub of asArray(ch['draw:frame'])) {
            if (sub['draw:image']) {
              const href = sub[':@']?.['@_xlink:href'];
              const uri = await zipImageToDataUri(zip, href);
              if (uri) frameImgs += `<img src="${uri}" alt="">`;
            }
          }
        }
      }
      html += `<p>${inner}${frameImgs}</p>\n`;
    } else if (node['text:list']) {
      html += '<ul>';
      for (const li of asArray(node['text:list'])) {
        if (li['text:list-item']) {
          html += `<li>${await odfOrderedNodesToHtml(li['text:list-item'], zip)}</li>`;
        }
      }
      html += '</ul>\n';
    } else if (node['table:table']) {
      html += '<table><tbody>';
      for (const row of asArray(node['table:table'])) {
        if (row['table:table-row']) {
          html += '<tr>';
          for (const cell of asArray(row['table:table-row'])) {
            if (cell['table:table-cell']) {
              html += `<td>${await odfOrderedNodesToHtml(cell['table:table-cell'], zip)}</td>`;
            }
          }
          html += '</tr>';
        }
      }
      html += '</tbody></table>\n';
    } else if (node['draw:frame']) {
      for (const sub of asArray(node['draw:frame'])) {
        if (sub['draw:image']) {
          const href = sub[':@']?.['@_xlink:href'];
          const uri = await zipImageToDataUri(zip, href);
          if (uri) html += `<p><img src="${uri}" alt=""></p>\n`;
        }
      }
    }
  }
  return html;
}

export async function parseOdt(buf) {
  const zip = await JSZip.loadAsync(buf);
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) throw new Error('无效的 ODT 文件（缺少 content.xml）');
  const ordered = xmlOrderedParser.parse(await contentEntry.async('string'));
  const docContent = ordered.find((n) => n['office:document-content'])?.['office:document-content'] || [];
  const body = docContent.find((n) => n['office:body'])?.['office:body'] || [];
  const textBody = body.find((n) => n['office:text'])?.['office:text'] || [];
  const html = await odfOrderedNodesToHtml(textBody, zip);
  return { html: sanitizeHtml(html || '<p class="muted">（文档内容为空）</p>') };
}

export async function parseOdp(buf) {
  const zip = await JSZip.loadAsync(buf);
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) throw new Error('无效的 ODP 文件（缺少 content.xml）');
  const ordered = xmlOrderedParser.parse(await contentEntry.async('string'));
  const docContent = ordered.find((n) => n['office:document-content'])?.['office:document-content'] || [];
  const body = docContent.find((n) => n['office:body'])?.['office:body'] || [];
  const pres = body.find((n) => n['office:presentation'])?.['office:presentation'] || [];

  const slides = [];
  let idx = 0;
  for (const item of pres) {
    if (!item['draw:page']) continue;
    idx++;
    const pageChildren = item['draw:page'];
    const parts = [];
    for (const ch of pageChildren) {
      if (ch['draw:frame']) {
        for (const sub of asArray(ch['draw:frame'])) {
          if (sub['draw:text-box']) {
            parts.push(await odfOrderedNodesToHtml(sub['draw:text-box'], zip));
          } else if (sub['draw:image']) {
            const href = sub[':@']?.['@_xlink:href'];
            const uri = await zipImageToDataUri(zip, href);
            if (uri) parts.push(`<p><img src="${uri}" alt=""></p>`);
          }
        }
      }
    }
    slides.push({ index: idx, html: sanitizeHtml(parts.join('\n') || '<p class="muted">（空白页）</p>') });
  }
  return { slideCount: slides.length, slides };
}

export async function parseEpub(buf, opts = {}) {
  const zip = await JSZip.loadAsync(buf);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('无效的 EPUB 文件（缺少 container.xml）');
  const container = xmlParser.parse(await containerFile.async('string'));
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.['@_full-path'];
  if (!opfPath || !zip.file(opfPath)) throw new Error('找不到 EPUB OPF 清单');
  const opf = xmlParser.parse(await zip.file(opfPath).async('string'))?.package || {};

  const meta = opf.metadata || {};
  const title = collectXmlText(meta['dc:title']) || 'EPUB 电子书';
  const author = collectXmlText(meta['dc:creator']) || '';

  const manifestMap = new Map();
  for (const item of asArray(opf.manifest?.item)) {
    manifestMap.set(item['@_id'], {
      href: resolveZipPath(opfPath, decodeURIComponent(item['@_href'] || '')),
      mediaType: item['@_media-type'] || '',
      properties: item['@_properties'] || '',
    });
  }

  const spineIds = asArray(opf.spine?.itemref).map((r) => r['@_idref']).filter(Boolean);
  const tocLabels = new Map();
  const ncxId = opf.spine?.['@_toc'];
  const ncxItem = ncxId ? manifestMap.get(ncxId) : null;
  if (ncxItem && zip.file(ncxItem.href)) {
    const ncx = xmlParser.parse(await zip.file(ncxItem.href).async('string'))?.ncx;
    const walkNav = (points) => {
      for (const np of asArray(points)) {
        const label = collectXmlText(np?.navLabel?.text).trim();
        const src = np?.content?.['@_src'] ? decodeURIComponent(np.content['@_src'].split('#')[0]) : '';
        if (src && label) tocLabels.set(resolveZipPath(ncxItem.href, src), label);
        if (np?.navPoint) walkNav(np.navPoint);
      }
    };
    walkNav(ncx?.navMap?.navPoint);
  }

  const chapters = spineIds
    .map((id, i) => {
      const m = manifestMap.get(id);
      if (!m) return null;
      return {
        index: i,
        id,
        path: m.href,
        title: tocLabels.get(m.href) || `第 ${i + 1} 节 (${basename(m.href)})`,
      };
    })
    .filter(Boolean);

  const chapterIndex = Math.max(0, Math.min(Number(opts.chapterIndex) || 0, Math.max(0, chapters.length - 1)));
  let html = '<p class="muted">（无章节内容）</p>';
  if (chapters[chapterIndex] && zip.file(chapters[chapterIndex].path)) {
    const chPath = chapters[chapterIndex].path;
    let raw = await zip.file(chPath).async('string');
    const bodyMatch = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    let body = bodyMatch ? bodyMatch[1] : raw;

    const imgMatches = [...body.matchAll(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi)];
    for (const m of imgMatches) {
      const src = m[3];
      if (/^(data:|https?:)/i.test(src)) continue;
      const imgPath = resolveZipPath(chPath, decodeURIComponent(src.split('#')[0]));
      const dataUri = await zipImageToDataUri(zip, imgPath);
      if (dataUri) {
        body = body.replace(m[0], `${m[1]}${m[2]}${dataUri}${m[2]}`);
      }
    }
    html = sanitizeHtml(body);
  }

  return { title, author, chapters, chapterIndex, html };
}

export function parseRtf(buf) {
  const raw = buf.toString('latin1');
  const cpgMatch = raw.match(/\\ansicpg(\d+)/);
  const encoding = cpgMatch && cpgMatch[1] === '936' ? 'gb18030' : 'gb18030';
  const hexDec = new TextDecoder(encoding);

  const SKIP_DEST = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
    'header', 'footer', 'headerl', 'headerr', 'headerf',
    'footerl', 'footerr', 'footerf', 'footnote', 'fldinst', 'themedata',
    'colorschememapping', 'latentstyles', 'datastore', 'xmlopen', 'mmathPr',
  ]);

  const stack = [];
  let state = { uc: 1, b: false, i: false, ul: false, skip: false };
  let skipChars = 0;
  let hexBytes = [];
  let out = '';

  const flushHex = () => {
    if (hexBytes.length > 0) {
      out += escHtml(hexDec.decode(Uint8Array.from(hexBytes)));
      hexBytes = [];
    }
  };

  for (let idx = 0; idx < raw.length; idx++) {
    const ch = raw[idx];
    if (ch === '{') {
      flushHex();
      stack.push({ ...state });
      continue;
    }
    if (ch === '}') {
      flushHex();
      const prev = stack.pop();
      if (prev) {
        if (!state.skip) {
          if (state.ul && !prev.ul) out += '</u>';
          if (state.i && !prev.i) out += '</em>';
          if (state.b && !prev.b) out += '</strong>';
        }
        state = prev;
      }
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;

    if (ch === '\\') {
      const next = raw[idx + 1];
      if (next === '\\' || next === '{' || next === '}') {
        flushHex();
        if (!state.skip) {
          if (skipChars > 0) skipChars--;
          else out += escHtml(next);
        }
        idx++;
        continue;
      }
      if (next === "'") {
        const hex = raw.slice(idx + 2, idx + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          if (!state.skip) {
            if (skipChars > 0) skipChars--;
            else hexBytes.push(parseInt(hex, 16));
          }
          idx += 3;
          continue;
        }
      }
      flushHex();
      if (next === '*') {
        state.skip = true;
        idx++;
        continue;
      }
      if (next === '~') {
        if (!state.skip) out += '&nbsp;';
        idx++;
        continue;
      }
      if (next === '-' || next === '_') {
        if (!state.skip) out += next === '_' ? '-' : '';
        idx++;
        continue;
      }
      const m = raw.slice(idx + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (m) {
        const word = m[1];
        const param = m[2] !== undefined ? Number(m[2]) : null;
        idx += m[0].length;
        if (SKIP_DEST.has(word)) {
          state.skip = true;
          continue;
        }
        if (state.skip) continue;
        if (word === 'uc' && param != null) state.uc = param;
        else if (word === 'u' && param != null) {
          const code = param < 0 ? 65536 + param : param;
          out += escHtml(String.fromCodePoint(code));
          skipChars = state.uc;
        } else if (word === 'par' || word === 'line') {
          out += '<br>\n';
        } else if (word === 'tab') {
          out += '&nbsp;&nbsp;&nbsp;&nbsp;';
        } else if (word === 'cell') {
          out += ' | ';
        } else if (word === 'row') {
          out += '<br>\n';
        } else if (word === 'b') {
          const nextB = param !== 0;
          if (nextB !== state.b) { out += nextB ? '<strong>' : '</strong>'; state.b = nextB; }
        } else if (word === 'i') {
          const nextI = param !== 0;
          if (nextI !== state.i) { out += nextI ? '<em>' : '</em>'; state.i = nextI; }
        } else if (word === 'ul') {
          const nextU = param !== 0;
          if (nextU !== state.ul) { out += nextU ? '<u>' : '</u>'; state.ul = nextU; }
        } else if (word === 'ulnone' && state.ul) {
          out += '</u>'; state.ul = false;
        }
        continue;
      }
    }

    if (state.skip) continue;
    flushHex();
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    out += escHtml(ch);
  }
  flushHex();
  return { html: `<div class="rtf-body">${out || '<span class="muted">（空文档）</span>'}</div>` };
}

export function parseLegacyDoc(buf) {
  const utf16Runs = [];
  const uText = buf.toString('utf16le');
  for (const m of uText.matchAll(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\x20-\x7e\r\n\t]{6,}/g)) {
    const cleaned = m[0].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
    if (cleaned.length >= 4 && !/^(Microsoft|Word\.Document|Root Entry|SummaryInformation)/i.test(cleaned)) {
      utf16Runs.push(cleaned);
    }
  }
  const text = utf16Runs.join('\n\n') || '（未提取到可读文本，旧版 .doc 二进制格式建议转换为 .docx 或用本地 Word/WPS 打开）';
  return { text };
}

export function parseIpynb(text) {
  const nb = JSON.parse(text);
  const rawCells = Array.isArray(nb.cells) ? nb.cells : [];
  const lang = nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || 'python';
  const cells = rawCells.map((cell, index) => {
    const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
    if (cell.cell_type === 'markdown') {
      return { index, cellType: 'markdown', html: renderMarkdownHtml(src).html };
    }
    if (cell.cell_type === 'code') {
      const codeHtml = hljs.getLanguage(lang)
        ? hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
        : escHtml(src);
      const outputs = (cell.outputs || []).map((out) => {
        if (out.output_type === 'stream') {
          const t = Array.isArray(out.text) ? out.text.join('') : String(out.text ?? '');
          return { kind: 'text', name: out.name || 'stdout', text: t };
        }
        if (out.output_type === 'error') {
          const tb = (out.traceback || []).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
          return { kind: 'error', text: `${out.ename || 'Error'}: ${out.evalue || ''}\n${tb}` };
        }
        const data = out.data || {};
        if (data['image/png']) {
          const b64 = Array.isArray(data['image/png']) ? data['image/png'].join('') : data['image/png'];
          return { kind: 'image', dataUri: `data:image/png;base64,${b64.replace(/\s+/g, '')}` };
        }
        if (data['image/jpeg']) {
          const b64 = Array.isArray(data['image/jpeg']) ? data['image/jpeg'].join('') : data['image/jpeg'];
          return { kind: 'image', dataUri: `data:image/jpeg;base64,${b64.replace(/\s+/g, '')}` };
        }
        if (data['image/svg+xml']) {
          const svg = Array.isArray(data['image/svg+xml']) ? data['image/svg+xml'].join('') : data['image/svg+xml'];
          return { kind: 'html', html: sanitizeHtml(svg) };
        }
        if (data['text/html']) {
          const h = Array.isArray(data['text/html']) ? data['text/html'].join('') : data['text/html'];
          return { kind: 'html', html: sanitizeHtml(h) };
        }
        if (data['text/plain']) {
          const t = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
          return { kind: 'text', text: String(t) };
        }
        return null;
      }).filter(Boolean);
      return {
        index,
        cellType: 'code',
        executionCount: cell.execution_count ?? null,
        codeHtml,
        outputs,
      };
    }
    return { index, cellType: cell.cell_type || 'raw', text: src };
  });
  return { lang, cells, nbformat: `${nb.nbformat ?? '?'}.${nb.nbformat_minor ?? 0}` };
}

function stripJsonComments(str) {
  let out = '';
  let inStr = false;
  let esc = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const n = str[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

export function parseStructured(text, ext) {
  const lower = ext.toLowerCase();
  let data = null;
  let parseError = null;
  let format = lower.slice(1).toUpperCase();
  let formatted = text;

  try {
    if (lower === '.json') {
      data = JSON.parse(text);
      formatted = JSON.stringify(data, null, 2);
    } else if (lower === '.jsonc') {
      data = JSON.parse(stripJsonComments(text));
      formatted = JSON.stringify(data, null, 2);
    } else if (lower === '.jsonl' || lower === '.ndjson') {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      data = lines.slice(0, 500).map((l, idx) => {
        try { return JSON.parse(l); } catch { return { _line: idx + 1, _raw: l }; }
      });
      format = `${format} (${lines.length} lines)`;
    } else if (lower === '.yaml' || lower === '.yml') {
      const docs = yaml.loadAll(text);
      data = docs.length === 1 ? docs[0] : docs;
    } else if (lower === '.toml') {
      data = TOML.parse(text);
    } else if (lower === '.xml') {
      data = xmlParser.parse(text);
    }
  } catch (err) {
    parseError = err.message;
  }

  const code = highlightCode(formatted, ext, `file${ext}`);
  return { format, data, parseError, code };
}

export function parseSqliteMeta(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const items = db.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).all();
    const tables = items.map((item) => {
      let count = 0;
      try {
        const quoted = `"${String(item.name).replace(/"/g, '""')}"`;
        count = db.prepare(`SELECT COUNT(*) AS cnt FROM ${quoted}`).get()?.cnt ?? 0;
      } catch {
        count = -1;
      }
      return { type: item.type, name: item.name, sql: item.sql || '', count };
    });
    return { tables };
  } finally {
    db.close();
  }
}

export function querySqliteTable(filePath, tableName, opts = {}) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
    ).get(tableName);
    if (!exists) throw new Error(`表或视图不存在: ${tableName}`);
    const quoted = `"${String(tableName).replace(/"/g, '""')}"`;
    const pageSize = Math.min(300, Math.max(20, Number(opts.pageSize) || 100));
    const page = Math.max(0, Number(opts.page) || 0);
    const offset = page * pageSize;

    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM ${quoted}`).get()?.cnt ?? 0;
    const rows = db.prepare(`SELECT * FROM ${quoted} LIMIT ? OFFSET ?`).all(pageSize, offset);
    const cols = rows.length > 0
      ? Object.keys(rows[0])
      : db.prepare(`PRAGMA table_info(${quoted})`).all().map((c) => c.name);
    const formattedRows = rows.map((r) => cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return null;
      if (v instanceof Uint8Array) return `<BLOB ${v.byteLength} B>`;
      return String(v);
    }));
    return { tableName, cols, rows: formattedRows, total, page, pageSize };
  } finally {
    db.close();
  }
}

export async function listArchiveEntries(buf) {
  const zip = await JSZip.loadAsync(buf);
  const entries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    const data = entry._data || {};
    entries.push({
      path: relPath,
      dir: false,
      size: data.uncompressedSize ?? 0,
      compressedSize: data.compressedSize ?? 0,
      date: entry.date ? entry.date.toISOString() : null,
    });
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { totalEntries: entries.length, entries: entries.slice(0, 2000) };
}

export async function readArchiveEntry(buf, entryPath) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file(entryPath);
  if (!entry || entry.dir) throw new Error(`压缩包内未找到文件: ${entryPath}`);
  const entryBuf = await entry.async('nodebuffer');
  return entryBuf;
}
