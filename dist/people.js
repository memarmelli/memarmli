'use strict';

// Graduates as flat records, with the same filters the home page uses, for
// pages that work from the data rather than from the home page's frames.
window.MelliPeople = (() => {
  const {localize, href} = window.MelliI18n;
  const career = window.MelliCareer;

  // Lower-case, Latin digits, Persian ی and ک, no zero-width joiners.
  function searchText(value) {
    return String(value || '').toLowerCase()
      .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function all() {
    const people = [];
    (window.MELLI_COHORTS || []).filter(cohort => cohort.published).forEach(cohort => {
      (window.MELLI_STUDENTS?.[cohort.year] || []).forEach(raw => {
        const student = localize(raw);
        const place = career.splitLocation(student.location);
        people.push({
          year: cohort.year,
          suffix: raw.studentSuffix,
          name: student.name,
          href: href(`student.html?year=${cohort.year}&student=${raw.studentSuffix}`),
          experience: career.experienceMonths(student.resume?.entries),
          specialties: student.specialties || [],
          software: student.software || [],
          country: place.country,
          city: place.city,
          employer: student.employer || '',
          degree: student.degree || '',
          open: Boolean(student.openToWork),
          mentor: Boolean(student.mentoring),
          search: searchText([student.name, raw.name, raw.en?.name, raw.studentNumber].join(' '))
        });
      });
    });
    return people;
  }

  // The home page's URL parameters: q, specialty, software, country, city,
  // employer, degree, experience (years), open=1, mentor=1.
  function readFilters(params) {
    return {
      q: searchText(params.get('q') || ''),
      specialty: params.get('specialty') || '', software: params.get('software') || '',
      country: params.get('country') || '', city: params.get('city') || '',
      employer: params.get('employer') || '', degree: params.get('degree') || '',
      minimum: (Number(params.get('experience')) || 0) * 12,
      open: params.get('open') === '1', mentor: params.get('mentor') === '1'
    };
  }

  const active = f => Boolean(f.q || f.specialty || f.software || f.country || f.city || f.employer || f.degree || f.minimum || f.open || f.mentor);

  function matches(person, f) {
    return (!f.q || person.search.includes(f.q))
      && (!f.specialty || person.specialties.includes(f.specialty))
      && (!f.software || person.software.includes(f.software))
      && (!f.country || person.country === f.country)
      && (!f.city || person.city === f.city)
      && (!f.employer || person.employer === f.employer)
      && (!f.degree || person.degree === f.degree)
      && person.experience >= f.minimum
      && (!f.open || person.open) && (!f.mentor || person.mentor);
  }

  return {all, readFilters, active, matches, searchText};
})();
