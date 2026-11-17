#!/usr/bin/env python3
"""Hourly local Codex maintenance job. Independent of the four-character controller."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'agents/runs/maintenance-reviews'
STATE = DIRECTORY / 'schedule.json'
LABEL = 'com.trb.runscape-rascals-review'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
INTERVAL = 3600

def stamp(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat()

@contextmanager
def control():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    with (DIRECTORY / 'control.lock').open('a+') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield

def read_state():
    return json.loads(STATE.read_text()) if STATE.exists() else {}

def save_state(value):
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(STATE)

def codex_path():
    value = shutil.which('codex') or str(Path.home() / '.local/bin/codex')
    if not Path(value).is_file():
        raise RuntimeError('Codex CLI is not installed')
    return value

def command(report, readonly=False):
    return [codex_path(), 'exec', '--cd', str(ROOT), '--sandbox',
            'read-only' if readonly else 'danger-full-access', '-c', 'approval_policy="never"',
            '--color', 'never', '--output-last-message', str(report), '-']

def launchctl(*args):
    return subprocess.run(['/bin/launchctl', *args], capture_output=True, text=True)

def install():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    with (DIRECTORY / 'review.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('A review is running; let it finish before reinstalling')
        return install_locked()

def install_locked():
    if sys.platform != 'darwin':
        raise RuntimeError('This scheduler uses macOS launchd')
    codex_path()
    domain = f'gui/{os.getuid()}'
    # A single stable label: installing twice cannot create duplicate review workers.
    current = read_state()
    if current.get('running_pid'):
        try:
            os.kill(current['running_pid'], 0)
        except ProcessLookupError:
            pass
        else:
            raise RuntimeError('A review is running; let it finish before reinstalling')
    if launchctl('print', f'{domain}/{LABEL}').returncode == 0:
        result = launchctl('bootout', f'{domain}/{LABEL}')
        if result.returncode:
            raise RuntimeError(result.stderr)
    now = time.time()
    with control():
        save_state({**current, 'enabled': True, 'next_due': now + INTERVAL,
                    'installed_at': now, 'running_pid': None})
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    contents = {'Label': LABEL, 'ProgramArguments': [str(Path(sys.executable).resolve()), str(Path(__file__).resolve()), 'tick'],
                'WorkingDirectory': str(ROOT), 'StartInterval': 60, 'RunAtLoad': True,
                'EnvironmentVariables': {'PATH': f'{Path(codex_path()).parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                'StandardOutPath': str(DIRECTORY / 'scheduler.log'),
                'StandardErrorPath': str(DIRECTORY / 'scheduler.log')}
    PLIST.write_bytes(plistlib.dumps(contents))
    result = launchctl('bootstrap', domain, str(PLIST))
    if result.returncode:
        raise RuntimeError(result.stderr)
    print(json.dumps({'installed': LABEL, 'first_review': stamp(now + INTERVAL)}, indent=2))

def tick():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    with (DIRECTORY / 'review.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        now = time.time()
        with control():
            state = read_state()
            state.update({'last_tick_at': now, 'host_access_pending': False})
            save_state(state)
        if not state.get('enabled') or now < state.get('next_due', float('inf')):
            return 0
        name = dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
        report = DIRECTORY / (name + '.md')
        log = DIRECTORY / (name + '.log')
        since = state.get('last_success_started_at', state.get('installed_at', now - INTERVAL)) - 300
        git = subprocess.run(['git', 'status', '--short'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        prompt = (ROOT / 'agents/maintenance/review-prompt.md').read_text()
        prompt += f'\nReview window: {stamp(since)} through now.\nInitial git status (preserve):\n{git or "clean"}\n'
        with control():
            state = read_state()
            if not state.get('enabled') or now < state.get('next_due', float('inf')):
                return 0
            state.update({'running_pid': os.getpid(), 'last_started_at': now,
                          'next_due': now + INTERVAL, 'last_report': str(report)})
            save_state(state)
        result_code = 1
        try:
            with log.open('w') as output:
                result = subprocess.run(command(report), cwd=ROOT, input=prompt, text=True,
                                        stdout=output, stderr=subprocess.STDOUT)
            result_code = result.returncode
            if not report.is_file() or not report.read_text().strip():
                cli_code = result_code
                result_code = result_code or 1
                report.write_text(f'Review did not produce a valid report. CLI exit: {cli_code}. See {log.name}.\n')
            return result_code
        finally:
            # Preserve a pause requested while the review was in flight.
            with control():
                latest = read_state()
                latest.update({'running_pid': None, 'last_finished_at': time.time(),
                               'last_exit_code': result_code})
                if result_code == 0:
                    latest['last_success_started_at'] = now
                save_state(latest)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'status', 'pause', 'tick', 'probe'])
    action = parser.parse_args().action
    if action == 'install':
        install()
    elif action == 'pause':
        with control():
            state = read_state()
            state['enabled'] = False
            save_state(state)
        print('Future reviews paused. An in-flight review is allowed to finish safely.')
    elif action == 'status':
        state = read_state()
        state['launchd_loaded'] = launchctl('print', f'gui/{os.getuid()}/{LABEL}').returncode == 0
        if state.get('next_due'):
            state['next_review'] = stamp(state['next_due'])
        print(json.dumps(state, indent=2))
    elif action == 'probe':
        # Verify CLI/auth/report output without a maintenance pass, game mutation or git commit.
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        report = DIRECTORY / 'probe.md'
        with (DIRECTORY / 'probe.log').open('w') as output:
            result = subprocess.run(command(report, readonly=True), cwd=ROOT,
                                    input='Reply exactly REVIEW_RUNNER_READY. Do not use tools or change files.',
                                    text=True, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode or not report.exists() or report.read_text().strip() != 'REVIEW_RUNNER_READY':
            raise RuntimeError(f'CLI probe failed; see {DIRECTORY / "probe.log"}')
        print('CLI authentication and report output verified; no review or runtime change performed.')
    else:
        return tick()
    return 0

if __name__ == '__main__':
    sys.exit(main())
