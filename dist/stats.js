'use strict';

// Statistics page: headline numbers, breakdowns and the globe, for everyone or
// for the filters carried over from the home page's URL.
const {lang, t, num, href, apply} = window.MelliI18n;
const career = window.MelliCareer;
const {all, readFilters, active, matches} = window.MelliPeople;
const byId = id => document.getElementById(id);

apply();
document.title = t('stats.pageTitle');
byId('back-arrow').textContent = lang === 'en' ? '←' : '→';

const params = new URLSearchParams(location.search);
const filters = readFilters(params);
const everyone = all();
const people = everyone.filter(person => matches(person, filters));
const filtered = active(filters);

// Home-page URL with the same filters, optionally narrowed further.
function listHref(extra = {}) {
  const query = new URLSearchParams();
  ['q', 'specialty', 'software', 'country', 'city', 'employer', 'degree', 'experience', 'open', 'mentor'].forEach(key => {
    if (params.get(key)) query.set(key, params.get(key));
  });
  Object.entries(extra).forEach(([key, value]) => (value ? query.set(key, value) : query.delete(key)));
  const text = query.toString();
  return href(`index.html${text ? `?${text}` : ''}#archive`);
}

/* Which filters are on */

if (filtered) {
  const chips = byId('stats-filters');
  const add = text => {
    const chip = document.createElement('li');
    chip.textContent = text;
    chips.append(chip);
  };
  if (params.get('q')) add(t('stats.searchFor', {q: params.get('q')}));
  if (filters.specialty) add(`${t('filter.specialty')}: ${career.specialtyLabel(filters.specialty)}`);
  if (filters.software) add(`${t('filter.software')}: ${career.softwareLabel(filters.software)}`);
  if (filters.country) add(`${t('filter.country')}: ${filters.country}`);
  if (filters.city) add(`${t('filter.city')}: ${filters.city}`);
  if (filters.employer) add(`${t('filter.employer')}: ${filters.employer}`);
  if (filters.degree) add(`${t('filter.degree')}: ${career.degreeLabel(filters.degree)}`);
  if (filters.minimum) {
    const years = filters.minimum / 12;
    add(`${t('filter.experience')}: ${t('filter.minYears', {n: num(years), unit: years === 1 ? 'year' : 'years'})}`);
  }
  if (filters.open) add(t('filter.open'));
  if (filters.mentor) add(t('filter.mentor'));
  byId('stats-show-all').href = href('stats.html');
  byId('stats-to-list').href = listHref();
  byId('stats-filter-note').hidden = false;
}

/* Headline numbers */

function headline(value, label) {
  const item = document.createElement('div');
  item.className = 'stat';
  const strong = document.createElement('strong');
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  item.append(strong, span);
  return item;
}

const located = people.filter(person => person.country);
const abroad = located.filter(person => !career.inIran(person.country)).length;
const working = people.filter(person => person.experience > 0);
const average = working.length ? Math.round(working.reduce((sum, person) => sum + person.experience, 0) / working.length) : 0;
const numbers = [
  headline(num(people.length), t('stats.graduates')),
  headline(num(new Set(people.map(person => person.year)).size), t('stats.intakes')),
  headline(num(new Set(located.map(person => person.country)).size), t('stats.countries')),
  headline(t('stats.percent', {n: num(located.length ? Math.round(abroad / located.length * 100) : 0)}), t('stats.abroad')),
  headline(average ? career.formatExperience(average) : num(0), t('stats.experience'))
];
if (everyone.some(person => person.open)) numbers.push(headline(num(people.filter(person => person.open).length), t('stats.open')));
if (everyone.some(person => person.mentor)) numbers.push(headline(num(people.filter(person => person.mentor).length), t('stats.mentors')));
numbers[0].classList.add('stat-hero');
byId('stats-grid').dataset.count = numbers.length;
byId('stats-grid').append(...numbers);
byId('stats-empty').hidden = people.length > 0;
byId('stats-empty').textContent = t(filtered ? 'stats.none' : 'cohort.empty');

/* Breakdowns as bar lists; each row links to the list filtered to it. */

function counts(values) {
  const map = new Map();
  values.forEach(value => { if (value) map.set(value, (map.get(value) || 0) + 1); });
  return [...map];
}

function bars(id, rows, label, link, limit = 10) {
  const list = byId(id);
  const top = rows.slice(0, limit);
  const max = Math.max(1, ...top.map(([, count]) => count));
  top.forEach(([value, count], index) => {
    const item = document.createElement('li');
    const anchor = document.createElement(link ? 'a' : 'span');
    anchor.className = 'bar-row';
    if (link) anchor.href = link(value);
    const name = document.createElement('span');
    name.className = 'bar-label';
    name.textContent = label(value);
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(3, count / max * 100)}%`;
    fill.style.setProperty('--i', index);
    track.append(fill);
    const amount = document.createElement('span');
    amount.className = 'bar-value';
    amount.textContent = num(count);
    anchor.append(name, track, amount);
    item.append(anchor);
    list.append(item);
  });
  list.closest('section').hidden = !top.length;
}

const sorted = rows => rows.sort((a, b) => b[1] - a[1]);
bars('by-intake', counts(people.map(person => person.year)).sort((a, b) => b[0] - a[0]),
  year => `${t('fact.cohort')} ${num(year)}`, null, 50);
bars('by-specialty', sorted(counts(people.flatMap(person => person.specialties))), career.specialtyLabel, value => listHref({specialty: value}));
bars('by-software', sorted(counts(people.flatMap(person => person.software))), career.softwareLabel, value => listHref({software: value}));
bars('by-country', sorted(counts(people.map(person => person.country))), value => value, value => listHref({country: value, city: ''}));
bars('by-degree', sorted(counts(people.map(person => person.degree))), career.degreeLabel, value => listHref({degree: value}));

/* Globe */

const globe = byId('globe');
const places = new Map();
let unplaced = 0;
people.forEach(person => {
  const where = window.MelliGeo.locate(person.city, person.country);
  if (!where) {
    if (person.city || person.country) unplaced += 1;
    return;
  }
  const key = `${where.exact ? person.city : ''}|${person.country}`;
  if (!places.has(key)) {
    places.set(key, {key, city: where.exact ? person.city : '', country: person.country, lat: where.lat, lon: where.lon, exact: where.exact,
      label: [where.exact ? person.city : '', person.country].filter(Boolean).join(t('list.join')), count: 0, people: []});
  }
  const group = places.get(key);
  group.count += 1;
  group.people.push({name: person.name, href: person.href});
});
if (places.size || unplaced) {
  globe.hidden = false;
  window.MelliGlobe.mount(globe, {
    t, num,
    // "Show in the list" on a pin opens the home page filtered to that place.
    onFilter(group) {
      location.href = listHref({country: group.country, city: group.city});
    }
  });
  window.MelliGlobe.update([...places.values()], unplaced);
}
