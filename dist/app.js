'use strict';

const persianNumber = new Intl.NumberFormat('fa-IR', {useGrouping: false});
const archive = document.getElementById('cohorts');
const yearNav = document.getElementById('year-nav');
const dialog = document.getElementById('photo-dialog');
const dialogImage = document.getElementById('dialog-image');
const dialogTitle = document.getElementById('dialog-title');
const closeDialog = document.getElementById('close-dialog');
let lastPhotoButton;

const cohorts = (window.MELLI_COHORTS || [])
  .filter(cohort => cohort.published && Number.isInteger(cohort.year) && Number.isFinite(Date.parse(cohort.graduatedAt)))
  .sort((a, b) => Date.parse(b.graduatedAt) - Date.parse(a.graduatedAt) || b.year - a.year);

cohorts.forEach((cohort, index) => {
  const year = persianNumber.format(cohort.year);
  const article = document.createElement('article');
  article.className = 'cohort';
  article.id = `cohort-${cohort.year}`;
  article.setAttribute('aria-label', `ورودی ${year}`);

  const meta = document.createElement('div');
  meta.className = 'cohort-meta';
  const label = document.createElement('span');
  label.className = 'cohort-label';
  const rule = document.createElement('span');
  rule.className = 'label-rule';
  rule.setAttribute('aria-hidden', 'true');
  label.append(rule, document.createTextNode(index === 0 ? 'تازه‌ترین قاب آرشیو' : 'از آرشیو خاطره‌ها'));
  const count = document.createElement('span');
  count.className = 'cohort-count';
  count.dir = 'ltr';
  count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(cohorts.length).padStart(2, '0')}`;
  meta.append(label, count);

  const frame = document.createElement('div');
  frame.className = 'cohort-frame';
  const yearPanel = document.createElement('div');
  yearPanel.className = 'cohort-year';
  yearPanel.textContent = year;

  const button = document.createElement('button');
  button.className = 'photo-button';
  button.type = 'button';
  button.setAttribute('aria-label', `نمایش تصویر کامل ورودی ${year}${cohort.sample ? '؛ تصویر نمونه' : ''}`);
  button.setAttribute('aria-haspopup', 'dialog');
  const image = document.createElement('img');
  image.src = cohort.image;
  image.alt = cohort.sample ? `عکس نمونه برای چیدمان ورودی ${year}؛ تصویر واقعی این ورودی نیست` : `عکس گروهی فارغ‌التحصیلی ورودی ${year}`;
  image.loading = index === 0 ? 'eager' : 'lazy';
  image.decoding = 'async';
  if (index === 0) image.fetchPriority = 'high';
  image.addEventListener('error', () => { image.src = 'assets/photo-placeholder.svg'; }, {once: true});
  button.append(image);
  if (cohort.sample) {
    const sample = document.createElement('span');
    sample.className = 'sample-label';
    sample.textContent = 'تصویر نمونه';
    button.append(sample);
  }
  const expand = document.createElement('span');
  expand.className = 'expand-icon';
  expand.setAttribute('aria-hidden', 'true');
  expand.textContent = '↗';
  button.append(expand);
  button.addEventListener('click', () => {
    lastPhotoButton = button;
    dialogTitle.textContent = `ورودی ${year} · عکس گروهی`;
    dialogImage.src = image.currentSrc || image.src;
    dialogImage.alt = image.alt;
    document.querySelector('.dialog-caption').hidden = !cohort.sample;
    dialog.showModal();
    document.body.classList.add('dialog-open');
    closeDialog.focus();
  });
  frame.append(yearPanel, button);
  article.append(meta, frame);
  archive.append(article);

  const navLink = document.createElement('a');
  navLink.href = `#${article.id}`;
  navLink.textContent = year;
  navLink.setAttribute('aria-label', `رفتن به ورودی ${year}`);
  if (index === 0) navLink.setAttribute('aria-current', 'true');
  yearNav.append(navLink);
});

if (!cohorts.length) {
  const empty = document.createElement('p');
  empty.className = 'noscript';
  empty.textContent = 'قاب نخست آرشیو به‌زودی اینجا قرار می‌گیرد.';
  archive.append(empty);
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    yearNav.querySelectorAll('a').forEach(link => {
      if (link.hash === `#${visible.target.id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }, {rootMargin: '-10% 0px -30% 0px', threshold: [0, 0.3, 0.6]});
  archive.querySelectorAll('.cohort').forEach(article => observer.observe(article));
}

closeDialog.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
  if (lastPhotoButton) lastPhotoButton.focus({preventScroll: true});
});
