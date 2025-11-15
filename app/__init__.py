from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

templates = None


def create_app() -> FastAPI:
    app = FastAPI(
        title="cv-navigation-assistant",
    )

    package_root = Path(__file__).resolve().parent

    # Статика
    static_path = package_root / "static"
    if static_path.exists():
        app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

    # Шаблоны
    global templates
    templates_dir = package_root / "templates"
    templates = Jinja2Templates(directory=str(templates_dir))

    from .routes import pages, ws
    app.include_router(pages.router)
    app.include_router(ws.router)

    return app


app = create_app()
