// The same colors carry the same meaning throughout: blue scattering,
// gold sunlight, warm red/orange light after the longer sunset path.
const C = { blue: '#3c6fa8', red: '#a14332', orange: '#c46728', gold: '#d69b27', air: '#e4edf3', soft: '#645e54' };
const quiet = { sfx: false };

function heading(s, n, category, title, at, first = false) {
  s.text(`${n}  /  ${category}`, { x: 180, y: 115, align: 'left', size: 36, color: C.soft, at: first ? -1 : at, enter: first ? 'none' : 'fade', ...quiet });
  s.text(title, { x: 180, y: 220, align: 'left', size: 88, font: 'display', at: first ? -1 : at, enter: first ? 'none' : 'write', ...quiet });
  s.line([[180, 286], [1740, 286]], { at: first ? -1 : at, color: C.blue, opacity: 0.3, width: 2, ...quiet });
}
function label(s, text, x, y, at, o = {}) {
  return s.text(text, { x, y, size: 48, at, ...quiet, ...o });
}
function sun(s, x, y, at, size = 140, o = {}) {
  s.circle({ x, y, r: size * 0.30, fill: '#f4d17a', color: C.gold, at, ...quiet, ...o });
  s.icon('sun', { x, y, size, color: C.gold, at, ...quiet, ...o });
}
function molecule(s, x, y, at, o = {}) {
  s.line([[x - 10, y], [x + 10, y]], { at, color: C.soft, width: 4, ...quiet, ...o });
  s.circle({ x: x - 12, y, r: 13, at, color: C.soft, fill: '#f7f3ea', width: 2.5, ...quiet, ...o });
  s.circle({ x: x + 12, y, r: 13, at, color: C.soft, fill: '#f7f3ea', width: 2.5, ...quiet, ...o });
}
function ray(s, from, to, at, color = C.blue, o = {}) {
  s.arrow(from, to, { at, color, width: 7, headSize: 21, gap: 8, ...quiet, ...o });
}
function horizon(s, x, y, w, at, color = '#7a8d70') {
  s.path(`M ${x} ${y} Q ${x+w/2} ${y-95} ${x+w} ${y}`, { at, color, width: 5, ...quiet });
}
function wave(s, x, y, w, wavelength, color, at) {
  let d = `M ${x} ${y}`;
  for (let i = 1; i <= 200; i++) {
    const dx = w*i/200;
    d += ` L ${x+dx} ${y-40*Math.sin(dx*2*Math.PI/wavelength)}`;
  }
  s.path(d, { at, color, width: 6, single: true, ...quiet });
}
// A pulse follows a ray, keeping a diagram alive between spoken cues.
// This uses local scene time, so rendering remains deterministic.
function pulse(s, from, to, at, color, offset = 0) {
  s.draw({ at, ...quiet }, (ctx, life) => {
    const p = ((life.local + offset) % 2.8) / 2.8;
    ctx.globalAlpha *= Math.sin(Math.PI*p) * 0.8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(from[0]+(to[0]-from[0])*p, from[1]+(to[1]-from[1])*p, 7, 0, 2*Math.PI);
    ctx.fill();
  });
}

export default {
  pregunta(s) {
    heading(s, '01', 'UNA PREGUNTA COTIDIANA', '¿Por qué el cielo es azul?', '#pregunta', true);
    s.path('M 520 750 C 490 240 1430 240 1400 750 Z', { at: '#pregunta', color: C.blue, fill: C.air, width: 3, ...quiet });
    horizon(s, 460, 775, 1000, '#pregunta');
    sun(s, 760, 470, 'día', 150);
    label(s, 'Luz del Sol', 460, 530, '#respuesta');
    ray(s, [585, 550], [715, 493], '#respuesta', C.gold);
    label(s, 'Aire', 1420, 530, 'aire', { color: C.blue });
    ray(s, [1325, 540], [1180, 540], 'aire');
    s.annotate({ x: 1060, y: 500, w: 180, h: 120 }, { type: 'circle', at: 'aire', color: C.blue, ...quiet });
  },

  colores(s) {
    heading(s, '02', 'LA LUZ DEL SOL', 'Una mezcla de colores', '#sol');
    sun(s, 350, 575, '#sol', 185);
    label(s, 'Sol', 350, 780, '#sol');
    const colors = ['#b55743', '#d98835', '#ddb544', '#6d985c', '#3c6fa8', '#6563a6', '#895b9f'];
    colors.forEach((color, i) => {
      const y = 440+i*44;
      s.path(`M 475 575 Q 770 ${y} 1100 ${y} Q 1300 ${y} 1450 575`, { at: 'colores', color, width: 10, ...quiet });
    });
    label(s, 'Colores visibles', 910, 355, 'colores');
    s.circle({ x: 1500, y: 575, r: 83, color: '#9c9486', fill: '#fffdf8', width: 3, at: '#juntos', ...quiet });
    label(s, 'Luz blanca', 1500, 780, 'blanca');
    s.annotate({ x: 1498, y: 575, w: 192, h: 192 }, { type: 'circle', at: 'mezcla', color: C.gold, ...quiet });
    pulse(s, [1170, 575], [1420, 575], '#juntos', C.gold);
  },

  moleculas(s) {
    heading(s, '03', 'EL PAPEL DEL AIRE', 'La luz cambia de dirección', '#aire');
    s.circle({ x: 960, y: 575, r: 185, color: C.blue, fill: C.air, width: 3, at: '#aire', ...quiet });
    [[850,490],[1060,480],[960,575],[850,660],[1070,660]].forEach(([x,y],i) => molecule(s,x,y,i===2 ? 'moléculas' : 'partículas'));
    label(s, 'Moléculas del aire', 960, 360, 'moléculas');
    ray(s, [360,575], [920,575], 'luz', C.gold);
    label(s, 'Luz solar', 485, 670, 'luz');
    ray(s, [992,555], [1400,410], '#desvio');
    ray(s, [995,595], [1370,730], 'direcciones');
    pulse(s, [992,555], [1400,410], '#desvio', C.blue);
    pulse(s, [995,595], [1370,730], 'direcciones', C.blue, 1.2);
    label(s, 'Dispersión', 960, 788, '#nombre', { size: 58, color: C.blue, font: 'display' });
  },

  ondas(s) {
    heading(s, '04', 'EL PAPEL DEL AIRE', 'El azul se dispersa más', '#ondas');
    label(s, 'Azul', 275, 455, '#ondas', { color: C.blue, size: 56 });
    label(s, 'Rojo', 275, 685, '#ondas', { color: C.red, size: 56 });
    wave(s, 440,455,920,120,C.blue,'#ondas');
    wave(s, 440,685,920,300,C.red,'#ondas');
    s.arrow([470,359], [590,359], { at: 'distancia', head: 'both', color: C.blue, width: 3, headSize: 14, gap: 0, ...quiet });
    s.line([[470,367],[470,405]], { at: 'crestas', color: C.blue, dashed: true, width: 2, ...quiet });
    s.line([[590,367],[590,405]], { at: 'crestas', color: C.blue, dashed: true, width: 2, ...quiet });
    label(s, 'Onda corta', 965, 355, '#azul', { color: C.blue });
    label(s, 'Más\ndispersión', 1550, 455, 'dispersan', { color: C.blue, size: 44 });
    label(s, 'Onda larga', 965, 790, '#rojo', { color: C.red });
    label(s, 'Menos\ndispersión', 1550, 685, '#rojo', { color: C.red, size: 44 });
    s.annotate({ x: 830, y: 455, w: 300, h: 110 }, { at: 'cortas', type: 'highlight', color: C.blue, ...quiet });
  },

  ojos(s) {
    heading(s, '05', 'EL AZUL QUE VEMOS', 'Desde todo el cielo', '#cielo');
    s.path('M 430 680 C 380 255 1540 255 1490 680', { at: '#cielo', color: C.blue, width: 4, ...quiet });
    sun(s, 390, 435, '#cielo', 120);
    s.icon('eye', { x: 960, y: 690, size: 145, at: 'ojos', color: 'ink', ...quiet });
    label(s, 'Nuestros ojos', 960, 795, 'ojos');
    const rays = [[[590,475],[895,665]], [[960,375],[960,627]], [[1330,475],[1025,665]]];
    rays.forEach(([from,to],i) => {
      const at = i===0 ? 'azul' : i===1 ? 'ojos' : 'direcciones';
      s.circle({ x: from[0], y: from[1], r: 19, color: C.blue, fill: C.air, at, ...quiet });
      ray(s,from,to,at);
      pulse(s,from,to,at,C.blue,i*.7);
    });
    s.annotate({ x: 1330, y: 475, w: 110, h: 110 }, { at: '#mirada', type: 'circle', color: C.blue, ...quiet });
    label(s, 'Lejos del Sol', 1470, 785, 'lejos', { size: 46, color: C.blue });
  },

  ocaso(s) {
    heading(s, '06', 'AL ATARDECER', 'Un recorrido más largo', '#bajo');
    s.path('M 450 770 C 510 295 1370 295 1480 770 Z', { at: '#bajo', color: C.blue, fill: C.air, width: 2.5, ...quiet });
    horizon(s, 200, 790, 1510, '#bajo');
    sun(s, 280, 650, 'bajo', 130);
    [[630,600],[780,700],[930,590],[1080,705],[1230,600],[1370,700]].forEach(([x,y]) => molecule(s,x,y,'aire'));
    s.icon('eye', { x: 1570, y: 650, size: 125, at: 'luz', color: 'ink', ...quiet });
    ray(s,[365,650],[1495,650],'luz',C.gold);
    label(s, 'Más aire', 960, 370, 'aire', { size: 52, color: C.blue });
    ray(s,[715,638],[790,465],'#fuera');
    ray(s,[970,638],[1090,465],'azul');
    pulse(s,[715,638],[790,465],'#fuera',C.blue);
    pulse(s,[970,638],[1090,465],'azul',C.blue,1);
    label(s, 'Azul dispersado', 580, 405, 'dispersa', { size: 42, color: C.blue });
    ray(s,[1130,650],[1495,650],'#calidos',C.orange,{width:11});
    label(s, 'Rojos y naranjas', 1330, 798, 'rojos', { size: 46, color: C.red });
  },

  cierre(s) {
    heading(s, '07', 'LA IDEA PRINCIPAL', 'El aire cambia lo que vemos', '#dia');
    label(s, 'De día', 540, 360, '#dia', { size: 60, font: 'display', color: C.blue });
    s.path('M 285 695 C 285 330 795 330 795 695', { at: '#dia', color: C.blue, fill: C.air, width: 3, ...quiet });
    s.icon('eye', { x: 540, y: 700, size: 105, at: 'vemos', ...quiet });
    [[390,540],[540,470],[690,540]].forEach((p,i)=>ray(s,p,[540+(i-1)*36,647], 'dispersado'));
    label(s, 'Azul dispersado', 540, 795, 'aire', { color: C.blue });
    label(s, 'Al atardecer', 1380, 360, '#tarde', { size: 60, font: 'display', color: C.red });
    horizon(s, 1110, 715, 580, '#tarde');
    sun(s, 1160, 620, '#tarde', 110);
    s.icon('eye', { x: 1630, y: 620, size: 105, at: '#tarde', ...quiet });
    ray(s,[1220,620],[1565,620], 'recorrido', C.orange, {width:9});
    ray(s,[1350,605],[1395,470], 'largo');
    label(s, 'Tonos cálidos', 1380, 795, 'tonos', { color: C.red });
    s.line([[960,365],[960,830]], { at: '#tarde', color: C.blue, opacity:0.2, width:2, ...quiet });
  },
};
