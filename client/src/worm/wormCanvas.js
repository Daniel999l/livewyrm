// The living specimen. A worm that roams a tank, stalks abstract targets,
// lunges at them, and either latches on (the target dims) or gets pushed back
// (the target flares and it recoils). Its speed, hunger and color track a
// "mood" value in [0..1] that the page feeds from treasury health: high is
// fast and confident, low is slow, sagging and twitchy.
//
// Nothing here touches the network or any real system. It is an animation.

const PALETTE = [
  [154, 118, 255],
  [255, 106, 160],
  [255, 200, 120],
  [100, 242, 210],
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rgbAt(t) {
  const x = t * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(x));
  const f = x - i;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  return [
    Math.round(lerp(a[0], b[0], f)),
    Math.round(lerp(a[1], b[1], f)),
    Math.round(lerp(a[2], b[2], f)),
  ];
}

export function createWorm(canvas, getMood) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tank region: the worm mostly stays in the top band of the viewport, and
  // only occasionally dips lower.
  function tankHeight() {
    return Math.min(height, Math.max(520, height * 0.72));
  }

  const SEG = 48; // number of body segments
  const SPACING = 11; // distance between segments
  const spine = [];
  let head = { x: 0, y: 0, a: 0 };
  let heading = 0; // desired angle
  let speed = 1.4;
  let phase = 0; // undulation phase

  // targets it hunts
  let targets = [];
  let current = null; // index into targets
  let mode = 'roam'; // roam | stalk | lunge | recoil
  let modeT = 0;
  let wander = { x: 0, y: 0 };
  let dip = 0; // 0 stays in tank, up to 1 ventures down
  let mood = 0.6; // smoothed

  function resize() {
    const r = canvas.getBoundingClientRect();
    width = r.width;
    height = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (spine.length === 0) seed();
    spawnTargets();
  }

  function seed() {
    head = { x: width * 0.5, y: tankHeight() * 0.5, a: 0 };
    heading = 0;
    for (let i = 0; i < SEG; i++) spine.push({ x: head.x - i * SPACING, y: head.y });
    pickWander();
  }

  function spawnTargets() {
    const n = Math.max(4, Math.min(7, Math.round(width / 260)));
    const th = tankHeight();
    const next = [];
    for (let i = 0; i < n; i++) {
      // deterministic-ish spread, biased to the right and mid-height
      const gx = (i + 0.5) / n;
      const x = width * (0.18 + gx * 0.72) + (Math.sin(i * 12.9) * 40);
      const y = th * (0.22 + ((Math.sin(i * 7.3) + 1) / 2) * 0.56);
      next.push({
        x,
        y,
        r: 7 + ((Math.sin(i * 3.1) + 1) / 2) * 7,
        big: i === n - 1, // the last one is "a larger mind"
        life: 1, // 1 = intact, drops when latched
        flare: 0, // flashes when it repels
        hue: i === n - 1 ? 0.0 : 0.7,
      });
    }
    // keep the big one top-right, the prize it reaches for
    next[next.length - 1].x = width * 0.86;
    next[next.length - 1].y = th * 0.24;
    next[next.length - 1].r = 15;
    targets = next;
    current = null;
    mode = 'roam';
  }

  function pickWander() {
    const th = tankHeight();
    // occasionally dip below the tank (behind lower content), then come back
    dip = Math.random() < 0.18 ? 0.55 + Math.random() * 0.35 : 0;
    const topY = dip > 0 ? th * 0.6 : th * 0.12;
    const botY = dip > 0 ? Math.min(height - 40, th * (1 + dip)) : th * 0.9;
    wander = {
      x: width * (0.12 + Math.random() * 0.76),
      y: lerp(topY, botY, Math.random()),
    };
  }

  function nearestTarget() {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.life <= 0.15 && !t.big) continue; // drained small nodes lose appeal
      const d = Math.hypot(t.x - head.x, t.y - head.y);
      // the big mind is alluring from farther away when mood is high
      const w = t.big ? 1 - mood * 0.5 : 1;
      if (d * w < bd) {
        bd = d * w;
        best = i;
      }
    }
    return best;
  }

  function step(dt) {
    const m = clamp(getMood ? getMood() : 0.6, 0, 1);
    mood = lerp(mood, m, 0.03);

    // mood shapes behavior
    const baseSpeed = reduced ? 0.0 : lerp(0.5, 3.0, mood);
    const hunger = lerp(0.15, 1, mood); // how eager to strike
    const amp = lerp(2, 10, mood); // undulation amplitude
    const freq = lerp(0.04, 0.11, mood);
    const droop = lerp(26, 0, mood); // sags downward when weak

    phase += freq * (0.6 + mood);

    // decide mode
    modeT -= dt;
    if (mode === 'roam') {
      const d = Math.hypot(wander.x - head.x, wander.y - head.y);
      if (d < 40 || modeT <= 0) {
        // maybe commit to a target instead of wandering again
        if (Math.random() < hunger * 0.7) {
          current = nearestTarget();
          mode = current >= 0 ? 'stalk' : 'roam';
          modeT = 6;
        } else {
          pickWander();
          modeT = 3 + Math.random() * 3;
        }
      }
    } else if (mode === 'stalk') {
      const t = targets[current];
      if (!t) {
        mode = 'roam';
        pickWander();
      } else {
        const d = Math.hypot(t.x - head.x, t.y - head.y);
        if (d < t.r + 46) {
          mode = 'lunge';
          modeT = 0.5;
        } else if (modeT <= 0) {
          mode = 'roam';
          pickWander();
        }
      }
    } else if (mode === 'lunge') {
      const t = targets[current];
      if (!t) {
        mode = 'roam';
        pickWander();
      } else {
        const d = Math.hypot(t.x - head.x, t.y - head.y);
        if (d < t.r + 14) {
          // strike resolves: latch (drain) or get repelled
          const latch = Math.random() < lerp(0.25, 0.7, mood) && !t.big;
          if (latch) {
            t.life = Math.max(0, t.life - (0.3 + Math.random() * 0.4));
            t.flare = 0.4;
          } else {
            t.flare = 1;
          }
          mode = 'recoil';
          modeT = 0.5 + Math.random() * 0.4;
          // recoil direction: away from target
          const ang = Math.atan2(head.y - t.y, head.x - t.x);
          wander = { x: head.x + Math.cos(ang) * 180, y: head.y + Math.sin(ang) * 120 };
        } else if (modeT <= 0) {
          mode = 'stalk';
          modeT = 4;
        }
      }
    } else if (mode === 'recoil') {
      if (modeT <= 0) {
        mode = 'roam';
        pickWander();
        modeT = 2 + Math.random() * 2;
      }
    }

    // steer toward goal
    let goal = wander;
    if ((mode === 'stalk' || mode === 'lunge') && targets[current]) goal = targets[current];
    const desired = Math.atan2(goal.y + droop - head.y, goal.x - head.x);
    // smooth angle turn
    let da = desired - heading;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const turnRate = mode === 'lunge' ? 0.14 : 0.06;
    heading += da * turnRate;

    const spd =
      baseSpeed *
      (mode === 'lunge' ? 2.1 : mode === 'recoil' ? 1.5 : 1) *
      (reduced ? 0 : 1);
    // weak worm twitches
    const twitch = mood < 0.3 && !reduced ? (Math.random() - 0.5) * (0.3 - mood) * 6 : 0;
    head.x += Math.cos(heading) * spd + Math.cos(heading + Math.PI / 2) * twitch;
    head.y += Math.sin(heading) * spd + Math.sin(heading + Math.PI / 2) * twitch;
    head.a = heading;

    // keep head in bounds (soft)
    const pad = 30;
    const maxY = dip > 0 ? height - pad : tankHeight() - pad;
    if (head.x < pad) heading = lerp(heading, 0, 0.3), (head.x = pad);
    if (head.x > width - pad) heading = lerp(heading, Math.PI, 0.3), (head.x = width - pad);
    if (head.y < pad) (head.y = pad), (heading = Math.abs(heading));
    if (head.y > maxY) (head.y = maxY), (heading = -Math.abs(heading));

    // body follows with undulation
    spine[0].x = head.x;
    spine[0].y = head.y;
    for (let i = 1; i < SEG; i++) {
      const prev = spine[i - 1];
      const cur = spine[i];
      const ang = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      // lateral wave
      const wave = Math.sin(phase - i * 0.5) * amp * (i / SEG);
      const tx = prev.x + Math.cos(ang) * SPACING + Math.cos(ang + Math.PI / 2) * wave * 0.15;
      const ty = prev.y + Math.sin(ang) * SPACING + Math.sin(ang + Math.PI / 2) * wave * 0.15;
      cur.x = lerp(cur.x, tx, 0.5);
      cur.y = lerp(cur.y, ty, 0.5);
    }

    // decay flares
    for (const t of targets) t.flare = Math.max(0, t.flare - dt * 2.2);
  }

  function radAt(i) {
    const t = i / (SEG - 1);
    const belly = Math.sin(Math.min(1, t * 1.12) * Math.PI);
    return (4 + belly * 15 * (1 - 0.3 * t)) * lerp(0.7, 1.08, mood);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const vivid = lerp(0.4, 1, mood);

    // targets first (behind the worm glow)
    ctx.save();
    for (const t of targets) {
      const alive = t.big ? 1 : t.life;
      const baseA = 0.25 + alive * 0.5;
      // halo
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.r * (3 + t.flare * 2));
      const [hr, hg, hb] = t.big ? [150, 175, 255] : rgbAt(t.hue);
      halo.addColorStop(0, `rgba(${hr},${hg},${hb},${(0.22 + t.flare * 0.5) * baseA})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (3 + t.flare * 2), 0, Math.PI * 2);
      ctx.fill();
      // core
      ctx.globalCompositeOperation = 'source-over';
      const core = ctx.createRadialGradient(
        t.x - t.r * 0.3,
        t.y - t.r * 0.3,
        0,
        t.x,
        t.y,
        t.r
      );
      core.addColorStop(0, `rgba(255,255,255,${0.9 * baseA})`);
      core.addColorStop(0.5, `rgba(${hr},${hg},${hb},${0.8 * baseA})`);
      core.addColorStop(1, `rgba(12,14,30,${0.9 * baseA})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (0.6 + alive * 0.4), 0, Math.PI * 2);
      ctx.fill();
      if (t.big) {
        ctx.strokeStyle = 'rgba(160,180,255,0.22)';
        ctx.setLineDash([2, 7]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * 2.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // worm bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < SEG; i++) {
      const p = spine[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = `rgba(150,110,255,${0.16 * vivid})`;
    ctx.lineWidth = 46;
    ctx.stroke();
    ctx.strokeStyle = `rgba(100,242,210,${0.12 * vivid})`;
    ctx.lineWidth = 24;
    ctx.stroke();
    ctx.restore();

    // body discs
    ctx.save();
    for (let i = SEG - 1; i >= 0; i--) {
      const p = spine[i];
      const t = i / (SEG - 1);
      const r = radAt(i);
      const [cr, cg, cb] = rgbAt((Math.sin(t * 3 + 0.3) + 1) / 2);
      const g = ctx.createRadialGradient(
        p.x - r * 0.3,
        p.y - r * 0.34,
        0,
        p.x,
        p.y,
        r
      );
      g.addColorStop(0, `rgba(255,255,255,${0.95 * vivid})`);
      g.addColorStop(0.22, `rgba(${cr},${cg},${cb},${0.95 * vivid})`);
      g.addColorStop(0.7, `rgba(${cr},${cg},${cb},${0.5 * vivid})`);
      g.addColorStop(1, 'rgba(9,10,22,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // bright spine
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < SEG; i++) {
      const p = spine[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = `rgba(200,255,245,${0.5 * vivid})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // head
    const h = spine[0];
    const hr = radAt(0) + 3;
    const hg = ctx.createRadialGradient(h.x - hr * 0.3, h.y - hr * 0.3, 0, h.x, h.y, hr);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.42, '#9cf7e6');
    hg.addColorStop(1, '#0a0b16');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
    ctx.fill();
    // eyes face the heading
    const ex = Math.cos(heading);
    const ey = Math.sin(heading);
    const px = -ey;
    const py = ex;
    ctx.fillStyle = '#050a12';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(h.x + ex * hr * 0.3 + px * s * hr * 0.35, h.y + ey * hr * 0.3 + py * s * hr * 0.35, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let raf = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    },
  };
}
