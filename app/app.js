(function () {
  'use strict';

  const PICTURES = window.PICTURES || {};
  const ALL_LANGUAGES = window.ALL_LANGUAGES || [];
  const STORE_KEY = 'language-lessons-v1';
  const MAX_HEARTS = 5;
  const REFILL_MS = 30 * 60 * 1000;
  const DAILY_GOAL = 30;
  const REPO = 'https://github.com/leewonyoungethan/language';
  const PUNCT = /[.,!?;:¿¡。，！？、]/g;

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const sample = (a, n) => shuffle(a).slice(0, n);
  function uniqueBy(list, keyFn) {
    const seen = new Set();
    return list.filter((x) => {
      const k = keyFn(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function hashHue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  // 받침 유무로 조사 고르기 (괄호 속 설명은 건너뛰고 마지막 한글로 판단)
  function particle(word, withBatchim, without) {
    const hangul = word.replace(/\s*\(.*?\)\s*/g, '').match(/[가-힣]/g);
    if (!hangul) return withBatchim + '(' + without + ')';
    return (hangul[hangul.length - 1].charCodeAt(0) - 0xac00) % 28 ? withBatchim : without;
  }
  const topicJ = (w) => particle(w, '은', '는');
  const objectJ = (w) => particle(w, '을', '를');
  function mix(hex, other, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
    const ch = (x, s) => (x >> s) & 255;
    const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
    return '#' + ((1 << 24) + (m(16) << 16) + (m(8) << 8) + m(0)).toString(16).slice(1);
  }

  const app = $('#app');
  function render(html) {
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- saved state ----------
  const DEFAULTS = {
    course: null, xp: 0, streak: 0, lastDay: null,
    hearts: MAX_HEARTS, heartsAt: null,
    daily: { date: null, xp: 0 }, progress: {}, sound: true,
  };
  let S = load();
  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { saved = {}; }
    return Object.assign({}, DEFAULTS, saved);
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }
  function dayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dayStr(d);
  }
  const currentStreak = () => (S.lastDay === dayStr() || S.lastDay === yesterday() ? S.streak : 0);
  const dailyXp = () => (S.daily.date === dayStr() ? S.daily.xp : 0);
  function addXp(n) {
    S.xp += n;
    if (S.daily.date !== dayStr()) S.daily = { date: dayStr(), xp: 0 };
    S.daily.xp += n;
    if (S.lastDay !== dayStr()) {
      S.streak = S.lastDay === yesterday() ? S.streak + 1 : 1;
      S.lastDay = dayStr();
    }
    save();
  }
  function syncHearts() {
    if (S.hearts >= MAX_HEARTS) {
      S.hearts = MAX_HEARTS;
      S.heartsAt = null;
      return;
    }
    if (!S.heartsAt) S.heartsAt = Date.now();
    const n = Math.floor((Date.now() - S.heartsAt) / REFILL_MS);
    if (n > 0) {
      S.hearts = Math.min(MAX_HEARTS, S.hearts + n);
      S.heartsAt = S.hearts >= MAX_HEARTS ? null : S.heartsAt + n * REFILL_MS;
    }
  }
  function loseHeart() {
    syncHearts();
    if (S.hearts >= MAX_HEARTS) S.heartsAt = Date.now();
    S.hearts = Math.max(0, S.hearts - 1);
    save();
  }
  function gainHeart() {
    syncHearts();
    S.hearts = Math.min(MAX_HEARTS, S.hearts + 1);
    if (S.hearts >= MAX_HEARTS) S.heartsAt = null;
    save();
  }
  function nextHeartMinutes() {
    if (!S.heartsAt) return 0;
    return Math.max(1, Math.ceil((S.heartsAt + REFILL_MS - Date.now()) / 60000));
  }

  // ---------- courses ----------
  const COURSES = (window.COURSES || []).slice();
  buildBasicCourses();
  COURSES.forEach(prepare);

  // 기초 코스: 공통 단어 25개(BASIC_CORE)에 언어별 번역(BASIC_LANGS)과 한글 발음(BASIC_PRON)을 붙여요.
  function buildBasicCourses() {
    const core = window.BASIC_CORE, pron = window.BASIC_PRON || {};
    if (!core) return;
    (window.BASIC_LANGS || []).forEach((b) => {
      if (COURSES.some((c) => c.id === b.id)) return;
      const words = b.w.split(';').map((s) => s.trim());
      const hs = pron[b.id] ? pron[b.id].ko.split(';').map((s) => s.trim()) : [];
      if (words.length !== core.keys.length) console.warn('basic course word count', b.id, words.length);
      if (hs.length && hs.length !== core.keys.length) console.warn('basic pron count', b.id, hs.length);
      const latin = words.every((w) => !w.includes('|'));
      const chars = latin
        ? uniqueBy((words.join('').toLowerCase().match(/[^\x00-\x7f]/g) || []).filter((c) => /\p{L}/u.test(c)), (c) => c).slice(0, 10)
        : [];
      COURSES.push({
        id: b.id, name: b.name, lang: b.lang, tts: b.tts, rtl: !!b.rtl, joiner: ' ', basic: true,
        typing: latin, chars: chars.length ? chars : null,
        guide: `${REPO}/blob/main/${b.id}.md`, tips: pron[b.id] ? pron[b.id].tips : [],
        units: core.units.map((u) => Object.assign({}, u, {
          lessons: u.lessons.map((l) => ({
            title: l.title,
            items: l.idx.filter((i) => words[i]).map((i) => {
              const [t, p] = words[i].split('|');
              return [t.trim(), core.keys[i], (p || '').trim(), hs[i] || ''];
            }),
          })),
        })),
      });
    });
  }

  function prepare(course) {
    if (course.flat) return course;
    course.units.forEach((u, ui) => u.lessons.forEach((l, li) => {
      l.key = ui + '-' + li;
      l.unit = u;
      l.items = l.items.map((a) => {
        const t = a[0], k = a[1], p = a[2] || '', h = a[3] || '';
        const tokens = t.replace(PUNCT, ' ').trim().split(/\s+/);
        return {
          t, k, p, h, tokens,
          kTokens: k.replace(PUNCT, ' ').trim().split(/\s+/),
          sentence: tokens.length >= 3,
          disp: course.joiner === '' ? t.replace(/\s+/g, '') : t,
          pic: PICTURES[k] || '',
        };
      });
    }));
    course.flat = course.units.flatMap((u) => u.lessons);
    course.items = course.flat.flatMap((l) => l.items);
    course.picCount = new Set(course.items.map((x) => x.pic).filter(Boolean)).size;
    course.pronCount = new Set(course.items.map((x) => x.h).filter(Boolean)).size;
    course.hue = hashHue(course.id);
    return course;
  }
  const getCourse = (id) => COURSES.find((c) => c.id === id);
  function progressOf(course) {
    if (!S.progress[course.id]) S.progress[course.id] = { done: {} };
    return S.progress[course.id];
  }
  const isDone = (course, lesson) => !!progressOf(course).done[lesson.key];
  const doneCount = (course) => course.flat.filter((l) => isDone(course, l)).length;
  const tAttr = (course) => `lang="${course.lang}" dir="auto"`;

  // ---------- sound ----------
  let voices = [];
  function loadVoices() {
    try { voices = speechSynthesis.getVoices(); } catch (e) { voices = []; }
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function voiceFor(lang) {
    const want = lang.toLowerCase();
    const norm = (v) => v.lang.replace('_', '-').toLowerCase();
    return voices.find((v) => norm(v) === want) || voices.find((v) => norm(v).split('-')[0] === want.split('-')[0]);
  }
  const canSpeak = (lang) => 'speechSynthesis' in window && !!voiceFor(lang);
  function speak(text, lang, slow) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const v = voiceFor(lang);
    if (v) u.voice = v;
    u.rate = slow ? 0.55 : 0.9;
    speechSynthesis.speak(u);
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let actx;
  function tone(seq) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      seq.forEach(([freq, dur, type]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur * 0.7;
      });
    } catch (e) { /* audio unavailable */ }
  }
  const SFX = {
    ok: () => tone([[784, 0.1], [1175, 0.22]]),
    bad: () => tone([[220, 0.16, 'sine'], [175, 0.26, 'sine']]),
    tick: () => tone([[988, 0.07]]),
    flip: () => tone([[523, 0.06], [659, 0.08]]),
    done: () => tone([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]),
  };

  // ---------- graphics ----------
  const ICONS = {
    heart: '<path d="M12 21s-7.6-4.7-9.7-9.3C.7 8.2 2.9 4.4 6.6 4.4c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.7 0 5.9 3.8 4.3 7.3C19.6 16.3 12 21 12 21z"/>',
    flame: '<path d="M12.6 2.2c.6 3.3 4.9 5.6 4.9 10.6a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.4 2.7-5.6.1 1.9.9 3 2 3.4-.4-3.4.3-6 1.4-8.4z"/><path d="M12 21c-1.9 0-3.2-1.4-3.2-3.2 0-1.6 1.1-2.6 2-3.4.2 1 .7 1.6 1.3 1.8 0-1.4.4-2.5 1.1-3.4.5 1.6 2 2.7 2 5 0 1.8-1.4 3.2-3.2 3.2z" fill="#ffd15c"/>',
    bolt: '<path d="M13.4 2 4.6 13.4h6.1L9.6 22l9.8-12.2h-6.3L13.4 2z"/>',
    star: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9L12 2.8z"/>',
    check: '<path d="M9.5 16.6 4.9 12l-1.8 1.8 6.4 6.4L21 8.7l-1.8-1.8z"/>',
    lock: '<path d="M7 10V7.5a5 5 0 0 1 10 0V10h1.2c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H5.8c-.7 0-1.3-.6-1.3-1.3v-8.4c0-.7.6-1.3 1.3-1.3H7zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0V10z"/>',
    speaker: '<path d="M3.5 9.2v5.6h3.8l5 4.2V5l-5 4.2H3.5z"/><path d="M15.6 8.4a5 5 0 0 1 0 7.2M18.2 5.8a8.6 8.6 0 0 1 0 12.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    turtle: '<path d="M4 15c0-4 3.6-7 8-7s8 3 8 7H4z"/><circle cx="21" cy="13" r="2"/><path d="M6 15v3h2.5v-3M15.5 15v3H18v-3" />',
    mic: '<path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 0 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5z"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    book: '<path d="M4 4.5c0-.8.7-1.5 1.5-1.5H11v16H5.5c-.8 0-1.5.7-1.5 1.5V4.5zM20 4.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5.7 1.5 1.5V4.5z"/>',
    close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/>',
    search: '<path d="M10.5 3a7.5 7.5 0 0 1 6 12l4.3 4.3-1.5 1.5-4.3-4.3A7.5 7.5 0 1 1 10.5 3zm0 2.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 0 0 0-10.6z"/>',
    back: '<path d="M15.4 4.6 8 12l7.4 7.4-1.6 1.6L4.8 12l9-9z"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    dumbbell: '<path d="M2 10h2V7h3v10H4v-3H2v-4zm20 0h-2V7h-3v10h3v-3h2v-4zM8.5 11h7v2h-7z"/>',
  };
  const icon = (name, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // 마스코트 '루미': 세계를 여행하는 작은 지구본 (기분: happy, wow, sad, think)
  let gid = 0;
  function mascot(mood, size) {
    mood = mood || 'happy';
    const id = 'lumi' + ++gid;
    const ink = '#1d1b4b';
    const eyeY = mood === 'sad' ? 62 : 58;
    const [px, py] = mood === 'think' ? [3, -3] : mood === 'sad' ? [0, 3] : [1, 2];
    const pr = mood === 'wow' ? 6.2 : 5.4;
    const mouth = {
      happy: `<path d="M50 74 Q60 88 70 74 Z" fill="${ink}"/><path d="M55 80 Q60 84 65 80 Q60 83 55 80Z" fill="#ff8fab"/>`,
      wow: `<ellipse cx="60" cy="79" rx="6" ry="7.5" fill="${ink}"/>`,
      sad: `<path d="M51 82 Q60 74 69 82" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/>`,
      think: `<path d="M53 79 Q61 76 68 79" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/>`,
    }[mood];
    const brows = mood === 'sad'
      ? `<path d="M37 46 L52 50 M83 46 L68 50" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`
      : mood === 'wow' ? `<path d="M37 42 Q46 37 54 42 M66 42 Q74 37 83 42" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>` : '';
    const raised = mood === 'happy' || mood === 'wow';
    const eye = (x) => `<ellipse cx="${x}" cy="${eyeY}" rx="10" ry="11" fill="#fff"/>
      <circle cx="${x + px}" cy="${eyeY + py}" r="${pr}" fill="${ink}"/>
      <circle cx="${x + px + 2}" cy="${eyeY + py - 2.4}" r="1.8" fill="#fff"/>`;
    return `<svg class="mascot mascot-${mood}" viewBox="0 0 120 124" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <radialGradient id="${id}o" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#9be7ff"/><stop offset=".55" stop-color="#4aa8ff"/><stop offset="1" stop-color="#3a56d4"/></radialGradient>
        <clipPath id="${id}c"><circle cx="60" cy="64" r="40"/></clipPath>
      </defs>
      <ellipse cx="60" cy="117" rx="28" ry="4.5" fill="rgba(20,18,60,.18)"/>
      <ellipse cx="21" cy="${raised ? 52 : 76}" rx="7.5" ry="12" transform="rotate(${raised ? -30 : 22} 21 ${raised ? 52 : 76})" fill="#4aa8ff"/>
      <ellipse cx="99" cy="${raised ? 48 : 76}" rx="7.5" ry="12" transform="rotate(${raised ? 35 : -22} 99 ${raised ? 48 : 76})" fill="#4aa8ff"/>
      <ellipse cx="46" cy="106" rx="9" ry="5.5" fill="#3a56d4"/><ellipse cx="74" cy="106" rx="9" ry="5.5" fill="#3a56d4"/>
      <path d="M60 25 L60 13" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
      <path d="m60 3 2.6 5.2 5.7.8-4.1 4 1 5.7L60 16l-5.2 2.7 1-5.7-4.1-4 5.7-.8z" fill="#ffc53d" stroke="#f0a020" stroke-width="1"/>
      <circle cx="60" cy="64" r="40" fill="url(#${id}o)"/>
      <g clip-path="url(#${id}c)" fill="#6ee7a8">
        <path d="M18 46c7-9 20-11 26-4s-2 15-10 17-13 3-17-2-3-7 1-11z"/>
        <path d="M80 28c10 2 19 9 21 18s-5 11-11 8-8-9-13-13-6-15 3-13z"/>
        <path d="M44 96c6-6 18-6 24 0s4 13-6 13-21-6-18-13z"/>
      </g>
      <ellipse cx="42" cy="38" rx="11" ry="6" fill="#fff" opacity=".35" transform="rotate(-32 42 38)"/>
      <path d="M27 84 Q60 98 93 84 L93 92 Q60 106 27 92Z" fill="#ff7a59"/>
      <path d="M77 93 l9 15 -7.5 2 -7-13z" fill="#f4623f"/>
      ${brows}${eye(46)}${eye(74)}
      <ellipse cx="35" cy="71" rx="5.5" ry="3.5" fill="#ff8fab" opacity=".8"/><ellipse cx="85" cy="71" rx="5.5" ry="3.5" fill="#ff8fab" opacity=".8"/>
      ${mouth}
      ${mood === 'think' ? `<text x="96" y="34" font-size="20" font-weight="900" fill="${ink}">?</text>` : ''}
    </svg>`;
  }
  const speech = (mood, inner, size, cls) => `<div class="speech ${cls || ''}">${mascot(mood, size || 92)}<div class="bubble">${inner}</div></div>`;

  function badge(course, cls) {
    if (course.flagSvg) return `<span class="badge flag ${cls || ''}">${course.flagSvg}</span>`;
    return `<span class="badge ${cls || ''}" style="--h:${course.hue}">${esc(course.name[0])}</span>`;
  }

  // 유닛 배너 풍경: 하늘, 해, 구름, 언덕 세 겹
  function scene(color, n) {
    const id = 'sky' + ++gid;
    return `<svg class="scene" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(color, '#ffffff', 0.78)}"/><stop offset="1" stop-color="${mix(color, '#ffffff', 0.45)}"/></linearGradient></defs>
      <rect width="400" height="150" fill="url(#${id})"/>
      <circle cx="${310 + (n % 3) * 20}" cy="40" r="24" fill="#fff6c9"/><circle cx="${310 + (n % 3) * 20}" cy="40" r="34" fill="#fff6c9" opacity=".35"/>
      <g class="clouds" fill="#fff" opacity=".9"><ellipse cx="${70 + n * 23 % 90}" cy="36" rx="28" ry="9"/><ellipse cx="${92 + n * 23 % 90}" cy="29" rx="17" ry="10"/><ellipse cx="${220 + n * 37 % 60}" cy="58" rx="22" ry="6.5"/></g>
      <path d="M0 108 Q70 66 140 98 T270 88 T400 96 V150 H0Z" fill="${mix(color, '#ffffff', 0.25)}"/>
      <path d="M0 126 Q90 98 190 122 T400 112 V150 H0Z" fill="${color}"/>
      <path d="M0 140 Q120 126 240 140 T400 134 V150 H0Z" fill="${mix(color, '#000000', 0.22)}"/>
    </svg>`;
  }

  // 오늘의 목표 링
  function ring(value, max, size) {
    const r = 30, c = 2 * Math.PI * r, f = Math.min(1, value / max);
    return `<svg class="ring" viewBox="0 0 76 76" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--track)" stroke-width="9"/>
      <circle cx="38" cy="38" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/>
      <defs><linearGradient id="ringGrad" x1="0" x2="1"><stop offset="0" stop-color="#ffb020"/><stop offset="1" stop-color="#ff7a59"/></linearGradient></defs>
    </svg>`;
  }

  function confetti() {
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { /* ignore */ }
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#6c5ce7', '#ff7a59', '#19c39a', '#ffb020', '#3fa9f5', '#ff4d8d'];
    for (let i = 0; i < 100; i++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = pick(colors);
      s.style.animationDelay = Math.random() * 0.5 + 's';
      s.style.animationDuration = 2.2 + Math.random() * 1.6 + 's';
      s.style.setProperty('--r', Math.random() * 900 - 450 + 'deg');
      s.style.setProperty('--dx', Math.random() * 200 - 100 + 'px');
      if (i % 3 === 0) s.style.borderRadius = '50%';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5000);
  }

  // ---------- top bar ----------
  function topBar(course) {
    syncHearts();
    const st = currentStreak();
    return `<header class="top"><div class="top-inner">
      <button class="course-chip" aria-label="코스 바꾸기">${badge(course, 'sm')}<span>${esc(course.name)}</span><span class="caret">▾</span></button>
      <div class="stats">
        <button class="stat streak ${st ? '' : 'off'}" title="연속 학습">${icon('flame')}<b>${st}</b></button>
        <button class="stat xp" title="총 XP">${icon('bolt')}<b>${S.xp}</b></button>
        <button class="stat heart" title="하트">${icon('heart')}<b>${S.hearts}</b></button>
      </div>
    </div></header>`;
  }
  function bindTopBar() {
    $('.course-chip').onclick = showCourses;
    $('.stat.heart').onclick = () => toast(S.hearts < MAX_HEARTS ? `${nextHeartMinutes()}분 뒤에 하트가 1개 충전돼요. 복습하면 바로 1개 얻어요.` : '하트가 가득 찼어요!');
    $('.stat.streak').onclick = () => toast(currentStreak() ? `${currentStreak()}일 연속 학습 중이에요!` : '오늘 레슨을 하나 끝내면 연속 학습이 시작돼요.');
    $('.stat.xp').onclick = () => toast(`지금까지 모은 경험치 ${S.xp} XP`);
  }

  // ---------- home ----------
  function showHome() {
    const course = getCourse(S.course);
    if (!course) return showCourses();
    save();
    const curIdx = course.flat.findIndex((l) => !isDone(course, l));
    const anyDone = course.flat.some((l) => isDone(course, l));
    const daily = dailyXp();
    const msg = daily >= DAILY_GOAL ? '오늘 목표 달성! 정말 멋져요!'
      : daily > 0 ? `목표까지 ${DAILY_GOAL - daily} XP 남았어요. 조금만 더!`
        : anyDone ? '오늘도 같이 여행을 떠나 볼까요?' : `안녕! 나는 루미야. 같이 ${course.name}${objectJ(course.name)} 배워 보자!`;

    let n = 0;
    const units = course.units.map((u, ui) => {
      const offsets = [0, 64, 0, -64];
      const pts = u.lessons.map((_, i) => [150 + offsets[i % 4], 100 + i * 128]);
      const h = pts[pts.length - 1][1] + 84;
      let d = `M ${pts[0][0]} ${pts[0][1] - 64}`;
      d += ` L ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        d += ` C ${x0} ${y0 + 64}, ${x1} ${y1 - 64}, ${x1} ${y1}`;
      }
      const nodes = u.lessons.map((l, i) => {
        const idx = course.flat.indexOf(l);
        const done = isDone(course, l);
        const unlocked = idx === 0 || isDone(course, course.flat[idx - 1]);
        const current = idx === curIdx;
        const cls = done ? 'done' : current ? 'current' : unlocked ? 'open' : 'locked';
        const ic = done ? icon('check') : unlocked ? icon('star') : icon('lock');
        n++;
        return `<div class="node-wrap" style="left:${pts[i][0]}px;top:${pts[i][1]}px">
          ${current ? `<div class="start-tag">${anyDone ? '여기부터!' : '시작'}</div>` : ''}
          <button class="node ${cls}" data-key="${l.key}" aria-label="${esc(l.title)}${done ? ' (완료)' : unlocked ? '' : ' (잠김)'}">
            <span class="node-face">${ic}</span>
          </button>
          <div class="node-label">${esc(l.title)}</div>
        </div>`;
      }).join('');
      return `<section class="unit" style="--c:${u.color};--c-dark:${mix(u.color, '#000000', 0.25)};--c-soft:${mix(u.color, '#ffffff', 0.82)}">
        <div class="unit-head">
          ${scene(u.color, ui)}
          <div class="unit-text">
            <div class="unit-no">유닛 ${ui + 1}</div>
            <h2>${esc(u.title)}</h2>
            <p>${esc(u.desc)}</p>
          </div>
          ${u.icon ? `<div class="unit-landmark" aria-hidden="true">${u.icon}</div>` : ''}
        </div>
        <div class="trail" style="height:${h}px">
          <svg class="road" viewBox="0 0 300 ${h}" width="300" height="${h}" aria-hidden="true">
            <path d="${d}" fill="none" stroke="var(--road)" stroke-width="22" stroke-linecap="round"/>
            <path d="${d}" fill="none" stroke="var(--road-line)" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>
          </svg>
          ${nodes}
        </div>
      </section>`;
    }).join('');

    render(`${topBar(course)}
      <main class="page home">
        <section class="hero card">
          ${speech(daily >= DAILY_GOAL ? 'wow' : 'happy', esc(msg), 88, 'hero-speech')}
          <div class="goal">
            <div class="goal-ring">${ring(daily, DAILY_GOAL, 76)}<div class="goal-num"><b>${Math.min(daily, DAILY_GOAL)}</b><small>/${DAILY_GOAL}</small></div></div>
            <div class="goal-text"><b>오늘의 목표</b><span>${daily >= DAILY_GOAL ? '달성 완료!' : `하루 ${DAILY_GOAL} XP 모으기`}</span></div>
          </div>
          <div class="hero-actions">
            <button class="btn primary continue">${icon('play')}${curIdx === -1 ? '코스 완료!' : anyDone ? '이어서 하기' : '첫 레슨 시작'}</button>
            <button class="btn soft practice" ${anyDone ? '' : 'disabled'}>${icon('dumbbell')}복습</button>
            <button class="btn soft guide">${icon('book')}발음·단어장</button>
          </div>
        </section>
        ${units}
        <p class="foot-note">${course.basic ? '기초 코스예요. 그림 단어 25개로 시작해요.' : '정규 코스예요.'} · <a href="${course.guide}" target="_blank" rel="noopener">${esc(course.name)} 공부 자료 보기</a></p>
      </main>`);

    bindTopBar();
    $('.continue').onclick = () => {
      if (curIdx === -1) return toast('모든 레슨을 끝냈어요! 복습으로 실력을 지켜 보세요.');
      startLesson(course, course.flat[curIdx], false);
    };
    $('.practice').onclick = () => startLesson(course, null, true);
    $('.guide').onclick = () => showGuide(course);
    $$('.node').forEach((b) => {
      b.onclick = () => {
        const l = course.flat.find((x) => x.key === b.dataset.key);
        if (b.classList.contains('locked')) return toast('앞 레슨을 먼저 끝내야 열려요');
        startLesson(course, l, false);
      };
    });
    const cur = $('.node.current');
    if (cur && anyDone) cur.scrollIntoView({ block: 'center' });
  }

  // ---------- pronunciation guide & word list ----------
  function showGuide(course) {
    const speakOk = canSpeak(course.tts);
    const tips = (course.tips || []).map((t, i) => `<li><span class="tip-no">${i + 1}</span><span>${esc(t)}</span></li>`).join('');
    const units = course.units.map((u) => `<section class="wl-unit">
      <h3 style="--c:${u.color}">${u.icon || ''} ${esc(u.title)}</h3>
      ${u.lessons.map((l) => l.items.map((it) => `<div class="wl-row">
        <span class="wl-pic">${it.pic || '·'}</span>
        <div class="wl-main"><span class="wl-word" ${tAttr(course)}>${esc(it.disp)}</span>${it.p ? `<span class="wl-roman">${esc(it.p)}</span>` : ''}</div>
        <div class="wl-side">${it.h ? `<span class="pron">[${esc(it.h)}]</span>` : ''}<span class="wl-mean">${esc(it.k)}</span></div>
        ${speakOk ? `<button class="icon-btn say" data-say="${esc(it.disp)}" aria-label="듣기">${icon('speaker')}</button>` : ''}
      </div>`).join('')).join('')}
    </section>`).join('');
    render(`${topBar(course)}
      <main class="page guide-page">
        <div class="page-head"><button class="icon-btn back" aria-label="뒤로">${icon('back')}</button><h1>${esc(course.name)} 발음·단어장</h1></div>
        ${speech('think', `<b>발음 꿀팁</b><br>한글 발음은 비슷한 소리를 적은 참고용이에요. ${speakOk ? '🔊 버튼으로 실제 소리를 들어 보세요.' : '이 브라우저에는 이 언어 음성이 없어서 소리는 들을 수 없어요.'}`, 80)}
        ${tips ? `<ol class="tips card">${tips}</ol>` : ''}
        <div class="card wordlist">${units}</div>
      </main>`);
    bindTopBar();
    $('.back').onclick = showHome;
    $$('.say').forEach((b) => { b.onclick = () => speak(b.dataset.say, course.tts); });
  }

  // ---------- course select ----------
  function showCourses() {
    const active = getCourse(S.course);
    const ordered = COURSES.filter((c) => !c.basic).concat(
      COURSES.filter((c) => c.basic).sort((a, b) => a.name.localeCompare(b.name, 'ko')));
    const courseIds = new Set(COURSES.map((c) => c.id));
    const others = ALL_LANGUAGES.filter((l) => !courseIds.has(l.id));
    const statusLabel = { '위기': '소멸 위기', '사어': '사어', '고전': '고전어', '인공': '인공어', group: '언어군', '미상': '정보 없음' };
    render(`<main class="page courses">
      <div class="page-head">${active ? `<button class="icon-btn back" aria-label="닫기">${icon('back')}</button>` : ''}<h1>언어 고르기</h1></div>
      ${speech('happy', '<b>어떤 언어로 여행을 떠날까요?</b><br>레슨이 있는 언어는 바로 배울 수 있고, 나머지 언어는 공부 자료를 볼 수 있어요.', 84)}
      <label class="search">${icon('search')}<input type="search" placeholder="언어 검색 (예: 스페인어, Spanish)" autocomplete="off"></label>
      <h2 class="sec-title">레슨 코스 <span class="count">${ordered.length}</span></h2>
      <div class="course-grid">${ordered.map((c) => {
        const done = doneCount(c);
        return `<button class="course-card ${active === c ? 'active' : ''}" data-id="${c.id}" data-q="${esc((c.name + ' ' + c.id).toLowerCase())}">
          ${badge(c, 'lg')}
          <span class="cname">${esc(c.name)}</span>
          <span class="ctag ${c.basic ? '' : 'full'}">${c.basic ? '기초 25단어' : `정규 ${c.flat.length}레슨`}</span>
          <span class="mini-bar"><span style="width:${Math.round((100 * done) / c.flat.length)}%"></span></span>
        </button>`;
      }).join('')}</div>
      <h2 class="sec-title">공부 자료만 있는 언어 <span class="count">${others.length}</span></h2>
      <p class="sec-desc">아래 언어는 아직 레슨이 없어요. 누르면 사용 지역·문자·공부 방법을 정리한 자료가 열려요.</p>
      <div class="lang-list card">${others.map((l) => `<a class="lang-row" href="${REPO}/blob/main/${l.id}.md" target="_blank" rel="noopener" data-q="${esc((l.ko + ' ' + l.en + ' ' + l.id).toLowerCase())}">
        <span class="badge xs" style="--h:${hashHue(l.id)}">${esc(l.ko[0])}</span>
        <span class="lr-name">${esc(l.ko)}</span><span class="lr-en">${esc(l.en)}</span>
        ${statusLabel[l.status] ? `<span class="lr-tag">${statusLabel[l.status]}</span>` : ''}
        <span class="lr-go">자료 ›</span></a>`).join('')}</div>
      <p class="empty" hidden>찾는 언어가 없어요.</p>
      <label class="toggle"><input type="checkbox" class="sound" ${S.sound ? 'checked' : ''}> 효과음 켜기</label>
    </main>`);
    const back = $('.back');
    if (back) back.onclick = showHome;
    $('.sound').onchange = (e) => { S.sound = e.target.checked; save(); };
    $$('.course-card').forEach((b) => {
      b.onclick = () => { S.course = b.dataset.id; save(); showHome(); };
    });
    const input = $('.search input');
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      $$('[data-q]').forEach((el) => {
        const hit = !q || el.dataset.q.includes(q);
        el.hidden = !hit;
        if (hit) shown++;
      });
      $('.empty').hidden = shown > 0;
    };
  }

  // ---------- exercise generation ----------
  const hasPic = (course, it) => !it.sentence && !!it.pic && course.picCount >= 4;
  const spellable = (course, it) => course.typing && !it.sentence && it.tokens.length === 1 && [...it.t].length >= 3 && [...it.t].length <= 9;

  function poolFor(course, lesson) {
    const idx = course.flat.indexOf(lesson);
    const items = course.flat.slice(0, idx + 1).flatMap((l) => l.items);
    return items.length >= 10 ? items : course.items;
  }
  // 오답 보기: 같은 종류(단어/문장)를 먼저 고르고, 같은 키는 다시 쓰지 않아요.
  function distractors(course, item, pool, n, keyFn, allow) {
    const seen = new Set([keyFn(item)]);
    const out = [];
    const order = shuffle(pool.filter((x) => x.sentence === item.sentence))
      .concat(shuffle(pool.filter((x) => x.sentence !== item.sentence)), shuffle(course.items));
    for (const x of order) {
      const k = keyFn(x);
      if (!k || seen.has(k) || (allow && !allow(x))) continue;
      seen.add(k);
      out.push(x);
      if (out.length >= n) break;
    }
    return out;
  }
  function extraTokens(item, pool, field, n) {
    const have = new Set(item[field].map((t) => t.toLowerCase()));
    const cand = uniqueBy(pool.flatMap((x) => x[field]), (t) => t.toLowerCase()).filter((t) => !have.has(t.toLowerCase()));
    return sample(cand, n);
  }

  function easyTypes(course, it) {
    if (it.sentence) return it.kTokens.length >= 2 ? ['kobuild', 'meaning'] : ['meaning'];
    const t = ['meaning', 'kochoice'];
    if (hasPic(course, it)) t.push('picture', 'picture');
    return t;
  }
  function hardTypes(course, it) {
    const t = ['truefalse'];
    const voice = canSpeak(course.tts);
    if (it.sentence) {
      t.push('build', 'build');
      if (it.tokens.length >= 3) t.push('fill');
      if (course.typing && it.tokens.length <= 5) t.push('type');
    } else {
      t.push('kochoice');
      if (hasPic(course, it)) t.push('picrev');
      if (course.typing) t.push('type');
      if (spellable(course, it)) t.push('spell');
      if (Recognition && voice) t.push('speak');
    }
    if (voice) t.push('listen');
    if (it.h && course.pronCount >= 4) t.push('pron');
    return t;
  }
  // 문제 유형이 한쪽으로 몰리지 않게 가장 적게 나온 유형부터 골라요.
  function pickBalanced(types, counts) {
    const min = Math.min(...types.map((t) => counts[t] || 0));
    const t = pick(types.filter((x) => (counts[x] || 0) === min));
    counts[t] = (counts[t] || 0) + 1;
    return t;
  }
  function matchItems(list) {
    const words = uniqueBy(uniqueBy(list.filter((x) => !x.sentence), (x) => x.disp), (x) => x.k);
    return sample(words, Math.min(5, words.length));
  }
  function buildLesson(course, lesson) {
    const pool = poolFor(course, lesson);
    const counts = {};
    const first = lesson.items.map((it) => ({ type: pickBalanced(easyTypes(course, it), counts), item: it, pool }));
    const second = shuffle(lesson.items).map((it) => ({ type: pickBalanced(hardTypes(course, it), counts), item: it, pool }));
    let words = matchItems(lesson.items);
    if (words.length < 3) words = matchItems(pool);
    const match = words.length >= 3 ? [{ type: 'match', items: words }] : [];
    return first.concat(match, second);
  }
  function buildPractice(course) {
    const learned = course.flat.filter((l) => isDone(course, l)).flatMap((l) => l.items);
    const pool = learned.length >= 10 ? learned : course.items;
    const counts = {};
    const ex = sample(learned, Math.min(10, learned.length))
      .map((it) => ({ type: pickBalanced(hardTypes(course, it).concat(easyTypes(course, it)), counts), item: it, pool }));
    const words = matchItems(learned);
    if (words.length >= 4) ex.splice(Math.min(3, ex.length), 0, { type: 'match', items: words });
    return ex;
  }

  // ---------- lesson ----------
  let L = null;

  function startLesson(course, lesson, practice) {
    syncHearts();
    if (!practice && S.hearts <= 0) return showNoHearts(course);
    const queue = practice ? buildPractice(course) : buildLesson(course, lesson);
    if (!queue.length) return toast('복습할 레슨이 아직 없어요.');
    const learn = practice || isDone(course, lesson) ? [] : lesson.items.slice();
    L = {
      course, lesson, practice, queue, learn, li: 0, pos: 0, total: queue.length,
      correct: 0, firstTry: 0, mistakes: 0, ctrl: null, phase: learn.length ? 'learn' : 'answer',
    };
    render(`<div class="lesson">
      <header class="lesson-top">
        <button class="icon-btn quit" aria-label="그만하기">${icon('close')}</button>
        <div class="bar" role="progressbar" aria-label="진행도"><div class="bar-fill"></div></div>
        <div class="hearts ${practice ? 'practice' : ''}">${practice ? icon('dumbbell') : icon('heart') + '<b>' + S.hearts + '</b>'}</div>
      </header>
      <main class="ex"></main>
      <footer class="foot"><div class="foot-inner"><div class="fb"></div><button class="btn primary check" disabled>확인</button></div></footer>
    </div>`);
    $('.quit').onclick = () => {
      if (confirm('레슨을 그만둘까요? 이번 레슨의 진행 상황은 저장되지 않아요.')) {
        L = null;
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        showHome();
      }
    };
    if (L.phase === 'learn') nextCard();
    else nextExercise();
  }

  function updateBar() {
    const learnPart = L.learn.length ? 0.3 : 0;
    const learnDone = L.learn.length ? Math.min(L.li, L.learn.length) / L.learn.length : 0;
    const quizDone = L.correct / L.total;
    $('.bar-fill').style.width = Math.round(100 * (learnPart * learnDone + (1 - learnPart) * quizDone)) + '%';
    const h = $('.hearts b');
    if (h) h.textContent = S.hearts;
  }

  // 1단계: 단어 카드로 먼저 배우기
  function nextCard() {
    const course = L.course;
    if (L.li >= L.learn.length) {
      L.phase = 'answer';
      return showQuizIntro();
    }
    const it = L.learn[L.li];
    const speakOk = canSpeak(course.tts);
    const last = L.li === L.learn.length - 1;
    $('.ex').innerHTML = `<div class="learn">
      <div class="learn-step"><span class="pill">새로 배울 ${it.sentence ? '문장' : '단어'}</span><span>${L.li + 1} / ${L.learn.length}</span></div>
      <article class="learn-card" style="--c:${L.lesson.unit.color}">
        <div class="learn-art">${it.pic ? `<span class="pic-xl">${it.pic}</span>` : mascot('happy', 112)}</div>
        <div class="learn-word" ${tAttr(course)}>${esc(it.disp)}</div>
        ${it.p ? `<div class="learn-roman">${esc(it.p)}</div>` : ''}
        ${it.h ? `<div class="learn-pron"><span class="pron-label">발음</span><span class="pron">[${esc(it.h)}]</span></div>` : ''}
        <div class="learn-mean">${esc(it.k)}</div>
        ${speakOk ? `<div class="learn-audio">
          <button class="btn soft say" data-say="${esc(it.disp)}">${icon('speaker')}듣기</button>
          <button class="btn soft say" data-say="${esc(it.disp)}" data-slow="1">${icon('turtle')}천천히</button>
        </div>` : ''}
      </article>
      <div class="learn-dots">${L.learn.map((_, i) => `<i class="${i < L.li ? 'on' : i === L.li ? 'now' : ''}"></i>`).join('')}</div>
    </div>`;
    $$('.say').forEach((b) => { b.onclick = () => speak(b.dataset.say, course.tts, b.dataset.slow === '1'); });
    if (speakOk) setTimeout(() => speak(it.disp, course.tts), 250);
    SFX.flip();
    const foot = $('.foot'), btn = $('.check');
    foot.className = 'foot';
    $('.fb').innerHTML = '';
    btn.disabled = false;
    btn.textContent = last ? '다 외웠어요! 문제 풀기' : '다음 단어';
    btn.onclick = () => { L.li++; nextCard(); };
    updateBar();
  }

  function showQuizIntro() {
    $('.ex').innerHTML = `<div class="quiz-intro">${mascot('wow', 140)}
      <h2>이제 문제를 풀어 볼까요?</h2>
      <p>방금 배운 ${L.learn.length}개를 여러 가지 문제로 확인해요.<br>틀린 문제는 마지막에 한 번 더 나와요.</p></div>`;
    const btn = $('.check');
    btn.disabled = false;
    btn.textContent = '시작!';
    btn.onclick = nextExercise;
    updateBar();
  }

  function nextExercise() {
    if (L.pos >= L.queue.length) return finishLesson();
    const ex = L.queue[L.pos];
    const foot = $('.foot'), btn = $('.check');
    foot.className = 'foot';
    $('.fb').innerHTML = '';
    btn.textContent = '확인';
    btn.disabled = true;
    L.phase = 'answer';
    L.ctrl = null;
    L.ctrl = renderExercise(L.course, ex, $('.ex'), () => { if (L && L.ctrl && L.phase === 'answer') btn.disabled = !L.ctrl.ready(); });
    btn.onclick = () => {
      if (L.phase === 'answer') {
        if (L.ctrl.ready()) showFeedback(ex, L.ctrl.check());
      } else {
        L.pos++;
        nextExercise();
      }
    };
    updateBar();
  }

  function showFeedback(ex, r) {
    L.phase = 'feedback';
    if (L.ctrl.lock) L.ctrl.lock();
    const foot = $('.foot'), fb = $('.fb'), btn = $('.check');
    if (r.ok) {
      L.correct++;
      if (!ex.retry) L.firstTry++;
      SFX.ok();
      foot.className = 'foot ok';
      fb.innerHTML = `<div class="fb-face">${mascot('happy', 52)}</div><div><div class="fb-title">${r.title || pick(['훌륭해요!', '정답이에요!', '잘했어요!', '완벽해요!', '최고예요!'])}</div>${r.note ? `<div class="fb-ans">${r.note}</div>` : ''}</div>`;
      if (r.say) speak(r.say, L.course.tts);
    } else {
      L.mistakes++;
      SFX.bad();
      foot.className = 'foot bad';
      fb.innerHTML = `<div class="fb-face">${mascot('sad', 52)}</div><div><div class="fb-title">아쉬워요! 정답은</div><div class="fb-ans">${r.answer}</div></div>`;
      L.queue.push(Object.assign({}, ex, { retry: true }));
      if (!L.practice) {
        loseHeart();
        if (S.hearts <= 0) {
          updateBar();
          btn.textContent = '계속';
          btn.disabled = false;
          btn.onclick = () => showNoHearts(L.course);
          return;
        }
      }
    }
    btn.textContent = '계속';
    btn.disabled = false;
    updateBar();
  }

  function finishLesson() {
    const { course, lesson, practice } = L;
    const perfect = L.mistakes === 0;
    const xp = practice ? 5 : 10 + (perfect ? 5 : 0);
    const before = currentStreak();
    addXp(xp);
    if (practice) gainHeart();
    else {
      const p = progressOf(course);
      p.done[lesson.key] = (p.done[lesson.key] || 0) + 1;
      save();
    }
    SFX.done();
    const acc = Math.round((100 * L.firstTry) / L.total);
    const streakUp = currentStreak() > before;
    const title = practice ? '복습 완료!' : perfect ? '완벽한 레슨!' : '레슨 완료!';
    L = null;
    render(`<div class="center result">
      <div class="burst">${mascot(perfect ? 'wow' : 'happy', 150)}</div>
      <h1>${title}</h1>
      ${streakUp ? `<p class="streak-up">${icon('flame')}<b>${currentStreak()}일</b> 연속 학습 중이에요!</p>` : ''}
      ${practice ? '<p>복습 보상으로 하트 1개를 받았어요.</p>' : ''}
      <div class="stats-row">
        <div class="stat-card xp">${icon('bolt')}<b>+${xp}</b><span>XP</span></div>
        <div class="stat-card acc">${icon('star')}<b>${acc}%</b><span>정확도</span></div>
        <div class="stat-card fire">${icon('flame')}<b>${currentStreak()}</b><span>연속 학습</span></div>
      </div>
      <button class="btn primary wide check">계속</button>
    </div>`);
    $('.check').onclick = showHome;
    confetti();
  }

  function showNoHearts(course) {
    L = null;
    syncHearts();
    save();
    const learned = course.flat.some((l) => isDone(course, l));
    render(`<div class="center">
      ${mascot('sad', 150)}
      <h1 class="red">하트가 다 떨어졌어요</h1>
      <p>하트는 30분마다 1개씩 다시 채워져요.<br>다음 하트까지 약 <b>${nextHeartMinutes()}분</b> 남았어요.${learned ? '<br>복습을 끝내면 하트를 바로 1개 받을 수 있어요!' : ''}</p>
      ${learned ? `<button class="btn primary wide practice">${icon('dumbbell')}복습해서 하트 받기</button>` : ''}
      <button class="btn ghost wide home">홈으로</button>
    </div>`);
    const p = $('.practice');
    if (p) p.onclick = () => startLesson(course, null, true);
    $('.home').onclick = showHome;
  }

  // ---------- exercise screens ----------
  function renderExercise(course, ex, main, changed) {
    const it = ex.item;
    const lang = course.tts;
    const speakOk = canSpeak(lang);
    const say = (text, slow) => speak(text, lang, slow);
    const speakBtn = (text) => (speakOk ? `<button class="icon-btn speak" data-say="${esc(text)}" aria-label="듣기">${icon('speaker')}</button>` : '');
    const targetHtml = (x, extra) => `<span ${tAttr(course)}>${esc(x.disp)}</span>${extra && x.p ? `<small class="roman">${esc(x.p)}</small>` : ''}`;
    const answerTarget = (x) => `${targetHtml(x, true)}${x.h ? ` <span class="pron">[${esc(x.h)}]</span>` : ''}<small>${esc(x.k)}</small>`;
    const said = (x, mood) => speech(mood || 'happy', `<div class="bubble-row">${speakBtn(x.disp)}<div class="target"><span class="target-text" ${tAttr(course)}>${esc(x.disp)}</span>${x.p ? `<span class="roman">${esc(x.p)}</span>` : ''}</div></div>`);
    const tag = (label) => `<span class="ex-tag">${label}</span>`;
    let ctrl;

    function choices(prompt, body, options, correct, optHtml, answer, layout) {
      main.innerHTML = `${prompt}${body}<div class="choices ${layout || ''}">${options.map((o, i) =>
        `<button class="choice" data-i="${i}"><span class="num">${i + 1}</span><span class="choice-text">${optHtml(o, i)}</span></button>`).join('')}</div>`;
      let sel = null, locked = false;
      const btns = $$('.choice', main);
      btns.forEach((b) => {
        b.onclick = () => {
          if (locked) return;
          sel = +b.dataset.i;
          btns.forEach((x) => x.classList.toggle('sel', x === b));
          changed();
        };
      });
      return {
        ready: () => sel !== null,
        check: () => ({ ok: sel === correct, answer }),
        lock: () => {
          locked = true;
          btns.forEach((b, i) => {
            b.classList.remove('sel');
            b.classList.toggle('right', i === correct);
            b.classList.toggle('wrong', i === sel && sel !== correct);
          });
        },
        choose: (i) => { if (btns[i]) btns[i].click(); },
      };
    }

    function wordBank(prompt, body, answer, extra, joiner, answerHtml, tokLang, onPick) {
      const bank = shuffle(answer.concat(extra));
      main.innerHTML = `${prompt}${body}
        <div class="answer-line" lang="${tokLang}" dir="auto"></div>
        <div class="bank" lang="${tokLang}" dir="auto">${bank.map((t, i) => `<button class="tok" data-i="${i}">${esc(t)}</button>`).join('')}</div>`;
      const line = $('.answer-line', main);
      const bankBtns = $$('.bank .tok', main);
      const chosen = [];
      let locked = false;
      function draw() {
        line.innerHTML = chosen.map((i) => `<button class="tok" data-i="${i}">${esc(bank[i])}</button>`).join('');
        $$('.tok', line).forEach((b) => {
          b.onclick = () => {
            if (locked) return;
            const i = +b.dataset.i;
            chosen.splice(chosen.indexOf(i), 1);
            bankBtns[i].classList.remove('used');
            draw();
            changed();
          };
        });
      }
      bankBtns.forEach((b) => {
        b.onclick = () => {
          if (locked) return;
          const i = +b.dataset.i;
          b.classList.add('used');
          chosen.push(i);
          draw();
          changed();
          if (onPick) onPick(bank[i]);
        };
      });
      const norm = (arr) => arr.map((t) => t.toLowerCase()).join(joiner === '' ? '' : ' ');
      return {
        ready: () => chosen.length > 0,
        check: () => ({ ok: norm(chosen.map((i) => bank[i])) === norm(answer), answer: answerHtml }),
        lock: () => { locked = true; },
      };
    }

    const H = (label, text) => `<div class="ex-head">${tag(label)}<h1 class="prompt">${text}</h1></div>`;

    switch (ex.type) {
      case 'meaning': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.k)));
        ctrl = choices(H('뜻 고르기', it.sentence ? '이 문장은 무슨 뜻일까요?' : '이 말은 무슨 뜻일까요?'), said(it, 'think'), opts, opts.indexOf(it),
          (o) => esc(o.k), answerTarget(it));
        if (speakOk) setTimeout(() => say(it.disp), 250);
        break;
      }
      case 'kochoice': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.disp)));
        ctrl = choices(H('단어 고르기', `'${esc(it.k)}'${topicJ(it.k)} ${esc(course.name)}로 무엇일까요?`), '', opts, opts.indexOf(it),
          (o) => targetHtml(o, true), answerTarget(it));
        ctrl.say = it.disp;
        break;
      }
      case 'picture': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.pic, (x) => !x.sentence && !!x.pic)));
        ctrl = choices(H('그림 고르기', `'${esc(it.k)}'${topicJ(it.k)} 어느 것일까요?`), '', opts, opts.indexOf(it),
          (o) => `<span class="pic" aria-hidden="true">${o.pic}</span>${targetHtml(o, true)}`, answerTarget(it), 'pic-grid');
        ctrl.say = it.disp;
        break;
      }
      case 'picrev': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.disp, (x) => !x.sentence)));
        ctrl = choices(H('그림 보고 말하기', '그림에 알맞은 말을 고르세요'), `<div class="pic-stage"><span class="pic-xl">${it.pic}</span></div>`, opts, opts.indexOf(it),
          (o) => targetHtml(o, true), answerTarget(it), 'two-col');
        ctrl.say = it.disp;
        break;
      }
      case 'pron': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.h)));
        ctrl = choices(H('발음 고르기', '어떻게 읽을까요?'),
          `<div class="card big-word"><span class="target-text" ${tAttr(course)}>${esc(it.disp)}</span><span class="mean-hint">${esc(it.k)}</span></div>`,
          opts, opts.indexOf(it), (o) => `<span class="pron">[${esc(o.h)}]</span>`, answerTarget(it), 'two-col');
        ctrl.say = it.disp;
        break;
      }
      case 'truefalse': {
        const truth = Math.random() < 0.5;
        const other = distractors(course, it, ex.pool, 1, (x) => x.k)[0];
        const shown = truth || !other ? it.k : other.k;
        const isTrue = shown === it.k;
        ctrl = choices(H('O / X', '뜻이 맞을까요?'),
          `<div class="card tf-card">${it.pic && !it.sentence && isTrue ? `<span class="pic">${it.pic}</span>` : ''}
            <span class="target-text" ${tAttr(course)}>${esc(it.disp)}</span>${speakBtn(it.disp)}
            <span class="tf-eq">=</span><span class="tf-mean">${esc(shown)}</span></div>`,
          ['ok', 'no'], isTrue ? 0 : 1, (o) => (o === 'ok' ? '<span class="tf-ic ok">O</span>맞아요' : '<span class="tf-ic no">X</span>틀려요'),
          answerTarget(it), 'tf-grid');
        ctrl.say = it.disp;
        break;
      }
      case 'listen': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.p || x.disp.toLowerCase())));
        ctrl = choices(H('듣기', '듣고 알맞은 것을 고르세요'),
          `<div class="listen"><button class="big-say" data-say="${esc(it.disp)}" aria-label="듣기">${icon('speaker')}</button><button class="big-say slow" data-say="${esc(it.disp)}" data-slow="1" aria-label="천천히 듣기">${icon('turtle')}</button></div>`,
          opts, opts.indexOf(it), (o) => targetHtml(o, false), answerTarget(it));
        setTimeout(() => say(it.disp), 300);
        break;
      }
      case 'fill': {
        const blank = Math.floor(Math.random() * it.tokens.length);
        const right = it.tokens[blank];
        const wrong = extraTokens(it, ex.pool, 'tokens', 3);
        const opts = shuffle([right].concat(wrong));
        const sep = course.joiner === '' ? '' : ' ';
        const sentence = it.tokens.map((t, i) => (i === blank ? '<span class="blank">　?　</span>' : esc(t))).join(sep);
        ctrl = choices(H('빈칸 채우기', '빈칸에 들어갈 말을 고르세요'),
          `<div class="card fill-card"><div class="fill-sentence" ${tAttr(course)}>${sentence}</div><div class="mean-hint">${esc(it.k)}</div></div>`,
          opts, opts.indexOf(right), (o) => `<span ${tAttr(course)}>${esc(o)}</span>`, answerTarget(it), 'two-col');
        ctrl.say = it.disp;
        break;
      }
      case 'build': {
        ctrl = wordBank(H('문장 만들기', `${esc(course.name)}로 옮겨 보세요`), `<div class="card ko-card">${esc(it.k)}</div>`,
          it.tokens, extraTokens(it, ex.pool, 'tokens', 3), course.joiner, answerTarget(it), course.lang,
          speakOk ? (t) => say(t) : null);
        ctrl.say = it.disp;
        break;
      }
      case 'kobuild': {
        ctrl = wordBank(H('해석하기', '한국어로 옮겨 보세요'), said(it), it.kTokens, extraTokens(it, ex.pool, 'kTokens', 3), ' ',
          `${esc(it.k)}<small>${esc(it.disp)}</small>`, 'ko', null);
        if (speakOk) setTimeout(() => say(it.disp), 250);
        break;
      }
      case 'spell': {
        const letters = [...it.t];
        let order = shuffle(letters);
        for (let i = 0; i < 5 && order.join('') === it.t; i++) order = shuffle(letters);
        ctrl = wordBank(H('철자 맞추기', `글자를 순서대로 눌러 '${esc(it.k)}'${objectJ(it.k)} 만드세요`),
          it.pic ? `<div class="pic-stage small"><span class="pic-xl">${it.pic}</span></div>` : '',
          letters, [], '', answerTarget(it), course.lang, null);
        // wordBank 는 정답 순서를 섞어서 보여 주므로, 여기서는 섞은 순서로 다시 그려요.
        $$('.bank .tok', main).forEach((b, i) => { b.textContent = order[i]; });
        ctrl = spellCtrl(order, it, answerTarget(it));
        ctrl.say = it.disp;
        break;
      }
      case 'type': {
        main.innerHTML = `${H('직접 쓰기', `${esc(course.name)}로 써 보세요`)}
          <div class="card ko-card">${it.pic && !it.sentence ? `<span class="pic">${it.pic}</span>` : ''}${esc(it.k)}</div>
          <input class="type-in" ${tAttr(course)} placeholder="${esc(course.name)}로 입력하세요" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          ${course.chars ? `<div class="chars">${course.chars.map((c) => `<button class="tok small" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}`;
        const input = $('.type-in', main);
        input.oninput = changed;
        $$('[data-c]', main).forEach((b) => {
          b.onclick = () => {
            const s = input.selectionStart, e = input.selectionEnd;
            input.value = input.value.slice(0, s) + b.dataset.c + input.value.slice(e);
            input.focus();
            input.setSelectionRange(s + b.dataset.c.length, s + b.dataset.c.length);
            changed();
          };
        });
        setTimeout(() => input.focus(), 50);
        const norm = (s) => s.toLowerCase().normalize('NFC').replace(PUNCT, ' ')
          .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
          .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻʼ’']/g, '')
          .replace(/\s+/g, ' ').trim();
        ctrl = {
          ready: () => input.value.trim().length > 0,
          check: () => {
            const ok = norm(input.value) === norm(it.t);
            const exact = input.value.trim().replace(PUNCT, '').toLowerCase() === it.t.replace(PUNCT, '').toLowerCase();
            return { ok, answer: answerTarget(it), title: ok && !exact ? '정답! 철자 기호도 확인해 보세요' : '' };
          },
          lock: () => { input.disabled = true; },
          say: it.disp,
        };
        break;
      }
      case 'speak': {
        main.innerHTML = `${H('말하기', '따라 말해 보세요')}${said(it)}
          <div class="speak-box"><button class="mic">${icon('mic')}</button><div class="heard">버튼을 누르고 말해 보세요</div></div>
          <button class="btn ghost skip">지금은 말할 수 없어요</button>`;
        let result = null;
        const heard = $('.heard', main), mic = $('.mic', main);
        mic.onclick = () => {
          try {
            const rec = new Recognition();
            rec.lang = lang;
            rec.interimResults = false;
            rec.maxAlternatives = 3;
            mic.classList.add('on');
            heard.textContent = '듣고 있어요...';
            rec.onresult = (e) => {
              const alts = Array.from(e.results[0]).map((a) => a.transcript);
              const ok = alts.some((a) => similar(a, it.disp) >= 0.6);
              result = { ok, heardText: alts[0] };
              heard.textContent = `들린 말: "${alts[0]}"`;
              changed();
            };
            rec.onerror = () => { heard.textContent = '잘 들리지 않았어요. 다시 눌러 보세요.'; };
            rec.onend = () => mic.classList.remove('on');
            rec.start();
          } catch (e) {
            heard.textContent = '이 브라우저에서는 말하기를 쓸 수 없어요.';
          }
        };
        $('.skip', main).onclick = () => { result = { ok: true, skipped: true }; changed(); $('.check').click(); };
        ctrl = {
          ready: () => !!result,
          check: () => ({ ok: result.ok, answer: answerTarget(it), title: result.skipped ? '다음에 말해 봐요!' : '' }),
          say: it.disp,
        };
        break;
      }
      case 'match': {
        const items = ex.items;
        const left = shuffle(items), right = shuffle(items);
        main.innerHTML = `${H('짝 맞추기', '짝을 맞춰 보세요')}
          <div class="match">
            <div class="col">${left.map((x) => `<button class="tok mt" data-side="L" data-i="${items.indexOf(x)}" ${tAttr(course)}>${esc(x.disp)}</button>`).join('')}</div>
            <div class="col">${right.map((x) => `<button class="tok mt" data-side="R" data-i="${items.indexOf(x)}">${x.pic ? `<span class="mini-pic">${x.pic}</span>` : ''}${esc(x.k)}</button>`).join('')}</div>
          </div>`;
        let sel = null, matched = 0;
        $$('.mt', main).forEach((b) => {
          b.onclick = () => {
            if (b.classList.contains('ok')) return;
            if (b.dataset.side === 'L' && speakOk) say(items[+b.dataset.i].disp);
            if (sel === b) { b.classList.remove('sel'); sel = null; return; }
            if (!sel || sel.dataset.side === b.dataset.side) {
              if (sel) sel.classList.remove('sel');
              sel = b;
              b.classList.add('sel');
              return;
            }
            const a = sel;
            sel = null;
            if (a.dataset.i === b.dataset.i) {
              [a, b].forEach((x) => { x.classList.remove('sel'); x.classList.add('ok'); x.disabled = true; });
              matched++;
              SFX.tick();
              if (matched === items.length) changed();
            } else {
              [a, b].forEach((x) => x.classList.add('no'));
              SFX.bad();
              setTimeout(() => [a, b].forEach((x) => x.classList.remove('no', 'sel')), 450);
            }
          };
        });
        ctrl = { ready: () => matched === items.length, check: () => ({ ok: true, answer: '', title: '짝을 모두 맞췄어요!' }) };
        break;
      }
    }

    function spellCtrl(order, x, answerHtml) {
      const line = $('.answer-line', main);
      const bankBtns = $$('.bank .tok', main);
      const chosen = [];
      let locked = false;
      function draw() {
        line.innerHTML = chosen.map((i) => `<button class="tok" data-i="${i}">${esc(order[i])}</button>`).join('');
        $$('.tok', line).forEach((b) => {
          b.onclick = () => {
            if (locked) return;
            const i = +b.dataset.i;
            chosen.splice(chosen.indexOf(i), 1);
            bankBtns[i].classList.remove('used');
            draw();
            changed();
          };
        });
      }
      bankBtns.forEach((b, i) => {
        b.onclick = () => {
          if (locked || b.classList.contains('used')) return;
          b.classList.add('used');
          chosen.push(i);
          draw();
          changed();
        };
      });
      return {
        ready: () => chosen.length === order.length,
        check: () => ({ ok: chosen.map((i) => order[i]).join('').toLowerCase() === x.t.toLowerCase(), answer: answerHtml }),
        lock: () => { locked = true; },
      };
    }

    $$('[data-say]', main).forEach((b) => { b.onclick = () => say(b.dataset.say, b.dataset.slow === '1'); });
    const baseCheck = ctrl.check;
    ctrl.check = () => {
      const r = baseCheck();
      if (r.ok && ex.type !== 'match' && it) {
        r.note = `${it.pic && !it.sentence ? `${it.pic} ` : ''}<span ${tAttr(course)}>${esc(it.disp)}</span>${it.p ? ` · ${esc(it.p)}` : ''}${it.h ? ` <span class="pron">[${esc(it.h)}]</span>` : ''}<small>${esc(it.k)}</small>`;
        if (speakOk && ctrl.say) r.say = ctrl.say;
      }
      return r;
    };
    return ctrl;
  }

  // 말하기 채점: 글자 단위 유사도 (0~1)
  function similar(a, b) {
    const n = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(PUNCT, '').replace(/\s+/g, '');
    a = n(a); b = n(b);
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return 1;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const btn = $('.check');
    if (!btn) return;
    if (e.key === 'Enter') {
      if (!btn.disabled) {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (L && L.phase === 'answer' && L.ctrl && L.ctrl.choose && /^[1-9]$/.test(e.key) && document.activeElement.tagName !== 'INPUT') {
      L.ctrl.choose(+e.key - 1);
    }
  });

  // 테스트용: 주소 끝에 #debug 를 붙이면 현재 레슨 상태를 볼 수 있어요.
  if (location.hash === '#debug') window.__lesson = () => L;

  showHome();
})();
