'use strict';

// ===== 매달리기 타이머 / Hang Timer Korean Coach =====
// 전부 로컬에서 동작. 서버 전송 없음.

(function () {
  const timerEl = document.getElementById('timer');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const intervalSelect = document.getElementById('intervalSelect');
  const testVoiceBtn = document.getElementById('testVoiceBtn');
  const statusEl = document.getElementById('status');
  const noticeEl = document.getElementById('notice');
  const countdownToggle = document.getElementById('countdownToggle');
  const elapsedToggle = document.getElementById('elapsedToggle');

  // ---- 설정 저장/복원: 안내에 '경과' 붙일지 (localStorage, 다음에도 유지) ----
  const ELAPSED_KEY = 'hangtimer.sayElapsed';
  if (elapsedToggle) {
    const saved = localStorage.getItem(ELAPSED_KEY);
    if (saved !== null) elapsedToggle.checked = (saved === '1');
    elapsedToggle.addEventListener('change', () => {
      localStorage.setItem(ELAPSED_KEY, elapsedToggle.checked ? '1' : '0');
    });
  }

  // ---- 상태 ----
  let running = false;
  let startTime = 0;       // performance.now() 기준 시작 시각
  let accumulated = 0;     // 일시정지 누적 경과(ms)
  let rafId = null;
  let lastAnnounced = 0;   // 마지막으로 안내한 간격 경계(초)
  let wakeLock = null;

  // ---- 기능 지원 여부 ----
  const supportsSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const supportsVibrate = 'vibrate' in navigator;
  const supportsWakeLock = 'wakeLock' in navigator;
  let audioCtx = null;

  // ---- 시간 포맷 ----
  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds % 60);
    const m = Math.floor((totalSeconds / 60) % 60);
    const h = Math.floor(totalSeconds / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  // ---- 한국어 안내 문구: "N초/분/시간 (경과)" — 체크박스로 '경과' on/off ----
  function buildAnnouncement(seconds) {
    const suffix = (!elapsedToggle || elapsedToggle.checked) ? ' 경과' : '';
    if (seconds % 3600 === 0) return `${seconds / 3600}시간${suffix}`;
    if (seconds % 60 === 0) return `${seconds / 60}분${suffix}`;
    return `${seconds}초${suffix}`;
  }

  // ---- 음성: ko-KR voice 우선 ----
  let koVoice = null;
  function pickKoreanVoice() {
    if (!supportsSpeech) return;
    const voices = window.speechSynthesis.getVoices();
    koVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ko')) || null;
  }
  if (supportsSpeech) {
    pickKoreanVoice();
    window.speechSynthesis.onvoiceschanged = pickKoreanVoice;
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
        u.lang = 'ko-KR';
        if (koVoice) u.voice = koVoice;
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
    if (!supportsWakeLock) {
      noticeEl.textContent = '이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다. 화면 자동 잠금을 길게 설정하세요.';
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { /* released */ });
    } catch (e) {
      noticeEl.textContent = '화면 꺼짐 방지를 켤 수 없습니다 (' + (e && e.name ? e.name : 'error') + ').';
    }
  }
  async function releaseWakeLock() {
    try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
  }
  // 화면 복귀 시 wake lock 재요청
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
    if (!opts.silent) announce('시작합니다'); // 카운트다운 끝엔 '시작'만 말하고 중복 방지
    requestWakeLock();
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
    pauseBtn.textContent = '일시정지';
    intervalSelect.disabled = false;
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!running) { resume(); return; }
    running = false;
    accumulated += performance.now() - startTime;
    if (rafId) cancelAnimationFrame(rafId);
    releaseWakeLock();
    pauseBtn.textContent = '재개';
    statusEl.textContent = '일시정지됨';
  }

  function resume() {
    if (running) return;
    if (accumulated === 0) { start(); return; }
    running = true;
    startTime = performance.now();
    requestWakeLock();
    pauseBtn.textContent = '일시정지';
    statusEl.textContent = '재개됨';
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
    pauseBtn.textContent = '일시정지';
    if (hadTime) announce('수고하셨습니다', { longVibe: true });
    else statusEl.textContent = '대기 중. 시작을 누르세요.';
  }

  // ---- 시작 카운트다운 ("시작하겠습니다. 5·4·3·2·1") ----
  let countdownActive = false;
  let countdownTimer = null;
  function runCountdown() {
    if (running || countdownActive) return;
    countdownActive = true;
    startBtn.disabled = true;
    intervalSelect.disabled = true;
    const seq = ['시작하겠습니다', '5', '4', '3', '2', '1'];
    let i = 0;
    announce(seq[i]); statusEl.textContent = seq[i]; i++;
    countdownTimer = setInterval(() => {
      if (i < seq.length) {
        announce(seq[i]); statusEl.textContent = seq[i]; i++;
      } else {
        clearInterval(countdownTimer); countdownTimer = null;
        countdownActive = false;
        announce('시작');               // 구령 끝 "시작"
        start({ silent: true });        // 타이머는 음성 없이 바로 (중복 방지)
      }
    }, 1000);
  }
  function onStartClick() {
    if (countdownToggle && countdownToggle.checked) runCountdown();
    else start();
  }

  // ---- 이벤트 ----
  startBtn.addEventListener('click', onStartClick);
  pauseBtn.addEventListener('click', pause); // 일시정지/재개 토글
  resetBtn.addEventListener('click', reset);
  testVoiceBtn.addEventListener('click', () => announce('음성 테스트. ' + buildAnnouncement(5)));

  // ---- 초기 안내 ----
  if (!supportsSpeech) {
    noticeEl.textContent = '음성 합성 미지원 브라우저입니다. 안내 시 화면 표시와 비프/진동으로 대체합니다.';
  }

  // ---- Service Worker 등록 ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  timerEl.textContent = formatTime(0);
})();
