'use strict';
const params = new URLSearchParams(window.location.search);
const cohort = (window.MELLI_COHORTS || []).find(item => item.published && String(item.year) === params.get('year'));
const student = cohort && (window.MELLI_STUDENTS?.[cohort.year] || []).find(item => item.studentSuffix === params.get('student'));
const back = document.getElementById('back-to-cohort');
if (cohort) {
  back.href = `cohort.html?year=${cohort.year}`;
  back.replaceChildren(document.createTextNode('بازگشت به چهره‌های دوره '));
  const arrow = document.createElement('span');
  arrow.textContent = '↗';
  arrow.setAttribute('aria-hidden', 'true');
  back.append(arrow);
}
if (!student) {
  document.getElementById('profile-empty').hidden = false;
} else {
  const fa = new Intl.NumberFormat('fa-IR', {useGrouping: false});
  const suffix = new Intl.NumberFormat('fa-IR', {useGrouping: false, minimumIntegerDigits: 2}).format(Number(student.studentSuffix));
  document.title = `${student.name} · یادگاری — معمار ملی`;
  document.getElementById('student-name').textContent = student.name;
  document.getElementById('student-cohort').textContent = `ورودی ${fa.format(cohort.year)} · دوره ${fa.format(cohort.year - 1399 + 60)}`;
  document.getElementById('profile-sample').hidden = !student.sample;
  const badge = document.createElement('span');
  badge.className = 'student-suffix';
  badge.textContent = suffix;
  document.getElementById('student-portrait').append(makePortrait(student, suffix), badge);
  const paragraphs = Array.isArray(student.memory) ? student.memory : [student.memory || ''];
  paragraphs.forEach(text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.getElementById('student-memory').append(paragraph);
  });
  document.getElementById('memory-signature').textContent = student.name;
  document.getElementById('student-profile').hidden = false;
}
