import subprocess
import sys
from pathlib import Path

from project_settings import get_project_venv_path, get_requirements_path, get_project_root, get_project_python


def is_inside_any_virtualenv() -> bool:
    return hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)


def is_running_from_project_venv() -> bool:
    venv = get_project_venv_path().resolve()
    if not venv.exists():
        return False
    exe = Path(sys.executable).resolve()
    return venv in exe.parents


def create_project_venv() -> None:
    venv = get_project_venv_path()
    print(f'Создаю виртуальное окружение проекта по пути {venv}...')
    try:
        subprocess.check_call([sys.executable, '-m', 'venv', str(venv)], cwd=str(get_project_root()))
        print('Виртуальное окружение проекта успешно создано.')
    except subprocess.CalledProcessError as e:
        print(f'Ошибка при создании виртуального окружения: {e}')
        raise


def install_missing_requirements(python_executable: Path, requirements_file: Path, update_pip: bool = True):
    import re

    if update_pip:
        try:
            print('Проверяю версию pip...')
            subprocess.run(
                [str(python_executable), '-m', 'pip', 'install', '--upgrade', 'pip'],
                check=True
            )
        except subprocess.CalledProcessError as e:
            print(f'Не удалось обновить pip: {e}')

    if not requirements_file.exists():
        print(f'{requirements_file} не найден, установка зависимостей пропущена.')
        return

    print(f'Проверяю зависимости из {requirements_file}...')

    # Получаем список уже установленных пакетов (stdout читаем в память, это быстро)
    try:
        result = subprocess.run(
            [str(python_executable), '-m', 'pip', 'freeze'],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        installed_packages = {line.split('==')[0].lower() for line in result.stdout.splitlines() if '==' in line}
    except subprocess.CalledProcessError as e:
        print(f'Не удалось получить список установленных пакетов: {e}')
        installed_packages = set()

    # Читаем requirements.txt
    requirements = []
    for line in requirements_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        lib_name = re.split(r'[<>=!]', line)[0].strip().lower()
        requirements.append((lib_name, line))

    # Устанавливаем пакеты — НЕ перенаправляем вывод: пользователь увидит прогресс pip
    for lib_name, full_spec in requirements:
        if lib_name in installed_packages:
            continue
        print(f'Устанавливаю {full_spec}...')
        try:
            subprocess.run(
                [str(python_executable), '-m', 'pip', 'install', full_spec],
                check=True
            )
        except subprocess.CalledProcessError as e:
            print(f'Ошибка при установке {full_spec}: {e}')


def setup_venv(dev: bool = True):
    create_project_venv()
    install_missing_requirements(get_project_python(), get_requirements_path(dev=False))
    if dev:
        install_missing_requirements(get_project_python(), get_requirements_path(dev=True), update_pip=False)


if __name__ == '__main__':
    setup_venv(dev=True)
