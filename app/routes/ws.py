import asyncio
import json
import logging
from typing import List, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.reference_tools import get_objects_from

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
        'человек', 'велосипед', 'машина', 'мотоцикл', 'автобус', 'поезд', 'грузовик', 'лодка',
        'светофор', 'пожарный гидрант', 'знак стоп', 'паркомат', 'скамейка', 'кот', 'собака',
        'лошадь', 'овца', 'корова', 'слон', 'медведь', 'зебра', 'жираф', 'рюкзак', 'зонт',
        'сумка', 'чемодан', 'лыжи', 'сноуборд', 'скейтборд', 'серфборд', 'растение в горшке',
        'кровать', 'стол', 'унитаз', 'телевизор', 'раковина', 'духовка', 'микроволновка', 'тостер',
        'холодильник',
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
    return f"{horizontal} {obj_name} {distance}"


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
