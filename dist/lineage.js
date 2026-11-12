'use strict';

// Lineage: a graduate whose student number ends in the same two digits and who
// entered in the previous intake is your lineage father or mother.
window.MelliLineage = (() => {
  const years = (window.MELLI_COHORTS || []).filter(cohort => cohort.published).map(cohort => cohort.year).sort((a, b) => a - b);
  const students = window.MELLI_STUDENTS || {};
  const faDigits = '۰۱۲۳۴۵۶۷۸۹';

  function normalizeDigits(value) {
    return String(value).trim()
      .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660));
  }

  function toFa(value) {
    return String(value).replace(/\d/g, digit => faDigits[digit]);
  }

  function find(year, suffix) {
    return (students[year] || []).find(student => student.studentSuffix === suffix);
  }

  const previousYear = year => years.filter(item => item < year).pop();
  const nextYear = year => years.find(item => item > year);

  // Numbers start with the intake year: 99… is 1399, 401… is 1401.
  function parseNumber(digits) {
    const year = digits[0] === '4' ? 1000 + Number(digits.slice(0, 3)) : 1300 + Number(digits.slice(0, 2));
    return {year, suffix: digits.slice(-2), student: null};
  }

  function locate(raw) {
    const digits = normalizeDigits(raw).replace(/\D/g, '');
    if (digits.length < 6) return null;
    for (const year of years) {
      const student = (students[year] || []).find(item => item.studentNumber === digits);
      if (student) return {year, suffix: student.studentSuffix, student};
    }
    return parseNumber(digits);
  }

  // Every graduate with the same two digits in earlier intakes, nearest first,
  // back to the first generation. An intake without that number is skipped
  // and the chain continues to the next earlier one that has it.
  function ancestors(year, suffix) {
    const chain = [];
    for (let item = previousYear(year); item !== undefined; item = previousYear(item)) {
      const student = find(item, suffix);
      if (student) chain.push({year: item, student});
    }
    return chain;
  }

  // The same for later intakes, nearest first.
  function descendants(year, suffix) {
    const chain = [];
    for (let item = nextYear(year); item !== undefined; item = nextYear(item)) {
      const student = find(item, suffix);
      if (student) chain.push({year: item, student});
    }
    return chain;
  }

  const child = (year, suffix) => descendants(year, suffix)[0] || null;

  // Label for a relative, from the gap in intake years: positive for
  // ancestors, negative for descendants.
  function relation(distance) {
    const {t, num} = window.MelliI18n;
    if (distance === 0) return t('rel.self');
    if (distance === 1) return t('rel.parent');
    if (distance === -1) return t('rel.child');
    return t(distance > 0 ? 'rel.before' : 'rel.after', {n: num(Math.abs(distance))});
  }

  return {normalizeDigits, toFa, locate, ancestors, descendants, child, relation, previousYear};
})();
