"""Sites source helper fallback. Read one credential JSON from stdin; never save it."""
import json, os, subprocess, sys, tarfile
from pathlib import Path
if sys.stdin.isatty():
 import termios
 settings=termios.tcgetattr(sys.stdin)
 settings[3] &= ~termios.ECHO
 termios.tcsetattr(sys.stdin,termios.TCSANOW,settings)
print('Ready for source credential JSON on stdin (hidden).',flush=True)
payload=json.loads(sys.stdin.readline())
credential=payload['credential']
env=os.environ.copy()
if credential.get('auth_mode')!='work_proxy':
 env.update(GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0='http.extraHeader',GIT_CONFIG_VALUE_0='Authorization: Bearer '+credential['token'])
def run(args,check=True):
 r=subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if check and r.returncode:
  error=r.stderr.replace(credential.get('token','THIS_WILL_NOT_MATCH'),'[redacted]')
  raise RuntimeError(error)
 return r
if not Path('.git').exists():
 run(['git','init','-b','main'])
 run(['git','config','user.name','Codex'])
 run(['git','config','user.email','codex@openai.com'])
 run(['git','remote','add','origin',credential['remote_url']])
heads=run(['git','ls-remote','--heads','origin',credential['branch']]).stdout.strip()
if heads:
 run(['git','fetch','origin',credential['branch']])
 if run(['git','rev-parse','--verify','HEAD'],False).returncode:
  run(['git','reset','--mixed','origin/'+credential['branch']])
run(['git','add','-A'])
if run(['git','diff','--cached','--quiet'],False).returncode:
 run(['git','commit','-m',payload.get('message','Build DonJai digital gift demo')])
run(['git','push','-u','origin',credential['branch']])
sha=run(['git','rev-parse','HEAD']).stdout.strip()
archive=Path(payload['archivePath'])
with tarfile.open(archive,'w:gz') as tar:
 tar.add('.openai',arcname='.openai')
 tar.add('dist',arcname='dist')
print(json.dumps({'project_id':json.loads(Path('.openai/hosting.json').read_text())['project_id'],'commit_sha':sha,'archive':str(archive)}))
