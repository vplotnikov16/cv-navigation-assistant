// app/static/js/index.js
// Универсальный клиент JS: камера, WebSocket, TTS, голосовые команды (robust для Chromium/Safari/desktop/mobile).
// Подключается с `defer` — DOM уже готов.

(function () {
  // UI elements
  const logEl = document.getElementById('log');
  const video = document.getElementById('video');         // foreground (clear)
  const bgVideo = document.getElementById('bg-video');   // background (blurred via CSS)
  const canvas = document.getElementById('canvas');
  const startBtn = document.getElementById('start-button');
  const voiceBtn = document.getElementById('voice-btn');
  const voiceStatus = document.getElementById('voice-status');

  // state
  let ws = null;
  let streamRef = null;
  let readyWS = false;
  let readyCam = false;
  let awaitingResponse = false;

  // running state controlled by big button
  let running = false;

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
            awaitingResponse = false;
            if (msg && msg.text) {
              try {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(msg.text);
                u.lang = 'ru-RU';
                u.onend = () => {
                  log('[TTS] finished');
                  scheduleNextCapture();
                };
                window.speechSynthesis.speak(u);
                log('[TTS] speaking:', msg.text);
              } catch (e) {
                log('[TTS] error:', e);
                scheduleNextCapture();
              }
            } else {
              scheduleNextCapture();
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
            height: { ideal: 1280 },
            // Do not request audio here for camera; voice uses separate request when needed.
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
      // assign stream to both foreground and background videos
      if (!video) throw new Error('no-video-element');
      try {
        video.srcObject = streamRef;
        // Some browsers require explicit play()
        await video.play().catch(() => {});
      } catch (e) {
        log('[CAM] play foreground error', e);
      }

      if (bgVideo) {
        try {
          // Use the same stream for background
          bgVideo.srcObject = streamRef;
          await bgVideo.play().catch(() => {});
        } catch (e) {
          log('[CAM] play background error', e);
        }
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
      if (bgVideo) {
        try { bgVideo.pause(); } catch (_) { }
        try { bgVideo.srcObject = null; } catch (_) { }
      }
      readyCam = false;
      log('[CAM] stopped');
    }
  }

  // capture frame => ArrayBuffer
  function captureToArrayBuffer() {
    if (!canvas || !video) return Promise.resolve(null);
    // adjust canvas size to video dimensions if available
    try {
      const w = video.videoWidth || canvas.width || 640;
      const h = video.videoHeight || canvas.height || 480;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    } catch (e) {
      // ignore
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

  // Voice recognition (SpeechRecognition) + torch control
  let recognition = null;
  let recognizing = false;
  let torchOn = false;

  function createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) return null;

    const r = new SpeechRecognition();
    r.lang = 'ru-RU';
    r.interimResults = false;
    r.continuous = false;
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
    if (!voiceBtn || !voiceStatus) return;
    voiceBtn.setAttribute('aria-pressed', recognizing ? 'true' : 'false');
    voiceStatus.textContent = recognizing ? 'Слушаю…' : 'Ожидание';
  }

  async function ensureMicrophonePermission() {
    // Some browsers (esp. Safari) may require an explicit getUserMedia audio request
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        return true;
      } catch (e) {
        log('[VOICE] cannot get audio permission:', e && e.name ? e.name : e);
        return false;
      }
    }
    return false;
  }

  async function toggleRecognition() {
    if (!recognition) {
      recognition = createRecognition();
      if (!recognition) {
        // try to request mic first (Safari may require) and rebuild recognition
        const micOk = await ensureMicrophonePermission().catch(() => false);
        recognition = createRecognition();
        if (!recognition) {
          log('[VOICE] SpeechRecognition API not supported in this browser');
          if (voiceStatus) voiceStatus.textContent = 'SpeechRecognition не поддерживается';
          return;
        } else if (!micOk) {
          log('[VOICE] Микрофон не доступен/разрешение не получено — распознавание может не работать');
        }
      }
    }

    if (recognizing) {
      try { recognition.stop(); } catch (_) { }
    } else {
      try { recognition.start(); } catch (e) {
        log('[VOICE] recognition.start error', e);
        // try requesting mic then restart
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
    if (text.includes('включи фонарик') || text.includes('включить фонарик') || text.includes('фонарик включи')) {
      enableTorch(true);
      speakTTS('Фонарик включаю');
      return;
    }
    if (text.includes('выключи фонарик') || text.includes('выключить фонарик') || text.includes('фонарик выключи')) {
      enableTorch(false);
      speakTTS('Фонарик выключаю');
      return;
    }

    // Camera stop/start
    if (text.includes('стоп камера') || text.includes('останови камеру') || text.includes('выключи камеру')) {
      // stop camera but keep app running
      stopCamera();
      speakTTS('Камера остановлена');
      return;
    }
    if (text.includes('включить камеру') || text.includes('включи камеру') || text.includes('старт камера')) {
      startCamera().then(() => speakTTS('Камера включена')).catch(e => { log('[VOICE] startCamera error', e); speakTTS('Не удалось включить камеру'); });
      return;
    }

    if (text === 'стоп') {
      // stop entire app
      stopAll();
      speakTTS('Остановлено');
      return;
    }

    log('[VOICE] команда не распознана:', text);
    speakTTS('Команда не распознана');
  }

  function speakTTS(text) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      window.speechSynthesis.speak(u);
    } catch (e) {
      log('[TTS] speak error', e);
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
      try { if (recognition && recognizing) recognition.stop(); } catch (_) {}
      // close ws
      try { if (ws) ws.close(); } catch (_) {}
      ws = null;
      readyWS = false;
      // stop camera
      stopCamera();
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
    getState: () => ({ running, readyCam, readyWS, awaitingResponse, streamRefExists: !!streamRef, torchOn })
  };

})();
