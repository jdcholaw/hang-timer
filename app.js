'use strict';

// ===== 매달리기 타이머 / Hang Timer — 한국어·영어 음성 코치 =====
// 전부 로컬에서 동작. 서버 전송 없음.

(function () {
  const htmlRoot = document.getElementById('htmlRoot');
  const pageTitle = document.getElementById('pageTitle');
  const titleEl = document.getElementById('title');
  const timerEl = document.getElementById('timer');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const intervalSelect = document.getElementById('intervalSelect');
  const intervalLabel = document.getElementById('intervalLabel');
  const testVoiceBtn = document.getElementById('testVoiceBtn');
  const statusEl = document.getElementById('status');
  const noticeEl = document.getElementById('notice');
  const countdownToggle = document.getElementById('countdownToggle');
  const countdownLabel = document.getElementById('countdownLabel');
  const elapsedToggle = document.getElementById('elapsedToggle');
  const elapsedLabel = document.getElementById('elapsedLabel');
  const langSelect = document.getElementById('langSelect');
  const langLabel = document.getElementById('langLabel');

  // ---- 다국어 문자열 (한국어 / English) ----
  const I18N = {
    ko: {
      voiceLang: 'ko-KR',
      title: '매달리기 타이머',
      start: '시작', pause: '일시정지', resume: '재개', reset: '초기화',
      intervalLabel: '안내 간격',
      countdownLabel: '시작 카운트다운 (시작하겠습니다 · 5·4·3·2·1)',
      elapsedLabel: "안내에 '경과' 붙이기 (끄면 \"10초\"처럼 숫자만)",
      voiceTest: '음성 테스트',
      langLabel: '언어 / Language',
      idle: '대기 중. 시작을 누르세요.',
      paused: '일시정지됨', resumed: '재개됨',
      starting: '시작합니다', go: '시작', getReady: '시작하겠습니다', wellDone: '수고하셨습니다',
      voiceTestPrefix: '음성 테스트. ',
      noSpeech: '음성 합성 미지원 브라우저입니다. 안내 시 화면 표시와 비프/진동으로 대체합니다.',
      noWakeLock: '이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다. 화면 자동 잠금을 길게 설정하세요.',
      intervals: { 5: '5초', 10: '10초', 15: '15초', 30: '30초', 60: '1분', 300: '5분', 600: '10분', 1800: '30분', 3600: '1시간' }
    },
    en: {
      voiceLang: 'en-US',
      title: 'Hang Timer',
      start: 'Start', pause: 'Pause', resume: 'Resume', reset: 'Reset',
      intervalLabel: 'Announce interval',
      countdownLabel: 'Start countdown (Get ready · 5·4·3·2·1)',
      elapsedLabel: 'Say "elapsed" (off = just "10 seconds")',
      voiceTest: 'Voice test',
      langLabel: '언어 / Language',
      idle: 'Ready. Press Start.',
      paused: 'Paused', resumed: 'Resumed',
      starting: 'Starting', go: 'Start', getReady: 'Get ready', wellDone: 'Well done',
      voiceTestPrefix: 'Voice test. ',
      noSpeech: 'Speech synthesis is not supported. Falling back to on-screen text, beep, and vibration.',
      noWakeLock: 'This browser cannot keep the screen awake. Set a long screen-lock timeout.',
      intervals: { 5: '5 sec', 10: '10 sec', 15: '15 sec', 30: '30 sec', 60: '1 min', 300: '5 min', 600: '10 min', 1800: '30 min', 3600: '1 hour' }
    }
  };

  // ---- 상태 ----
  let lang = localStorage.getItem('hangtimer.lang') || 'ko';
  if (!I18N[lang]) lang = 'ko';
  let running = false;
  let startTime = 0;       // performance.now() 기준 시작 시각
  let accumulated = 0;     // 일시정지 누적 경과(ms)
  let rafId = null;
  let lastAnnounced = 0;   // 마지막으로 안내한 간격 경계(초)
  let wakeLock = null;

  function t(key) { return I18N[lang][key]; }

  // ---- 기능 지원 여부 ----
  const supportsSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const supportsVibrate = 'vibrate' in navigator;
  const supportsWakeLock = 'wakeLock' in navigator;
  let audioCtx = null;

  // ---- 음성: 현재 언어 voice 우선 ----
  let voice = null;
  function pickVoice() {
    if (!supportsSpeech) return;
    const want = (lang === 'en') ? 'en' : 'ko';
    const voices = window.speechSynthesis.getVoices();
    voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(want)) || null;
  }
  if (supportsSpeech) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  // ---- UI 언어 적용 ----
  function applyLanguage() {
    const L = I18N[lang];
    htmlRoot.lang = (lang === 'en') ? 'en' : 'ko';
    pageTitle.textContent = L.title;
    titleEl.textContent = L.title;
    startBtn.textContent = L.start;
    pauseBtn.textContent = running ? L.pause : (accumulated > 0 ? L.resume : L.pause);
    resetBtn.textContent = L.reset;
    intervalLabel.textContent = L.intervalLabel;
    countdownLabel.textContent = L.countdownLabel;
    elapsedLabel.textContent = L.elapsedLabel;
    testVoiceBtn.textContent = L.voiceTest;
    langLabel.textContent = L.langLabel;
    Array.prototype.forEach.call(intervalSelect.options, (opt) => {
      const lbl = L.intervals[opt.value];
      if (lbl) opt.textContent = lbl;
    });
    // 정지 상태일 때만 안내문을 대기 문구로(작동 중엔 다음 안내가 갱신)
    if (!running && accumulated === 0) statusEl.textContent = L.idle;
  }

  // ---- 시간 포맷 ----
  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds % 60);
    const m = Math.floor((totalSeconds / 60) % 60);
    const h = Math.floor(totalSeconds / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  // ---- 안내 문구: "N초/분/시간 (경과)" / "N second(s) (elapsed)" ----
  function buildAnnouncement(seconds) {
    const withElapsed = (!elapsedToggle || elapsedToggle.checked);
    if (lang === 'en') {
      let n, unit;
      if (seconds % 3600 === 0) { n = seconds / 3600; unit = 'hour'; }
      else if (seconds % 60 === 0) { n = seconds / 60; unit = 'minute'; }
      else { n = seconds; unit = 'second'; }
      return `${n} ${unit}${n === 1 ? '' : 's'}${withElapsed ? ' elapsed' : ''}`;
    }
    const suffix = withElapsed ? ' 경과' : '';
    if (seconds % 3600 === 0) return `${seconds / 3600}시간${suffix}`;
    if (seconds % 60 === 0) return `${seconds / 60}분${suffix}`;
    return `${seconds}초${suffix}`;
  }

  // ---- beep (음성 미지원 시 fallback) ----
  function beep() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.26);
    } catch (e) { /* 무시 */ }
  }

  // ---- 통합 안내: 음성 -> (실패/미지원) beep, 진동 동반 ----
  function announce(text, opts) {
    opts = opts || {};
    statusEl.textContent = text;
    if (supportsVibrate) {
      try { navigator.vibrate(opts.longVibe ? [120, 60, 120] : 80); } catch (e) {}
    }
    if (supportsSpeech) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = I18N[lang].voiceLang;
        if (voice) u.voice = voice;
        u.rate = 1.0;
        u.pitch = 1.0;
        window.speechSynthesis.speak(u);
        return;
      } catch (e) { /* 아래 fallback */ }
    }
    beep();
  }

  // ---- Wake Lock ----
  async function requestWakeLock() {
    if (!supportsWakeLock) { noticeEl.textContent = t('noWakeLock'); return; }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { /* released */ });
    } catch (e) { /* 무시 */ }
  }
  async function releaseWakeLock() {
    try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  });

  // ---- 메인 루프 ----
  function tick() {
    if (!running) return;
    const elapsedMs = accumulated + (performance.now() - startTime);
    const totalSeconds = elapsedMs / 1000;
    timerEl.textContent = formatTime(totalSeconds);
    const interval = parseInt(intervalSelect.value, 10);
    const wholeSeconds = Math.floor(totalSeconds);
    if (wholeSeconds >= interval && wholeSeconds % interval === 0 && wholeSeconds !== lastAnnounced) {
      lastAnnounced = wholeSeconds;
      announce(buildAnnouncement(wholeSeconds));
    }
    rafId = requestAnimationFrame(tick);
  }

  // ---- 컨트롤 ----
  function start(opts) {
    opts = opts || {};
    if (running) return;
    running = true;
    startTime = performance.now();
    lastAnnounced = Math.floor(accumulated / 1000); // 재개 시 중복 안내 방지
    noticeEl.textContent = '';
    if (!opts.silent) announce(t('starting')); // 카운트다운 끝엔 '시작'만 말하고 중복 방지
    requestWakeLock();
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
    pauseBtn.textContent = t('pause');
    intervalSelect.disabled = false;
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!running) { resume(); return; }
    running = false;
    accumulated += performance.now() - startTime;
    if (rafId) cancelAnimationFrame(rafId);
    releaseWakeLock();
    pauseBtn.textContent = t('resume');
    statusEl.textContent = t('paused');
  }

  function resume() {
    if (running) return;
    if (accumulated === 0) { start(); return; }
    running = true;
    startTime = performance.now();
    requestWakeLock();
    pauseBtn.textContent = t('pause');
    statusEl.textContent = t('resumed');
    rafId = requestAnimationFrame(tick);
  }

  function reset() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    releaseWakeLock();
    const hadTime = accumulated > 0 || startTime > 0;
    accumulated = 0;
    startTime = 0;
    lastAnnounced = 0;
    timerEl.textContent = formatTime(0);
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = true;
    pauseBtn.textContent = t('pause');
    if (hadTime) announce(t('wellDone'), { longVibe: true });
    else statusEl.textContent = t('idle');
  }

  // ---- 시작 카운트다운 ("시작하겠습니다 / Get ready. 5·4·3·2·1") ----
  let countdownActive = false;
  let countdownTimer = null;
  function runCountdown() {
    if (running || countdownActive) return;
    countdownActive = true;
    startBtn.disabled = true;
    intervalSelect.disabled = true;
    const seq = [t('getReady'), '5', '4', '3', '2', '1'];
    let i = 0;
    announce(seq[i]); statusEl.textContent = seq[i]; i++;
    countdownTimer = setInterval(() => {
      if (i < seq.length) {
        announce(seq[i]); statusEl.textContent = seq[i]; i++;
      } else {
        clearInterval(countdownTimer); countdownTimer = null;
        countdownActive = false;
        announce(t('go'));              // 구령 끝 "시작" / "Start"
        start({ silent: true });        // 타이머는 음성 없이 바로 (중복 방지)
      }
    }, 1000);
  }
  function onStartClick() {
    if (countdownToggle && countdownToggle.checked) runCountdown();
    else start();
  }

  // ---- 설정 복원/저장 ----
  // 언어 (한국어/English)
  langSelect.value = lang;
  langSelect.addEventListener('change', () => {
    lang = I18N[langSelect.value] ? langSelect.value : 'ko';
    localStorage.setItem('hangtimer.lang', lang);
    pickVoice();
    applyLanguage();
  });
  // 안내에 '경과' 붙일지
  const ELAPSED_KEY = 'hangtimer.sayElapsed';
  if (elapsedToggle) {
    const saved = localStorage.getItem(ELAPSED_KEY);
    if (saved !== null) elapsedToggle.checked = (saved === '1');
    elapsedToggle.addEventListener('change', () => {
      localStorage.setItem(ELAPSED_KEY, elapsedToggle.checked ? '1' : '0');
    });
  }

  // ---- 이벤트 ----
  startBtn.addEventListener('click', onStartClick);
  pauseBtn.addEventListener('click', pause); // 일시정지/재개 토글
  resetBtn.addEventListener('click', reset);
  testVoiceBtn.addEventListener('click', () => announce(t('voiceTestPrefix') + buildAnnouncement(5)));

  // ---- 초기화 ----
  applyLanguage();
  if (!supportsSpeech) noticeEl.textContent = t('noSpeech');
  timerEl.textContent = formatTime(0);

  // ---- Service Worker 등록 ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
