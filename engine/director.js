// The automatic camera. Before anything is drawn, explainroo measures each
// element of a scene once, and this file plans the camera from that. The
// camera opens on the picture and widens when something new would not fit.
// Something new that already fits needs no move. Now and then the camera
// moves in on a new thing and then follows new things at that distance. It
// moves in again only five seconds after the last change of zoom. Near the
// end of the scene it shows the whole picture. During each scene it also
// pushes in very slowly. Scenes that call s.camera() keep their own camera.
import { clamp, lerp } from './util.js';

// Things that appear within BEAT_GAP seconds of each other are one beat
// and get one shot.
const BEAT_GAP = 0.8;
const FILL = 0.72; // share of the view a close-up's subject fills
const PICTURE_FILL = 0.82; // share of the view the whole picture fills
const MAX_ZOOM = 2.2;
const LEAD = 0.3; // the camera starts moving a moment before the element appears
const MIN_HOLD = 2.2; // shortest time between the starts of two moves
const SETTLE = 0.08; // smaller changes than this are not worth a move
const DRIFT = 0.035; // how much closer the slow push gets over a whole scene
// Moving in on something: the new shot is at least PUSH times closer, the
// viewer gets PUSH_HOLD seconds to look once the camera has arrived, and the
// zoom last changed, in or out, PUSH_GAP or more seconds ago.
const PUSH = 1.3;
const PUSH_HOLD = 1.5;
const PUSH_GAP = 5;
// A highlighted code line or terminal command gets a close-up when it is at
// least this much closer.
const FOCUS_GAIN = 1.25;
// Kinds that are a background when they cover most of the frame.
const BACKDROPS = ['shape', 'custom', 'image', 'clip', 'panel'];

const smoother = (p) => p * p * p * (p * (p * 6 - 15) + 10);

function union(boxes) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x - b.w / 2);
    y0 = Math.min(y0, b.y - b.h / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y1 = Math.max(y1, b.y + b.h / 2);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

// view: the part of the frame the subject should fill (the safe area),
// frame: { W, H }. Returns { x, y, z }: the scene point shown at the view's
// center and the zoom.
export function frameBox(box, view, frame, maxZoom = MAX_ZOOM, fill = FILL) {
  const z = clamp(Math.min((view.w * fill) / Math.max(1, box.w), (view.h * fill) / Math.max(1, box.h)), 1, maxZoom);
  return clampShot({ x: box.x, y: box.y, z }, view, frame);
}

// Keeps the visible part of the scene inside the frame, so backgrounds a
// scene paints itself never show their edges.
function clampShot(shot, view, frame) {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const z = shot.z;
  return {
    x: clamp(shot.x, cx / z, frame.W - (frame.W - cx) / z),
    y: clamp(shot.y, cy / z, frame.H - (frame.H - cy) / z),
    z,
  };
}

// The part of the scene the whole frame shows.
export function frameRect(shot, view, frame) {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  return { x0: shot.x - cx / shot.z, y0: shot.y - cy / shot.z, x1: shot.x + (frame.W - cx) / shot.z, y1: shot.y + (frame.H - cy) / shot.z };
}

export function viewRect(shot, view) {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  return { x0: shot.x - (cx - view.x) / shot.z, y0: shot.y - (cy - view.y) / shot.z, x1: shot.x + (view.x + view.w - cx) / shot.z, y1: shot.y + (view.y + view.h - cy) / shot.z };
}

// Whether a box is partly in view. Edges within `margin` of the view's edge
// count as cut too, so nothing touches the edge of the frame. A box that
// pokes in by less than `slack` counts as out.
// `r` is the whole frame; `use` (default r) the part captions and app
// overlays leave free, which a visible box has to sit in.
function cut(box, r, margin, slack = 0, use = r) {
  const x0 = box.x - box.w / 2;
  const x1 = box.x + box.w / 2;
  const y0 = box.y - box.h / 2;
  const y1 = box.y + box.h / 2;
  const outside = x1 <= r.x0 + slack || x0 >= r.x1 - slack || y1 <= r.y0 + slack || y0 >= r.y1 - slack;
  const inside = x0 >= use.x0 + margin && x1 <= use.x1 - margin && y0 >= use.y0 + margin && y1 <= use.y1 - margin;
  return !inside && !outside;
}

// The free part of the frame (frame pixels) as scene coordinates for a shot.
function usableRect(shot, view, usable) {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  return { x0: shot.x + (usable.x0 - cx) / shot.z, y0: shot.y + (usable.y0 - cy) / shot.z, x1: shot.x + (usable.x1 - cx) / shot.z, y1: shot.y + (usable.y1 - cy) / shot.z };
}

// Whether a shot shows `box` (when given) whole and cuts none of `others`,
// at its own zoom and at the tightest framing the slow drift reaches.
function clean(shot, box, others, view, frame, usable) {
  const z = shot.z;
  const margin = (Math.min(frame.W, frame.H) * 0.07) / z;
  const tight = clampShot({ ...shot, z: z * (1 + DRIFT) }, view, frame);
  if (box) {
    const v = viewRect(tight, view);
    if (box.x - box.w / 2 < v.x0 - 0.5 || box.x + box.w / 2 > v.x1 + 0.5 || box.y - box.h / 2 < v.y0 - 0.5 || box.y + box.h / 2 > v.y1 + 0.5) return false;
  }
  const r = frameRect(tight, view, frame);
  const wide = frameRect(shot, view, frame);
  return !others.some((e) => cut(e.box, r, margin, 1 / z, usableRect(tight, view, usable)) || cut(e.box, wide, margin, 1 / z, usableRect(shot, view, usable)));
}

// Frames `focus` as close as it can while every other visible element is
// either fully in the shot or fully out of it. Half a label at the edge
// looks like a mistake. It tries a few zoom levels. For each it tries the
// center on the subject and the centers that put a neighbour right inside
// or right outside the frame's edge, and keeps the closest, best centered
// shot. At zoom 1 the shot is the frame as it was written, which always
// works.
export function compose(focus, visible, view, frame, usable = { x0: 0, y0: 0, x1: frame.W, y1: frame.H }, fill = FILL, maxZoom = MAX_ZOOM) {
  const box = union(focus.map((e) => e.box));
  // Arrows and lines may run off the edge of a close-up, and so may an
  // element the shot looks into, like a code window around its highlighted
  // lines. A cut label or card may not.
  const looking = focus.every((e) => e.kind === 'focus');
  const others = visible.filter((e) => !focus.includes(e) && !['arrow', 'line', 'focus'].includes(e.kind) && !(looking && contains(e.box, box)));
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const best0 = frameBox(box, view, frame, Math.max(1, maxZoom), fill);
  let best = null;
  for (let z = best0.z; z > 1.001; z /= 1.06) {
    const margin = (Math.min(frame.W, frame.H) * 0.07) / z;
    // Centers that keep the subject inside the view.
    const xr = [box.x + box.w / 2 + margin - (view.x + view.w - cx) / z, box.x - box.w / 2 - margin + (cx - view.x) / z];
    const yr = [box.y + box.h / 2 + margin - (view.y + view.h - cy) / z, box.y - box.h / 2 - margin + (cy - view.y) / z];
    if (xr[0] > xr[1] || yr[0] > yr[1]) continue;
    const pad = 3 / z;
    const xs = [box.x];
    const ys = [box.y];
    for (const e of others) {
      const l = e.box.x - e.box.w / 2;
      const r = e.box.x + e.box.w / 2;
      const t = e.box.y - e.box.h / 2;
      const b = e.box.y + e.box.h / 2;
      xs.push(r + pad + cx / z, l - pad - (frame.W - cx) / z, l - margin + cx / z, r + margin - (frame.W - cx) / z);
      ys.push(b + pad + cy / z, t - pad - (frame.H - cy) / z, t - margin + cy / z, b + margin - (frame.H - cy) / z);
    }
    for (const x0 of xs) {
      if (x0 < xr[0] - 1e-6 || x0 > xr[1] + 1e-6) continue;
      for (const y0 of ys) {
        if (y0 < yr[0] - 1e-6 || y0 > yr[1] + 1e-6) continue;
        const shot = clampShot({ x: x0, y: y0, z }, view, frame);
        if (!clean(shot, box, others, view, frame, usable)) continue;
        const off = Math.hypot((shot.x - box.x) * z / view.w, (shot.y - box.y) * z / view.h);
        const score = Math.log(z) - 0.8 * off;
        if (!best || score > best.score) best = { shot, score };
      }
    }
  }
  if (best) return best.shot;
  // Otherwise the frame as it was written. Its slow push stays off when it
  // would move something into the captions or the app's buttons.
  const full = frameBox(box, view, frame, 1);
  const tight = clampShot({ ...full, z: 1 + DRIFT }, view, frame);
  const within = (e, shot) => {
    const u = usableRect(shot, view, usable);
    return e.box.x - e.box.w / 2 >= u.x0 && e.box.x + e.box.w / 2 <= u.x1 && e.box.y - e.box.h / 2 >= u.y0 && e.box.y + e.box.h / 2 <= u.y1;
  };
  const held = [...focus, ...others].filter((e) => !['arrow', 'line', 'focus'].includes(e.kind));
  return held.some((e) => within(e, full) && !within(e, tight)) ? { ...full, drift: 0 } : full;
}

function contains(outer, inner) {
  return outer.x - outer.w / 2 <= inner.x - inner.w / 2 + 0.5 && outer.x + outer.w / 2 >= inner.x + inner.w / 2 - 0.5 && outer.y - outer.h / 2 <= inner.y - inner.h / 2 + 0.5 && outer.y + outer.h / 2 >= inner.y + inner.h / 2 - 0.5;
}

function same(a, b) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 1e-4 && (a.drift ?? 1) === (b.drift ?? 1);
}

// How long a move takes at pace 1: longer for a bigger change of zoom or
// place, and a little longer for the pull-back at the end of a scene.
function moveLength(from, to, kind, frame) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y) / (frame.W / Math.min(from.z, to.z));
  return clamp(0.9 + 0.5 * Math.abs(Math.log(to.z / from.z)) + 0.6 * distance, 0.95, 1.7) * (kind === 'reveal' ? 1.2 : 1);
}

function differs(a, b, frame) {
  return (a.drift ?? 1) !== (b.drift ?? 1) || Math.abs(Math.log(a.z / b.z)) > SETTLE || Math.hypot(a.x - b.x, a.y - b.y) > (SETTLE * frame.W) / Math.max(a.z, b.z);
}

// elements: [{ at, out, box }] in scene coordinates. Returns null when there
// is nothing to film.
// `from`: where the camera is when the scene starts, for a scene that
// continues the one before it.
export function planCamera(elements, { dur, view, frame, pace = 1, voiceEnd = null, from = null, still = 0, usable = null }) {
  usable ??= { x0: 0, y0: 0, x1: frame.W, y1: frame.H };
  const area = frame.W * frame.H;
  const items = elements
    // A plain shape, drawing or picture that covers most of the frame is a
    // background. Charts, code, text and what a scene draws by hand ("ink")
    // count however large they are.
    .filter((e) => e.box && (!BACKDROPS.includes(e.kind) || e.box.w * e.box.h < area * 0.6) && (e.box.w > 2 || e.box.h > 2))
    .map((e) => ({ ...e, at: Math.max(0, e.at), out: e.out ?? Infinity }))
    .filter((e) => e.at < dur - 0.3)
    .sort((a, b) => a.at - b.at);
  if (!items.length) return null;

  const beats = [];
  for (const e of items) {
    const last = beats[beats.length - 1];
    if (last && e.at - last.start <= BEAT_GAP) last.els.push(e);
    else beats.push({ start: e.at, els: [e] });
  }

  const hold = MIN_HOLD / pace;
  const visibleDuring = (t0, t1) => items.filter((e) => e.at <= t1 && e.out > t0 + 0.25);
  const picture = (list) => list.filter((e) => e.kind !== 'focus');
  // What the camera may move in on. An arrow's label is kept whole, but it
  // is part of the arrow, which gets no close-up.
  const solid = (list) => list.filter((e) => !['arrow', 'line', 'focus', 'label'].includes(e.kind));
  // Everything on screen from t0 to t1, framed as one picture.
  const overview = (t0, t1) => {
    const v = picture(visibleDuring(t0, t1));
    return v.length ? compose(v, v, view, frame, usable, PICTURE_FILL) : null;
  };
  // Whether a shot already shows these elements whole, in the free part of
  // the frame, also at the end of its slow push. A beat of only arrows and
  // lines fits when they are at least partly in view. An arrow's label has
  // to be whole.
  const fits = (shot, list) => {
    const body = list.filter((e) => e.kind !== 'arrow' && e.kind !== 'line');
    const tight = shot.drift === 0 ? shot : clampShot({ ...shot, z: shot.z * (1 + DRIFT) }, view, frame);
    const pad = (Math.min(frame.W, frame.H) * 0.02) / shot.z;
    return [shot, tight].every((s) => {
      const u = usableRect(s, view, usable);
      if (!body.length) return list.every((e) => e.box.x + e.box.w / 2 > u.x0 && e.box.x - e.box.w / 2 < u.x1 && e.box.y + e.box.h / 2 > u.y0 && e.box.y - e.box.h / 2 < u.y1);
      return body.every((e) => e.box.x - e.box.w / 2 >= u.x0 + pad && e.box.x + e.box.w / 2 <= u.x1 - pad && e.box.y - e.box.h / 2 >= u.y0 + pad && e.box.y + e.box.h / 2 <= u.y1 - pad);
    });
  };
  // The one or two elements in `before` closest to `els`.
  const nearest = (els, before) => {
    if (!before.length) return [];
    const c = union(els.map((e) => e.box));
    const d = (e) => Math.hypot(e.box.x - c.x, e.box.y - c.y);
    const sorted = [...before].sort((a, b) => d(a) - d(b));
    return sorted.slice(0, sorted.length > 1 && d(sorted[1]) < d(sorted[0]) * 1.4 ? 2 : 1);
  };

  // Near the end the camera shows the whole picture.
  const lastBeat = beats[beats.length - 1].start;
  const revealAt = Math.max(lastBeat + 1.8, (voiceEnd ?? lastBeat) - 0.9);
  // When the next new thing or focus point after beat i would not fit the
  // shot.
  const heldUntil = (shot, i) => {
    for (let j = i + 1; j < beats.length; j++) {
      const next = beats[j].els.filter((e) => e.out > beats[j].start + 0.4);
      if (next.length && !fits(shot, next)) return Math.max(first, beats[j].start - LEAD);
    }
    return dur;
  };

  // `still`: the camera holds while the scene dissolves in from the one it
  // continues, so both pictures stay on top of each other.
  const first = Math.max(0, still);
  const shots = [];
  let cur = from;
  let last = from ? first - hold : -Infinity;
  let zoomed = -Infinity;
  // Takes a shot from `begin` on. The first one opens the scene.
  // A required move keeps something new whole, however small it is.
  const take = (shot, begin, kind, required = false) => {
    if (!shot) return false;
    if (cur && (required ? same(cur, shot) : !differs(cur, shot, frame))) return false;
    if (cur && Math.abs(Math.log(shot.z / cur.z)) > 0.1) zoomed = begin;
    shots.push({ begin: cur ? begin : 0, shot, kind, required });
    // The opening is not a move: the first move may follow it sooner.
    last = cur ? begin : begin - hold * 0.4;
    cur = shot;
    return true;
  };
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const begin = Math.max(first, beat.start - LEAD);
    const next = i + 1 < beats.length ? Math.max(first, beats[i + 1].start - LEAD) : dur;
    const free = !cur || begin >= last + hold - 1e-9;
    // Whether the camera may move closer now.
    const closer = !cur || (next - begin >= (PUSH_HOLD + 1) / pace && begin - zoomed >= PUSH_GAP / pace);
    const points = beat.els.filter((e) => e.kind === 'focus');
    const fresh = picture(beat.els).filter((e) => e.out > beat.start + 0.4);

    // Highlighted code lines, terminal commands and s.focus get a close-up
    // when the shot does not already show them big and there is time.
    if (points.length && free) {
      const explicit = points.some((p) => p.explicit);
      const ends = Math.min(...points.map((p) => p.out));
      const close = compose(points, visibleDuring(begin, Math.min(ends, begin + hold * 2 + LEAD)), view, frame, usable, FILL, explicit || closer ? MAX_ZOOM : cur.z);
      // The close-up holds until it ends or something new would not fit it.
      const until = Math.min(ends, heldUntil(close, i));
      const gain = cur ? close.z / cur.z : Infinity;
      if (until - begin >= hold && ((cur && !fits(cur, points)) || gain >= (explicit ? 1.05 : FOCUS_GAIN))) {
        if (take(close, begin, 'focus', Boolean(cur && !fits(cur, points)))) continue;
      }
    }
    if (!fresh.length) continue;
    const window = begin + hold + LEAD;
    if (!cur) {
      take(overview(begin, window), begin, 'picture');
      continue;
    }
    if (!free && !fits(cur, fresh)) {
      // Too soon after the last move for something that does not fit: the
      // last shot takes in the whole picture instead.
      if (shots.length) {
        const prev = shots[shots.length - 1];
        const wide = overview(prev.begin, window);
        if (wide) Object.assign(prev, { shot: wide, kind: 'picture' });
        cur = prev.shot;
      }
      continue;
    }
    const before = items.filter((e) => e.at < beat.start - 0.05 && e.out > beat.start + 0.3 && !['focus', 'ink', 'label'].includes(e.kind));
    if (fits(cur, fresh)) {
      // It is already in the shot. The camera moves in only on a new card,
      // label or picture. A line, an arrow, or something drawn inside an
      // element that is already there, like a line in a chart, gets no
      // close-up. Nor does an icon or shape without words: up close it shows
      // nothing more. It tries the new thing with its neighbours first, then
      // on its own.
      const own = solid(fresh).filter((e) => !e.bare && !before.some((f) => f.box.w * f.box.h >= e.box.w * e.box.h * 2 && contains(f.box, e.box)));
      // It is on screen already, so the push may wait a moment for its turn.
      const at = Math.max(begin, last + hold);
      if (!own.length || at > beat.start + 1 / pace || at - zoomed < PUSH_GAP / pace) continue;
      // What comes soon after belongs to the same shot when it can.
      const soon = beats.slice(i + 1).filter((b) => b.start - beat.start <= PUSH_HOLD / pace).flatMap((b) => solid(picture(b.els)));
      const near = nearest(own, before);
      const seen = visibleDuring(at, at + PUSH_HOLD / pace + hold);
      for (const list of [[...near, ...own, ...soon], [...near, ...own], [...own, ...soon], own]) {
        const shot = compose(list, seen, view, frame, usable);
        const until = Math.min(heldUntil(shot, i), fits(shot, picture(visibleDuring(revealAt, revealAt + 0.1))) ? dur : revealAt);
        if (shot.z >= cur.z * PUSH && until - at - moveLength(cur, shot, 'push', frame) / pace >= PUSH_HOLD / pace) {
          take(shot, at, 'push');
          break;
        }
      }
      continue;
    }
    // It does not fit: the new thing with what it relates to, at most as
    // close as the camera may go now.
    const visible = visibleDuring(begin, Math.max(next, window));
    const limit = closer ? MAX_ZOOM : cur.z;
    let subject = compose([...nearest(fresh, before), ...fresh], visible, view, frame, usable, FILL, limit);
    if (subject.z < Math.min(1.15, limit)) subject = compose(fresh, visible, view, frame, usable, FILL, limit);
    take(fits(subject, fresh) ? subject : overview(begin, window), begin, 'follow', true);
  }
  if (!shots.length && !from) return null;
  // Near the end the camera shows the whole picture when the shot leaves
  // part of it out.
  const reveal = Math.max(revealAt, last + hold);
  // A scene too short for that ends on its last move. When that move is a
  // close-up that leaves part of the picture out, the last frame would not
  // show the whole idea, so the move frames the whole picture instead. A
  // move in that becomes a wide shot is then usually no move at all.
  const atEnd = items.filter((e) => e.kind !== 'focus' && e.at <= dur - 0.1 && e.out >= dur - 0.05);
  const tail = shots[shots.length - 1];
  if (reveal >= dur - 1.1 && atEnd.length && tail && tail.begin > 0 && ['push', 'follow'].includes(tail.kind) && !fits(cur, atEnd)) {
    const wide = overview(tail.begin, dur);
    if (wide) cur = tail.shot = wide;
  }
  if (cur && reveal < dur - 1.1) {
    const all = picture(visibleDuring(reveal, reveal + 0.1));
    if (all.length && !fits(cur, all)) take(compose(all, visibleDuring(reveal, dur), view, frame, usable, PICTURE_FILL), reveal, 'reveal');
  }

  const start = from ?? shots[0].shot;
  const moves = [];
  let current = start;
  for (const { begin, shot, kind, required } of from ? shots : shots.slice(1)) {
    if (required ? same(current, shot) : !differs(current, shot, frame)) continue;
    // Every move ends before the scene does.
    const room = dur - 0.05 - begin;
    if (room < 0.45 / pace) continue;
    const length = Math.min(room, moveLength(current, shot, kind, frame) / pace);
    moves.push({ start: begin, dur: length, to: shot, kind });
    current = shot;
  }
  // Each move starts from wherever the camera is at that moment, so moves
  // that overlap stay smooth.
  const plan = { start, moves, dur, view, frame, still, elements: items };
  for (const m of moves) {
    m.from = cameraAt(plan, m.start, false);
    // Between shots far apart the camera pulls back on the way, so less is
    // cut off while it travels.
    const a = frameRect(m.from, view, frame);
    const b = frameRect(m.to, view, frame);
    const shared = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    if (shared < 0.25 * Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))) {
      const both = { x: (Math.min(a.x0, b.x0) + Math.max(a.x1, b.x1)) / 2, y: (Math.min(a.y0, b.y0) + Math.max(a.y1, b.y1)) / 2, w: Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0), h: Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) };
      const via = frameBox(both, view, frame, Math.min(m.from.z, m.to.z));
      if (via.z < Math.min(m.from.z, m.to.z) * 0.97) m.via = via;
    }
  }
  return plan;
}

// `drift` on a shot (0 or 1, default 1) says whether the slow push may run
// there; moves blend it.
export function cameraAt(plan, t, drift = true) {
  let cam = plan.start;
  for (const m of plan.moves) {
    if (t < m.start || !m.from) break;
    const p = smoother(clamp((t - m.start) / m.dur));
    const d = lerp(m.from.drift ?? 1, m.to.drift ?? 1, p);
    if (m.via) {
      // A curve through the wider shot in the middle.
      const q = (a, b, c) => (1 - p) * (1 - p) * a + 2 * (1 - p) * p * b + p * p * c;
      const mid = (k) => 2 * m.via[k] - (m.from[k] + m.to[k]) / 2;
      cam = {
        x: q(m.from.x, mid('x'), m.to.x),
        y: q(m.from.y, mid('y'), m.to.y),
        z: Math.max(1, Math.exp(q(Math.log(m.from.z), 2 * Math.log(m.via.z) - (Math.log(m.from.z) + Math.log(m.to.z)) / 2, Math.log(m.to.z)))),
      };
      cam = { ...clampShot(cam, plan.view, plan.frame), drift: d };
    } else {
      cam = {
        x: lerp(m.from.x, m.to.x, p),
        y: lerp(m.from.y, m.to.y, p),
        z: Math.exp(lerp(Math.log(m.from.z), Math.log(m.to.z), p)),
        drift: d,
      };
    }
  }
  if (!drift) return cam;
  // The slow push starts once a continued scene has dissolved in.
  const still = plan.still || 0;
  const push = 1 + DRIFT * (cam.drift ?? 1) * clamp((t - still) / Math.max(1, plan.dur - still));
  return { ...clampShot({ x: cam.x, y: cam.y, z: cam.z * push }, plan.view, plan.frame), drift: cam.drift ?? 1 };
}

// True while the camera is in a move (not counting the slow drift).
export function cameraMoving(plan, t) {
  return plan.moves.some((m) => t > m.start && t < m.start + m.dur);
}

// Whether scene B picks up where scene A left off: what A's last frame
// shows is mostly still there when B starts, in the same places. `last` is
// the part of the scene A's camera shows at the end.
export function continues(a, b, last) {
  const inView = (e) => e.box.x + e.box.w / 2 > last.x0 && e.box.x - e.box.w / 2 < last.x1 && e.box.y + e.box.h / 2 > last.y0 && e.box.y - e.box.h / 2 < last.y1;
  const end = a.filter((e) => e.out === Infinity && inView(e));
  const carried = b.filter((e) => e.at <= 0.05);
  if (end.length < 2 || carried.length < 2) return false;
  const same = (x, y) => x.kind === y.kind && Math.abs(x.box.x - y.box.x) < 2 && Math.abs(x.box.y - y.box.y) < 2 && Math.abs(x.box.w - y.box.w) < 2 && Math.abs(x.box.h - y.box.h) < 2;
  const kept = end.filter((e) => carried.some((f) => same(e, f)));
  const known = carried.filter((e) => a.some((f) => same(e, f)));
  return kept.length >= end.length * 0.7 && known.length >= carried.length * 0.6;
}

// Where the background is, for the camera at `cam`: it follows at a third of
// the camera's strength, as if it sat further back.
export function backgroundShot(plan, cam, depth = 0.33) {
  const cx = plan.view.x + plan.view.w / 2;
  const cy = plan.view.y + plan.view.h / 2;
  return clampShot({ x: cx + (cam.x - cx) * depth, y: cy + (cam.y - cy) * depth, z: Math.pow(cam.z, depth) }, plan.view, plan.frame);
}
