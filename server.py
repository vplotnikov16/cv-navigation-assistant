# server.py
import asyncio
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

logging.basicConfig(level=logging.INFO)
app = FastAPI()

HTML = """<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Auto camera → WebSocket demo</title>
  <style>
    body { font-family: system-ui, Arial; padding: 12px; }
    video { border:1px solid #ccc; display:block; margin-bottom:8px; }
    #log { white-space: pre-wrap; background:#fafafa; border:1px solid #eee; padding:10px; height:240px; overflow:auto; }
    .muted { color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <h3>Авто: камера → сервер (инференс-заглушка 0.5s) → TTS → следующий кадр</h3>
  <video id="video" width="640" height="480" autoplay playsinline muted></video>
  <canvas id="canvas" width="640" height="480" style="display:none"></canvas>
  <div class="muted">Страница автоматически запрашивает камеру и подключается к WebSocket. Разрешите доступ к камере.</div>
  <h4>Лог (клиента):</h4>
  <div id="log"></div>

<script>
const logEl = document.getElementById('log');
function log(...args){ logEl.textContent += args.join(' ') + '\\n'; logEl.scrollTop = logEl.scrollHeight; console.log(...args); }

let ws = null;
let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let streamRef = null;
let readyWS = false;
let readyCam = false;
let awaitingResponse = false;

// Создаёт и ждёт открытия WS (возвращает promise, который резолвится на open)
function createAndAwaitWS() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      readyWS = true;
      resolve();
      return;
    }
    ws = new WebSocket("ws://" + location.host + "/ws");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      readyWS = true;
      log("[WS] connected");
      resolve();
    };
    ws.onmessage = (ev) => {
      // parse JSON (server sends text/json)
      try {
        const txt = typeof ev.data === 'string' ? ev.data : null;
        if (txt) {
          const msg = JSON.parse(txt);
          log("[WS] got response:", JSON.stringify(msg));
          awaitingResponse = false;
          // speak the returned text
          if (msg && msg.text) {
            try {
              window.speechSynthesis.cancel();
              const u = new SpeechSynthesisUtterance(msg.text);
              u.lang = 'ru-RU';
              u.onend = () => {
                log("[TTS] finished");
                // start next capture automatically
                scheduleNextCapture();
              };
              window.speechSynthesis.speak(u);
              log("[TTS] speaking:", msg.text);
            } catch (e) {
              log("[TTS] error:", e);
              scheduleNextCapture();
            }
          } else {
            scheduleNextCapture();
          }
        } else {
          // Unexpected binary or non-text
          log("[WS] received non-text message");
          awaitingResponse = false;
          scheduleNextCapture();
        }
      } catch (e) {
        log("[WS] onmessage parse error", e);
        awaitingResponse = false;
        scheduleNextCapture();
      }
    };
    ws.onclose = (ev) => {
      readyWS = false;
      log("[WS] closed", ev && ev.code ? ev.code : "");
      // try reconnect after a short delay
      setTimeout(() => { initFlow().catch(e=>log("reconnect init error", e)); }, 1000);
    };
    ws.onerror = (e) => {
      log("[WS] error", e && e.message ? e.message : e);
      // no reject — просто попробуем подключиться снова later
    };
    // safety timeout for connect
    setTimeout(() => {
      if (!readyWS) {
        reject(new Error("WS connect timeout"));
      }
    }, 5000);
  });
}

async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "environment" }, audio: false });
    streamRef = s;
    video.srcObject = s;
    await video.play();
    readyCam = true;
    log("Камера готова");
  } catch (e) {
    readyCam = false;
    log("Ошибка доступа к камере:", e && e.message ? e.message : e);
    throw e;
  }
}

function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
    video.pause();
    video.srcObject = null;
    readyCam = false;
    log("Камера остановлена");
  }
}

// capture frame -> Blob -> ArrayBuffer
function captureToArrayBuffer() {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      blob.arrayBuffer().then(resolve).catch(() => resolve(null));
    }, 'image/jpeg', 0.7);
  });
}

// отправляем кадр, но только если нет ожидающего ответа
async function sendOneIfReady() {
  if (!readyCam || !readyWS) {
    log("Не готовы: readyCam=", readyCam, " readyWS=", readyWS);
    return;
  }
  if (awaitingResponse) {
    log("Ждём ответ сервера, не отправляем");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log("WS не открыт, пробуем переподключиться");
    try {
      await createAndAwaitWS();
    } catch (e) {
      log("Не удалось открыть WS:", e);
      return;
    }
  }
  try {
    const arr = await captureToArrayBuffer();
    if (!arr) { log("Не удалось получить кадр"); return; }
    log("Отправка кадра, bytes=", arr.byteLength);
    awaitingResponse = true;
    ws.send(arr);
    // теперь ждём onmessage, который снимет awaitingResponse и запустит TTS и следующий кадр
  } catch (e) {
    log("Ошибка отправки кадра:", e);
    awaitingResponse = false;
  }
}

// schedule next capture после небольшой задержки (плавнее)
function scheduleNextCapture(delayMs = 50) {
  setTimeout(() => {
    sendOneIfReady();
  }, delayMs);
}

// инициализация: подключаем WS и камеру, потом стартуем цикл
async function initFlow() {
  log("Инициализация...");
  try {
    await Promise.allSettled([
      createAndAwaitWS().catch(e => { log("WS init failed:", e); }),
      startCamera().catch(e => { log("Cam init failed:", e); throw e; })
    ]);
    // если камера или ws не готовы — бросим
    if (!readyCam) {
      log("Камера не готова — останов");
      return;
    }
    if (!readyWS) {
      log("WS не готов — но попытаемся всё равно отправлять, будет переподключение");
    }
    log("Старт цикла отправки");
    // немедленно отправляем первый кадр
    await sendOneIfReady();
  } catch (e) {
    log("initFlow error:", e);
  }
}

// старт при загрузке страницы
window.addEventListener('load', () => {
  initFlow().catch(e => log("initFlow top error", e));
});

// cleanup при уходе со страницы
window.addEventListener('beforeunload', () => {
  try { if (ws) ws.close(); } catch(_) {}
  stopCamera();
});
</script>
</body>
</html>
"""


@app.get("/")
async def index():
    return HTMLResponse(HTML)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}"
    logging.info("WebSocket connected: %s", client)
    try:
        while True:
            data = await ws.receive_bytes()  # ждём байты JPEG
            preview = data[:20]
            logging.info("Received image from %s: total %d bytes; first20(hex)=%s; first20(list)=%s",
                         client, len(data), preview.hex(), list(preview))
            # заглушка инференса
            await asyncio.sleep(0.5)
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
