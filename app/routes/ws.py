import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}"
    logging.info("WebSocket connected: %s", client)
    try:
        while True:
            data = await ws.receive_bytes()  # ждём байты JPEG
            preview = data[:20]
            logging.info(
                "Received image from %s: total %d bytes; first20(hex)=%s; first20(list)=%s",
                client, len(data), preview.hex(), list(preview)
            )
            # заглушка инференса
            await asyncio.sleep(0.4)
            text = "проверка аудио"
            logging.info("Отправляю ответ пользователю...")
            payload = {"ok": True, "bytes": len(data), "text": text}
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except WebSocketDisconnect:
        logging.info("WebSocket disconnected: %s", client)
    except Exception as e:
        logging.exception("Error in ws handler for %s: %s", client, e)
        try:
            await ws.close()
        except Exception:
            pass
