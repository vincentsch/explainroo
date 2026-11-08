// SVG path helpers: parse to absolute commands, scale and move, split into
// subpaths, measure length, and build paths for the basic shapes.

const PARAMS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function parsePath(d) {
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m;
  let cmd = null;
  let nums = [];
  const flush = () => {
    if (!cmd) return;
    const up = cmd.toUpperCase();
    const n = PARAMS[up];
    if (n === 0) {
      out.push({ c: cmd, v: [] });
    } else {
      let first = true;
      for (let i = 0; i + n <= nums.length; i += n) {
        let c = cmd;
        if (!first && up === 'M') c = cmd === 'm' ? 'l' : 'L';
        out.push({ c, v: nums.slice(i, i + n) });
        first = false;
      }
    }
    nums = [];
  };
  // Arc flags can be written without separators ("a1 1 0 011 1"); expand them.
  const src = String(d).replace(/([Aa])([^MLHVCSQTAZmlhvcsqtaz]*)/g, (all, a, body) => a + expandArcFlags(body));
  while ((m = re.exec(src)) !== null) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else {
      nums.push(parseFloat(m[2]));
    }
  }
  flush();
  return out;
}

function expandArcFlags(body) {
  const tokens = body.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  // Only rewrite when flags were glued together, detected by a token count
  // that is not a multiple of 7.
  if (tokens.length % 7 === 0) return body;
  const out = [];
  const raw = body.trim();
  let i = 0;
  let idx = 0;
  const num = /^[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/;
  const flag = /^[\s,]*([01])/;
  while (i < raw.length) {
    const pos = idx % 7;
    const re = pos === 3 || pos === 4 ? flag : num;
    const m = re.exec(raw.slice(i));
    if (!m) break;
    out.push(m[1]);
    i += m[0].length;
    idx++;
  }
  return ' ' + out.join(' ') + ' ';
}

// Converts to absolute M, L, C, Q, A and Z commands.
export function absolutize(cmds) {
  const out = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null;
  let lastQ = null;
  for (const { c, v } of cmds) {
    const rel = c === c.toLowerCase();
    const up = c.toUpperCase();
    const ax = (i) => v[i] + (rel ? x : 0);
    const ay = (i) => v[i] + (rel ? y : 0);
    let cCtrl = null;
    let qCtrl = null;
    switch (up) {
      case 'M':
        x = ax(0); y = ay(1); sx = x; sy = y;
        out.push({ c: 'M', v: [x, y] });
        break;
      case 'L':
        x = ax(0); y = ay(1);
        out.push({ c: 'L', v: [x, y] });
        break;
      case 'H':
        x = v[0] + (rel ? x : 0);
        out.push({ c: 'L', v: [x, y] });
        break;
      case 'V':
        y = v[0] + (rel ? y : 0);
        out.push({ c: 'L', v: [x, y] });
        break;
      case 'C': {
        const p = [ax(0), ay(1), ax(2), ay(3), ax(4), ay(5)];
        out.push({ c: 'C', v: p });
        cCtrl = [p[2], p[3]];
        x = p[4]; y = p[5];
        break;
      }
      case 'S': {
        const r1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const p = [r1[0], r1[1], ax(0), ay(1), ax(2), ay(3)];
        out.push({ c: 'C', v: p });
        cCtrl = [p[2], p[3]];
        x = p[4]; y = p[5];
        break;
      }
      case 'Q': {
        const p = [ax(0), ay(1), ax(2), ay(3)];
        out.push({ c: 'Q', v: p });
        qCtrl = [p[0], p[1]];
        x = p[2]; y = p[3];
        break;
      }
      case 'T': {
        const r1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p = [r1[0], r1[1], ax(0), ay(1)];
        out.push({ c: 'Q', v: p });
        qCtrl = r1;
        x = p[2]; y = p[3];
        break;
      }
      case 'A': {
        const nx = ax(5);
        const ny = ay(6);
        out.push({ c: 'A', v: [v[0], v[1], v[2], v[3], v[4], nx, ny] });
        x = nx; y = ny;
        break;
      }
      case 'Z':
        out.push({ c: 'Z', v: [] });
        x = sx; y = sy;
        break;
      default:
        break;
    }
    lastC = cCtrl;
    lastQ = qCtrl;
  }
  return out;
}

// Scales then translates absolute commands.
export function transform(cmds, s, tx = 0, ty = 0) {
  return cmds.map(({ c, v }) => {
    if (c === 'A') return { c, v: [v[0] * s, v[1] * s, v[2], v[3], v[4], v[5] * s + tx, v[6] * s + ty] };
    return { c, v: v.map((n, i) => n * s + (i % 2 === 0 ? tx : ty)) };
  });
}

const r = (n) => Math.round(n * 100) / 100;
export function serialize(cmds) {
  return cmds.map(({ c, v }) => c + v.map(r).join(' ')).join('');
}

export function scalePath(d, s, tx = 0, ty = 0) {
  return serialize(transform(absolutize(parsePath(d)), s, tx, ty));
}

// Splits an absolute path string into subpath strings.
export function splitSubpaths(d) {
  const cmds = absolutize(parsePath(d));
  const out = [];
  let cur = [];
  for (const cmd of cmds) {
    if (cmd.c === 'M' && cur.length) {
      out.push(serialize(cur));
      cur = [];
    }
    cur.push(cmd);
  }
  if (cur.length) out.push(serialize(cur));
  return out;
}

let svgPath = null;
const lengths = new Map();
export function pathLength(d) {
  let L = lengths.get(d);
  if (L !== undefined) return L;
  if (!svgPath) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(svgPath);
    document.body.appendChild(svg);
  }
  svgPath.setAttribute('d', d);
  L = svgPath.getTotalLength() || 0;
  if (lengths.size > 20000) lengths.clear();
  lengths.set(d, L);
  return L;
}

export function pointAt(d, dist) {
  pathLength(d);
  svgPath.setAttribute('d', d);
  const p = svgPath.getPointAtLength(dist);
  return { x: p.x, y: p.y };
}

// Points along a path about `step` units apart, both ends included, for check
// to see where a line runs. Kept per path, since scenes draw the same paths
// on every frame.
const samples = new Map();
export function samplePath(d, step = 5) {
  const key = `${step}|${d}`;
  let pts = samples.get(key);
  if (pts) return pts;
  const L = pathLength(d);
  const n = Math.max(1, Math.ceil(L / step));
  svgPath.setAttribute('d', d);
  pts = [];
  for (let k = 0; k <= n; k++) {
    const p = svgPath.getPointAtLength((L * k) / n);
    pts.push([p.x, p.y]);
  }
  if (samples.size > 4000) samples.clear();
  samples.set(key, pts);
  return pts;
}

// Shapes centred on 0,0.
export function rectD(w, h, rr = 0) {
  const x = -w / 2;
  const y = -h / 2;
  const k = Math.max(0, Math.min(rr, w / 2, h / 2));
  if (!k) return `M${r(x)} ${r(y)}L${r(x + w)} ${r(y)}L${r(x + w)} ${r(y + h)}L${r(x)} ${r(y + h)}Z`;
  return `M${r(x + k)} ${r(y)}L${r(x + w - k)} ${r(y)}A${r(k)} ${r(k)} 0 0 1 ${r(x + w)} ${r(y + k)}L${r(x + w)} ${r(y + h - k)}A${r(k)} ${r(k)} 0 0 1 ${r(x + w - k)} ${r(y + h)}L${r(x + k)} ${r(y + h)}A${r(k)} ${r(k)} 0 0 1 ${r(x)} ${r(y + h - k)}L${r(x)} ${r(y + k)}A${r(k)} ${r(k)} 0 0 1 ${r(x + k)} ${r(y)}Z`;
}

export function ellipseD(w, h) {
  const rx = w / 2;
  const ry = h / 2;
  return `M${r(-rx)} 0A${r(rx)} ${r(ry)} 0 1 1 ${r(rx)} 0A${r(rx)} ${r(ry)} 0 1 1 ${r(-rx)} 0Z`;
}

export function polyD(points, close = false) {
  if (!points.length) return '';
  let d = `M${r(points[0][0])} ${r(points[0][1])}`;
  for (let i = 1; i < points.length; i++) d += `L${r(points[i][0])} ${r(points[i][1])}`;
  return close ? d + 'Z' : d;
}

export function quadD(a, c, b) {
  return `M${r(a[0])} ${r(a[1])}Q${r(c[0])} ${r(c[1])} ${r(b[0])} ${r(b[1])}`;
}
