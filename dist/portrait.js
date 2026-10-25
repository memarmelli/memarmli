'use strict';

function makePortrait(student, suffix) {
  let photo;
  const description = `${student.sample ? 'چهره ساختگی نمونه' : 'پرتره فارغ‌التحصیلی'}، شماره ${suffix}`;
  if (student.image) {
    photo = document.createElement('img');
    photo.src = student.image;
    photo.alt = description;
    photo.loading = 'lazy';
    photo.decoding = 'async';
  } else {
    photo = document.createElement('span');
    photo.setAttribute('role', 'img');
    photo.setAttribute('aria-label', description);
    const columns = student.portraitColumns || 6;
    const rows = student.portraitRows || 5;
    const index = student.portraitIndex || 0;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const tileAspect = (student.portraitAtlasAspect || 1) * rows / columns;
    const scaleX = Math.max(1, tileAspect / (3 / 4));
    const scaleY = Math.max(1, (3 / 4) / tileAspect);
    const sheetWidth = columns * scaleX;
    const sheetHeight = rows * scaleY;
    const offsetX = column * scaleX + (scaleX - 1) / 2;
    const offsetY = row * scaleY + (scaleY - 1) / 2;
    photo.style.backgroundImage = `url("${student.portraitAtlas}")`;
    photo.style.backgroundSize = `${sheetWidth * 100}% ${sheetHeight * 100}%`;
    photo.style.backgroundPosition = `${sheetWidth > 1 ? offsetX / (sheetWidth - 1) * 100 : 0}% ${sheetHeight > 1 ? offsetY / (sheetHeight - 1) * 100 : 0}%`;
  }
  photo.className = 'graduate-photo';
  return photo;
}

