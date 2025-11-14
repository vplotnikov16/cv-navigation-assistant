import os
from pathlib import Path


def get_project_root() -> Path:
    return Path(__file__).resolve().parent


def get_requirements_path(dev: bool = False) -> Path:
    requirements_filename = 'requirements-dev.txt' if dev else 'requirements.txt'
    return get_project_root() / 'max_venv' / requirements_filename


def get_project_venv_path() -> Path:
    return get_project_root() / '.venv'


def get_python_inside_venv(venv_path: Path) -> Path:
    return venv_path / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def get_project_python() -> Path:
    return get_python_inside_venv(get_project_venv_path())


if __name__ == '__main__':
    print(get_project_root())
    print(get_requirements_path())
