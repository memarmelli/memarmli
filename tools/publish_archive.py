"""Publish the server's public export to Pages without using the editor's Git index."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / 'dist' / 'data.js'
REMOTE = 'https://github.com/memarmelli/memarmli.git'
UPLOAD = re.compile(r'uploads/[a-f0-9]{24}\.(?:png|jpg|webp|pdf)')


def public_files(export):
    cohorts, students = [
        json.loads(line.removeprefix(prefix).removesuffix(';'))
        for line, prefix in zip(export.decode().splitlines()[1:],
                                ('window.MELLI_COHORTS = ', 'window.MELLI_STUDENTS = '), strict=True)
    ]
    paths = [cohort.get('image') for cohort in cohorts]
    for group in students.values():
        for student in group:
            paths.extend((student.get('image'), student.get('thumb'), student.get('resume', {}).get('file')))
            for record in (student, student.get('en', {})):
                paths.extend(item.get('image') for item in record.get('portfolio', []))
    for path in set(filter(None, paths)):
        if not UPLOAD.fullmatch(path):
            raise ValueError('Invalid public attachment path')
        yield 'dist/' + path


def publish(export):
    with tempfile.TemporaryDirectory() as temp:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(temp) / 'index'),
                   GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never')

        def git(*args, data=None):
            result = subprocess.run(
                ['git', '-c', 'user.name=memarmelli',
                 '-c', 'user.email=355799227+memarmelli@users.noreply.github.com', *args],
                input=data, cwd=ROOT, env=env, capture_output=True, check=True, timeout=180)
            return result.stdout.decode().strip()

        base = git('ls-remote', '--exit-code', REMOTE, 'refs/heads/main').split()[0]
        git('fetch', '--no-write-fetch-head', '--no-tags', REMOTE, base)
        git('read-tree', base)
        old = set(git('ls-tree', '-r', '--name-only', base, '--', 'dist/uploads').splitlines())
        wanted = set(public_files(export))
        # Uploaded files are immutable and get a new random name on every upload.
        changes = []
        for path in sorted(wanted - old):
            blob = git('hash-object', '-w', '--stdin', data=(ROOT / path).read_bytes())
            changes.append(f'100644 {blob}\t{path}')
        for path in sorted(old - wanted):
            changes.append(f'0 {"0" * 40}\t{path}')
        blob = git('hash-object', '-w', '--stdin', data=export)
        changes.append(f'100644 {blob}\tdist/data.js')
        git('update-index', '--index-info', data=('\n'.join(changes) + '\n').encode())
        tree = git('write-tree')
        if tree == git('rev-parse', base + '^{tree}'):
            return
        commit = git('commit-tree', tree, '-p', base, '-m', 'Publish archive edits')
        # A concurrent push is rejected and the next attempt starts from the new main.
        git('push', REMOTE, commit + ':refs/heads/main')


def watch():
    last = None
    while True:
        try:
            export = EXPORT.read_bytes().replace(b'\r\n', b'\n')
            digest = hashlib.sha256(export).digest()
            if digest != last:
                publish(export)
                last = digest
                print('Public archive synchronized.', flush=True)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print(f'Archive publication will retry ({type(error).__name__}).', flush=True)
        time.sleep(30)


if __name__ == '__main__':
    watch()
