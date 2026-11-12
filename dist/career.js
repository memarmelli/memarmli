'use strict';

// Specialties, solar-calendar months and total work experience. Shared by the
// public pages and the admin; it formats through MelliI18n when it is loaded.
window.MelliCareer = (() => {
  // key, Persian label, English label. Keys are stored in graduate records.
  const SPECIALTIES = [
    ['phase-1', 'فاز یک', 'Concept design (phase 1)'],
    ['phase-2', 'فاز دو', 'Construction documents (phase 2)'],
    ['bim', 'BIM', 'BIM'],
    ['facade', 'طراحی نما', 'Facade design'],
    ['interior', 'طراحی داخلی', 'Interior design'],
    ['furniture', 'طراحی مبلمان', 'Furniture design'],
    ['shop-drawing', 'شاپیست', 'Shop drawings'],
    ['construction', 'اجرای ساختمان', 'Construction'],
    ['supervision', 'نظارت', 'Site supervision'],
    ['project-management', 'مدیریت پروژه', 'Project management'],
    ['estimating', 'متره و برآورد', 'Cost estimating'],
    ['cg', 'CG و تصویرسازی', 'CG and visualisation'],
    ['parametric', 'طراحی پارامتریک', 'Parametric design'],
    ['computational', 'طراحی محاسباتی', 'Computational design'],
    ['software', 'مهندسی نرم‌افزار', 'Software engineering'],
    ['urban', 'طراحی شهری', 'Urban design'],
    ['landscape', 'معماری منظر', 'Landscape architecture'],
    ['restoration', 'مرمت', 'Heritage restoration'],
    ['lighting', 'طراحی نورپردازی', 'Lighting design'],
    ['sustainability', 'معماری پایدار', 'Sustainable design'],
    ['model-making', 'ماکت‌سازی', 'Model making'],
    ['graphic', 'گرافیک معماری', 'Architectural graphics'],
    ['research', 'پژوهش', 'Research'],
    ['teaching', 'تدریس', 'Teaching']
  ];
  // Software skills keep their product names in every language.
  const SOFTWARE = [
    'Revit', 'ArchiCAD', 'AutoCAD', 'Rhino', 'Grasshopper', 'SketchUp', '3ds Max', 'V-Ray', 'Corona', 'Lumion',
    'Enscape', 'Twinmotion', 'D5 Render', 'Unreal Engine', 'Blender', 'Photoshop', 'Illustrator', 'InDesign',
    'Dynamo', 'Python', 'Navisworks', 'ETABS', 'MS Project', 'Primavera'
  ].map(name => [name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name]);
  const DEGREES = [
    ['bachelor', 'کارشناسی', "Bachelor's"],
    ['master', 'کارشناسی ارشد', "Master's"],
    ['phd', 'دکتری', 'PhD']
  ];
  const MONTHS = {
    fa: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    en: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand']
  };
  const byKey = new Map(SPECIALTIES.map(([key, fa, en]) => [key, {key, fa, en}]));
  const lang = () => window.MelliI18n?.lang || document.documentElement.lang || 'fa';

  function specialtyLabel(key) {
    const item = byKey.get(key);
    return item ? item[lang() === 'en' ? 'en' : 'fa'] : '';
  }

  // Today's solar year and month, from the Persian calendar.
  function now() {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {year: 'numeric', month: 'numeric'}).formatToParts(new Date());
    const get = type => Number(parts.find(part => part.type === type)?.value);
    return {year: get('year'), month: get('month')};
  }

  // Months of work, with overlapping jobs counted once. A missing month counts
  // as Farvardin; a job without an end runs to this month.
  function experienceMonths(entries) {
    const today = now();
    const current = today.year * 12 + today.month - 1;
    const spans = (entries || [])
      .filter(entry => entry && entry.kind !== 'education' && Number.isInteger(Number(entry.from)) && entry.from)
      .map(entry => {
        const start = Number(entry.from) * 12 + (Number(entry.fromMonth) || 1) - 1;
        const end = entry.to ? Number(entry.to) * 12 + (Number(entry.toMonth) || 1) - 1 : current;
        return [start, Math.min(end, current)];
      })
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let reach = -Infinity;
    spans.forEach(([start, end]) => {
      if (end <= reach) return;
      total += end - Math.max(start, reach);
      reach = end;
    });
    return total;
  }

  function formatExperience(months) {
    const i18n = window.MelliI18n;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const num = value => (i18n ? i18n.num(value) : String(value));
    if (lang() === 'en') {
      const y = years ? `${years} ${years === 1 ? 'year' : 'years'}` : '';
      const m = rest ? `${rest} ${rest === 1 ? 'month' : 'months'}` : '';
      return [y, m].filter(Boolean).join(' ') || 'Under a month';
    }
    const y = years ? `${num(years)} سال` : '';
    const m = rest ? `${num(rest)} ماه` : '';
    return [y, m].filter(Boolean).join(' و ') || 'کمتر از یک ماه';
  }

  function monthName(month) {
    return month ? MONTHS[lang() === 'en' ? 'en' : 'fa'][Number(month) - 1] || '' : '';
  }

  const softwareByKey = new Map(SOFTWARE);
  const softwareLabel = key => softwareByKey.get(key) || '';
  const degreeByKey = new Map(DEGREES.map(([key, fa, en]) => [key, {fa, en}]));
  const degreeLabel = key => degreeByKey.get(key)?.[lang() === 'en' ? 'en' : 'fa'] || '';
  const higherDegree = key => key === 'master' || key === 'phd';

  // "City, Country" in either script; the last part is the country.
  function splitLocation(text) {
    const parts = String(text || '').split(/[،,]/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return {city: '', country: ''};
    return parts.length === 1 ? {city: '', country: parts[0]} : {city: parts[0], country: parts[parts.length - 1]};
  }

  const IRAN = new Set(['ایران', 'iran']);
  const inIran = country => IRAN.has(String(country).trim().toLowerCase());

  return {SPECIALTIES, SOFTWARE, DEGREES, specialtyLabel, softwareLabel, degreeLabel, higherDegree,
    experienceMonths, formatExperience, monthName, now, splitLocation, inIran};
})();
