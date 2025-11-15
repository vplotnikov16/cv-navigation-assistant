from typing import Any, Dict
from fastapi import Request
from . import templates


def render_template(request: Request, template_name: str, **context: Any):
    """
    Возвращает fastapi.responses.TemplateResponse.
    В обработчике нужно принимать request и передавать его сюда.
    Пример:
        def index(request: Request):
            return render_template(request, "index.html", foo="bar")
    """
    if templates is None:
        raise RuntimeError("templates not initialized")
    data: Dict[str, Any] = {"request": request}
    data.update(context)
    return templates.TemplateResponse(template_name, data)
