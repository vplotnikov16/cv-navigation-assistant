from fastapi import APIRouter, Request
from app.utils import render_template

router = APIRouter()


@router.get("/", name="index")
async def index(request: Request):
    return render_template(request, "index.html", title="Главная", message="Привет, FastAPI + шаблоны!")
