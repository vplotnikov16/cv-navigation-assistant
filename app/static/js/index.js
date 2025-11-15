// Перенесённый JS — оставлен почти без изменений.
// Файл подключается с defer — DOM уже будет готов.

(function(){
  const logEl = document.getElementById('log');
  function log(...args){ logEl.textContent += args.join(' ') + '\n'; logEl.scrollTop = logEl.scrollHeight; console.log(...args); }

  let ws = null;
  let video = document.getElementById('video');
  let canvas = document.getElementById('canvas');
  let streamRef = null;
  let readyWS = false;
  let readyCam = false;
  let awaitingResponse = false;

  function createAndAwaitWS() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        readyWS = true;
        resolve();
        return;
      }
      // используем тот же host, что и страница
      ws = new WebSocket("ws://" + location.host + "/ws");
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        readyWS = true;
        log("[WS] connected");
        resolve();
      };
      ws.onmessage = (ev) => {
        try {
          const txt = typeof ev.data === 'string' ? ev.data : null;
          if (txt) {
            const msg = JSON.parse(txt);
            log("[WS] got response:", JSON.stringify(msg));
            awaitingResponse = false;
            if (msg && msg.text) {
              try {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(msg.text);
                u.lang = 'ru-RU';
                u.onend = () => {
                  log("[TTS] finished");
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
        setTimeout(() => { initFlow().catch(e=>log("reconnect init error", e)); }, 1000);
      };
      ws.onerror = (e) => {
        log("[WS] error", e && e.message ? e.message : e);
      };
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
    } catch (e) {
      log("Ошибка отправки кадра:", e);
      awaitingResponse = false;
    }
  }

  function scheduleNextCapture(delayMs = 50) {
    setTimeout(() => {
      sendOneIfReady();
    }, delayMs);
  }

  async function initFlow() {
    log("Инициализация...");
    try {
      await Promise.allSettled([
        createAndAwaitWS().catch(e => { log("WS init failed:", e); }),
        startCamera().catch(e => { log("Cam init failed:", e); throw e; })
      ]);
      if (!readyCam) {
        log("Камера не готова — останов");
        return;
      }
      if (!readyWS) {
        log("WS не готов — но попытаемся всё равно отправлять, будет переподключение");
      }
      log("Старт цикла отправки");
      await sendOneIfReady();
    } catch (e) {
      log("initFlow error:", e);
    }
  }

  window.addEventListener('load', () => {
    initFlow().catch(e => log("initFlow top error", e));
  });

  window.addEventListener('beforeunload', () => {
    try { if (ws) ws.close(); } catch(_) {}
    stopCamera();
  });

})();
