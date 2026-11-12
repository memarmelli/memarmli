'use strict';

// A 3:4 portrait for a graduate. Photos of any shape are cropped to fill the
// frame; a graduate without a photo gets a neutral silhouette. Grids ask for the
// small thumbnail; the profile page uses the full photo.
function makePortrait(student, suffix, {thumbnail = false} = {}) {
  const i18n = window.MelliI18n;
  const photo = document.createElement('img');
  photo.className = 'graduate-photo';
  photo.alt = i18n ? i18n.t('portrait.real', {n: i18n.digits(suffix)}) : '';
  photo.loading = 'lazy';
  photo.decoding = 'async';
  photo.src = (thumbnail && student.thumb) || student.image || 'assets/portrait-empty.svg';
  if (!student.image) photo.classList.add('is-empty');
  photo.addEventListener('error', () => {
    photo.src = 'assets/portrait-empty.svg';
    photo.classList.add('is-empty');
  }, {once: true});
  return photo;
}
