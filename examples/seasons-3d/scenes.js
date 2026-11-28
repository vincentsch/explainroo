// Why we have seasons: the orbit, the tilt and day and night in 3D, and the
// distance and the angle of the light in 2D. Each 3D scene builds its own
// planet in setup and sets everything from the time in frame. Labels are
// s.text, placed with point(), so check can read them.
const TILT = (23.4 * Math.PI) / 180;

// A planet drawn once on a canvas: sea, continents that grow by small random
// steps, and white poles. Math.random is seeded in setup, so every render
// page draws the same continents.
function planetTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  const sea = g.createLinearGradient(0, 0, 0, 512);
  sea.addColorStop(0, '#1e3a8a');
  sea.addColorStop(0.5, '#2563eb');
  sea.addColorStop(1, '#1e3a8a');
  g.fillStyle = sea;
  g.fillRect(0, 0, 1024, 512);
  const blob = (x, y, r) => {
    for (const dx of [-1024, 0, 1024]) {
      g.beginPath();
      g.ellipse(x + dx, y, r * 1.3, r, 0, 0, Math.PI * 2);
      g.fill();
    }
  };
  for (let k = 0; k < 6; k++) {
    let x = Math.random() * 1024;
    let y = 130 + Math.random() * 250;
    for (let i = 0; i < 60; i++) {
      g.fillStyle = i % 7 === 0 ? '#c9b27a' : '#2f9e55';
      blob(x, y, 7 + Math.random() * 13);
      x += (Math.random() - 0.5) * 34;
      y += (Math.random() - 0.5) * 26;
    }
  }
  g.fillStyle = '#eef4ff';
  g.fillRect(0, 0, 1024, 28);
  g.fillRect(0, 484, 1024, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A tilted planet: its axis leans TILT toward +x and stays that way.
function planet(THREE, color, radius) {
  const tilt = new THREE.Group();
  tilt.rotation.z = -TILT;
  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), new THREE.MeshStandardMaterial({ map: planetTexture(THREE), roughness: 0.75 }));
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.02, radius * 0.02, radius * 2.8), new THREE.MeshBasicMaterial({ color: color('ink') }));
  tilt.add(globe, axis);
  return { tilt, globe };
}

// A soft round glow, for the Sun.
function glow(THREE, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 214, 120, 0.95)');
  grad.addColorStop(0.3, 'rgba(255, 170, 60, 0.4)');
  grad.addColorStop(1, 'rgba(255, 150, 40, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

// The Sun: a bright ball in its glow, and the light it gives.
function sun(THREE, radius) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
  group.add(glow(THREE, radius * 6), ball, new THREE.PointLight(0xffffff, 3.2, 0, 0));
  return group;
}

// Space: only the Sun lights the scene.
function darkSpace(scene, lights) {
  lights.key.visible = false;
  lights.fill.visible = false;
  lights.sky.intensity = 0.12;
  scene.environmentIntensity = 0.05;
}

// Sunlight from the right, far away: one half of the planet is day, the other
// night, and a glow at the edge of the frame shows where the Sun is.
function sunFromRight(THREE, scene, lights) {
  lights.fill.visible = false;
  lights.sky.intensity = 0.04;
  scene.environmentIntensity = 0.02;
  lights.key.position.set(10, 0, 0);
  lights.key.intensity = 3.2;
  const sunGlow = glow(THREE, 7);
  sunGlow.position.set(7, 0, 0);
  scene.add(sunGlow);
}

// A thin ring for the orbit, flat in the x-z plane.
function orbitRing(THREE, color, radius) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 8, 180), new THREE.MeshBasicMaterial({ color: color('muted') }));
  ring.rotation.x = Math.PI / 2;
  return ring;
}

// A circle of latitude on a tilted planet, in two colors: the part on the day
// side (toward +x, where the Sun is) and the part on the night side. The
// share of the circle in daylight is the share of a day the Sun is up there.
function latitude(THREE, radius, degrees, day, night) {
  const lat = (degrees * Math.PI) / 180;
  const r = radius * Math.cos(lat) + 0.012;
  const y = radius * Math.sin(lat);
  const group = new THREE.Group();
  const runs = [];
  let run = null;
  for (let i = 0; i <= 360; i++) {
    const a = (i * Math.PI) / 180;
    const p = new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
    // The x of this point once the planet leans, which decides day or night.
    const lit = p.x * Math.cos(TILT) + p.y * Math.sin(TILT) > 0;
    if (!run || run.lit !== lit) runs.push((run = { lit, points: run ? [run.points.at(-1)] : [] }));
    run.points.push(p);
  }
  for (const { lit, points } of runs) {
    if (points.length < 2) continue;
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length, 0.035, 8, false);
    group.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: lit ? day : night })));
  }
  return group;
}

// Where Earth is on an orbit of `radius` at `angle`, with the Sun in the middle.
// At angle PI it is on the -x side, where its north, which leans toward +x,
// leans toward the Sun: June. At 0 the south leans toward it: December.
const onOrbit = (radius, angle) => [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];

export default {
  hook(s) {
    const { top, h } = s.safe;
    s.title('Why we have seasons', { y: top + h * 0.07, size: 84, at: -1 });
    s.subtitle('Earth is closest to the Sun in early January', { y: top + h * 0.17, size: 42, at: 'closest' });
    const R = 3.6;
    const january = Math.PI * 0.36;
    const where = (t) => onOrbit(R, january + 0.025 * t);
    const space = s.three({ id: 'orbit', at: -1, full: true }, {
      setup({ THREE, scene, camera, lights, color }) {
        darkSpace(scene, lights);
        const { tilt, globe } = planet(THREE, color, 0.5);
        scene.add(sun(THREE, 0.75), orbitRing(THREE, color, R), tilt);
        camera.position.set(0, 5.4, 9.4);
        camera.lookAt(0, -0.1, 0);
        return { tilt, globe };
      },
      frame({ t, state }) {
        state.tilt.position.set(...where(t));
        state.globe.rotation.y = t * 0.8;
      },
    });
    const at = space.point(where(s.t));
    s.icon('snowflake', { x: at.x + 190, y: at.y - 20, size: 60, color: 'blue', at: '#cold' });
    s.text('Winter in the north', { x: at.x + 250, y: at.y - 20, size: 44, align: 'left', at: '#cold' });
  },

  distance(s) {
    const { left, top, w, h } = s.safe;
    s.number(3, { x: left + w * 0.22, y: top + h * 0.42, size: 220, suffix: '%', color: 'accent', at: 'three' });
    s.text('change in distance over a year', { x: left + w * 0.22, y: top + h * 0.62, size: 40, color: 'muted', maxWidth: w * 0.34, at: 'three' });
    s.bars([
      { label: 'Early January', value: 147, at: '#range' },
      { label: 'Early July', value: 152, at: 'kilometers' },
    ], { x: left + w * 0.68, y: top + h * 0.48, w: w * 0.46, h: h * 0.62, max: 160, suffix: ' million km', valueSize: 44, labelSize: 38 });
  },

  tilt(s) {
    const earth = s.three({ id: 'tilt', at: -1 }, {
      setup({ THREE, scene, color }) {
        const { tilt, globe } = planet(THREE, color, 2);
        // A dashed line straight up, so the lean shows against it, and the
        // arc of the angle between the two.
        const points = [];
        for (let y = -3.1; y <= 3.1; y += 0.4) points.push(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y + 0.2, 0));
        const upright = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: color('muted') }));
        const arc = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.03, 8, 48, TILT), new THREE.MeshBasicMaterial({ color: color('accent') }));
        arc.rotation.z = Math.PI / 2 - TILT;
        scene.add(tilt, upright, arc);
        return { globe, arc };
      },
      frame({ s, t, state }) {
        state.globe.rotation.y = t * 0.5;
        state.arc.visible = t >= s.time('#axis');
      },
    });
    const mid = earth.point([2.55 * Math.sin(TILT / 2), 2.55 * Math.cos(TILT / 2), 0]);
    s.text('23.4°', { x: mid.x + 30, y: mid.y - 50, size: 56, color: 'accent', align: 'left', at: '#axis' });
    const tip = earth.point([2.8 * Math.sin(TILT), 2.8 * Math.cos(TILT), 0]);
    s.text('It points the same way all year', { x: tip.x + 140, y: tip.y + 160, size: 40, color: 'muted', align: 'left', maxWidth: 440, at: '#fixed' });
  },

  orbit(s) {
    const R = 4.2;
    // From June on the -x side to December on the +x side, along the near half of the orbit.
    const angleAt = (t) => s.keys([{ at: 0, v: Math.PI * 0.94 }, { at: '#june', v: Math.PI }, { at: '#december', v: Math.PI * 2 }], t);
    const space = s.three({ id: 'year', at: -1, full: true }, {
      setup({ THREE, scene, camera, lights, color }) {
        darkSpace(scene, lights);
        const { tilt, globe } = planet(THREE, color, 0.62);
        // A faint copy stays behind in June.
        const { tilt: ghost } = planet(THREE, color, 0.62);
        ghost.traverse((o) => {
          if (o.material) {
            o.material.transparent = true;
            o.material.opacity = 0.3;
          }
        });
        ghost.position.set(...onOrbit(R, Math.PI));
        scene.add(sun(THREE, 0.8), orbitRing(THREE, color, R), tilt, ghost);
        camera.position.set(0, 3.4, 9.6);
        camera.lookAt(0, -0.2, 0);
        return { tilt, globe, ghost };
      },
      frame({ s, t, state }) {
        state.tilt.position.set(...onOrbit(R, angleAt(t)));
        state.globe.rotation.y = t * 0.9;
        state.ghost.visible = t >= s.time('#december');
      },
    });
    const june = space.point(onOrbit(R, Math.PI));
    const december = space.point(onOrbit(R, Math.PI * 2));
    s.text('June: the north leans in', { x: june.x + 20, y: june.y - 150, size: 40, color: 'accent', at: '#june' });
    s.text('December: the south leans in', { x: december.x - 150, y: december.y - 150, size: 40, color: 'blue', at: 'later' });
  },

  light(s) {
    const { left, top, w, h } = s.safe;
    const ground = top + h * 0.78;
    const beam = 120;
    // A beam of sunlight `beam` wide that hits the ground at `angle` degrees,
    // and the stretch of ground it lights, which grows as the angle drops.
    const panel = (cx, angle, at, label, spread) => {
      const rad = (angle * Math.PI) / 180;
      const foot = beam / Math.sin(rad);
      s.line([[cx - w * 0.2, ground], [cx + w * 0.2, ground]], { color: 'muted', width: 4, at: -1 });
      s.draw({ x: cx, y: ground, at, enter: 'fade', dur: 0.6, box: { x: -Math.cos(rad) * h * 0.31, y: -Math.sin(rad) * h * 0.31, w: foot + Math.cos(rad) * h * 0.62, h: Math.sin(rad) * h * 0.62 } }, (ctx) => {
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);
        const len = h * 0.62;
        const grad = ctx.createLinearGradient(-dx * len, -dy * len, 0, 0);
        grad.addColorStop(0, 'rgba(255, 210, 110, 0.05)');
        grad.addColorStop(1, 'rgba(255, 210, 110, 0.75)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-foot / 2, 0);
        ctx.lineTo(foot / 2, 0);
        ctx.lineTo(foot / 2 - dx * len, -dy * len);
        ctx.lineTo(-foot / 2 - dx * len, -dy * len);
        ctx.closePath();
        ctx.fill();
      });
      s.line([[cx - foot / 2, ground], [cx + foot / 2, ground]], { color: 'accent', width: 12, at: spread });
      s.text(label, { x: cx, y: ground + 70, size: 40, at: spread });
    };
    panel(left + w * 0.25, 80, 0, 'Small area: strong heat', 0.6);
    panel(left + w * 0.75, 28, '#slant', 'Large area: weak heat', '#spread');
  },

  days(s) {
    const earth = s.three({ id: 'day', at: -1, full: true }, {
      setup({ THREE, scene, lights, color }) {
        sunFromRight(THREE, scene, lights);
        const { tilt, globe } = planet(THREE, color, 2.2);
        const north = latitude(THREE, 2.2, 50, color('accent'), color('muted'));
        const south = latitude(THREE, 2.2, -50, color('accent'), color('muted'));
        tilt.add(north, south);
        scene.add(tilt);
        return { globe, north, south };
      },
      frame({ s, t, state }) {
        state.globe.rotation.y = t * 0.5;
        state.north.visible = t >= s.time('longer');
        state.south.visible = t >= s.time('#hours');
      },
    });
    const north = earth.point([2.25 * Math.cos(0.87) * Math.cos(TILT) + 2.25 * Math.sin(0.87) * Math.sin(TILT), -2.25 * Math.cos(0.87) * Math.sin(TILT) + 2.25 * Math.sin(0.87) * Math.cos(TILT), 0]);
    const south = earth.point([-2.25 * Math.cos(0.87) * Math.cos(TILT) - 2.25 * Math.sin(0.87) * Math.sin(TILT), 2.25 * Math.cos(0.87) * Math.sin(TILT) - 2.25 * Math.sin(0.87) * Math.cos(TILT), 0]);
    s.text('Longer days', { x: north.x + 60, y: north.y - 40, size: 48, color: 'accent', align: 'left', at: 'longer' });
    s.text('Shorter days', { x: south.x - 60, y: south.y + 40, size: 48, color: 'muted', align: 'right', at: '#hours' });
  },

  outro(s) {
    const { top, h } = s.safe;
    s.title('The tilt makes the seasons', { y: top + h * 0.07, size: 72, at: 'tilt' });
    const earth = s.three({ id: 'end', at: -1, full: true }, {
      setup({ THREE, scene, camera, lights, color }) {
        sunFromRight(THREE, scene, lights);
        // Looking a little above the planet puts it lower, under the title.
        camera.position.set(0, 0.8, 10);
        camera.lookAt(0, 0.8, 0);
        lights.sky.intensity = 0.2;
        const { tilt, globe } = planet(THREE, color, 1.45);
        scene.add(tilt);
        return { globe };
      },
      frame({ t, state }) {
        state.globe.rotation.y = t * 0.4;
      },
    });
    const north = earth.point([0.8, 1.25, 0]);
    const south = earth.point([-0.8, -1.25, 0]);
    s.text('Summer', { x: north.x + 220, y: north.y - 20, size: 64, color: 'accent', at: '#both' });
    s.text('Winter', { x: south.x - 220, y: south.y + 20, size: 64, color: 'blue', at: 'winter' });
  },
};
