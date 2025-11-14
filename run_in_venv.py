import sys
import subprocess

from max_venv.setup_venv import is_running_from_project_venv, setup_venv, install_missing_requirements
from project_settings import get_project_venv_path, get_requirements_path, get_project_python, get_project_root


def start():
    python_in_venv = get_project_python()
    if is_running_from_project_venv():
        print('Текущий процесс уже выполняется из виртуального окружения проекта.')
        install_missing_requirements(python_in_venv, get_requirements_path(dev=True))
    else:
        print('Текущий процесс выполняется не из виртуального окружения проекта.')

    venv_path = get_project_venv_path()
    if not venv_path.exists():
        print('Виртуальное окружение отсутствует.')
        setup_venv(dev=True)

    if not python_in_venv.exists():
        raise RuntimeError(f'Ожидался python в виртуальном окружении по пути {python_in_venv}, но файл не найден.')

    script = get_project_root() / 'run.py'
    python_in_venv = str(get_project_python())

    args = [python_in_venv, str(script)] + sys.argv[1:]

    # Запускаем подпроцесс, унаследовав stdin/stdout/stderr
    try:
        print('==== пошла работа run.py ====')
        ret = subprocess.run(args, check=False)
        # завершаем с тем же кодом, что и запущенный скрипт
        sys.exit(ret.returncode)
    except OSError as e:
        print(f'Не удалось запустить {python_in_venv}: {e}', file=sys.stderr)


if __name__ == '__main__':
    start()
