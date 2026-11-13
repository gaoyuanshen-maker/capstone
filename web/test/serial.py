import os, pty, subprocess, time, json, urllib.request, tempfile
from pathlib import Path
os.chdir(Path(__file__).resolve().parents[2])
temp = tempfile.TemporaryDirectory()
master, slave = pty.openpty()
server = subprocess.Popen(['node','web/server.js'], env={**os.environ, 'PORT':'3101','DB_PATH':os.path.join(temp.name,'test.db'),'SERIAL_PORT':os.ttyname(slave)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def report():
 return json.load(urllib.request.urlopen('http://localhost:3101/api/reports?time_zone=Asia%2FTokyo'))
def send(state, dist=550):
 os.write(master,f'DIST:{dist},STATE:{state}\r\n'.encode()); time.sleep(.13)
try:
 for i in range(50):
  try: report(); break
  except Exception: time.sleep(.1)
 send('PRESENT'); send('PRESENT',200)
 assert report()['session_count']==1
 send('AWAY',8190); time.sleep(.5); send('PRESENT')
 r=report(); assert r['session_count']==1 and r['sessions'][0]['ongoing']
 send('AWAY',8190)
 for i in range(10): time.sleep(1); send('AWAY',8190)
 r=report(); assert r['session_count']==1 and not r['sessions'][0]['ongoing'],r
 send('PRESENT'); r=report(); assert r['session_count']==2,r
 assert r['total_seconds']>=10,r
 time.sleep(16)
 send('PRESENT')
 r=report(); assert r['session_count']==3,r
 latest=json.load(urllib.request.urlopen('http://localhost:3101/api/latest'))
 assert latest['sitting_duration_sec']==0, latest
 print('PASS: real SerialPort via PTY, distance transition, brief absence, confirmed 10s VACANT, second session')
finally:
 server.terminate(); server.wait(); os.close(master); os.close(slave); temp.cleanup()
