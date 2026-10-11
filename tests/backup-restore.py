"""Local WSL dev rehearsal. Creates an isolated restore DB; never replaces production."""
import datetime
import json
import os
import subprocess
from pathlib import Path
import psycopg
from dotenv import load_dotenv

load_dotenv()
suffix=datetime.datetime.now().strftime('%Y%m%d%H%M%S')
restore='aivideo_restore_'+suffix
dump='/tmp/aivideo-'+suffix+'.dump'
def wsl(*args):
    subprocess.run(['wsl','--',*args],check=True,capture_output=True)
wsl('/usr/lib/postgresql/16/bin/pg_dump','-h','127.0.0.1','-p','55432','-U','dmin','-d','aivideo','-Fc','-f',dump)
wsl('/usr/lib/postgresql/16/bin/createdb','-h','127.0.0.1','-p','55432','-U','dmin',restore)
wsl('/usr/lib/postgresql/16/bin/pg_restore','-h','127.0.0.1','-p','55432','-U','dmin','-d',restore,'--no-owner','--exit-on-error',dump)
uri=os.environ['DATABASE_URL']
with psycopg.connect(uri) as source, psycopg.connect(uri.rsplit('/',1)[0]+'/'+restore) as target:
    counts={}
    for table in ['Resource','Revision','Job','FileObject','ApiKey','Conversation']:
        query='SELECT count(*) FROM "'+table+'"'
        a=source.execute(query).fetchone()[0]
        b=target.execute(query).fetchone()[0]
        assert a==b,(table,a,b)
        counts[table]=a
    checkpoints=target.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='agent_checkpoints'").fetchone()[0]
    assert checkpoints>0
Path('.runtime/backup-validation.json').write_text(json.dumps({'restoredDatabase':restore,'dumpPathWSL':dump,'counts':counts,'checkpointTables':checkpoints,'validatedAt':suffix},indent=2))
print('PASS PostgreSQL dump restored into isolated database; business counts and Agent checkpoint schema verified')
