from pathlib import Path
from contextlib import asynccontextmanager
import asyncio
import time
import logging
from collections import deque

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

templates = None

# ---- метрики ----
frame_counter = 0
frame_timestamps = deque()
START_TIME = time.time()

logger = logging.getLogger(__name__)


def register_frame():
    """
    Регистрация кадра в статистике
    """
    global frame_counter, frame_timestamps
    now = time.time()
    frame_counter += 1
    frame_timestamps.append(now)


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = asyncio.create_task(metrics_worker())

    yield

    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


def create_app() -> FastAPI:
    app = FastAPI(
        title="cv-navigation-assistant",
        lifespan=lifespan
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


async def metrics_worker():
    global frame_counter, frame_timestamps

    last_logged_minute = -1

    while True:
        await asyncio.sleep(1)

        now = time.time()
        minute_index = (now - START_TIME) // 60
        # если прошла новая полная (или первая) минута — логируем раз в минуту
        if minute_index > last_logged_minute:
            # удаляем старые отметки старше 60 секунд
            cutoff = now - 60.0
            while frame_timestamps and frame_timestamps[0] < cutoff:
                frame_timestamps.popleft()

            frames_last_minute = len(frame_timestamps)
            minute_number = minute_index + 1  # человекочитаемое: минута с 1
            logger.info(
                f"[FPM] для минуты {minute_number}: {frames_last_minute}/мин (всего={frame_counter})"
            )
            last_logged_minute = minute_index


app = create_app()
