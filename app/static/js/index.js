// app/static/js/index.js
// Универсальный клиент JS: камера, WebSocket, TTS, голосовые команды.
// Подключается с `defer` — DOM уже готов.

(function () {
  // UI elements
  const logEl = document.getElementById('log');
  const video = document.getElementById('video');         // foreground (clear)
  // const bgVideo = document.getElementById('bg-video'); // removed (not used)
  const canvas = document.getElementById('canvas');      // hidden capture canvas
  const startBtn = document.getElementById('start-button');
  const voiceBtn = document.getElementById('voice-btn');
  const voiceStatus = document.getElementById('voice-status');
  const overlay = document.getElementById('overlay');
  const overlayCtx = overlay ? overlay.getContext('2d') : null;

  // state
  let ws = null;
  let streamRef = null;
  let readyWS = false;
  let readyCam = false;
  let awaitingResponse = false;

  // running state controlled by big button
  let running = false;

  // Voice state
  let recognition = null;
  let recognizing = false;
  let torchOn = false;

  let pendingTTS = null;        // содержит самый свежий текст, который нужно сказать после текущего
  let currentUtterance = null;  // объект SpeechSynthesisUtterance, который сейчас говорит (или null)

  // helpers
  function log(...args) {
    try {
      if (logEl) {
        logEl.textContent += args.join(' ') + '\n';
        logEl.scrollTop = logEl.scrollHeight;
      }
    } catch (e) { /* ignore UI errors */ }
    console.log(...args);
  }

  function isSecureContextOrLocalhost() {
    return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    if (window.ReactNativeWebView) return true;
    return /FBAV|FBAN|Instagram|Twitter|LinkedIn|Line|Puffin|UCBrowser|MicroMessenger|QQ\//i.test(ua);
  }

  // WebSocket
  function wsProtocol() {
    return location.protocol === 'https:' ? 'wss:' : 'ws:';
  }

  function createAndAwaitWS() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        readyWS = true;
        resolve();
        return;
      }

      const url = `${wsProtocol()}//${location.host}/ws`;
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        readyWS = true;
        log('[WS] connected', url);
        resolve();
      };

      ws.onmessage = (ev) => {
        try {
          const txt = typeof ev.data === 'string' ? ev.data : null;
          if (txt) {
            const msg = JSON.parse(txt);
            log('[WS] got response:', JSON.stringify(msg));

            // если пришли dets, то перерисовываем их
            if (msg.detections && Array.isArray(msg.detections)) {
              drawDetectionsOnOverlay(msg.detections);
            } else {
              // очистить overlay если пусто
              drawDetectionsOnOverlay([]);
            }

            // Разрешаем отправку следующего кадра сразу — не ждём окончания TTS.
            awaitingResponse = false;
            scheduleNextCapture();

            // Если текст для TTS есть и не состоит только из пробелов, ставим/обновляем pendingTTS.
            if (msg && typeof msg.text === 'string' && msg.text.trim().length > 0) {
              const newText = msg.text.trim();
              pendingTTS = newText; // перезаписываем предыдущую очередь — берем самый свежий
              log('[TTS] queued (latest replaces previous):', newText);
              // Если сейчас ничего не произносится и нет активного utterance — стартуем немедленно
              if (!speechSynthesis.speaking && !currentUtterance) {
                speakNextTTS();
              } else {
                log('[TTS] speaking in progress, will speak queued after current');
              }
            } else {
              log('[TTS] empty or missing text — nothing to speak');
            }
          } else {
            log('[WS] received non-text message');
            awaitingResponse = false;
            scheduleNextCapture();
          }
        } catch (e) {
          log('[WS] onmessage parse error', e);
          awaitingResponse = false;
          scheduleNextCapture();
        }
      };

      ws.onclose = (ev) => {
        readyWS = false;
        log('[WS] closed', ev && ev.code ? ev.code : '');
        // reconnect after a short delay, but only if still running
        if (running) {
          setTimeout(() => { initFlow().catch(e => log('reconnect init error', e)); }, 1000);
        }
      };

      ws.onerror = (e) => {
        log('[WS] error', e && e.message ? e.message : e);
      };

      // safety timeout
      setTimeout(() => {
        if (!readyWS) reject(new Error('WS connect timeout'));
      }, 5000);
    });
  }

  function waitForWsClosed(timeoutMs = 2000) {
    return new Promise((resolve) => {
      try {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        // если уже OPEN, то не ждём закрытия
        if (ws.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        // ожидаем событие close
        const onClose = () => {
          try { ws.removeEventListener('close', onClose); } catch (_) {}
          resolve();
        };
        try {
          ws.addEventListener('close', onClose);
        } catch (_) {
          // если невозможно повесить слушатель — просто таймаут
        }
        // fallback таймаут
        setTimeout(() => {
          try { ws.removeEventListener && ws.removeEventListener('close', onClose); } catch (_) {}
          resolve();
        }, timeoutMs);
      } catch (e) {
        // на всякий случай
        resolve();
      }
    });
  }

  async function ensureWSAlive() {
    // уже готов
    if (ws && ws.readyState === WebSocket.OPEN) {
      readyWS = true;
      return;
    }

    // если в процессе закрытия, подождём закрытия
    if (ws && ws.readyState === WebSocket.CLOSING) {
      log('[WS] waiting for existing socket to close before creating new one');
      await waitForWsClosed(2000);
    }

    // Попробуем создать WS (первый раз)
    try {
      await createAndAwaitWS();
      return;
    } catch (e) {
      log('[WS] first create failed', e);
      // аккуратно закрываем старый объект, если он есть
      try { if (ws) { try { ws.close(); } catch(_){} ws = null; readyWS = false; } } catch(_) {}
      // небольшая пауза и повтор
      await new Promise(r => setTimeout(r, 300));
      try {
        await createAndAwaitWS();
        return;
      } catch (e2) {
        log('[WS] second create failed', e2);
        throw e2;
      }
    }
  }

  // Camera
  async function startCamera() {
    try {
      log('[CAM] starting camera: secure?', isSecureContextOrLocalhost(), 'in-app?', isInAppBrowser());
      if (!isSecureContextOrLocalhost()) {
        const msg = 'Страница не в безопасном контексте (HTTPS или localhost required) — камера может не работать.';
        log('[CAM] ' + msg);
        throw new Error('insecure-context');
      }
      // Prefer modern API
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // Prefer portrait (vertical phone). Use ideal hints; browser may adapt.
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 720 },
            height: { ideal: 1280 }
          },
          audio: false
        };
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef = s;
      } else {
        // legacy fallback
        const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        if (!getUserMedia) throw new Error('no-getusermedia');
        streamRef = await new Promise((resolve, reject) => {
          getUserMedia.call(navigator, { video: true, audio: false }, resolve, reject);
        });
      }
      // assign stream to video
      if (!video) throw new Error('no-video-element');
      try {
        video.srcObject = streamRef;
        video.addEventListener('loadedmetadata', () => { syncOverlaySize(); });
        window.addEventListener('resize', () => { syncOverlaySize(); });

        await video.play().catch(() => {});
      } catch (e) {
        log('[CAM] play foreground error', e);
      }

      readyCam = true;
      log('[CAM] ready');
    } catch (e) {
      readyCam = false;
      // user-friendly messages
      if (e && e.name === 'NotAllowedError') {
        log('[CAM] Доступ к камере запрещён (NotAllowedError). Проверьте разрешения сайта в браузере.');
      } else if (e && e.name === 'NotFoundError') {
        log('[CAM] Камера не найдена (NotFoundError).');
      } else if (e && e.message === 'insecure-context') {
        log('[CAM] Ошибка: требуется HTTPS или локальный хост (localhost).');
      } else if (e && e.message === 'no-getusermedia') {
        log('[CAM] getUserMedia не поддерживается в этом браузере/контексте.');
      } else {
        log('[CAM] Ошибка доступа к камере:', e && (e.message || e.name) ? (e.message || e.name) : e);
      }
      throw e;
    }
  }

  function stopCamera() {
    try {
      if (streamRef) {
        streamRef.getTracks().forEach(t => {
          try { t.stop(); } catch (_) { }
        });
      }
    } finally {
      streamRef = null;
      if (video) {
        try { video.pause(); } catch (_) { }
        try { video.srcObject = null; } catch (_) { }
      }
      readyCam = false;
      log('[CAM] stopped');
    }
  }

  // capture frame => ArrayBuffer
  function captureToArrayBuffer() {
    if (!canvas || !video) return Promise.resolve(null);

    // ensure sizes are synced: hidden canvas should match video pixels
    try {
      // prefer intrinsic video dimensions (actual pixels)
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;

      if (vw && vh) {
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
        }
      } else {
        // fallback to overlay or client size
        const rect = video.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
    } catch (e) {
      // ignore sizing errors
    }

    const ctx = canvas.getContext('2d');
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      log('[CAPTURE] drawImage failed', e);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        blob.arrayBuffer().then(resolve).catch(() => resolve(null));
      }, 'image/jpeg', 0.7);
    });
  }

  // sending logic
  async function sendOneIfReady() {
    if (!running) {
      log('[SEND] not running, skipping');
      return;
    }
    if (!readyCam || !readyWS) {
      log('[SEND] not ready: readyCam=', readyCam, 'readyWS=', readyWS);
      return;
    }
    if (awaitingResponse) {
      log('[SEND] waiting for server response, skipping');
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('[SEND] WS not open, reconnecting...');
      try {
        await createAndAwaitWS();
      } catch (e) {
        log('[SEND] cannot open WS:', e);
        return;
      }
    }
    try {
      const arr = await captureToArrayBuffer();
      if (!arr) { log('[SEND] cannot capture frame'); return; }
      log('[SEND] sending bytes=', arr.byteLength);
      awaitingResponse = true;
      ws.send(arr);
    } catch (e) {
      log('[SEND] send error', e);
      awaitingResponse = false;
    }
  }

  function scheduleNextCapture(delayMs = 50) {
    setTimeout(() => sendOneIfReady(), delayMs);
  }

  // init flow
  async function initFlow() {
    log('[INIT] starting initFlow');
    try {
      // create ws and camera in parallel, but we want to fail if camera fails
      const wsTask = createAndAwaitWS().catch(e => { log('[INIT] WS init failed:', e); });
      const camTask = startCamera().catch(e => { log('[INIT] Cam init failed:', e); throw e; });

      await Promise.allSettled([wsTask, camTask]);

      if (!readyCam) {
        log('[INIT] Camera not ready — stopping initFlow');
        return;
      }
      if (!readyWS) {
        log('[INIT] WS not ready — will attempt to send when ready');
      }
      log('[INIT] starting send cycle');
      await sendOneIfReady();
    } catch (e) {
      log('[INIT] initFlow error', e);
    }
  }

  // Voice recognition (SpeechRecognition) + helpers

  function createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) return null;

    const r = new SpeechRecognition();
    r.lang = 'ru-RU';
    r.interimResults = false;
    // enable continuous listening so user can say commands anytime
    r.continuous = true;
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
      // Auto-restart recognition if app still running to keep listening
      if (running) {
        // small delay to avoid tight restart loop on persistent errors
        setTimeout(() => {
          try {
            r.start();
          } catch (e) {
            log('[VOICE] restart after end failed', e);
          }
        }, 300);
      }
    };
    r.onerror = (ev) => {
      recognizing = false;
      updateVoiceUI();
      log('[VOICE] recognition error', ev && ev.error ? ev.error : ev);
      // on certain errors, recognition may stop; let onend handle restart if needed
    };
    r.onresult = (ev) => {
      try {
        const txt = ev.results[ev.results.length - 1][0].transcript;
        log('[VOICE] got:', txt);
        handleVoiceCommand(txt);
      } catch (e) {
        log('[VOICE] parse result error', e);
      }
    };
    return r;
  }

  function updateVoiceUI() {
    if (!voiceBtn || !voiceStatus) return;
    voiceBtn.setAttribute('aria-pressed', recognizing ? 'true' : 'false');
    voiceStatus.textContent = recognizing ? 'Слушаю…' : 'Ожидание';
  }

  async function ensureMicrophonePermission() {
    // Some browsers (esp. Safari) require an explicit getUserMedia audio request
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        // request audio-only permission (we don't need to keep this audio stream)
        await navigator.mediaDevices.getUserMedia({ audio: true });
        log('[VOICE] microphone permission granted');
        return true;
      } catch (e) {
        log('[VOICE] cannot get audio permission:', e && e.name ? e.name : e);
        return false;
      }
    }
    // If API not present, then cannot request; return false but still try recognition if implemented
    return false;
  }

  async function startRecognition() {
    // ensure we have permission first where needed
    const micOk = await ensureMicrophonePermission().catch(() => false);
    recognition = createRecognition();
    if (!recognition) {
      log('[VOICE] SpeechRecognition API not supported in this browser');
      if (voiceStatus) voiceStatus.textContent = 'SpeechRecognition не поддерживается';
      return;
    }
    if (!micOk) {
      // It's possible recognition still works (browser handles permission internally), but warn
      log('[VOICE] микрофон не подтверждён; распознавание может не работать полноценно');
    }
    try {
      recognition.start();
    } catch (e) {
      log('[VOICE] recognition.start failed', e);
      // try to request mic explicitly and start again
      const ok = await ensureMicrophonePermission().catch(() => false);
      if (ok) {
        try { recognition.start(); } catch (e2) { log('[VOICE] recognition.start after permission failed', e2); }
      }
    }
  }

  async function stopRecognition() {
    try {
      if (recognition) {
        try {
          recognition.stop();
        } catch (_) { }
        // allow onend to run then drop reference
        recognition = null;
      }
    } catch (e) {
      log('[VOICE] stopRecognition error', e);
    } finally {
      recognizing = false;
      updateVoiceUI();
    }
  }

  async function toggleRecognition() {
    if (!recognition) {
      await startRecognition();
      return;
    }
    if (recognizing) {
      try { recognition.stop(); } catch (_) { }
    } else {
      try { recognition.start(); } catch (e) {
        log('[VOICE] recognition.start error', e);
        const ok = await ensureMicrophonePermission().catch(() => false);
        if (ok) {
          try { recognition.start(); } catch (e2) { log('[VOICE] start after permission failed', e2); }
        }
      }
    }
  }

  function handleVoiceCommand(rawText) {
    const text = (rawText || '').toLowerCase().trim();
    // Torch
    if (text.includes('включить камеру') || text.includes('включи камеру') || text.includes('старт камера')) {
      startCamera()
        .then(async () => {
          log('[VOICE] startCamera OK via voice');

          awaitingResponse = false;

          try {
            await ensureWSAlive();
            log('[VOICE] WS ensured after camera start');
          } catch (e) {
            log('[VOICE] Не удалось восстановить WS после старта камеры:', e);
            speakTTS('Камера включена, но соединение с сервером не установлено');
          }

          scheduleNextCapture(100);

          speakTTS('Камера включена');
        })
        .catch(e => {
          log('[VOICE] startCamera error', e);
          speakTTS('Не удалось включить камеру');
        });
      return;
    }

    if (text.includes('включи фонарик') || text.includes('включить фонарик') || text.includes('фонарик включи')) {
      enableTorch(true);
      speakTTS('Фонарик включен');
      return;
    }

    if (text.includes('выключи фонарик') || text.includes('выключить фонарик') || text.includes('фонарик выключи')) {
      enableTorch(false);
      speakTTS('Фонарик выключаю');
      return;
    }

    // Camera stop/start
    if (text.includes('стоп камера') || text.includes('останови камеру') || text.includes('выключи камеру')) {
      stopCamera();
      speakTTS('Камера остановлена');
      return;
    }
    if (text.includes('включить камеру') || text.includes('включи камеру') || text.includes('старт камера')) {
      startCamera().then(() => speakTTS('Камера включена')).catch(e => { log('[VOICE] startCamera error', e); speakTTS('Не удалось включить камеру'); });
      return;
    }

    if (text === 'стоп') {
      stopAll();
      speakTTS('Остановлено');
      return;
    }

    log('[VOICE] команда не распознана:', text);
  }

  // TTS queue — enqueue version (keep only this)
  function speakNextTTS() {
    if (!pendingTTS) return;
    const textToSpeak = pendingTTS;
    pendingTTS = null; // забираем в работу — последующие сообщения перезапишут следующий pending
    try {
      currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
      currentUtterance.lang = 'ru-RU';
      currentUtterance.onend = () => {
        log('[TTS] finished:', textToSpeak);
        currentUtterance = null;
        // Если за время говорения накопился новый pending — говорим его
        setTimeout(() => {
          if (pendingTTS) {
            speakNextTTS();
          }
        }, 30);
      };
      currentUtterance.onerror = (e) => {
        log('[TTS] utterance error', e);
        currentUtterance = null;
        // попробуем следующий, если есть
        setTimeout(() => { if (pendingTTS) speakNextTTS(); }, 30);
      };
      window.speechSynthesis.speak(currentUtterance);
      log('[TTS] speaking:', textToSpeak);
    } catch (e) {
      log('[TTS] speak error', e);
      currentUtterance = null;
    }
  }

  // Enqueue speakTTS (public)
  function speakTTS(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;
    pendingTTS = text.trim();
    // Если ничего не говорит — начнём сразу
    if (!speechSynthesis.speaking && !currentUtterance) {
      speakNextTTS();
    } else {
      log('[TTS] enqueued (will speak after current):', pendingTTS);
    }
  }

  // Torch control
  async function enableTorch(shouldEnable) {
    try {
      if (!streamRef) {
        log('[TORCH] Нет активного видеопотока');
        return;
      }
      const track = streamRef.getVideoTracks()[0];
      if (!track) { log('[TORCH] Нет видеодорожки'); return; }

      const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      if (!capabilities || !('torch' in capabilities)) {
        log('[TORCH] torch capability not supported');
        return;
      }

      try {
        await track.applyConstraints({ advanced: [{ torch: !!shouldEnable }] });
        torchOn = !!shouldEnable;
        log('[TORCH] set', torchOn);
      } catch (e) {
        log('[TORCH] applyConstraints error, trying ImageCapture fallback', e);
        try {
          if (window.ImageCapture) {
            const ic = new ImageCapture(track);
            if (ic && typeof ic.setOptions === 'function') {
              await ic.setOptions({ torch: !!shouldEnable });
              torchOn = !!shouldEnable;
              log('[TORCH] set via ImageCapture', torchOn);
            } else {
              log('[TORCH] ImageCapture does not support setOptions on this platform');
            }
          } else {
            log('[TORCH] ImageCapture not available');
          }
        } catch (e2) {
          log('[TORCH] ImageCapture fallback error', e2);
        }
      }
    } catch (e) {
      log('[TORCH] unexpected error', e);
    }
  }

  // Start/Stop app
  async function startAll() {
    if (running) {
      log('[APP] already running');
      return;
    }
    running = true;
    updateStartUI();
    try {
      await initFlow();
      // start listening for voice commands as soon as we started camera/ws
      await startRecognition();
    } catch (e) {
      log('[APP] startAll error', e);
    }
  }

  function stopAll() {
    if (!running) return;
    running = false;
    updateStartUI();
    try {
      // cancel TTS and recognition
      try { window.speechSynthesis.cancel(); } catch(_) {}
      pendingTTS = null;
      currentUtterance = null;
      try { if (recognition && recognizing) recognition.stop(); } catch (_) {}
      // close ws
      try { if (ws) ws.close(); } catch (_) {}
      ws = null;
      readyWS = false;
      // stop camera
      stopCamera();
      // clear overlay
      clearOverlay();
      // stop recognition fully
      stopRecognition().catch(() => {});
      awaitingResponse = false;
      log('[APP] stopped');
    } catch (e) {
      log('[APP] stopAll error', e);
    }
  }

  function updateStartUI() {
    if (!startBtn) return;
    if (running) {
      startBtn.textContent = 'СТОП';
      startBtn.setAttribute('aria-pressed', 'true');
    } else {
      startBtn.textContent = 'НАЧАТЬ';
      startBtn.setAttribute('aria-pressed', 'false');
    }
  }

  // Sync overlay size so canvas covers exact visible video area and internal pixel size matches video stream
  function syncOverlaySize() {
    if (!overlay || !video) return;

    // get visible rect (CSS pixels)
    const rect = video.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));

    // set CSS size so overlay covers same visible area
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';

    // set internal pixel buffer to actual video pixel size if available (better precision)
    const vidW = video.videoWidth || 0;
    const vidH = video.videoHeight || 0;

    if (vidW && vidH) {
      if (overlay.width !== vidW || overlay.height !== vidH) {
        overlay.width = vidW;
        overlay.height = vidH;
      }
    } else {
      // fallback: match CSS size (approx)
      if (overlay.width !== cssW || overlay.height !== cssH) {
        overlay.width = cssW;
        overlay.height = cssH;
      }
    }
  }

  function drawDetectionsOnOverlay(detections) {
    if (!overlayCtx || !overlay) return;
    syncOverlaySize();
    const W = overlay.width;
    const H = overlay.height;

    // очистка
    overlayCtx.clearRect(0, 0, W, H);

    if (!Array.isArray(detections) || detections.length === 0) return;

    overlayCtx.lineWidth = 3;
    overlayCtx.font = '18px sans-serif';
    overlayCtx.textBaseline = 'top';

    detections.forEach(det => {
      try {
        const box = det.bbox_norm || det.bbox || null;
        if (!box) return;
        // bbox_norm: [nx1, ny1, nx2, ny2]
        const nx1 = Number(box[0]), ny1 = Number(box[1]), nx2 = Number(box[2]), ny2 = Number(box[3]);
        if (![nx1, ny1, nx2, ny2].every(v => isFinite(v))) return;

        // clamp 0..1
        const cx1 = Math.min(1, Math.max(0, nx1));
        const cy1 = Math.min(1, Math.max(0, ny1));
        const cx2 = Math.min(1, Math.max(0, nx2));
        const cy2 = Math.min(1, Math.max(0, ny2));

        const x1 = Math.round(cx1 * W);
        const y1 = Math.round(cy1 * H);
        const x2 = Math.round(cx2 * W);
        const y2 = Math.round(cy2 * H);
        const bw = Math.max(2, x2 - x1);
        const bh = Math.max(2, y2 - y1);

        // цвет по категории расстояния (пример)
        let color = 'lime';
        if (det.distance_cat === 'очень близко') color = 'red';
        else if (det.distance_cat === 'близко') color = 'orange';

        // рамка
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeRect(x1, y1, bw, bh);

        // подпись: класс + проценты + расстояние
        let label = det.class || det.object || '';
        if (typeof det.confidence === 'number') {
          label += ' ' + Math.round(det.confidence * 100) + '%';
        } else if (det.confidence) {
          const c = Number(det.confidence);
          if (!isNaN(c)) label += ' ' + Math.round(c * 100) + '%';
        }
        if (det.distance_m) {
          label += ' ' + (Number(det.distance_m).toFixed(1)) + 'm';
        }

        const padding = 6;
        const metrics = overlayCtx.measureText(label);
        const tw = metrics.width;
        const th = 18; // approx

        let textX = x1 + 3;
        let textY = y1 - th - 4;
        let bgX = x1 - padding / 2;
        let bgY = y1 - th - padding / 2;

        if (textY < 0) {
          // рисуем надпись внутри рамки сверху
          textY = y1 + 4;
          bgY = y1 + 2;
        }

        overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
        overlayCtx.fillRect(bgX, bgY, tw + padding, th + padding / 2);
        overlayCtx.fillStyle = 'white';
        overlayCtx.fillText(label, textX, textY);
      } catch (e) {
        console.error('draw det error', e);
      }
    });
  }

  function clearOverlay() {
    if (!overlayCtx || !overlay) return;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  }

  // Wire UI
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (running) {
        stopAll();
      } else {
        startAll();
      }
    });
    updateStartUI();
  }

  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      toggleRecognition().catch(e => log('[VOICE] toggle error', e));
    });
    updateVoiceUI();
  }

  // Start on load? we don't auto start because UI has big start button.
  window.addEventListener('load', () => {
    if (isInAppBrowser()) {
      log('[ENV] Похоже, вы используете встроенный браузер приложения. Если камера/микрофон не работают, откройте страницу в Chrome/Safari.');
    }
    // do not call initFlow here; wait for user to press НАЧАТЬ
  });

  window.addEventListener('beforeunload', () => {
    try { if (ws) ws.close(); } catch (_) { }
    stopCamera();
  });

  // Expose some functions for debugging in console (optional)
  window.__app_client = {
    startAll,
    stopAll,
    startCamera,
    stopCamera,
    enableTorch,
    toggleRecognition,
    clearOverlay,
    syncOverlaySize,
    getState: () => ({ running, readyCam, readyWS, awaitingResponse, streamRefExists: !!streamRef, torchOn, recognizing })
  };

})();
