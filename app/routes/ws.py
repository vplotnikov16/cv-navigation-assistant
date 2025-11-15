import asyncio
import json
import logging
from typing import List, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.reference_tools import get_objects_from

router = APIRouter()


def get_closest_most_confident(detections: List[Dict]) -> Optional[Dict]:
    if not detections:
        return None

    return min(
        detections,
        key=lambda d: (d['distance']['estimated_meters'], -d['confidence'])
    )


def prepare_tts_text(objects) -> str:
    if len(objects) == 0:
        return ''
    # очевидно не None, так как выше такой случай обработан
    object_to_tts = get_closest_most_confident(objects)
    horizontal = object_to_tts['direction']['horizontal']
    vertical = object_to_tts['direction']['vertical']
    obj_name = object_to_tts['object']
    distance = object_to_tts['distance']['meters'].replace('м', ' метр')
    return f"{horizontal} {vertical} {obj_name} {distance}"


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}"
    logging.info("WebSocket подключен: %s", client)
    try:
        while True:
            data = await ws.receive_bytes()  # ждём байты JPEG
            logging.info("Получено изображение от %s: всего %d байт",client, len(data))
            objects = get_objects_from(data)
            text = prepare_tts_text(objects)
            logging.info("Отправляю ответ пользователю: %s", text)
            payload = {"ok": True, "bytes": len(data), "text": text}
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except WebSocketDisconnect:
        logging.info("WebSocket отключен: %s", client)
    except Exception as e:
        logging.exception("Ошибка в WebSocket для %s: %s", client, e)
        try:
            await ws.close()
        except Exception:
            pass
