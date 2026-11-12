'use strict';

// A dependency-free 3D globe on canvas: dotted land (Natural Earth, baked into
// assets/geo/land-dots.json), drag to turn, slow spin, and a pin per place
// sized by how many graduates are there. Pins follow the main page's filters.
window.MelliGlobe = (() => {
  const RAD = Math.PI / 180;
  const INK = '214,204,176';
  const PIN = '#D8A76A';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let canvas, context, card, list, unplaced, options;
  let dots = [];
  let groups = [];
  let selected = null;
  let view = {lon: 53, lat: 24};
  let size = {w: 0, h: 0, r: 0, cx: 0, cy: 0, dpr: 1};
  let running = false;
  let lastTime = 0;
  let pauseUntil = 0;
  let flight = null;
  let drag = null;

  function project(lat, lon) {
    const phi = lat * RAD;
    const lambda = (lon - view.lon) * RAD;
    const phi0 = view.lat * RAD;
    const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
    const x = Math.cos(phi) * Math.sin(lambda);
    const y = Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda);
    return {x: size.cx + x * size.r, y: size.cy - y * size.r, depth: cosc};
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = {w: rect.width * dpr, h: rect.height * dpr, dpr};
    size.r = Math.min(size.w, size.h) / 2 * 0.8;
    size.cx = size.w / 2;
    size.cy = size.h / 2;
    canvas.width = Math.round(size.w);
    canvas.height = Math.round(size.h);
  }

  // From 3 to 9 CSS pixels by share of the busiest place, scaled with the globe.
  let maxCount = 1;
  function pinRadius(group) {
    const scale = Math.max(0.8, Math.min(1.4, size.r / size.dpr / 200));
    return (3 + 6 * Math.sqrt(group.count / maxCount)) * size.dpr * scale;
  }

  // Traces lines of latitude or longitude on the visible side only.
  function graticule(list, isLongitude) {
    context.beginPath();
    list.forEach(fixed => {
      let pen = false;
      for (let step = isLongitude ? -90 : -180; step <= (isLongitude ? 90 : 180); step += 3) {
        const point = isLongitude ? project(step, fixed) : project(fixed, step);
        if (point.depth > 0) {
          pen ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y);
          pen = true;
        } else {
          pen = false;
        }
      }
    });
    context.stroke();
  }

  // Drawn like an old library globe: a horizon ring with a degree scale,
  // engraved hatching on the shaded side, stippled land and surveyor's marks.
  function draw(time) {
    const {w, h, r, cx, cy, dpr} = size;
    context.clearRect(0, 0, w, h);
    context.setLineDash([]);
    // Horizon ring and its scale: a tick every 5 degrees, longer every 10 and 30.
    const inner = r * 1.045;
    const outer = r * 1.1;
    context.strokeStyle = `rgba(${INK},.42)`;
    context.lineWidth = dpr;
    context.beginPath();
    context.arc(cx, cy, inner, 0, Math.PI * 2);
    context.moveTo(cx + outer, cy);
    context.arc(cx, cy, outer, 0, Math.PI * 2);
    for (let degree = 0; degree < 360; degree += 5) {
      const angle = degree * RAD;
      const reach = degree % 30 === 0 ? outer : inner + (outer - inner) * (degree % 10 === 0 ? .6 : .32);
      context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      context.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    }
    context.stroke();
    // The sphere, lit from the upper left.
    const body = context.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r * 1.05);
    body.addColorStop(0, '#141a26');
    body.addColorStop(1, '#06080d');
    context.fillStyle = body;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fill();
    // Hatching that darkens toward the shaded side.
    context.save();
    context.clip();
    const shade = context.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.55, cx, cy, r * 1.05);
    shade.addColorStop(0, `rgba(${INK},0)`);
    shade.addColorStop(1, `rgba(${INK},.2)`);
    context.strokeStyle = shade;
    context.lineWidth = 0.8 * dpr;
    context.beginPath();
    const gap = 4.5 * dpr;
    for (let offset = -2 * r; offset <= 2 * r; offset += gap) {
      context.moveTo(cx + offset - r, cy + r);
      context.lineTo(cx + offset + r, cy - r);
    }
    context.stroke();
    context.restore();
    // Graticule every 15 degrees; the equator and the tropics dashed.
    context.strokeStyle = `rgba(${INK},.09)`;
    context.lineWidth = 0.8 * dpr;
    const meridians = [];
    for (let lon = -180; lon < 180; lon += 15) meridians.push(lon);
    graticule(meridians, true);
    graticule([-75, -60, -45, -30, -15, 15, 30, 45, 60, 75], false);
    context.setLineDash([5 * dpr, 4 * dpr]);
    context.strokeStyle = `rgba(${INK},.32)`;
    graticule([0], false);
    context.setLineDash([2 * dpr, 4 * dpr]);
    context.strokeStyle = `rgba(${INK},.2)`;
    graticule([-23.44, 23.44], false);
    context.setLineDash([]);
    // Land as ink stipple, fading toward the edge.
    const dot = 1.5 * dpr;
    for (let i = 0; i < dots.length; i += 2) {
      const point = project(dots[i], dots[i + 1]);
      if (point.depth <= 0.02) continue;
      context.fillStyle = `rgba(${INK},${(0.14 + point.depth * 0.62).toFixed(2)})`;
      const s = dot * (0.55 + 0.45 * point.depth);
      context.fillRect(point.x - s / 2, point.y - s / 2, s, s);
    }
    context.strokeStyle = `rgba(${INK},.6)`;
    context.lineWidth = 1.2 * dpr;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
    // Pins as surveyor's marks: a ring with four ticks, sized by headcount;
    // a solid centre when the city is known, a dashed ring when only the country is.
    const pulse = reduced ? 0 : (time / 2200) % 1;
    groups.forEach(group => {
      const point = project(group.lat, group.lon);
      group.screen = point;
      if (point.depth <= 0.05) return;
      const radius = pinRadius(group);
      const isSelected = selected && selected.key === group.key;
      context.globalAlpha = 0.35 + point.depth * 0.65;
      if (!reduced) {
        context.strokeStyle = `rgba(216,167,106,${(isSelected ? 0.7 : 0.35) * (1 - pulse)})`;
        context.lineWidth = dpr;
        context.beginPath();
        context.arc(point.x, point.y, radius + pulse * radius * 1.4, 0, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = 'rgba(216,167,106,.14)';
      context.strokeStyle = PIN;
      context.lineWidth = (isSelected ? 2 : 1.3) * dpr;
      if (!group.exact) context.setLineDash([3 * dpr, 2.5 * dpr]);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        context.moveTo(point.x + dx * (radius + 2 * dpr), point.y + dy * (radius + 2 * dpr));
        context.lineTo(point.x + dx * (radius + 6 * dpr), point.y + dy * (radius + 6 * dpr));
      });
      context.stroke();
      if (group.exact) {
        context.fillStyle = PIN;
        context.beginPath();
        context.arc(point.x, point.y, 1.8 * dpr, 0, Math.PI * 2);
        context.fill();
      }
      if (isSelected) {
        context.font = `600 ${13 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
        context.textAlign = 'center';
        context.lineJoin = 'round';
        context.lineWidth = 4 * dpr;
        context.strokeStyle = '#06080d';
        context.strokeText(group.label, point.x, point.y - radius - 12 * dpr);
        context.fillStyle = `rgb(${INK})`;
        context.fillText(group.label, point.x, point.y - radius - 12 * dpr);
      }
      context.globalAlpha = 1;
    });
  }

  function frame(time) {
    if (!running) return;
    const delta = Math.min(64, time - (lastTime || time));
    lastTime = time;
    if (flight) {
      const t = Math.min(1, (time - flight.start) / flight.duration);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      view.lon = flight.from.lon + flight.dLon * ease;
      view.lat = flight.from.lat + (flight.to.lat - flight.from.lat) * ease;
      if (t >= 1) flight = null;
    } else if (!drag && !reduced && time > pauseUntil && !selected) {
      view.lon = (view.lon + delta * 0.004 + 540) % 360 - 180;
    }
    draw(time);
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || !dots.length) return;
    running = true;
    lastTime = 0;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  function flyTo(lat, lon) {
    const dLon = ((lon - view.lon + 540) % 360) - 180;
    const to = {lat: Math.max(-60, Math.min(60, lat)), lon};
    if (reduced) {
      view = {...to};
      draw(0);
      return;
    }
    flight = {start: performance.now(), duration: 900, from: {...view}, to, dLon};
  }

  function select(group) {
    selected = group;
    pauseUntil = performance.now() + 6000;
    list.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(group && button.dataset.key === group.key)));
    if (!group) {
      card.hidden = true;
      return;
    }
    flyTo(group.lat, group.lon);
    const {t, num} = options;
    card.replaceChildren();
    const head = document.createElement('div');
    head.className = 'globe-card-head';
    const title = document.createElement('strong');
    title.textContent = group.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'globe-close';
    close.setAttribute('aria-label', t('globe.close'));
    close.textContent = '×';
    close.addEventListener('click', () => select(null));
    head.append(title, close);
    const count = document.createElement('p');
    count.className = 'globe-card-count';
    count.textContent = t(group.count === 1 ? 'globe.peopleOne' : 'globe.people', {n: num(group.count)}) + (group.exact ? '' : ` · ${t('globe.countryOnly')}`);
    const people = document.createElement('ul');
    group.people.slice(0, 8).forEach(person => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = person.href;
      link.textContent = person.name;
      item.append(link);
      people.append(item);
    });
    card.append(head, count, people);
    if (group.people.length > 8) {
      const more = document.createElement('p');
      more.className = 'globe-card-more';
      more.textContent = t('globe.more', {n: num(group.people.length - 8)});
      card.append(more);
    }
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'globe-show';
    show.textContent = t('globe.filter');
    show.addEventListener('click', () => options.onFilter(group));
    card.append(show);
    card.hidden = false;
  }

  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * size.dpr;
    const y = (event.clientY - rect.top) * size.dpr;
    let best = null;
    let bestDistance = Infinity;
    groups.forEach(group => {
      if (!group.screen || group.screen.depth <= 0.05) return;
      const distance = Math.hypot(group.screen.x - x, group.screen.y - y);
      if (distance < pinRadius(group) + 10 * size.dpr && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    });
    return best;
  }

  function renderList() {
    const {t, num} = options;
    list.replaceChildren();
    const most = Math.max(1, ...groups.map(group => group.count));
    [...groups].sort((a, b) => b.count - a.count).forEach(group => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--share', (group.count / most).toFixed(3));
      button.dataset.key = group.key;
      button.setAttribute('aria-pressed', String(Boolean(selected && selected.key === group.key)));
      const name = document.createElement('span');
      name.textContent = group.label;
      const count = document.createElement('strong');
      count.textContent = num(group.count);
      button.append(name, count);
      button.addEventListener('click', () => select(selected && selected.key === group.key ? null : group));
      item.append(button);
      list.append(item);
    });
  }

  function mount(root, settings) {
    options = settings;
    canvas = root.querySelector('canvas');
    card = root.querySelector('.globe-card');
    list = root.querySelector('.globe-cities');
    unplaced = root.querySelector('.globe-unplaced');
    context = canvas.getContext('2d');
    resize();
    new ResizeObserver(() => {
      resize();
      if (!running) draw(0);
    }).observe(canvas);
    canvas.addEventListener('pointerdown', event => {
      drag = {x: event.clientX, y: event.clientY, lon: view.lon, lat: view.lat, moved: false};
      canvas.setPointerCapture(event.pointerId);
      flight = null;
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) {
        canvas.style.cursor = hit(event) ? 'pointer' : 'grab';
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const scale = 180 / (size.r / size.dpr) / Math.PI;
      view.lon = drag.lon - dx * scale;
      view.lat = Math.max(-70, Math.min(70, drag.lat + dy * scale));
      if (!running) draw(0);
    });
    canvas.addEventListener('pointerup', event => {
      const wasDrag = drag && drag.moved;
      drag = null;
      pauseUntil = performance.now() + 4000;
      if (!wasDrag) select(hit(event));
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) start();
      else stop();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    fetch('assets/geo/land-dots.json')
      .then(response => response.json())
      .then(data => {
        dots = data;
        draw(0);
        start();
      })
      .catch(() => {});
  }

  function update(nextGroups, unplacedCount) {
    groups = nextGroups;
    maxCount = Math.max(1, ...groups.map(group => group.count));
    if (selected) selected = groups.find(group => group.key === selected.key) || null;
    if (!selected) card.hidden = true;
    renderList();
    unplaced.hidden = !unplacedCount;
    unplaced.textContent = unplacedCount ? options.t('globe.unplaced', {n: options.num(unplacedCount)}) : '';
    if (!running && dots.length) draw(0);
  }

  return {mount, update, select: key => select(groups.find(group => group.key === key) || null)};
})();
