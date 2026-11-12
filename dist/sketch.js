'use strict';

// Hand-drawn line work for every page: pencil lines that overshoot their
// corners the way architects sketch, drawn once when they come into view.
//   data-sketch="frame"      a sketched border around the element
//   data-sketch="underline"  a dimension line under the element
//   data-sketch="rule"       a dimension line above the element
// The masthead and the community block get their own drawings.
window.MelliSketch = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const round = value => Math.round(value * 10) / 10;

  // Seeded, so a drawing looks the same on every visit.
  function pen(seed = 11) {
    let state = seed;
    const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
    const jitter = amount => (random() - .5) * 2 * amount;

    function line(x1, y1, x2, y2, over = 4) {
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / length;
      const uy = (y2 - y1) / length;
      const a = over * (.4 + random() * .8);
      const b = over * (.4 + random() * .8);
      const sx = x1 - ux * a + jitter(.5);
      const sy = y1 - uy * a + jitter(.5);
      const ex = x2 + ux * b + jitter(.5);
      const ey = y2 + uy * b + jitter(.5);
      const bow = jitter(Math.min(2.2, length * .006 + .3));
      return `M${round(sx)} ${round(sy)}Q${round((sx + ex) / 2 - uy * bow)} ${round((sy + ey) / 2 + ux * bow)} ${round(ex)} ${round(ey)}`;
    }

    function curve(x1, y1, cx, cy, x2, y2) {
      return `M${round(x1 + jitter(.4))} ${round(y1 + jitter(.4))}Q${round(cx + jitter(1.2))} ${round(cy + jitter(1.2))} ${round(x2 + jitter(.4))} ${round(y2 + jitter(.4))}`;
    }

    function rect(x, y, w, h, over = 6) {
      return [line(x, y, x + w, y, over), line(x + w, y, x + w, y + h, over), line(x + w, y + h, x, y + h, over), line(x, y + h, x, y, over)];
    }

    // A pointed (Persian) arch standing on two jambs.
    function arch(x, base, width, spring, apex) {
      const mid = x + width / 2;
      return [
        line(x, base, x, spring, 1.5), line(x + width, base, x + width, spring, 1.5),
        curve(x, spring, x + width * .04, spring - (spring - apex) * .7, mid, apex),
        curve(x + width, spring, x + width * .96, spring - (spring - apex) * .7, mid, apex)
      ];
    }

    function circle(cx, cy, r) {
      return [curve(cx - r, cy, cx - r, cy - r, cx, cy - r), curve(cx, cy - r, cx + r, cy - r, cx + r, cy),
        curve(cx + r, cy, cx + r, cy + r, cx, cy + r), curve(cx, cy + r, cx - r - 1, cy + r, cx - r - .5, cy - 1)];
    }

    return {line, curve, rect, arch, circle, random};
  }

  // One wobble filter for the whole page; it roughens every stroke a little.
  function ensureFilter() {
    if (document.getElementById('sketch-defs')) return;
    const defs = document.createElementNS(NS, 'svg');
    defs.id = 'sketch-defs';
    defs.setAttribute('aria-hidden', 'true');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.style.position = 'absolute';
    defs.innerHTML = '<filter id="sketch-rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="1.8"/></filter>';
    document.body.append(defs);
  }

  const observer = 'IntersectionObserver' in window && !still
    ? new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-drawn');
      observer.unobserve(entry.target);
    }), {threshold: .15, rootMargin: '0px 0px -8% 0px'})
    : null;

  // strokes: [{d, delay, className}] or plain path strings.
  function paint(svg, strokes, {pace = 1, start = 0} = {}) {
    ensureFilter();
    svg.replaceChildren();
    let delay = start;
    strokes.forEach(stroke => {
      const item = typeof stroke === 'string' ? {d: stroke} : stroke;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', item.d);
      path.setAttribute('class', `sk${item.className ? ` ${item.className}` : ''}`);
      svg.append(path);
      const length = Math.ceil(path.getTotalLength()) + 2;
      const duration = Math.min(1.4, .25 + length / 900) * pace;
      path.style.setProperty('--len', length);
      path.style.setProperty('--dur', `${duration.toFixed(2)}s`);
      path.style.setProperty('--delay', `${(item.delay ?? delay).toFixed(2)}s`);
      delay += item.step ?? duration * .35;
    });
  }

  function svgFor(host, className) {
    ensureFilter();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', `sketch ${className}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    host.append(svg);
    return svg;
  }

  function reveal(svg, now = false) {
    if (now || !observer) svg.classList.add('is-drawn');
    else observer.observe(svg);
  }

  // ------------------------------------------------------------- frames and lines that follow the element's size

  const decorated = new WeakSet();

  function decorate(element) {
    if (decorated.has(element)) return;
    decorated.add(element);
    const kind = element.dataset.sketch;
    element.classList.add('has-sketch', `sketch-${kind}`);
    const svg = svgFor(element, `sketch-${kind}-svg`);
    const seed = 3 + (element.textContent.length % 97);
    let drawn = false;
    const draw = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!width) return;
      const p = pen(seed);
      let strokes;
      if (kind === 'frame') {
        const pad = 10;
        svg.setAttribute('viewBox', `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`);
        strokes = p.rect(0, 0, width, height, 9);
        // A second, lighter pass on two sides, the way a pencil goes over a line again.
        strokes.push({d: p.line(0, 2, width * (.3 + p.random() * .3), 1.5, 3), className: 'sk-soft'});
        strokes.push({d: p.line(width - 1.5, height, width - 2, height * (.5 + p.random() * .2), 3), className: 'sk-soft'});
      } else {
        const y = 7;
        svg.setAttribute('viewBox', `-8 0 ${width + 16} 14`);
        strokes = [
          p.line(0, y, width, y, 6),
          // dimension ticks at both ends
          {d: p.line(-3, y + 4, 3, y - 4, 0), className: 'sk-tick'},
          {d: p.line(width - 3, y + 4, width + 3, y - 4, 0), className: 'sk-tick'},
          {d: p.line(width * .02, y + 3.5, width * (.12 + p.random() * .1), y + 3, 2), className: 'sk-soft'}
        ];
      }
      paint(svg, strokes, {pace: kind === 'frame' ? 1.2 : 1});
      // A redraw after a resize appears at once; only the first one animates.
      reveal(svg, drawn);
      drawn = true;
    };
    draw();
    if ('ResizeObserver' in window) {
      let last = `${element.offsetWidth}x${element.offsetHeight}`;
      new ResizeObserver(() => {
        const size = `${element.offsetWidth}x${element.offsetHeight}`;
        if (size === last) return;
        last = size;
        draw();
      }).observe(element);
    }
  }

  function scan(root = document) {
    root.querySelectorAll('[data-sketch]').forEach(decorate);
  }

  // ------------------------------------------------------------- the masthead: an old arcade, a domed hall and a new block on one street

  function masthead(host) {
    const svg = svgFor(host, 'sketch-masthead');
    svg.setAttribute('viewBox', '0 0 1200 170');
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    const p = pen(29);
    const ground = 158;
    const strokes = [{d: p.line(-30, ground, 1230, ground, 0), step: .5}];
    for (let x = 24; x < 1190; x += 34) strokes.push({d: p.line(x, ground + 3, x - 7, ground + 11, 0), className: 'sk-soft', step: .015});
    strokes.push({d: p.line(0, 66, 1200, 66, 0), className: 'sk-guide', step: .2});

    // Arcade
    strokes.push(p.line(40, 52, 414, 52, 9), p.line(40, 44, 414, 44, 9), p.line(40, 44, 40, ground, 3), p.line(414, 44, 414, ground, 3));
    for (let i = 0; i < 5; i += 1) strokes.push(...p.arch(56 + i * 71, ground, 56, 104, 68));
    for (let i = 0; i < 5; i += 1) strokes.push({d: p.line(70 + i * 71, 30, 70 + i * 71, 44, 1), className: 'sk-soft'});

    // Cypresses and the domed hall
    [488, 712].forEach(x => strokes.push(p.curve(x - 7, ground, x - 10, 118, x, 84), p.curve(x + 7, ground, x + 10, 118, x, 84)));
    strokes.push(p.line(530, ground, 530, 98, 2), p.line(670, ground, 670, 98, 2), p.line(520, 98, 680, 98, 7), p.line(524, 90, 676, 90, 5));
    strokes.push(p.line(552, 90, 552, 76, 1), p.line(648, 90, 648, 76, 1), p.line(546, 76, 654, 76, 4));
    strokes.push(p.curve(552, 76, 554, 26, 600, 16), p.curve(648, 76, 646, 26, 600, 16), p.line(600, 16, 600, 2, 1));
    strokes.push(...p.arch(578, ground, 44, 124, 100));
    strokes.push({d: p.curve(560, 76, 580, 40, 600, 34), className: 'sk-soft'});

    // The new block and its tower
    strokes.push(p.line(790, ground, 790, 74, 3), p.line(1000, ground, 1000, 74, 3), p.line(782, 74, 1066, 74, 6), p.line(1066, 74, 1066, 82, 1));
    [96, 118, 140].forEach(y => strokes.push({d: p.line(790, y, 1000, y, 2), className: 'sk-soft'}));
    [832, 874, 916, 958].forEach(x => strokes.push({d: p.line(x, 74, x, ground, 1), className: 'sk-soft'}));
    strokes.push(p.line(1040, ground, 1040, 30, 3), p.line(1112, ground, 1112, 30, 3), p.line(1034, 30, 1118, 30, 5));
    for (let y = 44; y < ground; y += 13) strokes.push({d: p.line(1040, y, 1112, y, 1.5), className: 'sk-soft', step: .03});
    strokes.push({d: p.line(1150, ground, 1150, 120, 1), className: 'sk-soft'}, ...p.circle(1150, 112, 10));

    paint(svg, strokes, {pace: 1.1, start: .2});
    reveal(svg);
  }

  // ------------------------------------------------------------- drafting tools: a set square, a compass and a pencil line

  function tools(host) {
    const svg = svgFor(host, 'sketch-tools');
    svg.setAttribute('viewBox', '0 0 300 220');
    const p = pen(41);
    const strokes = [
      p.line(10, 196, 290, 196, 8),
      // iwan
      ...p.rect(96, 40, 148, 156, 6).slice(0, 2), p.line(96, 40, 96, 196, 6),
      ...p.arch(122, 196, 96, 110, 58),
      {d: p.curve(134, 112, 140, 80, 170, 70), className: 'sk-soft'},
      {d: p.line(96, 52, 244, 52, 4), className: 'sk-soft'},
      // set square
      p.line(22, 186, 112, 186, 4), p.line(22, 186, 22, 98, 4), p.line(22, 98, 112, 186, 4),
      {d: p.line(36, 172, 66, 172, 2), className: 'sk-soft'}, {d: p.line(36, 172, 36, 142, 2), className: 'sk-soft'}, {d: p.line(36, 142, 66, 172, 2), className: 'sk-soft'},
      // compass
      ...p.circle(262, 36, 5), p.line(260, 41, 236, 150, 2), p.line(264, 41, 284, 150, 2),
      {d: p.curve(226, 150, 258, 178, 292, 146), className: 'sk-guide'}
    ];
    paint(svg, strokes, {pace: 1.2});
    reveal(svg);
  }

  // ------------------------------------------------------------- a survey sheet: hatched columns, a scale and a dimension line

  function chart(host) {
    const svg = svgFor(host, 'sketch-chart');
    svg.setAttribute('viewBox', '0 0 300 200');
    const p = pen(53);
    const base = 178;
    const strokes = [p.line(14, base, 292, base, 8), p.line(34, base, 34, 26, 6)];
    for (let y = base - 26; y > 36; y -= 26) strokes.push({d: p.line(28, y, 40, y, 0), className: 'sk-soft', step: .04});
    [[62, 58], [112, 104], [162, 80], [212, 132]].forEach(([x, height]) => {
      const top = base - height;
      strokes.push(p.line(x, base, x, top, 2), p.line(x, top, x + 30, top, 2), p.line(x + 30, top, x + 30, base, 2));
      for (let y = top + 10; y < base; y += 10) strokes.push({d: p.line(x + 3, Math.min(base, y + 8), x + 27, y - 8 < top ? top + 1 : y - 8, 0), className: 'sk-soft', step: .02});
    });
    strokes.push({d: p.curve(77, base - 70, 130, base - 128, 227, base - 150), className: 'sk-guide'});
    // dimension line over the tallest column
    strokes.push(p.line(212, 30, 242, 30, 2), {d: p.line(209, 34, 215, 26, 0), className: 'sk-tick'}, {d: p.line(239, 34, 245, 26, 0), className: 'sk-tick'});
    // scale bar
    strokes.push(p.line(252, 192, 290, 192, 1), ...[252, 265, 278, 290].map(x => ({d: p.line(x, 189, x, 195, 0), className: 'sk-soft', step: .03})));
    paint(svg, strokes, {pace: 1.1});
    reveal(svg);
  }

  // ------------------------------------------------------------- start

  function community() {
    const people = document.getElementById('community-people');
    if (!people) return;
    const cohorts = (window.MELLI_COHORTS || []).filter(cohort => cohort.published);
    const count = cohorts.reduce((sum, cohort) => sum + (window.MELLI_STUDENTS?.[cohort.year] || []).length, 0);
    const num = window.MelliI18n?.num || String;
    people.textContent = num(count);
    document.getElementById('community-years').textContent = num(cohorts.length);
    people.closest('.community-stats').hidden = !count;
  }

  function start() {
    document.documentElement.classList.add('sketch-ready');
    community();
    const head = document.querySelector('.masthead');
    if (head) masthead(head);
    document.querySelectorAll('[data-sketch-art="tools"]').forEach(tools);
    document.querySelectorAll('[data-sketch-art="chart"]').forEach(chart);
    scan();
    // Intakes are drawn by app.js and redrawn when the filters change.
    const cohorts = document.getElementById('cohorts');
    if (cohorts) {
      const mark = () => {
        cohorts.querySelectorAll('.cohort-head:not([data-sketch])').forEach(element => { element.dataset.sketch = 'underline'; });
        scan(cohorts);
      };
      mark();
      new MutationObserver(mark).observe(cohorts, {childList: true, subtree: true});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return {scan, decorate, pen, paint};
})();
