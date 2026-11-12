"""End-to-end check of server.py against the bot worker, without Telegram or Cloudflare.

Runs a copy of server.py on a throwaway folder and the worker on node:sqlite
(local-worker.mjs), then links, edits, approves, joins and unlinks.

    python bot/test/test_server_sync.py
"""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request, http.cookiejar

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'server.py')
work = tempfile.mkdtemp(prefix='melli-sync-')
os.makedirs(os.path.join(work, 'dist'))
os.makedirs(os.path.join(work, 'admin'))
shutil.copy(SRC, work)
env = {**os.environ, 'BOT_SYNC_URL': 'http://127.0.0.1:8798', 'MOCK_PORT': '8798', 'BOT_SYNC_SECRET': 'local-sync-secret', 'MELLI_NO_BROWSER': '1'}

bot = subprocess.Popen(['node', os.path.join(HERE, 'local-worker.mjs')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
bot.stdout.readline()
subprocess.run([sys.executable, 'server.py', '--new-code'], cwd=work, env=env, capture_output=True)
code = re.search(r'[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}', open(os.path.join(work, 'data', 'ADMIN-CODE.txt'), encoding='utf-8').read()).group(0)
site = subprocess.Popen([sys.executable, 'server.py', '--port', '4198'], cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None, base='http://127.0.0.1:4198'):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={'X-Melli': '1', 'Content-Type': 'application/json'})
    try:
        with opener.open(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def hook(update):
    call('POST', '/__hook', update, base='http://127.0.0.1:8798')


def data_js():
    return open(os.path.join(work, 'dist', 'data.js'), encoding='utf-8').read()


ok = True
def check(label, cond):
    global ok
    ok &= bool(cond)
    print(('PASS ' if cond else 'FAIL ') + label)

try:
    check('login', call('POST', '/api/login', {'code': code})[0] == 200)
    status, rec = call('POST', '/api/students', {'studentNumber': '9612345', 'name': 'سارا امینی', 'published': True,
                                                 'telegram': {'username': '@SaraAmini'}})
    check(f'create with telegram ({status} {rec.get("error")})', status == 201 and rec['telegram'] == {'username': 'SaraAmini'})
    sid = rec['id']
    check('bad telegram username rejected', call('POST', '/api/students', {'studentNumber': '9612346', 'name': 'x', 'telegram': {'username': 'a b'}})[0] == 400)
    status, inv = call('POST', f'/api/students/{sid}/invite')
    check('invite link', status == 200 and inv['link'].startswith('https://t.me/memar_mli_bot?start=l_'))
    status, ov = call('POST', '/api/bot/sync')
    check(f'manual sync ({status} {ov.get("error")})', status == 200 and ov['configured'] and ov['syncedAt'])
    check('telegram hidden from data.js', 'SaraAmini' not in data_js() and 'telegram' not in data_js() and 'contact' not in data_js())

    sara = {'id': 101, 'first_name': 'Sara', 'username': 'SaraAmini'}
    msg = iter(range(1000, 9999))
    upd = iter(range(1, 9999))
    def say(text, **extra):
        hook({'update_id': next(upd), 'message': {'message_id': next(msg), 'from': sara, 'chat': {'id': 101, 'type': 'private'}, **({'text': text} if text else {}), **extra}})
    def press(data):
        hook({'update_id': next(upd), 'callback_query': {'id': f'cb{next(msg)}', 'from': sara, 'data': data, 'message': {'chat': {'id': 101}}}})

    token = inv['link'].split('l_')[1]
    say(f'/start l_{token}')
    press('m:msg')  # accept messages
    press('e:occupation'); say('معمار ارشد')
    press('e:resumeFile'); say(None, document={'file_id': 'doc1', 'file_name': 'cv.pdf', 'mime_type': 'application/pdf', 'file_size': 2000})
    press('e:photo'); say(None, photo=[{'file_id': 'ph1', 'width': 100, 'height': 100, 'file_size': 900}])

    status, ov = call('POST', '/api/bot/sync')
    links = ov['links']
    check('linked and accepts messages', len(links) == 1 and links[0]['acceptsMessages'])
    check('contact button in data.js', f'start=c_{sid}' in data_js())
    fields = {e['field']: e for e in ov['edits']}
    check(f'three pending edits {sorted(fields)}', set(fields) == {'occupation', 'resumeFile', 'photo'})
    check('edit carries current value + name', fields['occupation']['name'] == 'سارا امینی')

    for field in ('occupation', 'resumeFile', 'photo'):
        status, ov = call('POST', f'/api/bot/edits/{fields[field]["id"]}', {'decision': 'approved'})
        check(f'approve {field} ({status} {ov.get("error")})', status == 200)
    status, siteData = call('GET', '/api/data')
    rec = next(s for s in siteData['students'] if s['id'] == sid)
    check('occupation applied', rec['occupation'] == 'معمار ارشد')
    check('resume imported', rec['resume']['file'].endswith('.pdf') and open(os.path.join(work, 'dist', rec['resume']['file']), 'rb').read().startswith(b'%PDF'))
    check('photo imported', rec['image'].endswith('.jpg'))
    check('queue empty', ov['edits'] == [])

    # join request from a stranger
    reza = {'id': 303, 'first_name': 'Reza'}
    def rsay(text):
        hook({'update_id': next(upd), 'message': {'message_id': next(msg), 'from': reza, 'chat': {'id': 303, 'type': 'private'}, 'text': text}})
    rsay('/start')
    hook({'update_id': next(upd), 'callback_query': {'id': 'cbj', 'from': reza, 'data': 'm:join', 'message': {'chat': {'id': 303}}}})
    rsay('رضا کریمی'); rsay('۹۵۱۲۳۴۵'); rsay('ورودی ۹۵')
    hook({'update_id': next(upd), 'callback_query': {'id': 'cbj2', 'from': reza, 'data': 'j:send', 'message': {'chat': {'id': 303}}}})
    status, ov = call('POST', '/api/bot/sync')
    check(f'join request visible {len(ov["joinRequests"])}', len(ov['joinRequests']) == 1)
    status, ov = call('POST', f'/api/bot/joins/{ov["joinRequests"][0]["id"]}', {'decision': 'accepted'})
    check(f'join accepted ({status} {ov.get("error")})', status == 200 and len(ov['links']) == 2)
    status, siteData = call('GET', '/api/data')
    check('draft created from join', any(s['studentNumber'] == '9512345' and not s.get('published') for s in siteData['students']))

    status, res = call('POST', '/api/students/bulk', {'lines': ['9711111, علی', '9722222،مریم', 'bad line', '']})
    check(f'bulk add {res}', res.get('created') == 2 and len(res['errors']) == 1)

    status, _ = call('DELETE', f'/api/students/{sid}/telegram')
    status, ov = call('GET', '/api/bot')
    check('unlink', status == 200 and all(l['profileId'] != sid for l in ov['links']) and f'start=c_{sid}' not in data_js())
    status, lg = call('GET', '/api/log')
    check(f'log has entries ({len(lg["entries"])})', len(lg['entries']) >= 6)
    tg = json.loads(urllib.request.urlopen('http://127.0.0.1:8798/__calls').read())
    check('graduate notified of approvals', sum(1 for c in tg if str(c['payload'].get('chat_id')) == '101') >= 6)
finally:
    site.terminate(); bot.terminate()
    out = site.stdout.read().decode('utf-8', 'replace')
    if not ok:
        print(out[-3000:])
    shutil.rmtree(work, ignore_errors=True)
print('ALL OK' if ok else 'SOME FAILED')
