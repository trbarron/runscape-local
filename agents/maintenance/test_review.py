import fcntl
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maintenance_review', Path(__file__).with_name('review.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)

class ReviewSchedulerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        directory = Path(self.temp.name)
        self.directory = patch.object(review, 'DIRECTORY', directory)
        self.state = patch.object(review, 'STATE', directory / 'schedule.json')
        self.directory.start()
        self.state.start()

    def tearDown(self):
        self.directory.stop()
        self.state.stop()
        self.temp.cleanup()

    def seed(self, **changes):
        review.save_state({'enabled': True, 'next_due': time.time()-1, 'installed_at': time.time()-3600, **changes})

    def test_not_due_or_paused_never_invokes_codex(self):
        for value in [{'enabled': False}, {'next_due': time.time()+3600}]:
            self.seed(**value)
            with patch.object(review.subprocess, 'run') as run:
                self.assertEqual(review.tick(), 0)
                run.assert_not_called()

    def test_overlapping_job_cannot_start_second_review(self):
        self.seed()
        with (review.DIRECTORY / 'review.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with patch.object(review.subprocess, 'run') as run:
                self.assertEqual(review.tick(), 0)
                run.assert_not_called()

    def run_fixture(self, code=0, pause=False, report_text='Test review complete.\n'):
        self.seed(last_success_started_at=1000)
        calls=[]
        def invoke(args, **kwargs):
            if args[0]=='git':
                return subprocess.CompletedProcess(args, 0, '?? .claude/scheduled_tasks.lock\n')
            calls.append(kwargs['input'])
            if report_text is not None:
                Path(args[args.index('--output-last-message')+1]).write_text(report_text)
            if pause:
                with review.control():
                    state=review.read_state();state['enabled']=False;review.save_state(state)
            return subprocess.CompletedProcess(args, code)
        with patch.object(review.subprocess, 'run', side_effect=invoke):
            self.assertEqual(review.tick(), code or (0 if report_text and report_text.strip() else 1))
        self.assertEqual(len(calls), 1)
        self.assertIn('1970-01-01T00:11:40', calls[0]) # Five-minute overlap from checkpoint.
        self.assertIn('scheduled_tasks.lock', calls[0])
        return review.read_state()

    def test_success_records_checkpoint_and_future_due(self):
        state=self.run_fixture()
        self.assertEqual(state['last_exit_code'], 0)
        self.assertIsNone(state['running_pid'])
        self.assertGreaterEqual(state['next_due'], state['last_started_at']+3600)
        self.assertEqual(state['last_success_started_at'], state['last_started_at'])

    def test_failure_keeps_previous_evidence_checkpoint(self):
        state=self.run_fixture(code=1)
        self.assertEqual(state['last_success_started_at'], 1000)
        self.assertEqual(state['last_exit_code'], 1)

    def test_pause_during_review_survives_finish(self):
        self.assertFalse(self.run_fixture(pause=True)['enabled'])

    def test_missing_or_empty_report_is_failure_even_on_zero_exit(self):
        for value in [None, '   ']:
            state=self.run_fixture(report_text=value)
            self.assertEqual(state['last_exit_code'], 1)
            self.assertEqual(state['last_success_started_at'], 1000)
            Path(state['last_report']).unlink()

    def test_reinstall_cannot_race_a_review_starting_before_pid_record(self):
        self.seed(running_pid=None)
        with (review.DIRECTORY / 'review.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with patch.object(review, 'launchctl') as launch:
                with self.assertRaisesRegex(RuntimeError, 'review is running'):
                    review.install()
                launch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
