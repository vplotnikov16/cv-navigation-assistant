import asyncio
import json
import logging
from typing import List, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import numpy as np
import cv2

from app.reference_tools import get_detections_from, Models, Direction

router = APIRouter()


def _ru_plural_form(n: int, forms: tuple) -> str:
    n = abs(n) % 100
    if 11 <= n <= 14:
        return forms[2]
    n = n % 10
    if n == 1:
        return forms[0]
    if 2 <= n <= 4:
        return forms[1]
    return forms[2]


def format_distance_for_tts(meters: float) -> str:
    if meters is None:
        return ''

    if meters < 0.01:
        return 'менее одного сантиметра'

    if meters < 0.8:
        cms = int(round(meters * 100))
        form = _ru_plural_form(cms, ('сантиметр', 'сантиметра', 'сантиметров'))
        return f"{cms} {form}"

    if 0.8 <= meters < 1.25:
        return "около метра"

    if 1.25 <= meters < 1.75:
        return "около полутора метров"

    if 1.75 <= meters < 2.25:
        return 'около двух метров'

    if 2.25 <= meters < 2.75:
        return 'около двух с половиной метров'

    if 2.75 <= meters < 3.25:
        return 'около трёх метров'

    if 3.25 <= meters < 3.75:
        return 'около трёх с половиной метров'

    rounded = round(meters, 1)
    int_part = int(rounded)
    frac = int(round((rounded - int_part) * 10))

    if frac == 0:
        form = _ru_plural_form(int_part, ('метр', 'метра', 'метров'))
        return f"{int_part} {form}"

    form = _ru_plural_form(int_part, ('метр', 'метра', 'метров'))
    text_number = f"{rounded:.1f}".replace('.', ',')
    return f"{text_number} {form}"


def get_closest_most_confident(detections: List[Dict]) -> Optional[Dict]:
    if not detections:
        return None

    return min(
        detections,
        key=lambda d: (d['distance']['estimated_meters'], -d['confidence'])
    )


def filter_objects(objects: List[Dict]) -> List[Dict]:
    necessary_classes = [
        'ступенька', 'лестница', 'пандус', 'поручень'
    ]
    return [obj for obj in objects if obj['object'] in necessary_classes]


def prepare_tts_text(objects) -> str:
    # очевидно не None, так как выше такой случай обработан
    filtered_objects = filter_objects(objects)
    if len(filtered_objects) == 0:
        return ''
    object_to_tts = get_closest_most_confident(filtered_objects)
    horizontal = object_to_tts['direction']['horizontal']
    vertical = object_to_tts['direction']['vertical']
    obj_name = object_to_tts['object']
    est = object_to_tts.get('distance', {}).get('estimated_meters')
    distance = format_distance_for_tts(float(est)) if est is not None else ''
    if vertical == Direction.BOTTOM.value:
        return f"{horizontal} {vertical} {obj_name} {distance}"
    return f"{horizontal} {obj_name} {distance}"


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}"
    logging.info("WebSocket подключен: %s", client)
    try:
        while True:
            data = await ws.receive_bytes()  # ждём байты JPEG
            logging.info("Получено изображение от %s: всего %d байт", client, len(data))

            # Получаем список детекций (серилизованные — с абсолютными координатами)
            accessibility = get_detections_from(data, Models.Accessibility)
            # если у вас есть объекты from Objects модель — добавьте тоже
            objects = get_detections_from(data, Models.Objects) if False else []  # включите по необходимости
            all_detections = objects + accessibility

            # Подготовка TTS как раньше
            text = prepare_tts_text(all_detections)

            # Преобразуем детекции в компактный формат с нормализованными bbox
            # Для этого восстановим cv2 image чтобы узнать размеры
            arr = np.frombuffer(data, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                ih, iw = img.shape[:2]
            else:
                iw, ih = 640, 480  # fallback

            compact = []
            for det in all_detections:
                bbox = det.get("bbox", {})
                x1 = bbox.get("x1", 0)
                y1 = bbox.get("y1", 0)
                x2 = bbox.get("x2", 0)
                y2 = bbox.get("y2", 0)
                # нормализуем в 0..1 (защита на случай деления на ноль)
                if iw > 0 and ih > 0:
                    nx1 = float(x1) / iw
                    ny1 = float(y1) / ih
                    nx2 = float(x2) / iw
                    ny2 = float(y2) / ih
                else:
                    nx1 = ny1 = nx2 = ny2 = 0.0

                compact.append({
                    "class": det.get("object"),
                    "class_id": det.get("class_id"),
                    "confidence": round(float(det.get("confidence", 0.0)), 3),
                    "distance_m": det.get("distance", {}).get("estimated_meters"),
                    "distance_cat": det.get("distance", {}).get("category"),
                    "bbox_norm": [nx1, ny1, nx2, ny2]
                })

            payload = {
                "ok": True,
                "bytes": len(data),
                "text": text,
                # Отправляем и компактные детекции для клиента
                "detections": compact
            }

            await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except WebSocketDisconnect:
        logging.info("WebSocket отключен: %s", client)
    except Exception as e:
        logging.exception("Ошибка в WebSocket для %s: %s", client, e)
        try:
            await ws.close()
        except Exception:
            pass
