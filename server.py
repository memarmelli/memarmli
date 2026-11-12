"""Melli Architect: public site plus a code-protected admin for adding graduates.

Python standard library only. Run:

    python server.py                 # serve on http://127.0.0.1:4173
    python server.py --port 8080 --host 0.0.0.0
    python server.py --new-code      # replace the admin code and exit

The public site is the static folder dist/. Every save rewrites dist/data.js,
so dist/ can also be uploaded to a static host after editing. The admin pages
(admin/) and the API (/api/...) only exist while this server runs.

Data lives in data/site.json. The admin code is stored only as a salted hash
in data/admin.json; when a code is created it is printed once and written to
data/ADMIN-CODE.txt, which you should move somewhere safe and delete.

Telegram bot: when .env (here or one folder up) sets BOT_SYNC_URL and
BOT_SYNC_SECRET, a background loop pushes the profile list to the bot's
Cloudflare Worker (bot/) and pulls back Telegram links, contact settings,
pending self-edits and join requests. HTTPS_PROXY is honoured for that link.
"""

import argparse
import hashlib
import hmac
import html
import http.server
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from urllib.parse import urlparse, unquote, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
ADMIN = os.path.join(ROOT, 'admin')
DATA = os.environ.get('MELLI_DATA_DIR') or os.path.join(ROOT, 'data')
SITE_FILE = os.path.join(DATA, 'site.json')
ADMIN_FILE = os.path.join(DATA, 'admin.json')
CODE_FILE = os.path.join(DATA, 'ADMIN-CODE.txt')
UPLOADS = os.path.join(DIST, 'uploads')
DATA_JS = os.path.join(DIST, 'data.js')
BOT_STATE_FILE = os.path.join(DATA, 'bot-state.json')
LOG_FILE = os.path.join(DATA, 'log.jsonl')

CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
PBKDF2_ROUNDS = 240_000
SESSION_SECONDS = 12 * 3600
SESSION_COOKIE = 'melli_admin'
MAX_JSON = 1_000_000
MAX_UPLOAD = 12_000_000
LOCK_AFTER = 5
LOCK_SECONDS = 15 * 60
UPLOAD_TYPES = {
    'image/jpeg': ('jpg', (b'\xff\xd8\xff',)),
    'image/png': ('png', (b'\x89PNG\r\n\x1a\n',)),
    'image/webp': ('webp', (b'RIFF',)),
    'application/pdf': ('pdf', (b'%PDF-',)),
}
UPLOAD_PATH = re.compile(r'^uploads/[a-f0-9]{24}\.(jpg|png|webp|pdf)$')
SPECIALTY_KEY = re.compile(r'^[a-z0-9-]{1,40}$')
LINKEDIN = re.compile(r'^https://([a-z]{2,3}\.)?linkedin\.com/[^\s]*$', re.I)
WEB_URL = re.compile(r'^https?://[^\s]+$', re.I)
TELEGRAM_USERNAME = re.compile(r'^@?([A-Za-z][A-Za-z0-9_]{4,31})$')

data_lock = threading.Lock()
sessions = {}          # token -> expiry timestamp
failures = {}          # ip -> [count, first failure time, locked until]


# ---------------------------------------------------------------- admin code

def new_code():
    raw = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(16))
    return '-'.join(raw[i:i + 4] for i in range(0, 16, 4))


def normalize_code(value):
    return re.sub(r'[\s-]', '', str(value)).upper()


def hash_code(code, salt):
    return hashlib.pbkdf2_hmac('sha256', normalize_code(code).encode(), salt, PBKDF2_ROUNDS).hex()


def create_admin_code():
    os.makedirs(DATA, exist_ok=True)
    code = new_code()
    salt = secrets.token_bytes(16)
    write_json(ADMIN_FILE, {'salt': salt.hex(), 'hash': hash_code(code, salt), 'createdAt': now()})
    with open(CODE_FILE, 'w', encoding='utf-8') as handle:
        handle.write(f'Melli Architect admin code (created {now()}):\n\n{code}\n\n'
                     'Keep it somewhere safe, then delete this file. '
                     'Run "python server.py --new-code" to replace it.\n')
    sessions.clear()
    return code


def check_code(code):
    with open(ADMIN_FILE, encoding='utf-8') as handle:
        stored = json.load(handle)
    return hmac.compare_digest(hash_code(code, bytes.fromhex(stored['salt'])), stored['hash'])


# ---------------------------------------------------------------- storage

def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_json(path, value):
    temp = f'{path}.tmp'
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=1)
    os.replace(temp, path)


def load_site():
    if not os.path.exists(SITE_FILE):
        return {'version': 1, 'cohorts': {}, 'students': []}
    with open(SITE_FILE, encoding='utf-8') as handle:
        return json.load(handle)


def save_site(site):
    write_json(SITE_FILE, site)
    write_public_data(site)


def compact(value):
    """Drop empty strings, lists and objects so English fields never blank out Persian ones."""
    if isinstance(value, dict):
        result = {key: compact(item) for key, item in value.items()}
        return {key: item for key, item in result.items() if item not in ('', None, [], {})}
    if isinstance(value, list):
        return [item for item in (compact(entry) for entry in value) if item not in ('', None, [], {})]
    return value


def write_public_data(site):
    """dist/data.js holds only published graduates and the intakes they belong to."""
    students, years = {}, set()
    open_to_messages = contactable() if bot_configured() else set()
    for record in site['students']:
        if not record.get('published'):
            continue
        public = compact({key: value for key, value in record.items() if key not in ('id', 'published', 'updatedAt', 'createdAt', 'telegram')})
        public['studentSuffix'] = record['studentNumber'][-2:]
        # The Contact button opens the bot with this key; the Telegram account itself never leaves the server.
        if record['id'] in open_to_messages:
            public['contact'] = f'https://t.me/{BOT_USERNAME}?start=c_{record["id"]}'
        students.setdefault(str(record['year']), []).append(public)
        years.add(record['year'])
    cohorts = []
    for year in sorted(years, reverse=True):
        meta = site['cohorts'].get(str(year), {})
        cohorts.append(compact({'year': year, 'published': True, 'graduatedAt': meta.get('graduatedAt'), 'image': meta.get('image')}))
    for group in students.values():
        group.sort(key=lambda item: item['studentSuffix'])
    body = (
        '// Generated by server.py from data/site.json. Do not edit by hand.\n'
        f'window.MELLI_COHORTS = {json.dumps(cohorts, ensure_ascii=False)};\n'
        f'window.MELLI_STUDENTS = {json.dumps(students, ensure_ascii=False)};\n'
    )
    temp = f'{DATA_JS}.tmp'
    with open(temp, 'w', encoding='utf-8') as handle:
        handle.write(body)
    os.replace(temp, DATA_JS)


# ---------------------------------------------------------------- settings and activity log

def load_env():
    """KEY=value lines from .env here and one folder up; real environment variables win."""
    values = {}
    for path in (os.path.join(ROOT, '..', '.env'), os.path.join(ROOT, '.env')):
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as handle:
            for line in handle:
                match = re.match(r'\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$', line)
                if match:
                    values[match.group(1)] = match.group(2).strip()
    values.update({key: value for key, value in os.environ.items() if key.startswith(('BOT_', 'MELLI_'))})
    return values


ENV = load_env()
BOT_URL = ENV.get('BOT_SYNC_URL', '').rstrip('/')
BOT_SECRET = ENV.get('BOT_SYNC_SECRET', '')
BOT_USERNAME = ENV.get('BOT_USERNAME', 'memar_mli_bot')
# The public address, for absolute links in previews; without it the request's Host is used.
SITE_URL = ENV.get('MELLI_SITE_URL', '').rstrip('/')


def log(action, record=None, actor='admin', detail=''):
    entry = {'at': now(), 'actor': actor, 'action': action, 'detail': str(detail)[:300]}
    if record:
        entry.update({'studentId': record.get('id'), 'name': record.get('name')})
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError:
        pass


def read_log(limit=200):
    if not os.path.exists(LOG_FILE):
        return []
    with open(LOG_FILE, encoding='utf-8') as handle:
        lines = handle.readlines()[-limit:]
    return [json.loads(line) for line in reversed(lines) if line.strip()]


# ---------------------------------------------------------------- Telegram bot sync

class BotError(Exception):
    pass


def bot_configured():
    return bool(BOT_URL and BOT_SECRET)


def bot_request(method, path, payload=None, raw=False, timeout=25):
    if not bot_configured():
        raise BotError('the bot is not configured; set BOT_SYNC_URL and BOT_SYNC_SECRET in .env')
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = urllib.request.Request(BOT_URL + path, data=data, method=method, headers={
        'Authorization': f'Bearer {BOT_SECRET}', 'Content-Type': 'application/json', 'User-Agent': 'MelliArchitect/1'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            return body if raw else json.loads(body or b'{}')
    except urllib.error.HTTPError as error:
        detail = error.read()[:200].decode('utf-8', 'replace')
        raise BotError(f'bot answered {error.code}: {detail}') from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise BotError(f'cannot reach the bot: {error}') from None


def load_bot_state():
    if not os.path.exists(BOT_STATE_FILE):
        return {'links': [], 'edits': [], 'joinRequests': [], 'conversations': 0}
    with open(BOT_STATE_FILE, encoding='utf-8') as handle:
        return json.load(handle)


def contactable(state=None):
    state = state or load_bot_state()
    return {link['profileId'] for link in state.get('links', []) if link.get('acceptsMessages')}


def invite_hash(record):
    token = (record.get('telegram') or {}).get('invite')
    return hashlib.sha256(token.encode()).hexdigest() if token else None


def bot_profiles(site):
    profiles = []
    for record in site['students']:
        en = record.get('en') or {}
        resume = record.get('resume') or {}
        profiles.append({
            'id': record['id'], 'name': record['name'], 'nameEn': en.get('name') or '', 'year': record['year'],
            'studentNumber': record['studentNumber'], 'published': bool(record.get('published')),
            'telegramUsername': (record.get('telegram') or {}).get('username') or None, 'inviteHash': invite_hash(record),
            'card': {
                'nameEn': en.get('name') or '', 'location': record.get('location') or '', 'occupation': record.get('occupation') or '',
                'employer': record.get('employer') or '', 'linkedin': record.get('linkedin') or '',
                'summary': resume.get('summary') or '', 'memory': '\n\n'.join(record.get('memory') or [])[:2000],
                'openToWork': bool(record.get('openToWork')), 'mentoring': bool(record.get('mentoring')),
                'hasPhoto': bool(record.get('image')), 'hasResume': bool(resume.get('file')),
            },
        })
    return profiles


sync_status = {'syncedAt': None, 'error': None}
sync_wake = threading.Event()


def sync_bot():
    """Push every profile to the bot and keep its answer; rewrite data.js if Contact buttons changed."""
    with data_lock:
        profiles = bot_profiles(load_site())
    try:
        state = bot_request('POST', '/sync/profiles', {'profiles': profiles})
    except BotError as error:
        sync_status['error'] = str(error)
        raise
    with data_lock:
        before = contactable()
        write_json(BOT_STATE_FILE, state)
        sync_status.update({'syncedAt': now(), 'error': None})
        if contactable(state) != before:
            write_public_data(load_site())
    return state


def sync_loop():
    while True:
        try:
            sync_bot()
        except BotError:
            pass
        sync_wake.wait(60)
        sync_wake.clear()


def request_sync():
    if bot_configured():
        sync_wake.set()


# ---------------------------------------------------------------- validation

class Invalid(ValueError):
    pass


def text(value, limit=400, required=False, label='field'):
    value = '' if value is None else str(value).strip()
    if required and not value:
        raise Invalid(f'{label} is required')
    if len(value) > limit:
        raise Invalid(f'{label} is too long')
    return value


def year_value(value, label, required=False):
    if value in (None, ''):
        if required:
            raise Invalid(f'{label} is required')
        return None
    try:
        year = int(str(value).strip())
    except ValueError:
        raise Invalid(f'{label} must be a year') from None
    if not 1300 <= year <= 1500:
        raise Invalid(f'{label} must be a solar year between 1300 and 1500')
    return year


def upload_path(value, label):
    value = text(value, 80)
    if value and not UPLOAD_PATH.match(value):
        raise Invalid(f'{label} must be a file uploaded here')
    return value


def paragraphs(value):
    if isinstance(value, list):
        value = '\n\n'.join(str(item) for item in value)
    value = text(value, 12000)
    return [part.strip() for part in re.split(r'\n\s*\n', value) if part.strip()]


def month_value(value, label):
    if value in (None, ''):
        return None
    try:
        month = int(str(value).strip())
    except ValueError:
        raise Invalid(f'{label} must be a month from 1 to 12') from None
    if not 1 <= month <= 12:
        raise Invalid(f'{label} must be a month from 1 to 12')
    return month


def year_from_number(number):
    return 1000 + int(number[:3]) if number[0] == '4' else 1300 + int(number[:2])


def clean_telegram(body, old=None):
    username = text((body.get('telegram') or {}).get('username'), 40)
    if username:
        match = TELEGRAM_USERNAME.match(username)
        if not match:
            raise Invalid('Telegram username must be 5 to 32 letters, digits or underscores')
        username = match.group(1)
    telegram = {'username': username, 'invite': ((old or {}).get('telegram') or {}).get('invite') or ''}
    return compact(telegram)


def clean_student(body, site, existing_id=None):
    number = re.sub(r'\D', '', str(body.get('studentNumber', '')).translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')))
    if not 6 <= len(number) <= 12:
        raise Invalid('student number must have 6 to 12 digits')
    if any(item['studentNumber'] == number and item['id'] != existing_id for item in site['students']):
        raise Invalid('another graduate already has this student number')
    year = year_value(body.get('year'), 'intake year') or year_value(year_from_number(number), 'intake year')
    linkedin = text(body.get('linkedin'), 300)
    if linkedin and not LINKEDIN.match(linkedin):
        raise Invalid('LinkedIn link must start with https://www.linkedin.com/')

    en = body.get('en') or {}
    # English rows share years, links and images with the Persian rows; an
    # English field left empty falls back to the Persian text.
    entries, entries_en = [], []
    rows = (body.get('resume') or {}).get('entries') or []
    for row in rows:
        start = year_value(row.get('from'), 'résumé start year', required=True)
        end = year_value(row.get('to'), 'résumé end year')
        when = {'kind': 'education' if row.get('kind') == 'education' else 'work',
                'from': start, 'fromMonth': month_value(row.get('fromMonth'), 'résumé start month'),
                'to': end, 'toMonth': month_value(row.get('toMonth'), 'résumé end month') if end else None}
        title, place = text(row.get('title'), 200, True, 'résumé title'), text(row.get('place'), 200)
        entries.append({**when, 'title': title, 'place': place})
        entries_en.append({**when, 'title': text(row.get('titleEn'), 200) or title, 'place': text(row.get('placeEn'), 200) or place})
    has_entries_en = any(text(row.get('titleEn'), 200) for row in rows)
    portfolio, portfolio_en = [], []
    rows = body.get('portfolio') or []
    for row in rows:
        url = text(row.get('url'), 400)
        if url and not WEB_URL.match(url):
            raise Invalid('portfolio links must start with http:// or https://')
        shared = {'year': year_value(row.get('year'), 'portfolio year'), 'url': url, 'image': upload_path(row.get('image'), 'portfolio image')}
        title, kind = text(row.get('title'), 200, True, 'portfolio title'), text(row.get('kind'), 80)
        portfolio.append({**shared, 'title': title, 'kind': kind})
        portfolio_en.append({**shared, 'title': text(row.get('titleEn'), 200) or title, 'kind': text(row.get('kindEn'), 80) or kind})
    has_portfolio_en = any(text(row.get('titleEn'), 200) for row in rows)
    resume = body.get('resume') or {}
    resume_en = en.get('resume') or {}
    degree = body.get('degree') if body.get('degree') in ('bachelor', 'master', 'phd') else ''
    return {
        'studentNumber': number,
        'year': year,
        'published': bool(body.get('published')),
        'name': text(body.get('name'), 120, True, 'name'),
        'location': text(body.get('location'), 160),
        'occupation': text(body.get('occupation'), 200),
        'linkedin': linkedin,
        'specialties': list(dict.fromkeys(key for key in (body.get('specialties') or [])[:16] if isinstance(key, str) and SPECIALTY_KEY.match(key))),
        'software': list(dict.fromkeys(key for key in (body.get('software') or [])[:30] if isinstance(key, str) and SPECIALTY_KEY.match(key))),
        'employer': text(body.get('employer'), 200),
        'openToWork': bool(body.get('openToWork')),
        'mentoring': bool(body.get('mentoring')),
        'degree': degree,
        'degreeField': text(body.get('degreeField'), 160),
        'degreePlace': text(body.get('degreePlace'), 200),
        'thesis': text(body.get('thesis'), 400) if degree in ('master', 'phd') else '',
        'image': upload_path(body.get('image'), 'photo'),
        'thumb': upload_path(body.get('thumb'), 'thumbnail') if body.get('image') else '',
        'hideFromSearch': bool(body.get('hideFromSearch')),
        'resume': {'summary': text(resume.get('summary'), 4000), 'file': upload_path(resume.get('file'), 'résumé file'), 'entries': entries},
        'portfolio': portfolio,
        'memory': paragraphs(body.get('memory')),
        'en': {
            'name': text(en.get('name'), 120),
            'location': text(en.get('location'), 160),
            'occupation': text(en.get('occupation'), 200),
            'employer': text(en.get('employer'), 200),
            'degreeField': text(en.get('degreeField'), 160),
            'degreePlace': text(en.get('degreePlace'), 200),
            'thesis': text(en.get('thesis'), 400) if degree in ('master', 'phd') else '',
            'resume': {'summary': text(resume_en.get('summary'), 4000),
                       'entries': entries_en if has_entries_en else []},
            'portfolio': portfolio_en if has_portfolio_en else [],
            'memory': paragraphs(en.get('memory')),
        },
    }


# ---------------------------------------------------------------- applying bot self-edits

EDIT_FIELDS = {'name', 'nameEn', 'location', 'occupation', 'employer', 'linkedin', 'summary', 'memory',
               'photo', 'resumeFile', 'openToWork', 'mentoring', 'note'}


def current_value(record, field):
    en = record.get('en') or {}
    resume = record.get('resume') or {}
    return {
        'name': record.get('name'), 'nameEn': en.get('name'), 'location': record.get('location'),
        'occupation': record.get('occupation'), 'employer': record.get('employer'), 'linkedin': record.get('linkedin'),
        'summary': resume.get('summary'), 'memory': '\n\n'.join(record.get('memory') or []),
        'photo': record.get('image'), 'resumeFile': resume.get('file'),
        'openToWork': bool(record.get('openToWork')), 'mentoring': bool(record.get('mentoring')),
    }.get(field)


def import_bot_file(edit):
    """Fetch a photo or PDF the graduate sent to the bot and store it like an admin upload."""
    body = bot_request('GET', f'/sync/edits/{edit["id"]}/file', raw=True, timeout=60)
    kind = 'application/pdf' if edit['field'] == 'resumeFile' else (edit.get('mime') or 'image/jpeg')
    if kind not in UPLOAD_TYPES or len(body) > MAX_UPLOAD:
        raise Invalid('the file from the bot is not an accepted type or is too large')
    extension, signatures = UPLOAD_TYPES[kind]
    if not body.startswith(signatures):
        raise Invalid('the file from the bot does not match its type')
    os.makedirs(UPLOADS, exist_ok=True)
    name = f'{secrets.token_hex(12)}.{extension}'
    with open(os.path.join(UPLOADS, name), 'wb') as handle:
        handle.write(body)
    return f'uploads/{name}'


def apply_edit(record, edit, file_path=None):
    field, value = edit['field'], edit.get('value')
    if field not in EDIT_FIELDS:
        raise Invalid('unknown field')
    record.setdefault('en', {})
    record.setdefault('resume', {})
    if field == 'name':
        record['name'] = text(value, 120, True, 'name')
    elif field == 'nameEn':
        record['en']['name'] = text(value, 120)
    elif field in ('location', 'occupation', 'employer'):
        record[field] = text(value, 200)
    elif field == 'linkedin':
        link = text(value, 300)
        if link and not LINKEDIN.match(link):
            raise Invalid('LinkedIn link must start with https://www.linkedin.com/')
        record['linkedin'] = link
    elif field == 'summary':
        record['resume']['summary'] = text(value, 4000)
    elif field == 'memory':
        record['memory'] = paragraphs(value)
    elif field in ('openToWork', 'mentoring'):
        record[field] = bool(value)
    elif field == 'photo':
        record['image'] = file_path
        # The admin page makes a new thumbnail the next time it opens.
        record.pop('thumb', None)
    elif field == 'resumeFile':
        record['resume']['file'] = file_path
    # 'note' is a message to the admins; approving it only marks it read.


# ---------------------------------------------------------------- HTTP

PAGES = {'/': 'index.html', '/index.html': 'index.html', '/student.html': 'student.html', '/stats.html': 'stats.html'}
PREVIEW = {
    'fa': {'site': 'معمار ملی', 'title': 'معمار ملی، دانش‌آموختگان معماری',
           'description': 'آرشیو دانش‌آموختگان معماری دانشگاه ملی (شهید بهشتی).',
           'student': '{name}، ورودی {year}', 'lineage': 'نسل {name}', 'lineageAnon': 'نسل من',
           'lineageText': 'دانش‌آموختگان معماری دانشگاه ملی با دو رقم پایانی یکسان در شماره‌ی دانشجویی، از ورودی‌های پیشین تا تازه‌ترین ورودی.',
           'stats': 'آمار دانش‌آموختگان', 'statsText': 'محل زندگی و کار، تخصص‌ها و نرم‌افزارهای دانش‌آموختگان معماری دانشگاه ملی.'},
    'en': {'site': 'Melli Architect', 'title': 'Melli Architect, architecture graduates',
           'description': 'The archive of architecture graduates of the National University (Shahid Beheshti).',
           'student': '{name}, intake {year}', 'lineage': "{name}'s lineage", 'lineageAnon': 'My lineage',
           'lineageText': 'Architecture graduates of the National University whose student numbers end in the same two digits, intake after intake.',
           'stats': 'Graduates in numbers', 'statsText': 'Where the graduates of the National University live and work, and the specialties and software they use.'},
}


def persian_digits(value):
    return str(value).translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹'))


def preview_tags(name, query, site, origin, url):
    """Open Graph tags for a page: a graduate's photo and name, a lineage, or the site itself."""
    lang = 'en' if query.get('lang') == 'en' else 'fa'
    words = PREVIEW[lang]
    year_text = (lambda value: str(value)) if lang == 'en' else persian_digits
    published = [record for record in site['students'] if record.get('published')]
    local = lambda record, key: ((record.get('en') or {}).get(key) if lang == 'en' else None) or record.get(key) or ''
    title, description, image, robots, kind = words['title'], words['description'], 'assets/og-cover.png', False, 'website'
    if name == 'student.html':
        record = next((item for item in published if str(item['year']) == query.get('year', '')
                       and item['studentNumber'][-2:] == query.get('student', '')), None)
        if record:
            title = words['student'].format(name=local(record, 'name'), year=year_text(record['year']))
            description = '، '.join(part for part in (local(record, 'occupation'), local(record, 'location')) if part) if lang == 'fa' \
                else ', '.join(part for part in (local(record, 'occupation'), local(record, 'location')) if part)
            description = description or words['description']
            image = record.get('image') or image
            robots = bool(record.get('hideFromSearch'))
            kind = 'profile'
    elif name == 'index.html' and query.get('lineage'):
        number = re.sub(r'\D', '', query['lineage'])
        record = next((item for item in published if item['studentNumber'] == number), None)
        title = words['lineage'].format(name=local(record, 'name')) if record else words['lineageAnon']
        description = words['lineageText']
    elif name == 'stats.html':
        title, description = words['stats'], words['statsText']
    absolute = lambda path: f'{origin}/{path.lstrip("/")}' if origin else path
    page_url = absolute(url.path + (f'?{url.query}' if url.query else ''))
    tags = {
        'og:site_name': words['site'], 'og:type': kind, 'og:title': title, 'og:description': description,
        'og:image': absolute(image), 'og:url': page_url, 'og:locale': 'en_US' if lang == 'en' else 'fa_IR',
        'twitter:card': 'summary_large_image' if image.endswith('og-cover.png') else 'summary',
    }
    lines = [f'  <meta property="{key}" content="{html.escape(value, quote=True)}">' for key, value in tags.items()]
    if robots:
        lines.append('  <meta name="robots" content="noindex">')
    return '\n'.join(lines)


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = 'MelliArchitect'
    sys_version = ''
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                      '.woff2': 'font/woff2', '.webp': 'image/webp', '.json': 'application/json'}

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def log_message(self, format, *args):
        sys.stderr.write(f'{self.address_string()} {format % args}\n')

    # Static files: /admin/... from admin/, everything else from dist/.
    def translate_path(self, path):
        path = unquote(urlparse(path).path)
        base = DIST
        if path == '/admin' or path.startswith('/admin/'):
            base, path = ADMIN, path[len('/admin'):]
        parts = [part for part in path.split('/') if part and part not in ('.', '..')]
        if any(os.sep in part or (os.altsep and os.altsep in part) or ':' in part for part in parts):
            return os.path.join(base, '__invalid__')
        return os.path.join(base, *parts)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        path = urlparse(self.path).path
        if path.startswith('/admin') or path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Frame-Options', 'DENY')
        elif path.endswith('/data.js'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/admin':
            self.send_response(HTTPStatus.MOVED_PERMANENTLY)
            self.send_header('Location', '/admin/')
            self.end_headers()
            return
        if path.startswith('/api/'):
            return self.api('GET', path)
        if os.path.basename(path).startswith('.'):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if path in PAGES:
            return self.page(PAGES[path])
        return super().do_GET()

    def do_POST(self):
        self.api('POST', urlparse(self.path).path)

    def do_PUT(self):
        self.api('PUT', urlparse(self.path).path)

    def do_DELETE(self):
        self.api('DELETE', urlparse(self.path).path)

    # -- pages: the HTML gets preview tags for Telegram and other link previews,
    # which read the page without running its scripts.

    def origin(self):
        if SITE_URL:
            return SITE_URL
        host = self.headers.get('Host') or ''
        if not re.fullmatch(r'[A-Za-z0-9.\-]+(:\d+)?', host):
            return ''
        scheme = 'https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http'
        return f'{scheme}://{host}'

    def page(self, name):
        try:
            with open(os.path.join(DIST, name), encoding='utf-8') as handle:
                body = handle.read()
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)
        query = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
        with data_lock:
            site = load_site()
        tags = preview_tags(name, query, site, self.origin(), urlparse(self.path))
        body = body.replace('</head>', f'{tags}\n</head>', 1).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    # -- helpers

    def json_reply(self, status, value, cookie=None):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit):
        length = int(self.headers.get('Content-Length') or 0)
        if length > limit:
            raise Invalid('request is too large')
        return self.rfile.read(length) if length else b''

    def read_json(self):
        try:
            return json.loads(self.read_body(MAX_JSON) or b'{}')
        except json.JSONDecodeError:
            raise Invalid('request is not valid JSON') from None

    def session_token(self):
        for part in (self.headers.get('Cookie') or '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == SESSION_COOKIE:
                return value
        return ''

    def authenticated(self):
        token = self.session_token()
        expiry = sessions.get(token)
        if not expiry or expiry < time.time():
            sessions.pop(token, None)
            return False
        return True

    def cookie(self, value, max_age):
        secure = '; Secure' if os.environ.get('MELLI_SECURE_COOKIE') == '1' else ''
        return f'{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}'

    def same_origin(self):
        # Writes must come from the admin page itself: custom header plus matching Origin.
        if self.headers.get('X-Melli') != '1':
            return False
        origin = self.headers.get('Origin')
        return not origin or urlparse(origin).netloc == self.headers.get('Host')

    # -- API

    def api(self, method, path):
        try:
            if method != 'GET' and not self.same_origin():
                return self.json_reply(HTTPStatus.FORBIDDEN, {'error': 'forbidden'})
            if path == '/api/login' and method == 'POST':
                return self.login()
            if path == '/api/session' and method == 'GET':
                return self.json_reply(HTTPStatus.OK, {'authenticated': self.authenticated()})
            if not self.authenticated():
                return self.json_reply(HTTPStatus.UNAUTHORIZED, {'error': 'login required'})
            if path == '/api/logout' and method == 'POST':
                sessions.pop(self.session_token(), None)
                return self.json_reply(HTTPStatus.OK, {'ok': True}, cookie=self.cookie('', 0))
            if path == '/api/data' and method == 'GET':
                with data_lock:
                    return self.json_reply(HTTPStatus.OK, load_site())
            if path == '/api/upload' and method == 'POST':
                return self.upload()
            if path == '/api/students/bulk' and method == 'POST':
                return self.bulk_add()
            match = re.fullmatch(r'/api/students/([a-f0-9]{12})/invite', path)
            if match and method == 'POST':
                return self.invite(match.group(1))
            match = re.fullmatch(r'/api/students/([a-f0-9]{12})/thumb', path)
            if match and method == 'POST':
                return self.set_thumb(match.group(1))
            match = re.fullmatch(r'/api/students/([a-f0-9]{12})/telegram', path)
            if match and method == 'DELETE':
                return self.unlink(match.group(1))
            match = re.fullmatch(r'/api/students(?:/([a-f0-9]{12}))?', path)
            if match:
                return self.students(method, match.group(1))
            if path == '/api/bot' and method == 'GET':
                return self.bot_overview()
            if path == '/api/bot/sync' and method == 'POST':
                sync_bot()
                return self.bot_overview()
            match = re.fullmatch(r'/api/bot/edits/(\d+)/file', path)
            if match and method == 'GET':
                return self.edit_file(int(match.group(1)))
            match = re.fullmatch(r'/api/bot/edits/(\d+)', path)
            if match and method == 'POST':
                return self.decide_edit(int(match.group(1)))
            match = re.fullmatch(r'/api/bot/joins/(\d+)', path)
            if match and method == 'POST':
                return self.decide_join(int(match.group(1)))
            if path == '/api/log' and method == 'GET':
                return self.json_reply(HTTPStatus.OK, {'entries': read_log()})
            match = re.fullmatch(r'/api/cohorts/(\d{4})', path)
            if match and method == 'PUT':
                return self.cohort(int(match.group(1)))
            return self.json_reply(HTTPStatus.NOT_FOUND, {'error': 'not found'})
        except Invalid as error:
            return self.json_reply(HTTPStatus.BAD_REQUEST, {'error': str(error)})
        except BotError as error:
            return self.json_reply(HTTPStatus.BAD_GATEWAY, {'error': str(error)})

    def login(self):
        ip = self.client_address[0]
        record = failures.get(ip)
        if record and record[2] > time.time():
            return self.json_reply(HTTPStatus.TOO_MANY_REQUESTS, {'error': 'too many attempts, try again in 15 minutes'})
        code = str(self.read_json().get('code', ''))
        if code and check_code(code):
            failures.pop(ip, None)
            token = secrets.token_urlsafe(32)
            sessions[token] = time.time() + SESSION_SECONDS
            return self.json_reply(HTTPStatus.OK, {'ok': True}, cookie=self.cookie(token, SESSION_SECONDS))
        if not record or time.time() - record[1] > LOCK_SECONDS:
            record = [0, time.time(), 0]
        record[0] += 1
        if record[0] >= LOCK_AFTER:
            record[2] = time.time() + LOCK_SECONDS
        failures[ip] = record
        time.sleep(0.6)
        return self.json_reply(HTTPStatus.UNAUTHORIZED, {'error': 'wrong code'})

    def upload(self):
        kind = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if kind not in UPLOAD_TYPES:
            raise Invalid('only JPEG, PNG, WebP images and PDF files can be uploaded')
        body = self.read_body(MAX_UPLOAD)
        extension, signatures = UPLOAD_TYPES[kind]
        if not body or not body.startswith(signatures) or (extension == 'webp' and body[8:12] != b'WEBP'):
            raise Invalid('the file does not match its type')
        os.makedirs(UPLOADS, exist_ok=True)
        name = f'{secrets.token_hex(12)}.{extension}'
        with open(os.path.join(UPLOADS, name), 'wb') as handle:
            handle.write(body)
        return self.json_reply(HTTPStatus.CREATED, {'path': f'uploads/{name}'})

    def students(self, method, student_id):
        with data_lock:
            site = load_site()
            if method == 'POST' and not student_id:
                body = self.read_json()
                record = {'id': secrets.token_hex(6), **clean_student(body, site), 'telegram': clean_telegram(body),
                          'createdAt': now(), 'updatedAt': now()}
                site['students'].append(record)
                save_site(site)
                log('created', record)
                request_sync()
                return self.json_reply(HTTPStatus.CREATED, record)
            index = next((i for i, item in enumerate(site['students']) if item['id'] == student_id), None)
            if index is None:
                return self.json_reply(HTTPStatus.NOT_FOUND, {'error': 'graduate not found'})
            if method == 'PUT':
                old = site['students'][index]
                body = self.read_json()
                record = {'id': student_id, **clean_student(body, site, student_id), 'telegram': clean_telegram(body, old),
                          'createdAt': old.get('createdAt', now()), 'updatedAt': now()}
                if record['image'] != old.get('image') and record['thumb'] == old.get('thumb'):
                    record['thumb'] = ''
                site['students'][index] = record
                save_site(site)
                log('edited', record)
                request_sync()
                return self.json_reply(HTTPStatus.OK, record)
            if method == 'DELETE':
                record = site['students'].pop(index)
                save_site(site)
                log('deleted', record)
                request_sync()
                return self.json_reply(HTTPStatus.OK, {'ok': True})
        return self.json_reply(HTTPStatus.METHOD_NOT_ALLOWED, {'error': 'method not allowed'})

    def set_thumb(self, student_id):
        """The admin page sends a small copy of a photo; it is kept only if the photo is still the same."""
        body = self.read_json()
        image, thumb = upload_path(body.get('image'), 'photo'), upload_path(body.get('thumb'), 'thumbnail')
        if not image or not thumb:
            raise Invalid('photo and thumbnail are required')
        with data_lock:
            site = load_site()
            record = self.find(site, student_id)
            if record.get('image') != image:
                raise Invalid('the photo has changed; refresh')
            record['thumb'] = thumb
            save_site(site)
        return self.json_reply(HTTPStatus.OK, {'ok': True})

    # -- Telegram and bulk tools

    def find(self, site, student_id):
        record = next((item for item in site['students'] if item['id'] == student_id), None)
        if not record:
            raise Invalid('graduate not found')
        return record

    def bot_overview(self):
        with data_lock:
            site = load_site()
            state = load_bot_state()
        names = {record['id']: record for record in site['students']}
        edits = []
        for edit in state.get('edits', []):
            record = names.get(edit['profileId'])
            if record:
                edits.append({**edit, 'name': record['name'], 'year': record['year'], 'current': current_value(record, edit['field'])})
        return self.json_reply(HTTPStatus.OK, {
            'configured': bot_configured(), 'botUsername': BOT_USERNAME, **sync_status,
            'links': state.get('links', []), 'edits': edits, 'joinRequests': state.get('joinRequests', []),
            'conversations': state.get('conversations', 0),
        })

    def invite(self, student_id):
        with data_lock:
            site = load_site()
            record = self.find(site, student_id)
            token = secrets.token_urlsafe(18)
            record['telegram'] = {**(record.get('telegram') or {}), 'invite': token}
            save_site(site)
            log('invite created', record)
        request_sync()
        return self.json_reply(HTTPStatus.OK, {'link': f'https://t.me/{BOT_USERNAME}?start=l_{token}'})

    def unlink(self, student_id):
        bot_request('DELETE', f'/sync/links/{student_id}')
        with data_lock:
            site = load_site()
            record = self.find(site, student_id)
            record['telegram'] = {}
            save_site(site)
            log('Telegram unlinked', record)
        sync_bot()
        return self.json_reply(HTTPStatus.OK, {'ok': True})

    def edit_file(self, edit_id):
        # Lets the admin look at a photo or PDF before approving it.
        edit = next((item for item in load_bot_state().get('edits', []) if item['id'] == edit_id), None)
        if not edit or not edit.get('hasFile'):
            raise Invalid('this edit has no file')
        kind = 'application/pdf' if edit['field'] == 'resumeFile' else (edit.get('mime') or 'image/jpeg')
        if kind not in UPLOAD_TYPES:
            raise Invalid('the file from the bot is not an accepted type')
        body = bot_request('GET', f'/sync/edits/{edit_id}/file', raw=True, timeout=60)
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Content-Disposition', 'inline')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def decide_edit(self, edit_id):
        body = self.read_json()
        decision = body.get('decision')
        if decision not in ('approved', 'rejected'):
            raise Invalid('decision must be approved or rejected')
        edit = next((item for item in load_bot_state().get('edits', []) if item['id'] == edit_id), None)
        if not edit:
            raise Invalid('this edit is no longer pending; refresh')
        if decision == 'approved':
            file_path = import_bot_file(edit) if edit.get('hasFile') else None
            with data_lock:
                site = load_site()
                record = self.find(site, edit['profileId'])
                apply_edit(record, edit, file_path)
                record['updatedAt'] = now()
                save_site(site)
                log(f'approved bot edit: {edit["field"]}', record, actor='bot')
        else:
            with data_lock:
                record = next((item for item in load_site()['students'] if item['id'] == edit['profileId']), None)
            log(f'rejected bot edit: {edit["field"]}', record, actor='bot')
        bot_request('POST', f'/sync/edits/{edit_id}', {'decision': decision, 'note': text(body.get('note'), 500)})
        sync_bot()
        return self.bot_overview()

    def decide_join(self, join_id):
        body = self.read_json()
        decision = body.get('decision')
        if decision not in ('accepted', 'rejected'):
            raise Invalid('decision must be accepted or rejected')
        join = next((item for item in load_bot_state().get('joinRequests', []) if item['id'] == join_id), None)
        if not join:
            raise Invalid('this request is no longer pending; refresh')
        profile_id = None
        if decision == 'accepted':
            with data_lock:
                site = load_site()
                number = re.sub(r'\D', '', str(join.get('studentNumber') or '').translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹', '0123456789')))
                existing = next((item for item in site['students'] if number and item['studentNumber'] == number), None)
                if existing:
                    record = existing
                else:
                    if not 6 <= len(number) <= 12:
                        raise Invalid('the request has no full student number; add the graduate by hand, then link them with an invite')
                    record = {'id': secrets.token_hex(6), **clean_student({'studentNumber': number, 'name': join['name']}, site),
                              'telegram': compact({'username': join.get('telegramUsername') or ''}), 'createdAt': now(), 'updatedAt': now()}
                    record['published'] = False
                    site['students'].append(record)
                    save_site(site)
                profile_id = record['id']
                log('join request accepted', record, actor='bot')
            sync_bot()
        bot_request('POST', f'/sync/joins/{join_id}', {'decision': decision, 'profileId': profile_id})
        sync_bot()
        return self.bot_overview()

    def bulk_add(self):
        lines = self.read_json().get('lines') or []
        created, errors = 0, []
        with data_lock:
            site = load_site()
            for number, line in enumerate(lines[:1000], start=1):
                parts = [part.strip() for part in re.split(r'[,،\t]', str(line), maxsplit=1)]
                if len(parts) < 2 or not parts[0] or not parts[1]:
                    if str(line).strip():
                        errors.append(f'line {number}: write "student number, name"')
                    continue
                try:
                    record = {'id': secrets.token_hex(6), **clean_student({'studentNumber': parts[0], 'name': parts[1]}, site),
                              'telegram': {}, 'createdAt': now(), 'updatedAt': now()}
                except Invalid as error:
                    errors.append(f'line {number}: {error}')
                    continue
                record['published'] = False
                site['students'].append(record)
                created += 1
            if created:
                save_site(site)
                log(f'bulk added {created} drafts')
        request_sync()
        return self.json_reply(HTTPStatus.OK, {'created': created, 'errors': errors})

    def cohort(self, year):
        year = year_value(year, 'intake year', required=True)
        body = self.read_json()
        graduated = text(body.get('graduatedAt'), 10)
        if graduated and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', graduated):
            raise Invalid('graduation date must look like 2026-09-20')
        with data_lock:
            site = load_site()
            site['cohorts'][str(year)] = compact({'graduatedAt': graduated, 'image': upload_path(body.get('image'), 'group photo')})
            save_site(site)
            return self.json_reply(HTTPStatus.OK, site['cohorts'].get(str(year), {}))


def main():
    parser = argparse.ArgumentParser(description='Melli Architect site and admin server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--new-code', action='store_true', help='replace the admin code and exit')
    args = parser.parse_args()

    os.makedirs(DATA, exist_ok=True)
    if args.new_code or not os.path.exists(ADMIN_FILE):
        code = create_admin_code()
        print(f'New admin code: {code}\nAlso saved to {CODE_FILE}. Keep it safe, then delete that file.', flush=True)
        if args.new_code:
            return
    with data_lock:
        write_public_data(load_site())
    if bot_configured():
        threading.Thread(target=sync_loop, daemon=True).start()
        print(f'Telegram bot sync on, every minute, with {BOT_URL}', flush=True)
    else:
        print('Telegram bot sync off (set BOT_SYNC_URL and BOT_SYNC_SECRET in .env to turn it on)', flush=True)
    server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Melli Architect on http://{args.host}:{args.port}  (admin: /admin/)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
