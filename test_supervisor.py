"""Offline tests for launcher behavior. Makes no calls to Claude."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
FAKE = """#!/usr/bin/env python3
import os,json,sys
from pathlib import Path
args=sys.argv
cap=args[args.index('--max-budget-usd')+1]
p=Path('.studio-build'); s=p/'fake-count'
n=int(s.read_text())+1 if s.exists() else 1
s.write_text(str(n))
with (p/'caps').open('a') as f: f.write(cap+'\\n')
mode=os.environ['FAKE_MODE']
status='complete' if n==2 and mode=='complete' else 'working'
ev=[] if mode=='stall' else ['verified '+str(i) for i in range(n)]
(p/'state.json').write_text(json.dumps(dict(status=status,evidence=ev,next='next')))
result={'subtype':'success','total_cost_usd':0.4,'is_error':False}
if mode=='bad-cost': result.pop('total_cost_usd')
if mode=='failed': result.update(is_error=True,subtype='error_during_execution')
print(json.dumps(result))
"""
class SupervisorTest(unittest.TestCase):
    def scenario(self,mode,budget='2'):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'Writing-Studio-Master.md').write_text('fixture')
            cli=p/'claude'; cli.write_text(FAKE);cli.chmod(0o700)
            env={**os.environ,'PATH':d+os.pathsep+os.environ['PATH'],'FAKE_MODE':mode}
            proc=subprocess.run([sys.executable,str(ROOT/'run_studio.py'),'--repo',d,'--budget-usd',budget],
                env=env,capture_output=True,text=True,timeout=6)
            caps=(p/'.studio-build/caps').read_text().splitlines()
            return proc.returncode,caps
    def test_resume_and_aggregate_budget(self):
        self.assertEqual(self.scenario('complete'),(0,['2.000000','1.600000']))
    def test_no_progress(self):
        self.assertEqual(self.scenario('stall')[0],2)
    def test_budget(self):
        self.assertEqual(self.scenario('working','0.40'),(2,['0.400000']))
    def test_missing_cost(self):
        self.assertEqual(self.scenario('bad-cost'),(2,['2.000000']))
    def test_terminal_error(self):
        self.assertEqual(self.scenario('failed'),(2,['2.000000']))
if __name__=='__main__':
    unittest.main()
