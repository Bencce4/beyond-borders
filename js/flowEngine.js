// Particle engine for animated flow arrows
class FlowParticleEngine {
  constructor(map, paneName = 'arrows') {
    this.map = map;
    this.pane = map.getContainer();
    this.canvas = L.DomUtil.create('canvas', 'flow-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pane.appendChild(this.canvas);
    this.flows = [];
    this.particles = [];
    this.last = performance.now();
    this.running = false;
    this.dirty = true;
    this.maxParticles = 12000;
    this.fade = 0.06; // fade a bit quicker so tails vanish faster
    this.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    this._tick = this.step.bind(this);
    this.align = this.align.bind(this);
    this.map.on('move zoom zoomend', () => { this.dirty = true; this.align(); });
    this.map.on('resize', () => { this.dirty = true; this.resize(); });
    this.map.on('zoomend', () => { this.dirty = true; });
    this.resize();
  }

  resize() {
    const size = this.map.getSize();
    this.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const targetW = Math.round(size.x * this.dpr);
    const targetH = Math.round(size.y * this.dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.canvas.style.width = `${size.x}px`;
      this.canvas.style.height = `${size.y}px`;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, targetW / this.dpr, targetH / this.dpr);
    this.align();
    this.dirty = true;
  }

  align() {
    L.DomUtil.setPosition(this.canvas, L.point(0, 0));
  }

  pickCategory(distro) {
    const r = Math.random();
    let acc = 0;
    for (const d of distro) {
      acc += d.p;
      if (r <= acc) return d;
    }
    return distro[distro.length - 1] || { color: '#ffffff' };
  }

  clear(resetParticles = false) {
    const dpr = this.dpr || 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    if (resetParticles) this.particles = [];
  }

  setFlows(flows) {
    const getId = f => f?.id || f?.dest_iso3 || f?.dest;
    const prevIds = new Set(this.flows.map(getId).filter(Boolean));
    const nextIds = new Set(flows.map(getId).filter(Boolean));
    const removedIds = new Set([...prevIds].filter(id => !nextIds.has(id)));

    if (removedIds.size) {
      this.particles.forEach(p => {
        const pid = getId(p.flow);
        if (pid && removedIds.has(pid)) {
          p.fading = true;
          p.fadeAlpha = 1;
        }
      });
    }

    this.flows = flows.map(f => ({
      ...f,
      spawnAcc: 0
    }));
    this.dirty = true;
    this.ensureRunning();
  }

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  reproject() {
    this.flows.forEach(f => {
      const pts = f.latlngs.map(ll => this.map.latLngToContainerPoint(ll));
      let len = 0;
      const acc = [0];
      for (let i = 1; i < pts.length; i++) {
        len += pts[i].distanceTo(pts[i - 1]);
        acc.push(len);
      }
      f.points = pts;
      f.acc = acc;
      f.len = len || 1;
    });
    this.dirty = false;
  }

  pointAt(f, u) {
    if (!f.points || f.points.length < 2) return null;
    const dist = u * f.len;
    const acc = f.acc;
    let idx = acc.findIndex(x => x >= dist);
    if (idx < 1) idx = 1;
    if (idx === -1) idx = acc.length - 1;
    const p0 = f.points[idx - 1];
    const p1 = f.points[idx];
    const span = acc[idx] - acc[idx - 1] || 1;
    const t = Math.min(1, Math.max(0, (dist - acc[idx - 1]) / span));
    return L.point(
      p0.x + (p1.x - p0.x) * t,
      p0.y + (p1.y - p0.y) * t
    );
  }

  spawn(dt) {
    for (const f of this.flows) {
      const intensity = Math.max(0.4, Math.min(1.0, f.intensity || 0.6));
      const rate = Math.max(0.05, f.spawnRate || 0); // dots per second, derived from people-per-particle
      f.spawnAcc += rate * dt;
      const spawnN = Math.min(6, Math.floor(f.spawnAcc));
      f.spawnAcc -= spawnN;

      const laneCount = 1; // single lane, straight
      const laneSpacing = 0;

      for (let i = 0; i < spawnN; i++) {
        if (this.particles.length >= this.maxParticles) break;
        const laneIdx = Math.floor(Math.random() * laneCount);
        const laneOffset = (laneIdx - (laneCount - 1) / 2) * laneSpacing;
        const jitter = 0; // no wiggle
        const spreadWidth = (f.spread || 1) * 2.2; // continuous band
        const randOffset = 0; 
        const cat = this.pickCategory(f.distro);
        this.particles.push({
          flow: f,
          u: 0,
          speed: 1 / f.duration,
          jitter,
          laneOffset,
          randOffset,
          color: cat.color,
          fading: false,
          fadeAlpha: 1
        });
      }
    }
  }

  update(dt) {
    const alive = [];
    for (const p of this.particles) {
      const speedMult = p.fading ? 2.2 : 1;
      p.u += dt * p.speed * speedMult;
      if (p.fading) {
        p.fadeAlpha = (p.fadeAlpha ?? 1) - dt * 3.2;
        if ((p.fadeAlpha ?? 0) <= 0) continue;
      }
      if (p.u <= 1 || p.fading) alive.push(p);
    }
    this.particles = alive;
  }

  drawFrame() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear frame to avoid lingering streaks
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const r = 1.0;
    const tailDelay = 0.06;
    const tailLen = 22;

    for (const p of this.particles) {
      const f = p.flow;
      const fadeFactor = Math.max(0, Math.min(1, p.fadeAlpha ?? 1));
      const mainPt = this.pointAt(f, p.u);
      if (!mainPt) continue;

      const dir = this._dirForPoint(f, p.u, mainPt);
      const jitter = p.jitter;
      const perp = this._perpForFlow(f, mainPt);
      const offsetFactor = Math.sin(Math.PI * Math.max(0, Math.min(1, p.u))); // zero at ends, peak mid

      const drawSquare = (pt, size, alpha) => {
        if (!pt) return;
        const baseOffset = (p.laneOffset || 0) + (p.randOffset || 0);
        const offset = (baseOffset + jitter) * offsetFactor;
        const x = pt.x + perp[0] * offset;
        const y = pt.y + perp[1] * offset;
        const half = size / 2;
        ctx.beginPath();
        ctx.rect(x - half, y - half, size, size);
        ctx.fillStyle = p.color || f.color || '#ffffff';
        ctx.globalAlpha = alpha * fadeFactor;
        ctx.fill();
      };

      // tail with smooth fade
      const headColor = p.color || f.color || '#ffffff';
      if (p.u > tailDelay) {
        const tailEnd = L.point(mainPt.x - dir.x * tailLen, mainPt.y - dir.y * tailLen);
        const grad = ctx.createLinearGradient(tailEnd.x, tailEnd.y, mainPt.x, mainPt.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, headColor);
        ctx.beginPath();
        ctx.moveTo(tailEnd.x, tailEnd.y);
        ctx.lineTo(mainPt.x, mainPt.y);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = fadeFactor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // main dot as a square
      drawSquare(mainPt, r * 1.4, 0.95);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _perpForFlow(f, pt) {
    if (!f.points || f.points.length < 2) return [0, 0];
    // find nearest segment
    let bestIdx = 1;
    let bestDist = Infinity;
    for (let i = 1; i < f.points.length; i++) {
      const p0 = f.points[i - 1];
      const p1 = f.points[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const proj = ((pt.x - p0.x) * dx + (pt.y - p0.y) * dy) / (dx*dx + dy*dy || 1);
      const clamped = Math.max(0, Math.min(1, proj));
      const cx = p0.x + dx * clamped;
      const cy = p0.y + dy * clamped;
      const d2 = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = i;
      }
    }
    const p0 = f.points[bestIdx - 1];
    const p1 = f.points[bestIdx];
    const vx = p1.x - p0.x;
    const vy = p1.y - p0.y;
    const len = Math.hypot(vx, vy) || 1;
    return [-vy / len, vx / len];
  }

  _dirForPoint(f, u, pt) {
    if (!f.points || f.points.length < 2) return { x: 0, y: -1 };
    const dist = u * (f.len || 1);
    const acc = f.acc || [];
    let idx = acc.findIndex(x => x >= dist);
    if (idx < 1) idx = 1;
    if (idx === -1) idx = acc.length - 1;
    const p0 = f.points[idx - 1];
    const p1 = f.points[idx];
    let vx = p1.x - p0.x;
    let vy = p1.y - p0.y;
    if (vx === 0 && vy === 0 && f.points.length >= 2) {
      const first = f.points[0];
      const last = f.points[f.points.length - 1];
      vx = last.x - first.x;
      vy = last.y - first.y;
    }
    const len = Math.hypot(vx, vy) || 1;
    return { x: vx / len, y: vy / len };
  }

  step(now) {
    if (!this.running) return;
    const dt = Math.min(0.08, (now - this.last) / 1000);
    this.last = now;
    this.resize();
    if (this.dirty) this.reproject();
    this.spawn(dt);
    this.update(dt);
    this.drawFrame();
    requestAnimationFrame(this._tick);
  }
}
