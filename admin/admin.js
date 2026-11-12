'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fa = new Intl.NumberFormat('fa-IR', {useGrouping: false});
const faDigits = value => String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit]);
const toLatin = value => String(value).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
const EMPTY_PORTRAIT = '/assets/portrait-empty.svg';
const MAX_UPLOAD = 12 * 1024 * 1024;

const form = $('#student-form');
let site = {cohorts: {}, students: []};
let editingId = null;
let photoPath = '';
let thumbPath = '';
let resumeFilePath = '';
let dirty = false;
let cohortYear = null;
let cohortImage = '';
let bot = {configured: false, links: [], edits: [], joinRequests: [], conversations: 0};
let listFilter = 'all';
const dateTime = new Intl.DateTimeFormat('fa-IR', {dateStyle: 'medium', timeStyle: 'short'});
const formatDate = value => (value ? dateTime.format(new Date(value)) : '');

/* ---------------------------------------------------------------- API */

async function api(path, {method = 'GET', body, file} = {}) {
  const headers = {'X-Melli': '1'};
  let payload;
  if (file) {
    headers['Content-Type'] = file.type;
    payload = file;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, {method, headers, body: payload, credentials: 'same-origin'});
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('نشست شما به پایان رسیده است، دوباره وارد شوید.');
  }
  if (!response.ok) throw new Error(data.error || 'ارتباط با سرور برقرار نشد.');
  return data;
}

async function upload(file) {
  if (file.size > MAX_UPLOAD) throw new Error('حجم فایل باید کمتر از ۱۲ مگابایت باشد.');
  return (await api('/api/upload', {method: 'POST', file})).path;
}

// The home page shows hundreds of portraits, so each photo also gets a small
// 360×480 copy, cropped from the centre like the tiles. Made here in the browser,
// so the server needs nothing beyond Python.
const THUMB = {width: 360, height: 480};
async function makeThumb(source) {
  const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.max(THUMB.width / bitmap.width, THUMB.height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB.width;
  canvas.height = THUMB.height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (THUMB.width - width) / 2, (THUMB.height - height) / 2, width, height);
  bitmap.close();
  const small = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
  return upload(new File([small], 'thumb.jpg', {type: 'image/jpeg'}));
}

// Photos without a thumbnail (from the bot, or from before thumbnails) get one
// in the background whenever the admin page loads.
let thumbsRunning = false;
async function fillThumbnails() {
  if (thumbsRunning) return;
  thumbsRunning = true;
  try {
    for (const student of site.students.filter(item => item.image && !item.thumb)) {
      try {
        const thumb = await makeThumb(photoUrl(student.image));
        await api(`/api/students/${student.id}/thumb`, {method: 'POST', body: {image: student.image, thumb}});
        student.thumb = thumb;
      } catch (problem) { /* try again next time */ }
    }
  } finally {
    thumbsRunning = false;
  }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2600);
}

/* ---------------------------------------------------------------- Views */

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-code').focus();
}

async function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  await reload();
  showDashboard();
}

async function reload() {
  const [data, overview] = await Promise.all([api('/api/data'), api('/api/bot').catch(() => bot)]);
  site = data;
  bot = overview;
  fillThumbnails();
  const pending = bot.edits.length + bot.joinRequests.length;
  $('#tab-pending').textContent = fa.format(pending);
  $('#tab-pending').hidden = !pending;
}

function show(view) {
  ['dash', 'list', 'edit'].forEach(name => { $(`#${name}-view`).hidden = name !== view; });
  $$('.tab').forEach(tab => tab.setAttribute('aria-current', tab.dataset.view === view ? 'page' : 'false'));
  window.scrollTo(0, 0);
}

function leaveEditor() {
  if (!$('#edit-view').hidden && dirty && !confirm('تغییرات ذخیره نشده‌اند. بدون ذخیره ادامه می‌دهید؟')) return false;
  editingId = null;
  dirty = false;
  return true;
}

function showList() {
  if (!leaveEditor()) return;
  show('list');
  renderList();
}

function showDashboard() {
  if (!leaveEditor()) return;
  show('dash');
  renderDashboard();
  loadActivity();
}

$$('.tab').forEach(tab => tab.addEventListener('click', () => (tab.dataset.view === 'dash' ? showDashboard() : showList())));

/* ---------------------------------------------------------------- Login */

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('#login-error');
  const button = $('#login-form button');
  error.hidden = true;
  button.disabled = true;
  try {
    await api('/api/login', {method: 'POST', body: {code: $('#login-code').value}});
    $('#login-code').value = '';
    await showApp();
  } catch (problem) {
    error.textContent = problem.message === 'wrong code' ? 'کد ورود درست نیست.' : problem.message;
    error.hidden = false;
    $('#login-code').select();
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  if (dirty && !confirm('تغییرات ذخیره نشده‌اند. خارج می‌شوید؟')) return;
  dirty = false;
  await api('/api/logout', {method: 'POST'}).catch(() => {});
  showLogin();
});

/* ---------------------------------------------------------------- List */

function photoUrl(path) {
  return path ? `/${path}` : EMPTY_PORTRAIT;
}

function matches(student, query) {
  if (!query) return true;
  const haystack = [student.name, student.en?.name, student.studentNumber, student.location, student.occupation].join(' ').toLowerCase();
  return haystack.includes(query);
}

const FILTERS = {
  all: () => true,
  draft: student => !student.published,
  linked: student => Boolean(linkOf(student.id)),
  unlinked: student => !linkOf(student.id),
  pending: student => pendingFor(student.id).length > 0,
  incomplete: student => completeness(student).percent < 50
};

function renderList() {
  const query = toLatin($('#search').value.trim()).toLowerCase();
  const groups = new Map();
  site.students.filter(student => matches(student, query) && FILTERS[listFilter](student))
    .sort((a, b) => b.year - a.year || a.studentNumber.slice(-2).localeCompare(b.studentNumber.slice(-2)))
    .forEach(student => {
      if (!groups.has(student.year)) groups.set(student.year, []);
      groups.get(student.year).push(student);
    });

  const container = $('#groups');
  container.replaceChildren();
  groups.forEach((students, year) => {
    const group = document.createElement('section');
    group.className = 'group';
    const head = document.createElement('div');
    head.className = 'group-head';
    const title = document.createElement('div');
    const meta = site.cohorts[year] || {};
    title.innerHTML = '<h2></h2><p class="muted"></p>';
    $('h2', title).textContent = `ورودی ${fa.format(year)}`;
    $('p', title).textContent = `${fa.format(students.length)} نفر${meta.image ? ' · عکس گروهی دارد' : ''}${meta.graduatedAt ? ` · دانش‌آموختگی ${faDigits(meta.graduatedAt)}` : ''}`;
    const cohortButton = document.createElement('button');
    cohortButton.type = 'button';
    cohortButton.className = 'ghost small';
    cohortButton.textContent = 'عکس گروهی و تاریخ';
    cohortButton.addEventListener('click', () => openCohort(year));
    head.append(title, cohortButton);

    const list = document.createElement('ul');
    list.className = 'people';
    students.forEach(student => {
      const item = document.createElement('li');
      item.className = 'person';
      const image = document.createElement('img');
      image.src = photoUrl(student.image);
      image.alt = '';
      image.loading = 'lazy';
      const text = document.createElement('div');
      text.innerHTML = '<strong></strong><span class="number" dir="ltr"></span>';
      $('strong', text).textContent = student.name;
      $('.number', text).textContent = student.studentNumber;
      const tags = document.createElement('div');
      tags.className = 'tags';
      const badge = document.createElement('span');
      badge.className = `badge${student.published ? '' : ' off'}`;
      badge.textContent = student.published ? 'در سایت' : 'پیش‌نویس';
      const link = linkOf(student.id);
      const waiting = !link && (student.telegram?.username || student.telegram?.invite);
      const telegram = document.createElement('span');
      telegram.className = `tg-dot${link ? ' on' : waiting ? ' waiting' : ''}`;
      telegram.title = link ? `متصل به Telegram${link.acceptsMessages ? '، دریافت پیام فعال' : ''}` : waiting ? 'در انتظار اتصال به Telegram' : 'بدون Telegram';
      telegram.textContent = link?.acceptsMessages ? 'Telegram ✉' : 'Telegram';
      const pending = pendingFor(student.id).length;
      if (pending) {
        const queued = document.createElement('span');
        queued.className = 'badge pending';
        queued.textContent = `${fa.format(pending)} ویرایش`;
        tags.append(queued);
      }
      tags.append(meter(completeness(student).percent), telegram, badge);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost small';
      edit.textContent = 'ویرایش';
      edit.addEventListener('click', () => openEditor(student));
      item.append(image, text, tags, edit);
      list.append(item);
    });
    group.append(head, list);
    container.append(group);
  });

  const total = site.students.length;
  const published = site.students.filter(student => student.published).length;
  $('#list-count').textContent = total ? `${fa.format(total)} نفر · ${fa.format(published)} نفر در سایت · ${fa.format(new Set(site.students.map(s => s.year)).size)} ورودی` : '';
  $('#list-empty').hidden = total > 0;
  if (total && !groups.size) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'نتیجه‌ای پیدا نشد.';
    container.append(none);
  }
}

$('#search').addEventListener('input', renderList);
$('#filters').addEventListener('click', event => {
  const choice = event.target.closest('[data-filter]');
  if (!choice) return;
  listFilter = choice.dataset.filter;
  $$('#filters button').forEach(item => item.setAttribute('aria-pressed', String(item === choice)));
  renderList();
});
$('#add-student').addEventListener('click', () => openEditor(null));

/* ---------------------------------------------------------------- Editor */

function setPhoto(path) {
  photoPath = path || '';
  $('#photo-preview').src = path ? photoUrl(path) : '';
  $('#photo-preview').hidden = !path;
  $('#photo-empty').hidden = Boolean(path);
  $('#photo-remove').hidden = !path;
}

function setResumeFile(path) {
  resumeFilePath = path || '';
  $('#resume-file-link').href = path ? photoUrl(path) : '#';
  $('#resume-file-link').hidden = !path;
  $('#resume-file-remove').hidden = !path;
}

function field(name) {
  return form.elements.namedItem(name);
}

// The English value is shown only when it differs from the Persian one,
// since the server fills empty English fields with the Persian text.
const englishOnly = (english, persian) => (english && english !== persian ? english : '');

function addEntry(values = {}) {
  const row = $('#entry-template').content.firstElementChild.cloneNode(true);
  $$('[data-field]', row).forEach(input => { input.value = values[input.dataset.field] ?? (input.dataset.field === 'kind' ? 'work' : ''); });
  wireRow(row);
  $('#entries').append(row);
  return row;
}

function addProject(values = {}) {
  const row = $('#project-template').content.firstElementChild.cloneNode(true);
  $$('[data-field]', row).forEach(input => { input.value = values[input.dataset.field] ?? ''; });
  const image = $('img', row);
  const setImage = path => {
    row.dataset.image = path || '';
    image.src = path ? photoUrl(path) : '';
    image.hidden = !path;
  };
  setImage(values.image);
  $('input[type="file"]', row).addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const label = event.target.closest('.upload');
    label.classList.add('busy');
    try {
      setImage(await upload(file));
      dirty = true;
    } catch (problem) {
      showFormError(problem.message);
    } finally {
      label.classList.remove('busy');
      event.target.value = '';
    }
  });
  wireRow(row);
  $('#projects').append(row);
  return row;
}

function wireRow(row) {
  $('.remove', row).addEventListener('click', () => { row.remove(); dirty = true; });
  $('.up', row).addEventListener('click', () => {
    if (row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    dirty = true;
  });
}

function openEditor(student) {
  editingId = student?.id || null;
  form.reset();
  $('#entries').replaceChildren();
  $('#projects').replaceChildren();
  showFormError('');
  $$('[aria-invalid]', form).forEach(input => input.removeAttribute('aria-invalid'));

  const record = student || {published: true, resume: {}, en: {}};
  const en = record.en || {};
  const resume = record.resume || {};
  const enResume = en.resume || {};
  field('studentNumber').value = record.studentNumber || '';
  field('year').value = record.year && record.studentNumber && record.year !== yearFromNumber(record.studentNumber) ? record.year : '';
  field('published').checked = record.published !== false;
  field('hideFromSearch').checked = Boolean(record.hideFromSearch);
  field('name').value = record.name || '';
  field('location').value = record.location || '';
  field('occupation').value = record.occupation || '';
  field('linkedin').value = record.linkedin || '';
  field('en.name').value = englishOnly(en.name, record.name);
  field('en.location').value = englishOnly(en.location, record.location);
  field('en.occupation').value = englishOnly(en.occupation, record.occupation);
  field('employer').value = record.employer || '';
  field('en.employer').value = englishOnly(en.employer, record.employer);
  field('openToWork').checked = Boolean(record.openToWork);
  field('mentoring').checked = Boolean(record.mentoring);
  field('degree').value = record.degree || '';
  field('degreeField').value = record.degreeField || '';
  field('en.degreeField').value = englishOnly(en.degreeField, record.degreeField);
  field('degreePlace').value = record.degreePlace || '';
  field('en.degreePlace').value = englishOnly(en.degreePlace, record.degreePlace);
  field('thesis').value = record.thesis || '';
  field('en.thesis').value = englishOnly(en.thesis, record.thesis);
  updateThesis();
  field('resume.summary').value = resume.summary || '';
  field('en.resume.summary').value = enResume.summary || '';
  field('memory').value = (record.memory || []).join('\n\n');
  field('en.memory').value = (en.memory || []).join('\n\n');
  $$('#specialties input').forEach(input => { input.checked = (record.specialties || []).includes(input.value); });
  $$('#software input').forEach(input => { input.checked = (record.software || []).includes(input.value); });
  setPhoto(record.image);
  thumbPath = record.thumb || '';
  setResumeFile(resume.file);
  field('telegram.username').value = record.telegram?.username ? `@${record.telegram.username}` : '';
  renderTelegram(record);
  (resume.entries || []).forEach((entry, index) => {
    const english = (enResume.entries || [])[index] || {};
    addEntry({...entry, kind: entry.kind || 'work', to: entry.to ?? '', fromMonth: entry.fromMonth ?? '', toMonth: entry.toMonth ?? '', titleEn: englishOnly(english.title, entry.title), placeEn: englishOnly(english.place, entry.place)});
  });
  (record.portfolio || []).forEach((project, index) => {
    const english = (en.portfolio || [])[index] || {};
    addProject({...project, year: project.year ?? '', titleEn: englishOnly(english.title, project.title), kindEn: englishOnly(english.kind, project.kind)});
  });
  updateYearHint();
  updateExperience();

  $('#form-title').textContent = student ? student.name : 'دانش‌آموخته‌ی جدید';
  $('#delete-student').hidden = !student;
  updateProfileLink(student);
  dirty = false;
  show('edit');
  if (!student) field('studentNumber').focus();
}

function updateProfileLink(student) {
  const link = $('#view-profile');
  link.hidden = !student?.published;
  if (student) link.href = `/student.html?year=${student.year}&student=${student.studentNumber.slice(-2)}`;
}

function yearFromNumber(number) {
  const digits = toLatin(number).replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits[0] === '4' ? 1000 + Number(digits.slice(0, 3)) : 1300 + Number(digits.slice(0, 2));
}

function updateYearHint() {
  const year = yearFromNumber(field('studentNumber').value);
  field('year').placeholder = year ? `${fa.format(year)} (از شماره)` : 'از شماره خوانده می‌شود';
}

field('studentNumber').addEventListener('input', updateYearHint);

// Specialty chips, from the shared list the public site uses.
window.MelliCareer.SPECIALTIES.forEach(([key, label]) => {
  const chip = document.createElement('label');
  chip.innerHTML = '<input type="checkbox"><span></span>';
  $('input', chip).value = key;
  $('span', chip).textContent = label;
  $('#specialties').append(chip);
});

window.MelliCareer.SOFTWARE.forEach(([key, label]) => {
  const chip = document.createElement('label');
  chip.innerHTML = '<input type="checkbox"><span></span>';
  $('input', chip).value = key;
  $('span', chip).textContent = label;
  $('#software').append(chip);
});

// A thesis only exists for a master's or a doctorate.
function updateThesis() {
  const higher = window.MelliCareer.higherDegree(field('degree').value);
  $$('.thesis-field').forEach(label => { label.hidden = !higher; });
}
field('degree').addEventListener('change', updateThesis);

/* CSV export of every record, drafts included, for the faculty or the alumni association. */
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

$('#export-csv').addEventListener('click', () => {
  const career = window.MelliCareer;
  const columns = [
    ['شماره‌ی دانشجویی', s => s.studentNumber],
    ['سال ورود', s => s.year],
    ['نام', s => s.name],
    ['Name', s => s.en?.name],
    ['در سایت', s => (s.published ? 'بله' : 'خیر')],
    ['محل فعلی', s => s.location],
    ['Location', s => s.en?.location],
    ['شغل فعلی', s => s.occupation],
    ['محل کار', s => s.employer],
    ['تخصص‌ها', s => (s.specialties || []).map(career.specialtyLabel)],
    ['نرم‌افزارها', s => (s.software || []).map(career.softwareLabel)],
    ['سابقه‌ی کار (ماه)', s => career.experienceMonths(s.resume?.entries)],
    ['سابقه‌ی کار', s => { const m = career.experienceMonths(s.resume?.entries); return m ? career.formatExperience(m) : ''; }],
    ['آخرین مدرک', s => career.degreeLabel(s.degree)],
    ['رشته', s => s.degreeField],
    ['محل تحصیل', s => s.degreePlace],
    ['پایان‌نامه', s => s.thesis],
    ['آماده‌ی همکاری', s => (s.openToWork ? 'بله' : '')],
    ['آماده‌ی منتورینگ', s => (s.mentoring ? 'بله' : '')],
    ['LinkedIn', s => s.linkedin],
    ['آخرین ویرایش', s => s.updatedAt]
  ];
  const rows = [...site.students].sort((a, b) => a.year - b.year || a.studentNumber.localeCompare(b.studentNumber));
  const csv = [columns.map(([label]) => csvCell(label)).join(','), ...rows.map(s => columns.map(([, get]) => csvCell(get(s))).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}));
  link.download = `melli-graduates-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`${fa.format(rows.length)} پرونده در فایل CSV ذخیره شد.`);
});

// Live total of the work rows, computed exactly as the profile page does.
function updateExperience() {
  const entries = $$('#entries .row').map(rowValues);
  const months = window.MelliCareer.experienceMonths(entries.map(entry => ({...entry, to: entry.to || null})));
  $('#experience-total').textContent = months ? `سابقه‌ی کار محاسبه‌شده: ${faDigits(window.MelliCareer.formatExperience(months))}` : '';
}
$('#entries').addEventListener('input', updateExperience);
$('#entries').addEventListener('change', updateExperience);
form.addEventListener('input', () => { dirty = true; });
$('#add-entry').addEventListener('click', () => { $('[data-field="from"]', addEntry()).focus(); dirty = true; });
$('#add-project').addEventListener('click', () => { $('[data-field="title"]', addProject()).focus(); dirty = true; });

$('#photo-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const label = event.target.closest('.upload');
  label.classList.add('busy');
  try {
    const path = await upload(file);
    thumbPath = await makeThumb(file).catch(() => '');
    setPhoto(path);
    dirty = true;
  } catch (problem) {
    showFormError(problem.message);
  } finally {
    label.classList.remove('busy');
    event.target.value = '';
  }
});
$('#photo-remove').addEventListener('click', () => { setPhoto(''); thumbPath = ''; dirty = true; });

$('#resume-file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const label = event.target.closest('.upload');
  label.classList.add('busy');
  try {
    setResumeFile(await upload(file));
    dirty = true;
  } catch (problem) {
    showFormError(problem.message);
  } finally {
    label.classList.remove('busy');
    event.target.value = '';
  }
});
$('#resume-file-remove').addEventListener('click', () => { setResumeFile(''); dirty = true; });

// Year fields accept Persian digits; text fields keep them as typed.
const YEAR_FIELDS = new Set(['from', 'to', 'year', 'fromMonth', 'toMonth']);
function rowValues(row) {
  return Object.fromEntries($$('[data-field]', row).map(input => {
    const value = input.value.trim();
    return [input.dataset.field, YEAR_FIELDS.has(input.dataset.field) ? toLatin(value) : value];
  }));
}

function collect() {
  const value = name => field(name).value.trim();
  return {
    studentNumber: toLatin(value('studentNumber')),
    year: toLatin(value('year')),
    published: field('published').checked,
    hideFromSearch: field('hideFromSearch').checked,
    name: value('name'),
    location: value('location'),
    occupation: value('occupation'),
    linkedin: value('linkedin'),
    specialties: $$('#specialties input:checked').map(input => input.value),
    software: $$('#software input:checked').map(input => input.value),
    employer: value('employer'),
    openToWork: field('openToWork').checked,
    mentoring: field('mentoring').checked,
    degree: field('degree').value,
    degreeField: value('degreeField'),
    degreePlace: value('degreePlace'),
    thesis: value('thesis'),
    image: photoPath,
    thumb: thumbPath,
    telegram: {username: value('telegram.username')},
    resume: {
      summary: value('resume.summary'),
      file: resumeFilePath,
      entries: $$('#entries .row').map(rowValues)
    },
    portfolio: $$('#projects .row').map(row => ({...rowValues(row), image: row.dataset.image || ''})),
    memory: field('memory').value,
    en: {
      name: value('en.name'),
      location: value('en.location'),
      occupation: value('en.occupation'),
      employer: value('en.employer'),
      degreeField: value('en.degreeField'),
      degreePlace: value('en.degreePlace'),
      thesis: value('en.thesis'),
      resume: {summary: value('en.resume.summary')},
      memory: field('en.memory').value
    }
  };
}

function showFormError(message) {
  const banner = $('#form-error');
  banner.textContent = message;
  banner.hidden = !message;
  if (message) banner.scrollIntoView({block: 'center', behavior: 'smooth'});
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const required = ['studentNumber', 'name'].map(field).filter(input => !input.value.trim());
  $$('[aria-invalid]', form).forEach(input => input.removeAttribute('aria-invalid'));
  if (required.length) {
    required.forEach(input => input.setAttribute('aria-invalid', 'true'));
    showFormError('شماره‌ی دانشجویی و نام فارسی لازم است.');
    required[0].focus();
    return;
  }
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    const body = collect();
    const saved = editingId
      ? await api(`/api/students/${editingId}`, {method: 'PUT', body})
      : await api('/api/students', {method: 'POST', body});
    await reload();
    editingId = saved.id;
    renderTelegram(saved);
    dirty = false;
    showFormError('');
    $('#form-title').textContent = saved.name;
    $('#delete-student').hidden = false;
    updateProfileLink(saved);
    toast(saved.published ? 'ذخیره شد و در سایت نمایش داده می‌شود.' : 'ذخیره شد، به‌صورت پیش‌نویس.');
  } catch (problem) {
    showFormError(problem.message);
  } finally {
    button.disabled = false;
  }
});

$('#delete-student').addEventListener('click', async () => {
  const name = field('name').value.trim();
  if (!editingId || !confirm(`پرونده‌ی «${name}» برای همیشه حذف شود؟`)) return;
  try {
    await api(`/api/students/${editingId}`, {method: 'DELETE'});
    await reload();
    toast('حذف شد.');
    dirty = false;
    showList();
  } catch (problem) {
    showFormError(problem.message);
  }
});

$('#back-to-list').addEventListener('click', showList);

window.addEventListener('beforeunload', event => {
  if (dirty) event.preventDefault();
});

/* ---------------------------------------------------------------- Intake dialog */

function setCohortImage(path) {
  cohortImage = path || '';
  $('#cohort-preview').src = path ? photoUrl(path) : '';
  $('#cohort-preview').hidden = !path;
  $('#cohort-empty').hidden = Boolean(path);
  $('#cohort-remove').hidden = !path;
}

function openCohort(year) {
  cohortYear = year;
  const meta = site.cohorts[year] || {};
  $('#cohort-title').textContent = `ورودی ${fa.format(year)}`;
  $('#cohort-form').elements.graduatedAt.value = meta.graduatedAt || '';
  $('#cohort-error').hidden = true;
  setCohortImage(meta.image);
  $('#cohort-dialog').showModal();
}

$('#cohort-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const label = event.target.closest('.upload');
  label.classList.add('busy');
  try {
    setCohortImage(await upload(file));
  } catch (problem) {
    $('#cohort-error').textContent = problem.message;
    $('#cohort-error').hidden = false;
  } finally {
    label.classList.remove('busy');
    event.target.value = '';
  }
});
$('#cohort-remove').addEventListener('click', () => setCohortImage(''));

$('#cohort-save').addEventListener('click', async () => {
  try {
    await api(`/api/cohorts/${cohortYear}`, {method: 'PUT', body: {graduatedAt: $('#cohort-form').elements.graduatedAt.value, image: cohortImage}});
    await reload();
    $('#cohort-dialog').close();
    renderList();
    toast('ورودی ذخیره شد.');
  } catch (problem) {
    $('#cohort-error').textContent = problem.message;
    $('#cohort-error').hidden = false;
  }
});

/* ---------------------------------------------------------------- Telegram and completeness */

const linkOf = id => bot.links.find(link => link.profileId === id);
const pendingFor = id => bot.edits.filter(edit => edit.profileId === id);
const inviteLink = token => `https://t.me/${bot.botUsername || 'memar_mli_bot'}?start=l_${token}`;

// What a full profile has; Telegram counts because it lets the graduate keep the rest up to date.
const COMPLETENESS = [
  ['عکس', s => s.image],
  ['نام انگلیسی', s => s.en?.name && s.en.name !== s.name],
  ['محل فعلی', s => s.location],
  ['شغل فعلی', s => s.occupation],
  ['محل کار', s => s.employer],
  ['LinkedIn', s => s.linkedin],
  ['تخصص‌ها', s => s.specialties?.length],
  ['نرم‌افزارها', s => s.software?.length],
  ['مدرک', s => s.degree],
  ['خلاصه‌ی رزومه', s => s.resume?.summary],
  ['سوابق', s => s.resume?.entries?.length],
  ['نمونه‌کارها', s => s.portfolio?.length],
  ['یادگاری', s => s.memory?.length],
  ['Telegram', s => linkOf(s.id)]
];

function completeness(student) {
  const missing = COMPLETENESS.filter(([, has]) => !has(student)).map(([label]) => label);
  return {percent: Math.round(100 * (COMPLETENESS.length - missing.length) / COMPLETENESS.length), missing};
}

function meter(percent) {
  const element = document.createElement('span');
  element.className = 'meter';
  element.title = `${fa.format(percent)}٪ تکمیل`;
  element.innerHTML = '<i><i></i></i><b></b>';
  $('i i', element).style.width = `${percent}%`;
  $('b', element).textContent = `${fa.format(percent)}٪`;
  return element;
}

function renderTelegram(record) {
  const status = $('#tg-status');
  const link = record.id ? linkOf(record.id) : null;
  const invite = record.telegram?.invite;
  status.replaceChildren();
  const line = (text, className = '') => status.append(el('p', className, text));
  if (!bot.configured) {
    line('اتصال به ربات تنظیم نشده است. مقادیر BOT_SYNC_URL و BOT_SYNC_SECRET را در فایل .env وارد کنید.', 'warn');
  } else if (link) {
    line(`متصل به ${link.firstName || 'Telegram'}${link.telegramUsername ? ` (\u2068@${link.telegramUsername}\u2069)` : ''}، از ${formatDate(link.linkedAt)}`, 'ok');
    line(link.acceptsMessages ? 'دریافت پیام ناشناس از بازدیدکنندگان سایت: فعال' : 'دریافت پیام ناشناس از بازدیدکنندگان سایت: غیرفعال');
  } else if (record.id) {
    line(invite ? 'پیوند دعوت ساخته شده و هنوز استفاده نشده است.' : record.telegram?.username ? 'در انتظار ارسال ⁨/start⁩ از همین نام کاربری.' : 'هنوز به Telegram متصل نشده است.');
  } else {
    line('پس از ذخیره‌ی پرونده می‌توانید پیوند دعوت بسازید.');
  }
  const pending = record.id ? pendingFor(record.id).length : 0;
  if (pending) line(`${fa.format(pending)} ویرایش از طریق Telegram در داشبورد در انتظار تأیید است.`, 'warn');
  $('#tg-invite').hidden = Boolean(link) || !record.id;
  $('#tg-invite').textContent = invite ? 'ساخت پیوند تازه' : 'ساخت پیوند دعوت';
  $('#tg-invite-link').hidden = Boolean(link) || !invite;
  $('#tg-invite-link').value = invite ? inviteLink(invite) : '';
  $('#tg-copy').hidden = Boolean(link) || !invite;
  $('#tg-unlink').hidden = !link;
  $$('.bot-name').forEach(name => { name.textContent = `@${bot.botUsername || 'memar_mli_bot'}`; });
}

$('#tg-invite').addEventListener('click', async () => {
  if (!editingId) return;
  const record = site.students.find(student => student.id === editingId);
  if (record?.telegram?.invite && !confirm('پیوند قبلی از کار می‌افتد. پیوند تازه ساخته شود؟')) return;
  try {
    await api(`/api/students/${editingId}/invite`, {method: 'POST'});
    await reload();
    renderTelegram(site.students.find(student => student.id === editingId));
    toast('پیوند دعوت ساخته شد. شناسایی آن در ربات ممکن است تا یک دقیقه طول بکشد.');
  } catch (problem) {
    showFormError(problem.message);
  }
});

$('#tg-copy').addEventListener('click', async () => {
  const input = $('#tg-invite-link');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  toast('پیوند کپی شد.');
});

$('#tg-unlink').addEventListener('click', async () => {
  if (!editingId || !confirm('اتصال Telegram این پرونده قطع شود؟ پس از آن، دانش‌آموخته نمی‌تواند از طریق ربات پرونده را ویرایش کند یا پیامی دریافت کند.')) return;
  try {
    await api(`/api/students/${editingId}/telegram`, {method: 'DELETE'});
    await reload();
    field('telegram.username').value = '';
    renderTelegram(site.students.find(student => student.id === editingId));
    toast('اتصال قطع شد.');
  } catch (problem) {
    showFormError(problem.message);
  }
});

/* ---------------------------------------------------------------- Dashboard */

const EDIT_LABELS = {
  name: 'نام فارسی', nameEn: 'نام انگلیسی', location: 'محل فعلی', occupation: 'شغل فعلی', employer: 'محل کار',
  linkedin: 'پروفایل LinkedIn', summary: 'خلاصه‌ی رزومه', memory: 'یادگاری', photo: 'عکس', resumeFile: 'فایل PDF رزومه',
  openToWork: 'آماده‌ی همکاری', mentoring: 'آماده‌ی منتورینگ', note: 'پیام به مدیران'
};

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function button(label, className, onClick) {
  const element = el('button', className, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function renderDashboard() {
  const students = site.students;
  const published = students.filter(student => student.published).length;
  const linked = students.filter(student => linkOf(student.id)).length;
  const open = bot.links.filter(link => link.acceptsMessages).length;
  const average = students.length ? Math.round(students.reduce((sum, student) => sum + completeness(student).percent, 0) / students.length) : 0;
  const stats = [
    ['پرونده‌ها', fa.format(students.length), `${fa.format(published)} در سایت، ${fa.format(students.length - published)} پیش‌نویس`],
    ['متصل به Telegram', fa.format(linked), students.length ? `${fa.format(Math.round(100 * linked / students.length))}٪ از کل پرونده‌ها` : ''],
    ['پذیرای پیام', fa.format(open), 'دکمه‌ی تماس در صفحه‌ی این افراد فعال است'],
    ['گفت‌وگوهای ناشناس', fa.format(bot.conversations || 0), 'از ابتدا تا امروز'],
    ['میانگین تکمیل', `${fa.format(average)}٪`, 'بر اساس چهارده مورد در هر پرونده']
  ];
  $('#stats').replaceChildren(...stats.map(([label, value, note]) => {
    const card = el('div', 'stat');
    card.append(el('span', 'stat-label', label), el('strong', '', value), el('span', 'stat-note', note));
    return card;
  }));

  const status = $('#bot-status');
  status.className = `muted${bot.configured && bot.error ? ' warn' : ''}`;
  status.textContent = !bot.configured
    ? 'ربات Telegram هنوز به این سرور متصل نشده است. راهنمای راه‌اندازی در فایل bot/README.md آمده است.'
    : bot.error ? `آخرین تلاش برای ارتباط با ربات ناموفق بود: ${bot.error}`
      : bot.syncedAt ? `ربات \u2068@${bot.botUsername}\u2069 متصل است. آخرین هماهنگی: ${formatDate(bot.syncedAt)}` : 'در حال نخستین هماهنگی با ربات…';
  $('#bot-sync').hidden = !bot.configured;

  renderEdits();
  renderJoins();

  const incomplete = students.map(student => ({student, ...completeness(student)}))
    .filter(item => item.percent < 100).sort((a, b) => a.percent - b.percent).slice(0, 8);
  $('#incomplete').replaceChildren(...incomplete.map(({student, percent, missing}) => {
    const item = el('li');
    const open = button('', 'mini', () => openEditor(student));
    const text = el('span', 'mini-text');
    text.append(el('strong', '', student.name), el('span', 'muted', `ورودی ${fa.format(student.year)} · بدون ${missing.slice(0, 3).join('، ')}${missing.length > 3 ? '، …' : ''}`));
    open.append(text, meter(percent));
    item.append(open);
    return item;
  }));
  if (!incomplete.length) $('#incomplete').append(el('li', 'muted', students.length ? 'همه‌ی پرونده‌ها کامل هستند.' : 'هنوز پرونده‌ای ثبت نشده است.'));
}

function renderEdits() {
  const container = $('#edits');
  container.replaceChildren();
  if (!bot.edits.length) {
    container.append(el('p', 'muted', 'ویرایشی در انتظار تأیید نیست.'));
    return;
  }
  bot.edits.forEach(edit => {
    const item = el('article', 'queue-item');
    const head = el('div', 'queue-head');
    const who = el('div');
    who.append(el('strong', '', edit.name), el('span', 'muted', ` · ورودی ${fa.format(edit.year)}`));
    head.append(who, el('span', 'chip', EDIT_LABELS[edit.field] || edit.field), el('time', 'muted', formatDate(edit.createdAt)));
    const body = el('div', 'diff');
    const fileUrl = `/api/bot/edits/${edit.id}/file`;
    if (edit.field === 'photo') {
      const figure = (src, caption) => {
        const element = el('figure');
        const image = el('img');
        image.src = src;
        image.alt = caption;
        element.append(image, el('figcaption', '', caption));
        return element;
      };
      body.classList.add('photos');
      body.append(figure(photoUrl(edit.current), 'فعلی'), figure(fileUrl, 'پیشنهادی'));
    } else if (edit.field === 'resumeFile') {
      const link = el('a', '', `مشاهده‌ی ${edit.fileName || 'فایل'} ↗`);
      link.href = fileUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      body.append(link);
      if (edit.current) body.append(el('span', 'muted', ' (جایگزین فایل فعلی می‌شود)'));
    } else if (edit.field === 'note') {
      body.append(el('p', 'proposed', edit.value));
    } else {
      const isFlag = edit.field === 'openToWork' || edit.field === 'mentoring';
      const show = value => (isFlag ? (value ? 'بله' : 'خیر') : value || 'خالی');
      const current = el('p', 'current', show(edit.current));
      const proposed = el('p', 'proposed', show(edit.value));
      if (['nameEn', 'linkedin'].includes(edit.field)) current.dir = proposed.dir = 'ltr';
      body.append(current, proposed);
    }
    const actions = el('div', 'queue-actions');
    const note = el('input');
    note.placeholder = 'یادداشت برای دانش‌آموخته (اختیاری)';
    note.maxLength = 500;
    const decide = decision => async event => {
      event.target.disabled = true;
      try {
        await api(`/api/bot/edits/${edit.id}`, {method: 'POST', body: {decision, note: note.value.trim()}});
        await reload();
        renderDashboard();
        loadActivity();
        toast(decision === 'approved' ? 'تأیید شد و پیام آن برای دانش‌آموخته ارسال شد.' : 'رد شد و پیام آن برای دانش‌آموخته ارسال شد.');
      } catch (problem) {
        toast(problem.message);
        event.target.disabled = false;
      }
    };
    actions.append(button('پرونده', 'link small', () => openEditor(site.students.find(student => student.id === edit.profileId))));
    if (edit.field === 'note') actions.append(button('خوانده شد', 'primary small', decide('approved')));
    else actions.append(note, button('تأیید', 'primary small', decide('approved')), button('رد', 'danger small', decide('rejected')));
    item.append(head, body, actions);
    container.append(item);
  });
}

function renderJoins() {
  const container = $('#joins');
  container.replaceChildren();
  if (!bot.joinRequests.length) {
    container.append(el('p', 'muted', 'درخواستی در انتظار نیست.'));
    return;
  }
  bot.joinRequests.forEach(join => {
    const item = el('article', 'queue-item');
    const number = toLatin(join.studentNumber || '').replace(/\D/g, '');
    const existing = site.students.find(student => number && student.studentNumber === number);
    const head = el('div', 'queue-head');
    head.append(el('strong', '', join.name || 'بدون نام'), el('time', 'muted', formatDate(join.createdAt)));
    item.append(head, el('p', 'muted', [
      join.studentNumber ? `شماره‌ی دانشجویی ${faDigits(join.studentNumber)}` : 'بدون شماره‌ی دانشجویی',
      join.telegramUsername ? `\u2068@${join.telegramUsername}\u2069` : 'بدون نام کاربری Telegram'
    ].join(' · ')));
    if (join.note) item.append(el('p', 'proposed', join.note));
    if (existing) item.append(el('p', 'warn', `پرونده‌ی «${existing.name}» با همین شماره وجود دارد و با پذیرش، این حساب به آن متصل می‌شود.`));
    const decide = decision => async event => {
      event.target.disabled = true;
      try {
        await api(`/api/bot/joins/${join.id}`, {method: 'POST', body: {decision}});
        await reload();
        renderDashboard();
        loadActivity();
        toast(decision === 'rejected' ? 'درخواست رد شد.' : existing ? 'پذیرفته و به پرونده متصل شد.' : 'پذیرفته شد و پیش‌نویس پرونده ساخته شد.');
      } catch (problem) {
        toast(problem.message);
        event.target.disabled = false;
      }
    };
    const actions = el('div', 'queue-actions');
    actions.append(button(existing ? 'پذیرش و اتصال' : 'پذیرش و ساخت پیش‌نویس', 'primary small', decide('accepted')), button('رد', 'danger small', decide('rejected')));
    item.append(actions);
    container.append(item);
  });
}

const ACTIONS = [
  [/^created$/, () => 'پرونده ساخته شد'],
  [/^edited$/, () => 'پرونده ویرایش شد'],
  [/^deleted$/, () => 'پرونده حذف شد'],
  [/^invite created$/, () => 'پیوند دعوت Telegram ساخته شد'],
  [/^Telegram unlinked$/, () => 'اتصال Telegram قطع شد'],
  [/^approved bot edit: (\w+)$/, m => `ویرایش «${EDIT_LABELS[m[1]] || m[1]}» از Telegram تأیید شد`],
  [/^rejected bot edit: (\w+)$/, m => `ویرایش «${EDIT_LABELS[m[1]] || m[1]}» از Telegram رد شد`],
  [/^join request accepted$/, () => 'درخواست عضویت پذیرفته شد'],
  [/^bulk added (\d+) drafts$/, m => `${fa.format(Number(m[1]))} پیش‌نویس به‌صورت گروهی افزوده شد`]
];

async function loadActivity() {
  const list = $('#activity');
  try {
    const {entries} = await api('/api/log');
    list.replaceChildren(...entries.slice(0, 25).map(entry => {
      const rule = ACTIONS.find(([pattern]) => pattern.test(entry.action));
      const item = el('li');
      item.append(el('time', 'muted', formatDate(entry.at)), el('span', '', `${rule ? rule[1](entry.action.match(rule[0])) : entry.action}${entry.name ? `: ${entry.name}` : ''}`));
      return item;
    }));
    if (!entries.length) list.append(el('li', 'muted', 'هنوز فعالیتی ثبت نشده است.'));
  } catch {
    list.replaceChildren(el('li', 'muted', 'فهرست فعالیت‌ها در دسترس نیست.'));
  }
}

$('#bot-sync').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    await api('/api/bot/sync', {method: 'POST'});
    await reload();
    renderDashboard();
    toast('با ربات هماهنگ شد.');
  } catch (problem) {
    toast(problem.message);
  } finally {
    event.target.disabled = false;
  }
});

// The server pulls from the bot every minute; an open dashboard follows it.
setInterval(async () => {
  if ($('#app-view').hidden || document.hidden || $('#dash-view').hidden) return;
  try {
    await reload();
    renderDashboard();
  } catch {}
}, 60000);

/* ---------------------------------------------------------------- Bulk add */

$('#bulk-add').addEventListener('click', () => {
  $('#bulk-error').hidden = true;
  $('#bulk-dialog').showModal();
  $('#bulk-lines').focus();
});

$('#bulk-save').addEventListener('click', async () => {
  const lines = $('#bulk-lines').value.split(/\r?\n/).map(line => toLatin(line.trim())).filter(Boolean);
  if (!lines.length) return;
  try {
    const result = await api('/api/students/bulk', {method: 'POST', body: {lines}});
    await reload();
    renderList();
    if (result.errors.length) {
      $('#bulk-error').textContent = `${fa.format(result.created)} پیش‌نویس افزوده شد. این خطوط افزوده نشدند:\n${result.errors.join('\n')}`;
      $('#bulk-error').hidden = false;
    } else {
      $('#bulk-dialog').close();
      $('#bulk-lines').value = '';
      toast(`${fa.format(result.created)} پیش‌نویس افزوده شد.`);
    }
  } catch (problem) {
    $('#bulk-error').textContent = problem.message;
    $('#bulk-error').hidden = false;
  }
});


/* ---------------------------------------------------------------- Start */

api('/api/session')
  .then(session => (session.authenticated ? showApp() : showLogin()))
  .catch(() => showLogin());
