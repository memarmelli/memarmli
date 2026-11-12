'use strict';

const {t, num, digits, href, apply, localize} = window.MelliI18n;
const {locate, ancestors, descendants, relation} = window.MelliLineage;
const archive = document.getElementById('cohorts');
const lines = document.getElementById('lineage-lines');
const yearNav = document.getElementById('year-nav');
const lineageForm = document.getElementById('lineage-form');
const lineageInput = document.getElementById('lineage-input');
const lineageClear = document.getElementById('lineage-clear');
const lineageStatus = document.getElementById('lineage-status');
const lineageList = document.getElementById('lineage-list');
const lineageShare = document.getElementById('lineage-share');
const lineageTelegram = document.getElementById('lineage-telegram');
const lineageCopy = document.getElementById('lineage-copy');
const svgNS = 'http://www.w3.org/2000/svg';
const lineageKey = 'melli-lineage';
const viewKey = 'melli-view';
const viewButtons = document.querySelectorAll('.view-switch [data-view]');

apply();
document.title = t('site.title');

// Newest intake first: by graduation date when both intakes have one, otherwise by year.
const cohorts = (window.MELLI_COHORTS || [])
  .filter(cohort => cohort.published && Number.isInteger(cohort.year))
  .sort((a, b) => (Date.parse(b.graduatedAt) - Date.parse(a.graduatedAt)) || b.year - a.year);

// Lower-case, Latin digits, Persian ی and ک, no zero-width joiners: so a search matches however it is typed.
function searchText(value) {
  return String(value || '').toLowerCase()
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
}

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeTile(cohort, student) {
  const tile = document.createElement('a');
  tile.className = 'student-tile';
  tile.href = href(`student.html?year=${cohort.year}&student=${student.studentSuffix}`);
  tile.dataset.year = cohort.year;
  tile.dataset.suffix = student.studentSuffix;
  const career = window.MelliCareer;
  const place = career.splitLocation(student.location);
  const raw = (window.MELLI_STUDENTS?.[cohort.year] || []).find(item => item.studentSuffix === student.studentSuffix) || student;
  Object.assign(tile.dataset, {
    experience: career.experienceMonths(student.resume?.entries),
    specialties: (student.specialties || []).join('|'),
    software: (student.software || []).join('|'),
    country: place.country,
    city: place.city,
    employer: student.employer || '',
    degree: student.degree || '',
    open: student.openToWork ? '1' : '',
    mentor: student.mentoring ? '1' : '',
    name: student.name,
    search: searchText([student.name, raw.name, raw.en?.name, student.studentNumber].join(' '))
  });
  tile.setAttribute('aria-label', t('tile.aria', {name: student.name, number: digits(student.studentNumber)}));
  const frame = document.createElement('span');
  frame.className = 'tile-frame';
  frame.append(makePortrait(student, student.studentSuffix, {thumbnail: true}));
  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = student.name;
  const number = document.createElement('span');
  number.className = 'tile-number';
  number.textContent = digits(student.studentNumber);
  tile.append(frame, name, number);
  return tile;
}

cohorts.forEach((cohort, index) => {
  const year = num(cohort.year);
  const students = (window.MELLI_STUDENTS?.[cohort.year] || []).filter(student => student.studentNumber).map(localize);
  const article = document.createElement('article');
  article.className = 'cohort-group';
  article.id = `cohort-${cohort.year}`;
  article.setAttribute('aria-labelledby', `cohort-title-${cohort.year}`);

  const head = document.createElement('header');
  head.className = 'cohort-head';
  const title = document.createElement('h2');
  title.className = 'cohort-title';
  title.id = `cohort-title-${cohort.year}`;
  title.textContent = year;
  const period = document.createElement('span');
  period.className = 'cohort-period';
  // The 1399 intake is period 60; adjacent intakes change by one period.
  period.textContent = t('cohort.period', {n: num(cohort.year - 1399 + 60)});
  const count = document.createElement('span');
  count.className = 'cohort-count';
  count.textContent = t('cohort.count', {n: num(students.length)});
  article.dataset.total = students.length;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'cohort-toggle';
  toggle.addEventListener('click', () => setCohortView(article, article.classList.contains('view-photo') ? 'faces' : 'photo'));
  head.append(title, period, count, toggle);

  const grid = document.createElement('ul');
  grid.className = 'student-grid';
  shuffled(students).forEach(student => {
    const item = document.createElement('li');
    item.append(makeTile(cohort, student));
    grid.append(item);
  });
  const photo = document.createElement('figure');
  photo.className = 'cohort-photo';
  if (cohort.image) {
    const image = document.createElement('img');
    image.src = cohort.image;
    image.alt = t('cohort.photoAlt', {year});
    image.loading = 'lazy';
    image.decoding = 'async';
    photo.append(image);
  } else {
    photo.classList.add('is-empty');
    const empty = document.createElement('figcaption');
    empty.textContent = t('cohort.noPhoto');
    photo.append(empty);
  }
  article.append(head, grid, photo);
  archive.append(article);

  const navLink = document.createElement('a');
  navLink.href = `#${article.id}`;
  navLink.textContent = year;
  navLink.setAttribute('aria-label', t('nav.goto', {year}));
  if (index === 0) navLink.setAttribute('aria-current', 'true');
  yearNav.append(navLink);
});

if (!cohorts.length) {
  const empty = document.createElement('p');
  empty.className = 'noscript';
  empty.textContent = t('cohort.empty');
  archive.append(empty);
}

/* Portraits or group photo, for one intake (its header button) or all of them (the switch at the top) */

function setCohortView(article, view) {
  article.classList.toggle('view-photo', view === 'photo');
  article.querySelector('.cohort-toggle').textContent = t(view === 'photo' ? 'view.faces' : 'view.photo');
  if (lineageTiles.length) drawLines();
}

function setView(view, {save = true} = {}) {
  archive.querySelectorAll('.cohort-group').forEach(article => setCohortView(article, view));
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  if (save) {
    try { localStorage.setItem(viewKey, view); } catch (error) { /* storage unavailable */ }
  }
}

viewButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));

/* Search, filters, sorting and statistics */

const career = window.MelliCareer;
const $f = id => document.getElementById(id);
const filters = {
  search: $f('filter-search'), specialty: $f('filter-specialty'), experience: $f('filter-experience'), sort: $f('filter-sort'),
  software: $f('filter-software'), country: $f('filter-country'), city: $f('filter-city'), employer: $f('filter-employer'),
  degree: $f('filter-degree'), open: $f('filter-open'), mentor: $f('filter-mentor')
};
const PARAMS = {search: 'q', specialty: 'specialty', experience: 'experience', sort: 'sort', software: 'software', country: 'country',
  city: 'city', employer: 'employer', degree: 'degree', open: 'open', mentor: 'mentor'};
const EXTRA = ['software', 'country', 'city', 'employer', 'degree', 'open', 'mentor'];
const filterCount = $f('filter-count');
const filterClear = $f('filter-clear');
const filterEmpty = $f('filter-empty');
const filterMore = $f('filter-more');
const filterExtra = $f('filter-extra');
const allTiles = [...archive.querySelectorAll('.student-tile')];
allTiles.forEach((tile, index) => { tile.dataset.order = index; });
const listOf = (tile, key) => (tile.dataset[key] || '').split('|').filter(Boolean);

function makeOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}

// Options come from the data itself, most common first, each with its count.
function fillSelect(select, anyText, key, label) {
  const counts = new Map();
  allTiles.forEach(tile => listOf(tile, key).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
  select.append(makeOption('', anyText));
  [...counts].sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0])))
    .forEach(([value, count]) => select.append(makeOption(value, `${label(value)} (${num(count)})`)));
  select.closest('label').hidden = !counts.size;
}

fillSelect(filters.specialty, t('filter.anySpecialty'), 'specialties', career.specialtyLabel);
fillSelect(filters.software, t('filter.anySoftware'), 'software', career.softwareLabel);
fillSelect(filters.country, t('filter.anyCountry'), 'country', value => value);
fillSelect(filters.city, t('filter.anyCity'), 'city', value => value);
fillSelect(filters.employer, t('filter.anyEmployer'), 'employer', value => value);
fillSelect(filters.degree, t('filter.anyDegree'), 'degree', career.degreeLabel);
filters.experience.append(makeOption('0', t('filter.anyExperience')));
[1, 2, 3, 5, 10].forEach(years => filters.experience.append(makeOption(String(years), t('filter.minYears', {n: num(years), unit: years === 1 ? 'year' : 'years'}))));
['random', 'name', 'experience', 'number'].forEach(key => filters.sort.append(makeOption(key, t(`sort.${key}`))));
filters.open.closest('label').hidden = !allTiles.some(tile => tile.dataset.open);
filters.mentor.closest('label').hidden = !allTiles.some(tile => tile.dataset.mentor);

function currentFilters() {
  return {
    q: searchText(filters.search.value),
    specialty: filters.specialty.value, software: filters.software.value, country: filters.country.value,
    city: filters.city.value, employer: filters.employer.value, degree: filters.degree.value,
    minimum: Number(filters.experience.value) * 12, open: filters.open.checked, mentor: filters.mentor.checked
  };
}

function matches(tile, f) {
  return (!f.q || tile.dataset.search.includes(f.q))
    && (!f.specialty || listOf(tile, 'specialties').includes(f.specialty))
    && (!f.software || listOf(tile, 'software').includes(f.software))
    && (!f.country || tile.dataset.country === f.country)
    && (!f.city || tile.dataset.city === f.city)
    && (!f.employer || tile.dataset.employer === f.employer)
    && (!f.degree || tile.dataset.degree === f.degree)
    && Number(tile.dataset.experience) >= f.minimum
    && (!f.open || tile.dataset.open) && (!f.mentor || tile.dataset.mentor);
}

const collator = new Intl.Collator(document.documentElement.lang);
const SORTS = {
  random: (a, b) => a.dataset.order - b.dataset.order,
  name: (a, b) => collator.compare(a.dataset.name, b.dataset.name),
  experience: (a, b) => b.dataset.experience - a.dataset.experience,
  number: (a, b) => a.dataset.suffix.localeCompare(b.dataset.suffix)
};

function sortTiles() {
  const compare = SORTS[filters.sort.value] || SORTS.random;
  archive.querySelectorAll('.student-grid').forEach(grid => {
    [...grid.children].sort((a, b) => compare(a.firstElementChild, b.firstElementChild)).forEach(item => grid.append(item));
  });
}

// A filter's value as written in the URL; defaults are left out.
function paramValue(key) {
  const control = filters[key];
  if (control.type === 'checkbox') return control.checked ? '1' : '';
  if ((key === 'experience' && control.value === '0') || (key === 'sort' && control.value === 'random')) return '';
  return control.value.trim();
}

function toggleExtra(open) {
  filterExtra.hidden = !open;
  filterMore.setAttribute('aria-expanded', String(open));
  filterMore.textContent = t(open ? 'filter.less' : 'filter.more');
}

function applyFilters({save = true} = {}) {
  const f = currentFilters();
  const active = Boolean(f.q || f.specialty || f.software || f.country || f.city || f.employer || f.degree || f.minimum || f.open || f.mentor);
  const shown = [];
  archive.querySelectorAll('.cohort-group').forEach(article => {
    let visible = 0;
    article.querySelectorAll('.student-tile').forEach(tile => {
      const match = matches(tile, f);
      tile.parentElement.hidden = !match;
      if (match) {
        visible += 1;
        shown.push(tile);
      }
    });
    article.hidden = visible === 0;
    const total = Number(article.dataset.total);
    article.querySelector('.cohort-count').textContent = active
      ? t('cohort.countFiltered', {n: num(visible), total: num(total)})
      : t('cohort.count', {n: num(total)});
    const link = yearNav.querySelector(`a[href="#${article.id}"]`);
    if (link) link.hidden = visible === 0;
  });
  filterCount.textContent = active ? t(shown.length === 1 ? 'filter.countOne' : 'filter.count', {n: num(shown.length)}) : '';
  filterClear.hidden = !active;
  filterEmpty.hidden = !active || shown.length > 0;
  // The Statistics button carries the same filters to stats.html.
  const statsQuery = new URLSearchParams();
  Object.entries(PARAMS).forEach(([key, param]) => {
    const value = paramValue(key);
    if (value && key !== 'sort') statsQuery.set(param, value);
  });
  document.getElementById('stats-link').href = href(`stats.html${statsQuery.toString() ? `?${statsQuery}` : ''}`);
  if (save) {
    const url = new URL(location.href);
    Object.entries(PARAMS).forEach(([key, param]) => {
      const value = paramValue(key);
      if (value) url.searchParams.set(param, value);
      else url.searchParams.delete(param);
    });
    history.replaceState(null, '', url);
    try {
      if (statsQuery.toString() || paramValue('sort')) {
        const saved = new URLSearchParams(statsQuery);
        if (paramValue('sort')) saved.set('sort', paramValue('sort'));
        sessionStorage.setItem(filtersKey, saved.toString());
      } else {
        sessionStorage.removeItem(filtersKey);
      }
    } catch (error) { /* storage unavailable */ }
  }
  if (lineageTiles.length) drawLines();
}

// Search and filters persist for the visit: a return to the home page
// without filters in its address brings back the last ones used.
const filtersKey = 'melli-filters';
{
  let params = new URLSearchParams(location.search);
  if (!Object.values(PARAMS).some(param => params.has(param))) {
    try { params = new URLSearchParams(sessionStorage.getItem(filtersKey) || ''); } catch (error) { /* storage unavailable */ }
  }
  Object.entries(PARAMS).forEach(([key, param]) => {
    const value = params.get(param);
    if (value === null) return;
    const control = filters[key];
    if (control.type === 'checkbox') control.checked = value === '1';
    else if (control.tagName !== 'SELECT' || [...control.options].some(option => option.value === value)) control.value = value;
  });
  toggleExtra(EXTRA.some(key => params.has(PARAMS[key])));
}
let searchTimer;
filters.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applyFilters(), 150);
});
Object.entries(filters).forEach(([key, control]) => {
  if (key === 'search') return;
  control.addEventListener('change', () => {
    if (key === 'sort') sortTiles();
    applyFilters();
  });
});
filterMore.addEventListener('click', () => toggleExtra(filterExtra.hidden));
filterClear.addEventListener('click', () => {
  Object.entries(filters).forEach(([key, control]) => {
    if (key === 'sort') return;
    if (control.type === 'checkbox') control.checked = false;
    else control.value = key === 'experience' ? '0' : '';
  });
  applyFilters();
});
document.getElementById('filters').addEventListener('submit', event => event.preventDefault());

/* Lineage ("نسل من") */

let lineageTiles = [];

function tileFor(year, suffix) {
  return archive.querySelector(`.student-tile[data-year="${year}"][data-suffix="${suffix}"]`);
}

let lastLines = '';
let crayons = 0;

// Red crayon: a rough edge and a grain that streaks along the stroke. Each
// stroke gets its own filter in page units, because a region measured from a
// flat line's bounding box is too thin and cuts the line up.
function crayon(element, x1, y1, x2, y2) {
  const id = `crayon-${crayons++}`;
  const flat = Math.abs(x2 - x1) > Math.abs(y2 - y1);
  const filter = document.createElementNS(svgNS, 'filter');
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('x', Math.min(x1, x2) - 14);
  filter.setAttribute('y', Math.min(y1, y2) - 14);
  filter.setAttribute('width', Math.abs(x2 - x1) + 28);
  filter.setAttribute('height', Math.abs(y2 - y1) + 28);
  filter.innerHTML = `<feTurbulence type="fractalNoise" baseFrequency="${flat ? '.12 1.1' : '1.1 .12'}" numOctaves="3" seed="${crayons}" result="n"/>`
    + '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="edge"/>'
    + '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 5 0 0 0 -1.35" result="grain"/>'
    + '<feComposite in="edge" in2="grain" operator="in"/>';
  element.before(filter);
  element.setAttribute('filter', `url(#${id})`);
}

// Drawn like a family tree in red chalk: down from one graduate, across just
// above the next, then down to them. Only a new lineage animates; a resize redraws in place.
function drawLines(animate = false) {
  // A lineage restored on load comes before sketch.js has run; wait for it, or the line is drawn plain.
  if (!window.MelliSketch && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => drawLines(animate), {once: true});
    return;
  }
  const visible = lineageTiles.filter(tile => tile.offsetParent);
  const box = archive.getBoundingClientRect();
  const points = visible.map(tile => {
    const rect = tile.getBoundingClientRect();
    const frame = tile.querySelector('.tile-frame').getBoundingClientRect();
    return {
      x: Math.round(rect.left - box.left + rect.width / 2), top: Math.round(rect.top - box.top), bottom: Math.round(rect.bottom - box.top),
      frame: [frame.left - box.left, frame.top - box.top, frame.width, frame.height].map(Math.round),
      self: tile.classList.contains('is-self')
    };
  });
  const key = JSON.stringify(points);
  if (!animate && key === lastLines) return;
  lastLines = key;
  lines.replaceChildren();
  if (!points.length) return;
  lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const sketch = window.MelliSketch;
  const pen = sketch?.pen(7);
  const strokes = [];
  const boxes = [];
  const add = (x1, y1, x2, y2, over = 3) => {
    strokes.push(pen ? pen.line(x1, y1, x2, y2, over) : `M${x1} ${y1}L${x2} ${y2}`);
    boxes.push([x1, y1, x2, y2]);
  };
  // A frame around the portrait whose lines run past the corners; two passes for the graduate searched for.
  const frame = ([x, y, w, h], pad) => {
    add(x - pad, y - pad, x + w + pad, y - pad, 7);
    add(x + w + pad, y - pad, x + w + pad, y + h + pad, 7);
    add(x + w + pad, y + h + pad, x - pad, y + h + pad, 7);
    add(x - pad, y + h + pad, x - pad, y - pad, 7);
  };
  points.forEach((point, i) => {
    frame(point.frame, 5);
    if (point.self) frame(point.frame, 9);
    const to = points[i + 1];
    if (!to) return;
    const start = point.bottom + 6;
    const end = to.top - 6;
    const turn = Math.max(start, to.top - 20);
    if (Math.abs(point.x - to.x) < 2) add(point.x, start, to.x, end);
    else {
      add(point.x, start, point.x, turn);
      add(point.x, turn, to.x, turn);
      add(to.x, turn, to.x, end);
    }
  });
  if (sketch) {
    sketch.paint(lines, strokes, {pace: .6});
    lines.querySelectorAll('path').forEach((path, i) => crayon(path, ...boxes[i]));
  }
  else {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', strokes.join(''));
    lines.append(path);
  }
  points.forEach((point, i) => {
    [i > 0 && point.top - 6, i < points.length - 1 && point.bottom + 6].forEach(y => {
      if (y === false) return;
      const node = document.createElementNS(svgNS, 'circle');
      node.setAttribute('cx', point.x);
      node.setAttribute('cy', y);
      node.setAttribute('r', 4);
      node.setAttribute('class', 'lineage-node');
      node.style.setProperty('--delay', `${(i * .45).toFixed(2)}s`);
      lines.append(node);
      if (sketch) crayon(node, point.x, y, point.x, y);
    });
  });
  if (!animate) {
    lines.classList.add('is-drawn');
    return;
  }
  // Flush styles first, so the strokes start undrawn and the class change animates them.
  lines.classList.remove('is-drawn');
  lines.getBoundingClientRect();
  lines.classList.add('is-drawn');
}

// The lineage is kept in the address (?lineage=…), so a reload or a shared link shows it again.
function lineageNumber(raw) {
  return String(raw || '').replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/\D/g, '');
}

function remember(value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set('lineage', lineageNumber(value));
  else url.searchParams.delete('lineage');
  history.replaceState(null, '', url);
  try {
    if (value) sessionStorage.setItem(lineageKey, value);
    else sessionStorage.removeItem(lineageKey);
  } catch (error) { /* storage unavailable */ }
}

function clearLineage() {
  lineageTiles.forEach(tile => tile.classList.remove('in-lineage', 'is-self'));
  lineageTiles = [];
  archive.classList.remove('lineage-active');
  lines.replaceChildren();
  lastLines = '';
  lineageStatus.hidden = true;
  lineageList.hidden = true;
  lineageList.replaceChildren();
  lineageClear.hidden = true;
  lineageShare.hidden = true;
  lineageInput.removeAttribute('aria-invalid');
}


function showLineage(raw, {scroll = true} = {}) {
  clearLineage();
  const me = locate(raw);
  lineageStatus.hidden = false;
  if (!me || me.year < 1300 || me.year > 1499) {
    lineageInput.setAttribute('aria-invalid', 'true');
    lineageStatus.textContent = t('lineage.invalid');
    remember('');
    return;
  }

  // Newest intake first, matching the page order, so the line runs top to bottom.
  const chain = [
    ...descendants(me.year, me.suffix).map(link => ({...link, distance: me.year - link.year})).reverse(),
    ...(me.student ? [{year: me.year, student: me.student, distance: 0}] : []),
    ...ancestors(me.year, me.suffix).map(link => ({...link, distance: me.year - link.year}))
  ];
  if (!chain.length) {
    lineageStatus.textContent = t('lineage.none');
    lineageClear.hidden = false;
    remember('');
    return;
  }

  // The lineage is drawn on the portraits, so every intake switches to them.
  setView('faces', {save: false});
  lineageTiles = chain.map(link => tileFor(link.year, me.suffix)).filter(Boolean);
  lineageTiles.forEach(tile => tile.classList.add('in-lineage'));
  if (me.student) tileFor(me.year, me.suffix)?.classList.add('is-self');
  archive.classList.add('lineage-active');

  const newest = chain[0];
  const oldest = chain[chain.length - 1];
  lineageStatus.textContent = (me.student ? t('lineage.found', {name: localize(me.student).name, year: num(me.year)}) : t('lineage.unregistered'))
    + t('lineage.span', {oldest: num(oldest.year), newest: num(newest.year), count: num(chain.length)});

  chain.forEach(link => {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = href(`student.html?year=${link.year}&student=${me.suffix}`);
    const role = document.createElement('span');
    role.className = 'lineage-role';
    role.textContent = `${relation(link.distance)} · ${num(link.year)}`;
    if (link.distance === 0) item.className = 'is-self';
    const name = document.createElement('span');
    name.className = 'lineage-name';
    name.textContent = localize(link.student).name;
    anchor.append(role, name);
    item.append(anchor);
    lineageList.append(item);
  });
  lineageList.hidden = false;
  lineageClear.hidden = false;
  remember(raw);
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set('lineage', lineageNumber(raw));
  if (document.documentElement.lang === 'en') link.searchParams.set('lang', 'en');
  const message = me.student ? t('lineage.shareText', {name: localize(me.student).name}) : t('lineage.shareTextAnon');
  lineageTelegram.href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;
  lineageCopy.dataset.url = link;
  lineageShare.hidden = false;
  drawLines(true);
  if (scroll) (archive.querySelector('.is-self') || lineageTiles[0]).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'});
}

lineageForm.addEventListener('submit', event => {
  event.preventDefault();
  showLineage(lineageInput.value);
});

lineageInput.addEventListener('input', () => lineageInput.removeAttribute('aria-invalid'));

lineageCopy.addEventListener('click', async () => {
  const url = lineageCopy.dataset.url;
  try {
    await navigator.clipboard.writeText(url);
    lineageCopy.textContent = t('lineage.copied');
    setTimeout(() => { lineageCopy.textContent = t('lineage.copy'); }, 2000);
  } catch (error) {
    window.prompt(t('lineage.copy'), url);
  }
});

lineageClear.addEventListener('click', () => {
  clearLineage();
  lineageInput.value = '';
  remember('');
  lineageInput.focus();
});

if ('ResizeObserver' in window) new ResizeObserver(() => { if (lineageTiles.length) drawLines(); }).observe(archive);
else window.addEventListener('resize', () => { if (lineageTiles.length) drawLines(); });
document.fonts?.ready.then(() => { if (lineageTiles.length) drawLines(); });

try {
  setView(localStorage.getItem(viewKey) === 'photo' ? 'photo' : 'faces', {save: false});
} catch (error) {
  setView('faces', {save: false});
}

// A lineage in the address (a shared link) wins over the one remembered for this visit.
const linkedLineage = new URLSearchParams(location.search).get('lineage');
let savedLineage = linkedLineage;
if (!savedLineage) {
  try { savedLineage = sessionStorage.getItem(lineageKey); } catch (error) { /* storage unavailable */ }
}
if (savedLineage) {
  lineageInput.value = savedLineage;
  showLineage(savedLineage, {scroll: Boolean(linkedLineage)});
}

sortTiles();
applyFilters();

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    yearNav.querySelectorAll('a').forEach(link => {
      if (link.hash === `#${visible.target.id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }, {rootMargin: '-10% 0px -30% 0px', threshold: [0, 0.3, 0.6]});
  archive.querySelectorAll('.cohort-group').forEach(article => observer.observe(article));
}
