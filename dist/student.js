'use strict';
const params = new URLSearchParams(window.location.search);
const {lang, t, num, digits, href, apply, localize} = window.MelliI18n;
const cohort = (window.MELLI_COHORTS || []).find(item => item.published && String(item.year) === params.get('year'));
const record = cohort && (window.MELLI_STUDENTS?.[cohort.year] || []).find(item => item.studentSuffix === params.get('student'));
const student = localize(record);
const byId = id => document.getElementById(id);
const $specialtyList = document.querySelector('#student-specialties ul');

apply();
// The back arrow points toward the start of the line in each language.
byId('back-arrow').textContent = lang === 'en' ? '←' : '→';
document.title = t('site.name');

if (cohort) {
  byId('back-to-cohort').href = href(`index.html#cohort-${cohort.year}`);
  byId('back-label').textContent = t('profile.backYear', {year: num(cohort.year)});
}

if (!student) {
  byId('profile-empty').hidden = false;
} else {
  const suffix = digits(student.studentSuffix);
  const cohortLabel = t('profile.cohort', {year: num(cohort.year), period: num(cohort.year - 1399 + 60)});
  document.title = t('profile.title', {name: student.name});
  if (student.hideFromSearch) {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);
  }
  byId('student-name').textContent = student.name;
  byId('student-cohort').textContent = cohortLabel;
  if (/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(student.linkedin || '')) {
    byId('student-linkedin').href = student.linkedin;
    byId('student-linkedin').hidden = false;
  }
  // Opted-in graduates get a button that opens the bot; the bot relays the message without names.
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=c_[a-f0-9]{12}$/.test(student.contact || '')) {
    byId('contact-link').href = student.contact;
    byId('student-contact').hidden = false;
  }
  const badge = document.createElement('span');
  badge.className = 'student-suffix';
  badge.textContent = suffix;
  byId('student-portrait').append(makePortrait(student, student.studentSuffix), badge);

  byId('fact-number').textContent = student.studentNumber ? digits(student.studentNumber) : t('fact.missing');
  byId('fact-location').textContent = student.location || t('fact.missing');
  byId('fact-occupation').textContent = student.occupation || t('fact.missing');
  const {experienceMonths, formatExperience, specialtyLabel, monthName} = window.MelliCareer;
  const months = experienceMonths(student.resume?.entries);
  byId('fact-experience').textContent = months ? formatExperience(months) : t('fact.missing');
  const specialties = (student.specialties || []).map(specialtyLabel).filter(Boolean);
  specialties.forEach(label => {
    const chip = document.createElement('li');
    chip.textContent = label;
    $specialtyList.append(chip);
  });
  byId('student-specialties').hidden = !specialties.length;
  const career = window.MelliCareer;
  const softwareList = document.querySelector('#student-software ul');
  (student.software || []).map(career.softwareLabel).filter(Boolean).forEach(label => {
    const chip = document.createElement('li');
    chip.lang = 'en';
    chip.textContent = label;
    softwareList.append(chip);
  });
  byId('student-software').hidden = !softwareList.children.length;
  if (student.employer && !student.occupation) {
    byId('fact-occupation').textContent = student.employer;
  } else if (student.employer) {
    const employer = document.createElement('span');
    employer.className = 'fact-sub';
    employer.textContent = student.employer;
    byId('fact-occupation').append(employer);
  }
  const degree = career.degreeLabel(student.degree);
  byId('fact-degree').textContent = degree ? (student.degreeField ? t('fact.degreeIn', {degree, field: student.degreeField}) : degree) : t('fact.missing');
  byId('fact-degree-place').textContent = student.degreePlace || t('fact.missing');
  if (student.thesis && career.higherDegree(student.degree)) {
    document.querySelector('#student-thesis strong').textContent = student.thesis;
    byId('student-thesis').hidden = false;
  }
  [['openToWork', 'badge.open', 'open'], ['mentoring', 'badge.mentor', 'mentor']].forEach(([field, label, kind]) => {
    if (!student[field]) return;
    const badge = document.createElement('li');
    badge.className = `badge-${kind}`;
    badge.textContent = t(label);
    byId('student-badges').append(badge);
  });
  byId('student-badges').hidden = !byId('student-badges').children.length;

  const resume = student.resume || {};
  byId('resume-summary').textContent = resume.summary || '';
  byId('resume-summary').hidden = !resume.summary;
  if (resume.file) {
    byId('resume-file').href = resume.file;
    byId('resume-file').hidden = false;
  } else {
    byId('resume-missing').hidden = false;
  }
  (resume.entries || []).forEach(entry => {
    const item = document.createElement('li');
    const period = document.createElement('span');
    period.className = 'resume-period';
    const when = (year, month) => (month ? t('resume.monthYear', {month: monthName(month), year: num(year)}) : num(year));
    period.textContent = t('resume.period', {from: when(entry.from, entry.fromMonth), to: entry.to ? when(entry.to, entry.toMonth) : t('resume.now')});
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const place = document.createElement('span');
    place.className = 'resume-place';
    place.textContent = entry.place || '';
    item.append(period, title, place);
    byId('resume-list').append(item);
  });

  (student.portfolio || []).forEach((project, index) => {
    const item = document.createElement('li');
    const card = document.createElement(project.url ? 'a' : 'div');
    card.className = 'portfolio-card';
    if (project.url) {
      card.href = project.url;
      card.target = '_blank';
      card.rel = 'noopener';
    }
    const cover = document.createElement('div');
    cover.className = `portfolio-cover cover-${index % 3}`;
    if (project.image) cover.style.backgroundImage = `url("${project.image}")`;
    const title = document.createElement('h3');
    title.textContent = project.title;
    const meta = document.createElement('p');
    meta.textContent = [project.kind, project.year && num(project.year)].filter(Boolean).join(' · ');
    card.append(cover, title, meta);
    item.append(card);
    byId('portfolio-grid').append(item);
  });
  byId('portfolio-grid').closest('section').hidden = !(student.portfolio || []).length;

  const paragraphs = Array.isArray(student.memory) ? student.memory : [student.memory || ''];
  paragraphs.filter(Boolean).forEach(text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    byId('student-memory').append(paragraph);
  });
  byId('memory').hidden = !paragraphs.some(Boolean);
  byId('memory-signature').textContent = student.name;
  byId('student-profile').hidden = false;
}
