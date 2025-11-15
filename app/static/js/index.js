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

  const voiceBtn = document.getElementById('voice-btn');
const voiceStatus = document.getElementById('voice-status');

let recognition = null;
let recognizing = false;
let torchOn = false;

// Создаём и настраиваем SpeechRecognition
function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang = 'ru-RU';
  r.interimResults = false;
  r.continuous = false; // короткие команды
  r.maxAlternatives = 1;

  r.onstart = () => {
    recognizing = true;
    updateVoiceUI();
    log('[VOICE] recognition started');
  };

  r.onend = () => {
    recognizing = false;
    updateVoiceUI();
    log('[VOICE] recognition ended');
  };

  r.onerror = (ev) => {
    recognizing = false;
    updateVoiceUI();
    log('[VOICE] recognition error', ev && ev.error ? ev.error : ev);
  };

  r.onresult = (ev) => {
    try {
      const txt = ev.results[0][0].transcript;
      log('[VOICE] got:', txt);
      handleVoiceCommand(txt);
    } catch (e) {
      log('[VOICE] parse result error', e);
    }
  };

  return r;
}

function updateVoiceUI() {
  if (!voiceBtn) return;
  voiceBtn.setAttribute('aria-pressed', recognizing ? 'true' : 'false');
  voiceStatus.textContent = recognizing ? 'Слушаю…' : 'Ожидание';
}

function toggleRecognition() {
  if (!recognition) {
    recognition = createRecognition();
    if (!recognition) {
      log('[VOICE] SpeechRecognition не поддерживается в этом браузере');
      voiceStatus.textContent = 'SpeechRecognition не поддерживается';
      return;
    }
  }

  if (recognizing) {
    try { recognition.stop(); } catch(_) {}
  } else {
    try { recognition.start(); } catch (e) { log('[VOICE] start error', e); }
  }
}

// Обработка распознанной команды (простые матчи)
function handleVoiceCommand(rawText) {
  const text = (rawText || '').toLowerCase().trim();

  // команды включения / выключения фонарика
  if (text.includes('включи фонарик') || text.includes('включить фонарик') || text.includes('фонарик включи')) {
    enableTorch(true);
    return;
  }
  if (text.includes('выключи фонарик') || text.includes('выключить фонарик') || text.includes('фонарик выключи')) {
    enableTorch(false);
    return;
  }

  // стоп / старт камеры
  if (text.includes('стоп камера') || text.includes('останови камеру') || text.includes('выключи камеру')) {
    try { stopCamera(); log('[VOICE] camera stopped'); } catch (e) { log('[VOICE] stopCamera error', e); }
    return;
  }
  if (text.includes('включить камеру') || text.includes('включи камеру') || text.includes('старт камера')) {
    startCamera().then(() => log('[VOICE] camera started')).catch(e => log('[VOICE] startCamera error', e));
    return;
  }

  // дополнительные: стоп (общая команда)
  if (text === 'стоп') {
    try { stopCamera(); log('[VOICE] camera stopped (stop)'); } catch (e) { log('[VOICE] stop error', e); }
    return;
  }

  log('[VOICE] команда не распознана:', text);
}

// Включение/выключение фонарика (torch) — если поддерживается
async function enableTorch(shouldEnable) {
  try {
    if (!streamRef) {
      log('[TORCH] Нет активного потока камеры');
      return;
    }
    // получаем видеодорожку
    const track = streamRef.getVideoTracks()[0];
    if (!track) { log('[TORCH] Нет видеодорожки'); return; }

    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (!capabilities || !('torch' in capabilities)) {
      log('[TORCH] torch capability not supported by this device/browser');
      return;
    }

    // применяем ограничение
    try {
      await track.applyConstraints({ advanced: [{ torch: !!shouldEnable }] });
      torchOn = !!shouldEnable;
      log('[TORCH] set', torchOn);
    } catch (e) {
      log('[TORCH] applyConstraints error', e);
      // В некоторых реализациях может потребоваться ImageCapture (но оно не всегда даёт управление)
      try {
        if (window.ImageCapture) {
          const ic = new ImageCapture(track);
          if (ic && ic.track) {
            // Конкретный API для включения torch через photo settings не стандартизован везде — пробуем setOptions если есть
            if (typeof ic.setOptions === 'function') {
              await ic.setOptions({ torch: !!shouldEnable });
              torchOn = !!shouldEnable;
              log('[TORCH] set via ImageCapture.setOptions', torchOn);
            }
          }
        }
      } catch (e2) {
        log('[TORCH] ImageCapture fallback error', e2);
      }
    }
  } catch (e) {
    log('[TORCH] unexpected error', e);
  }
}

// Подключаем обработчики UI
if (voiceBtn) {
  voiceBtn.addEventListener('click', () => {
    toggleRecognition();
  });
  updateVoiceUI();
}

// --- END voice recognition & torch control ---

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
