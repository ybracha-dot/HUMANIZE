#!/usr/bin/env python3
"""Bounded Claude Code build supervisor for macOS/Linux. Uses the user's configured permissions."""
import argparse
from decimal import Decimal, InvalidOperation, ROUND_DOWN
import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

GUIDE = 'Writing-Studio-Master.md'
STATE = Path('.studio-build/state.json')
INSTRUCTION = """Read Writing-Studio-Master.md. Execute the personal release milestones.
If .studio-build/state.json exists, inspect its evidence and resume the first incomplete item.
Implement and verify a complete slice in this session. Persist concrete progress before the
session ends. If a real dependency blocks one item, continue independent authorized work.
Record genuine blockers and the next exact action. Use the state contract in the guide.
Conclude when the personal release passes its acceptance checks. Do not publish or spend on deployment."""
def state():
    if not STATE.exists():
        return ('new', frozenset(), '')
    value = json.loads(STATE.read_text())
    if not isinstance(value, dict) or value.get('status') not in {'working','blocked','complete'}:
        raise ValueError('Invalid build state. Check .studio-build/state.json.')
    evidence = value.get('evidence')
    if not isinstance(evidence,list) or any(not isinstance(x,str) or not x.strip() for x in evidence):
        raise ValueError('State evidence must be a list of milestone evidence strings.')
    if value['status']=='complete' and not evidence:
        raise ValueError('Completion requires milestone evidence.')
    return (value['status'],frozenset(evidence),str(value.get('next','')))

def stop_process(proc):
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    except ProcessLookupError:
        pass

def invoke(cmd, remaining, folder, serial):
    stdout = folder / f'{serial:02}-result.json'
    stderr = folder / f'{serial:02}-stderr.log'
    with stdout.open('x') as out, stderr.open('x') as err:
        process = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True)
        try:
            code = process.wait(timeout=remaining)
        except BaseException:
            stop_process(process)
            raise
    try:
        result = json.loads(stdout.read_text())
        if not isinstance(result,dict):
            raise ValueError()
    except (OSError, ValueError):
        raise ValueError('CLI produced no usable JSON result. Inspect the private run logs; no automatic retry.')
    return code, result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hours',type=float,default=4)
    parser.add_argument('--budget-usd',type=Decimal,required=True,help='Maximum estimated Claude API cost across this launch')
    parser.add_argument('--max-sessions',type=int,default=12)
    parser.add_argument('--turns',type=int,default=35)
    parser.add_argument('--repo',type=Path,default=Path.cwd())
    args = parser.parse_args()
    if not math.isfinite(args.hours) or args.hours<=0 or not args.budget_usd.is_finite() or args.budget_usd<Decimal('0.01') or min(args.max_sessions,args.turns)<1:
        parser.error('Use positive hours, turns and sessions and at least $0.01 for the cap.')
    os.chdir(args.repo)
    if not Path(GUIDE).is_file():
        parser.error('Run from the extracted kit or place the master file in the app repository.')
    cli = shutil.which('claude')
    if not cli:
        parser.error('Claude Code was not found on PATH.')
    os.umask(0o077)
    base=Path('.studio-build')
    base.mkdir(exist_ok=True)
    with (base/'supervisor.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another build supervisor already owns this repository.')
        if state()[0]=='complete':
            print('Personal release is recorded complete. Review its evidence.'); return 0
        if state()[0]=='blocked':
            print('Resolve the recorded blocker, set state to working, then relaunch.'); return 2
        import tempfile
        folder = Path(tempfile.mkdtemp(prefix='run-',dir=base))
        remaining = args.budget_usd
        deadline = time.monotonic() + args.hours*3600
        stalls=0
        print('Private session logs:',folder,flush=True)
        for i in range(1,args.max_sessions+1):
            budget=remaining.quantize(Decimal('.000001'),rounding=ROUND_DOWN)
            if budget<Decimal('.01') or time.monotonic()>=deadline:
                break
            before=state()[1]
            cmd=[cli,'-p','--output-format','json','--max-turns',str(args.turns),
                 '--max-budget-usd',str(budget),INSTRUCTION]
            code, result=invoke(cmd,max(0.01,deadline-time.monotonic()),folder,i)
            try:
                cost=Decimal(str(result['total_cost_usd']))
                if not cost.is_finite() or cost<0: raise ValueError()
            except (KeyError,InvalidOperation,ValueError):
                print('Missing estimated cost. Pausing before another session.'); return 2
            remaining-=cost
            status,evidence,next_item=state()
            subtype=result.get('subtype','')
            print(f'Session {i}: {status}; estimated cost {cost}; remaining {remaining}; next {next_item}',flush=True)
            if (code or result.get('is_error')) and subtype!='error_max_turns':
                print('Claude stopped. Inspect the result for permissions, quota, billing, or configuration.'); return 2
            if status=='complete':
                return 0
            if status=='blocked':
                return 2
            stalls=0 if evidence-before else stalls+1
            if stalls>=2:
                print('Two sessions added no milestone evidence. Inspect the blocker before retrying.'); return 2
        print('Configured time, session or estimated cost limit reached. Progress is on disk.'); return 2

if __name__=='__main__':
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired:
        print('Time limit reached. Last session cost may be unreported. Check usage before relaunching.',file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print('Stopped by operator. Inspect the latest session before relaunching.',file=sys.stderr)
        sys.exit(130)
    except (OSError,ValueError) as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(2)
