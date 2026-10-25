'use strict';

const faNumber = new Intl.NumberFormat('fa-IR', {useGrouping: false});
const faSuffix = new Intl.NumberFormat('fa-IR', {useGrouping: false, minimumIntegerDigits: 2});
const directory = document.getElementById('graduates');
const emptyMessage = document.getElementById('directory-empty');

const requestedYear = new URLSearchParams(window.location.search).get('year');
const selectedCohort = (window.MELLI_COHORTS || []).find(cohort => cohort.published && String(cohort.year) === requestedYear);

if (!selectedCohort) {
  document.getElementById('cohort-title').textContent = 'ورودی پیدا نشد';
  document.getElementById('directory-sample-note').hidden = true;
  document.querySelector('.directory-toolbar').hidden = true;
  emptyMessage.textContent = 'این ورودی در آرشیو موجود نیست. از فهرست ورودی‌ها یک سال را انتخاب کنید.';
  emptyMessage.hidden = false;
} else {
  const year = faNumber.format(selectedCohort.year);
  const period = faNumber.format(selectedCohort.year - 1399 + 60);
  document.title = `دوره ${period} · ورودی ${year} — معمار ملی`;
  document.getElementById('cohort-title').textContent = `دوره ${period}`;
  document.getElementById('cohort-year-label').textContent = `ورودی ${year}`;
  document.getElementById('back-to-intake').href = `index.html#cohort-${selectedCohort.year}`;

  const students = (window.MELLI_STUDENTS?.[selectedCohort.year] || [])
    .filter(student => /^\d{2}$/.test(String(student.studentSuffix)))
    .slice()
    .sort((a, b) => Number(a.studentSuffix) - Number(b.studentSuffix));

  document.getElementById('graduate-count').textContent = faNumber.format(students.length);
  document.getElementById('directory-sample-note').hidden = !students.some(student => student.sample);

  if (!students.length) {
    emptyMessage.textContent = 'پرتره‌های این ورودی هنوز به آرشیو اضافه نشده‌اند.';
    emptyMessage.hidden = false;
  }

  students.forEach(student => {
    const suffix = faSuffix.format(Number(student.studentSuffix));
    const card = document.createElement('a');
    card.href = `student.html?year=${selectedCohort.year}&student=${student.studentSuffix}`;
    card.className = 'graduate-card';
    card.dataset.studentSuffix = String(student.studentSuffix);
    card.setAttribute('aria-label', `یادگاری ${student.name}، شماره ${suffix}`);

    const photo = makePortrait(student, suffix);
    const badge = document.createElement('span');
    badge.className = 'student-suffix';
    badge.textContent = suffix;
    card.append(photo, badge);
    directory.append(card);
  });
}

