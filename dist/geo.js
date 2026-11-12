'use strict';

// Coordinates for the globe. A graduate's location is written "City, Country"
// in Persian or English; the city is looked up first, then the country.
// Add a row here to place a city that is missing from the globe.
window.MelliGeo = (() => {
  // [Persian, English, country code, latitude, longitude]
  const CITIES = [
    ['تهران', 'Tehran', 'IR', 35.69, 51.39], ['اصفهان', 'Isfahan', 'IR', 32.65, 51.67], ['شیراز', 'Shiraz', 'IR', 29.59, 52.58],
    ['تبریز', 'Tabriz', 'IR', 38.08, 46.29], ['مشهد', 'Mashhad', 'IR', 36.3, 59.6], ['کرج', 'Karaj', 'IR', 35.84, 50.94],
    ['قم', 'Qom', 'IR', 34.64, 50.88], ['یزد', 'Yazd', 'IR', 31.9, 54.37], ['کرمان', 'Kerman', 'IR', 30.28, 57.08],
    ['رشت', 'Rasht', 'IR', 37.28, 49.58], ['اهواز', 'Ahvaz', 'IR', 31.32, 48.67], ['کیش', 'Kish', 'IR', 26.53, 53.98],
    ['کاشان', 'Kashan', 'IR', 33.98, 51.44], ['همدان', 'Hamedan', 'IR', 34.8, 48.52], ['ساری', 'Sari', 'IR', 36.56, 53.06],
    ['قزوین', 'Qazvin', 'IR', 36.27, 50], ['بندرعباس', 'Bandar Abbas', 'IR', 27.18, 56.27], ['ارومیه', 'Urmia', 'IR', 37.55, 45.08],
    ['کرمانشاه', 'Kermanshah', 'IR', 34.31, 47.07], ['زنجان', 'Zanjan', 'IR', 36.67, 48.48], ['سنندج', 'Sanandaj', 'IR', 35.31, 47],
    ['گرگان', 'Gorgan', 'IR', 36.84, 54.44], ['بوشهر', 'Bushehr', 'IR', 28.92, 50.84],
    ['برلین', 'Berlin', 'DE', 52.52, 13.4], ['مونیخ', 'Munich', 'DE', 48.14, 11.58], ['هامبورگ', 'Hamburg', 'DE', 53.55, 9.99],
    ['فرانکفورت', 'Frankfurt', 'DE', 50.11, 8.68], ['کلن', 'Cologne', 'DE', 50.94, 6.96], ['اشتوتگارت', 'Stuttgart', 'DE', 48.78, 9.18],
    ['دوسلدورف', 'Dusseldorf', 'DE', 51.23, 6.78], ['دارمشتات', 'Darmstadt', 'DE', 49.87, 8.65], ['آخن', 'Aachen', 'DE', 50.78, 6.08],
    ['لندن', 'London', 'GB', 51.51, -0.13], ['منچستر', 'Manchester', 'GB', 53.48, -2.24], ['ادینبرو', 'Edinburgh', 'GB', 55.95, -3.19],
    ['کمبریج', 'Cambridge', 'GB', 52.21, 0.12], ['آکسفورد', 'Oxford', 'GB', 51.75, -1.26],
    ['میلان', 'Milan', 'IT', 45.46, 9.19], ['رم', 'Rome', 'IT', 41.9, 12.5], ['تورین', 'Turin', 'IT', 45.07, 7.69],
    ['فلورانس', 'Florence', 'IT', 43.77, 11.26], ['ونیز', 'Venice', 'IT', 45.44, 12.32],
    ['پاریس', 'Paris', 'FR', 48.86, 2.35], ['لیون', 'Lyon', 'FR', 45.76, 4.84],
    ['آمستردام', 'Amsterdam', 'NL', 52.37, 4.9], ['روتردام', 'Rotterdam', 'NL', 51.92, 4.48], ['دلفت', 'Delft', 'NL', 52.01, 4.36],
    ['آیندهوون', 'Eindhoven', 'NL', 51.44, 5.47], ['زوریخ', 'Zurich', 'CH', 47.38, 8.54], ['ژنو', 'Geneva', 'CH', 46.2, 6.14],
    ['لوزان', 'Lausanne', 'CH', 46.52, 6.63], ['وین', 'Vienna', 'AT', 48.21, 16.37], ['گراتس', 'Graz', 'AT', 47.07, 15.44],
    ['استکهلم', 'Stockholm', 'SE', 59.33, 18.07], ['گوتنبرگ', 'Gothenburg', 'SE', 57.71, 11.97], ['کپنهاگ', 'Copenhagen', 'DK', 55.68, 12.57],
    ['اسلو', 'Oslo', 'NO', 59.91, 10.75], ['هلسینکی', 'Helsinki', 'FI', 60.17, 24.94], ['مادرید', 'Madrid', 'ES', 40.42, -3.7],
    ['بارسلونا', 'Barcelona', 'ES', 41.39, 2.17], ['لیسبون', 'Lisbon', 'PT', 38.72, -9.14], ['پورتو', 'Porto', 'PT', 41.15, -8.61],
    ['بروکسل', 'Brussels', 'BE', 50.85, 4.35], ['استانبول', 'Istanbul', 'TR', 41.01, 28.98], ['آنکارا', 'Ankara', 'TR', 39.93, 32.86],
    ['ازمیر', 'Izmir', 'TR', 38.42, 27.14], ['دبی', 'Dubai', 'AE', 25.2, 55.27], ['ابوظبی', 'Abu Dhabi', 'AE', 24.45, 54.38],
    ['دوحه', 'Doha', 'QA', 25.29, 51.53], ['مسقط', 'Muscat', 'OM', 23.59, 58.38],
    ['تورنتو', 'Toronto', 'CA', 43.65, -79.38], ['ونکوور', 'Vancouver', 'CA', 49.28, -123.12], ['مونترال', 'Montreal', 'CA', 45.5, -73.57],
    ['اتاوا', 'Ottawa', 'CA', 45.42, -75.7], ['کلگری', 'Calgary', 'CA', 51.05, -114.07], ['ادمونتون', 'Edmonton', 'CA', 53.55, -113.49],
    ['واترلو', 'Waterloo', 'CA', 43.46, -80.52],
    ['نیویورک', 'New York', 'US', 40.71, -74.01], ['لس‌آنجلس', 'Los Angeles', 'US', 34.05, -118.24], ['سان‌فرانسیسکو', 'San Francisco', 'US', 37.77, -122.42],
    ['بوستون', 'Boston', 'US', 42.36, -71.06], ['شیکاگو', 'Chicago', 'US', 41.88, -87.63], ['سیاتل', 'Seattle', 'US', 47.61, -122.33],
    ['هیوستون', 'Houston', 'US', 29.76, -95.37], ['واشنگتن', 'Washington', 'US', 38.91, -77.04], ['سن‌خوزه', 'San Jose', 'US', 37.34, -121.89],
    ['دالاس', 'Dallas', 'US', 32.78, -96.8], ['میامی', 'Miami', 'US', 25.76, -80.19], ['آتلانتا', 'Atlanta', 'US', 33.75, -84.39],
    ['فیلادلفیا', 'Philadelphia', 'US', 39.95, -75.17], ['آستین', 'Austin', 'US', 30.27, -97.74],
    ['سیدنی', 'Sydney', 'AU', -33.87, 151.21], ['ملبورن', 'Melbourne', 'AU', -37.81, 144.96], ['بریزبن', 'Brisbane', 'AU', -27.47, 153.03],
    ['پرت', 'Perth', 'AU', -31.95, 115.86], ['اوکلند', 'Auckland', 'NZ', -36.85, 174.76],
    ['توکیو', 'Tokyo', 'JP', 35.68, 139.69], ['سنگاپور', 'Singapore', 'SG', 1.35, 103.82], ['کوالالامپور', 'Kuala Lumpur', 'MY', 3.14, 101.69],
    ['هنگ‌کنگ', 'Hong Kong', 'HK', 22.32, 114.17], ['شانگهای', 'Shanghai', 'CN', 31.23, 121.47], ['پکن', 'Beijing', 'CN', 39.9, 116.41],
    ['سئول', 'Seoul', 'KR', 37.57, 126.98], ['ایروان', 'Yerevan', 'AM', 40.18, 44.51], ['تفلیس', 'Tbilisi', 'GE', 41.72, 44.79],
    ['باکو', 'Baku', 'AZ', 40.41, 49.87], ['کابل', 'Kabul', 'AF', 34.56, 69.21], ['هرات', 'Herat', 'AF', 34.35, 62.2],
    ['بغداد', 'Baghdad', 'IQ', 33.32, 44.36], ['قاهره', 'Cairo', 'EG', 30.04, 31.24]
  ];
  // [code, Persian names, English names, latitude, longitude]
  const COUNTRIES = [
    ['IR', ['ایران'], ['Iran'], 32.4, 53.7], ['DE', ['آلمان'], ['Germany'], 51.2, 10.4],
    ['GB', ['بریتانیا', 'انگلستان', 'انگلیس'], ['United Kingdom', 'UK', 'England', 'Britain'], 54, -2],
    ['IT', ['ایتالیا'], ['Italy'], 42.8, 12.6], ['FR', ['فرانسه'], ['France'], 46.6, 2.2], ['NL', ['هلند'], ['Netherlands', 'Holland'], 52.1, 5.3],
    ['CH', ['سوئیس'], ['Switzerland'], 46.8, 8.2], ['AT', ['اتریش'], ['Austria'], 47.5, 14.6], ['SE', ['سوئد'], ['Sweden'], 60.1, 18.6],
    ['DK', ['دانمارک'], ['Denmark'], 56.3, 9.5], ['NO', ['نروژ'], ['Norway'], 60.5, 8.5], ['FI', ['فنلاند'], ['Finland'], 61.9, 25.7],
    ['ES', ['اسپانیا'], ['Spain'], 40.5, -3.7], ['PT', ['پرتغال'], ['Portugal'], 39.4, -8.2], ['BE', ['بلژیک'], ['Belgium'], 50.5, 4.5],
    ['TR', ['ترکیه'], ['Turkey', 'Türkiye'], 39, 35], ['AE', ['امارات', 'امارات متحده‌ی عربی'], ['UAE', 'United Arab Emirates'], 24, 54],
    ['QA', ['قطر'], ['Qatar'], 25.3, 51.2], ['OM', ['عمان'], ['Oman'], 21.5, 55.9], ['CA', ['کانادا'], ['Canada'], 56, -106],
    ['US', ['آمریکا', 'ایالات متحده'], ['USA', 'US', 'United States', 'America'], 39.8, -98.6], ['AU', ['استرالیا'], ['Australia'], -25.3, 133.8],
    ['NZ', ['نیوزیلند'], ['New Zealand'], -41, 174], ['JP', ['ژاپن'], ['Japan'], 36.2, 138.3], ['SG', ['سنگاپور'], ['Singapore'], 1.35, 103.8],
    ['MY', ['مالزی'], ['Malaysia'], 4.2, 102], ['CN', ['چین'], ['China'], 35.9, 104.2], ['HK', ['هنگ‌کنگ'], ['Hong Kong'], 22.3, 114.2],
    ['KR', ['کره‌ی جنوبی', 'کره جنوبی'], ['South Korea', 'Korea'], 36.5, 127.8], ['AM', ['ارمنستان'], ['Armenia'], 40.1, 45],
    ['GE', ['گرجستان'], ['Georgia'], 42.3, 43.4], ['AZ', ['آذربایجان'], ['Azerbaijan'], 40.1, 47.6], ['AF', ['افغانستان'], ['Afghanistan'], 33.9, 67.7],
    ['IQ', ['عراق'], ['Iraq'], 33.2, 43.7], ['EG', ['مصر'], ['Egypt'], 26.8, 30.8], ['IN', ['هند'], ['India'], 20.6, 79]
  ];

  // Same key however a name is typed: case, ZWNJ, spaces, hyphens, Arabic ی and ک, accents.
  const key = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌\-‌.]/g, '');
  const cities = new Map();
  CITIES.forEach(([fa, en, country, lat, lon]) => {
    [fa, en].forEach(name => cities.set(key(name), {country, lat, lon}));
  });
  const countries = new Map();
  COUNTRIES.forEach(([code, faNames, enNames, lat, lon]) => {
    [...faNames, ...enNames].forEach(name => countries.set(key(name), {code, lat, lon}));
  });

  // {lat, lon, exact} or null. exact is false when only the country is known.
  function locate(city, country) {
    const place = cities.get(key(city));
    if (place) return {lat: place.lat, lon: place.lon, exact: true};
    const land = countries.get(key(country)) || countries.get(key(city));
    return land ? {lat: land.lat, lon: land.lon, exact: false} : null;
  }

  return {locate};
})();
