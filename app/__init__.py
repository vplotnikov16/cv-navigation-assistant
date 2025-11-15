from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

templates = None


def create_app() -> FastAPI:
    app = FastAPI(title="cv-navigation-assistant")

    # Путь к директории пакета app
    package_root = Path(__file__).resolve().parent

    # Статика: по URL /static будет доступна папка app/static
    static_path = package_root / "static"
    if static_path.exists():
        app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

    # Шаблоны: папка app/templates
    templates_dir = package_root / "templates"
    global templates
    templates = Jinja2Templates(directory=str(templates_dir))

    # Подключаем роутеры из папки routes
    # каждый файл в routes должен экспортировать router (APIRouter)
    from .routes import pages, ws  # noqa: F401
    app.include_router(pages.router)
    app.include_router(ws.router)

    return app


# Глобальный объект app для импорта в server.py
app = create_app()
