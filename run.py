import subprocess
import sys

from project_settings import get_project_python

python_in_venv = str(get_project_python())
host = '0.0.0.0'
port = '8000'
args = [python_in_venv, '-m', 'uvicorn', 'server:app', '--host', host, '--port', port, '--reload']

# Запускаем подпроцесс, унаследовав stdin/stdout/stderr
try:
    ret = subprocess.run(args, check=False)
    # завершаем с тем же кодом, что и запущенный скрипт
    sys.exit(ret.returncode)
except OSError as e:
    print(f'Не удалось запустить {python_in_venv}: {e}', file=sys.stderr)
