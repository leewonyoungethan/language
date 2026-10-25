(function () {
  'use strict';

  const COURSES = window.COURSES || [];
  const STORE_KEY = 'language-lessons-v1';
  const MAX_HEARTS = 5;
  const REFILL_MS = 30 * 60 * 1000;
  const DAILY_GOAL = 30;
  const GUIDE_URL = 'https://github.com/leewonyoungethan/language#readme';
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
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
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
  function prepare(course) {
    if (course.flat) return course;
    course.units.forEach((u, ui) => u.lessons.forEach((l, li) => {
      l.key = ui + '-' + li;
      l.unit = u;
      l.items = l.items.map((a) => {
        const t = a[0], k = a[1], p = a[2] || '';
        const tokens = t.replace(PUNCT, ' ').trim().split(/\s+/);
        return {
          t, k, p, tokens,
          kTokens: k.replace(PUNCT, ' ').trim().split(/\s+/),
          sentence: tokens.length >= 3,
          disp: course.joiner === '' ? t.replace(/\s+/g, '') : t,
        };
      });
    }));
    course.flat = course.units.flatMap((u) => u.lessons);
    return course;
  }
  COURSES.forEach(prepare);
  const getCourse = (id) => COURSES.find((c) => c.id === id);
  const allItems = (course) => course.flat.flatMap((l) => l.items);
  function progressOf(course) {
    if (!S.progress[course.id]) S.progress[course.id] = { done: {} };
    return S.progress[course.id];
  }
  const isDone = (course, lesson) => !!progressOf(course).done[lesson.key];

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
    return voices.find((v) => norm(v) === want) || voices.find((v) => norm(v).startsWith(want.slice(0, 2)));
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

  let actx;
  function tone(seq) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      seq.forEach(([freq, dur]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur * 0.75;
      });
    } catch (e) { /* audio unavailable */ }
  }
  const SFX = {
    ok: () => tone([[660, 0.12], [990, 0.2]]),
    bad: () => tone([[200, 0.18], [160, 0.25]]),
    tick: () => tone([[880, 0.08]]),
    done: () => tone([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]]),
  };

  // ---------- exercise generation ----------
  function poolFor(course, lesson) {
    const idx = course.flat.indexOf(lesson);
    const items = course.flat.slice(0, idx + 1).flatMap((l) => l.items);
    return items.length >= 10 ? items : allItems(course);
  }

  // Wrong options, preferring the same kind (word vs sentence) and never repeating a key.
  function distractors(course, item, pool, n, keyFn) {
    const seen = new Set([keyFn(item)]);
    const out = [];
    const rest = allItems(course);
    const order = shuffle(pool.filter((x) => x.sentence === item.sentence))
      .concat(shuffle(pool.filter((x) => x.sentence !== item.sentence)), shuffle(rest));
    for (const x of order) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
      if (out.length >= n) break;
    }
    return out;
  }

  function extraTokens(item, pool, field, n) {
    const have = new Set(item[field].map((t) => t.toLowerCase()));
    const cand = uniqueBy(pool.flatMap((x) => x[field]), (t) => t.toLowerCase())
      .filter((t) => !have.has(t.toLowerCase()));
    return sample(cand, n);
  }

  function practiceType(course, it) {
    const speakOk = canSpeak(course.tts);
    const types = it.sentence ? ['build', 'build'] : ['kochoice'];
    if (speakOk) types.push('listen');
    if (course.typing && (!it.sentence || it.tokens.length <= 5)) types.push('type');
    return pick(types);
  }

  function matchItems(list) {
    const words = uniqueBy(uniqueBy(list.filter((x) => !x.sentence), (x) => x.disp), (x) => x.k);
    return sample(words, Math.min(5, words.length));
  }

  function buildLesson(course, lesson) {
    const pool = poolFor(course, lesson);
    const items = lesson.items;
    const first = items.map((it) => ({
      type: it.sentence && it.kTokens.length >= 2 ? 'kobuild' : 'intro', item: it, pool,
    }));
    const second = shuffle(items).map((it) => ({ type: practiceType(course, it), item: it, pool }));
    let words = matchItems(items);
    if (words.length < 3) words = matchItems(pool);
    const match = words.length >= 3 ? [{ type: 'match', items: words }] : [];
    return first.concat(match, second);
  }

  function buildPractice(course) {
    const learned = course.flat.filter((l) => isDone(course, l)).flatMap((l) => l.items);
    const pool = learned.length >= 10 ? learned : allItems(course);
    const ex = sample(learned, Math.min(10, learned.length))
      .map((it) => ({ type: practiceType(course, it), item: it, pool }));
    const words = matchItems(learned);
    if (words.length >= 4) ex.splice(Math.min(3, ex.length), 0, { type: 'match', items: words });
    return ex;
  }

  // ---------- home ----------
  function topBar(course) {
    syncHearts();
    const st = currentStreak();
    return `<header class="top">
      <button class="course-btn" title="코스 바꾸기" aria-label="코스 바꾸기">${course.flag}</button>
      <div class="stat streak ${st ? '' : 'off'}" title="연속 학습">🔥 ${st}</div>
      <div class="stat xp" title="총 XP">⚡ ${S.xp}</div>
      <div class="stat heart" title="${S.hearts < MAX_HEARTS ? nextHeartMinutes() + '분 뒤 하트 1개 충전' : '하트 가득'}">❤️ ${S.hearts}</div>
    </header>`;
  }

  function showHome() {
    const course = getCourse(S.course);
    if (!course) return showCourses();
    save();
    const curIdx = course.flat.findIndex((l) => !isDone(course, l));
    const anyDone = course.flat.some((l) => isDone(course, l));
    const daily = dailyXp();
    let n = 0;
    const units = course.units.map((u, ui) => {
      const nodes = u.lessons.map((l) => {
        const idx = course.flat.indexOf(l);
        const done = isDone(course, l);
        const unlocked = idx === 0 || isDone(course, course.flat[idx - 1]);
        const current = idx === curIdx;
        const x = [0, 44, 66, 44, 0, -44, -66, -44][n++ % 8];
        const cls = done ? 'done' : current ? 'current' : unlocked ? 'open' : 'locked';
        const icon = done ? '✓' : unlocked ? '★' : '🔒';
        return `<div class="node-wrap" style="--x:${x}px;--c:${u.color}">
          ${current ? '<div class="start-bubble">시작</div>' : ''}
          <button class="node ${cls}" data-key="${l.key}" aria-label="${esc(l.title)}${done ? ' (완료)' : unlocked ? '' : ' (잠김)'}">${icon}</button>
          <div class="node-label">${esc(l.title)}</div>
        </div>`;
      }).join('');
      return `<section class="unit">
        <div class="unit-banner" style="--c:${u.color}">
          <div><div class="unit-no">유닛 ${ui + 1}</div><h2>${esc(u.title)}</h2><p>${esc(u.desc)}</p></div>
          ${ui === 0 && course.guide ? `<a href="${course.guide}" target="_blank" rel="noopener">📖 가이드</a>` : ''}
        </div>
        <div class="path">${nodes}</div>
      </section>`;
    }).join('');

    render(`${topBar(course)}
      <div class="page">
        <div class="goal">
          <div class="goal-row"><span class="goal-title">${daily >= DAILY_GOAL ? '🎉 오늘의 목표 달성!' : '🎯 오늘의 목표'}</span><span class="goal-num">${Math.min(daily, DAILY_GOAL)} / ${DAILY_GOAL} XP</span></div>
          <div class="meter"><span style="width:${Math.min(100, Math.round((100 * daily) / DAILY_GOAL))}%"></span></div>
          <div class="actions">
            <button class="btn continue">${curIdx === -1 ? '🏆 코스 완료!' : anyDone ? '▶ 이어서 하기' : '▶ 첫 레슨 시작'}</button>
            <button class="btn blue practice" ${anyDone ? '' : 'disabled'}>💪 복습하기</button>
          </div>
        </div>
        ${units}
      </div>`);

    $('.course-btn').onclick = showCourses;
    $('.stat.heart').onclick = () => toast(S.hearts < MAX_HEARTS ? `${nextHeartMinutes()}분 뒤에 하트가 1개 충전돼요. 복습하면 바로 1개 얻어요.` : '하트가 가득 찼어요!');
    $('.stat.streak').onclick = () => toast(currentStreak() ? `${currentStreak()}일 연속 학습 중이에요! 🔥` : '오늘 레슨을 하나 끝내면 연속 학습이 시작돼요.');
    $('.continue').onclick = () => {
      if (curIdx === -1) return toast('모든 레슨을 끝냈어요! 복습으로 실력을 지켜 보세요.');
      startLesson(course, course.flat[curIdx], false);
    };
    $('.practice').onclick = () => startLesson(course, null, true);
    $$('.node').forEach((b) => {
      b.onclick = () => {
        const l = course.flat.find((x) => x.key === b.dataset.key);
        if (b.classList.contains('locked')) return toast('앞 레슨을 먼저 끝내야 열려요 🔒');
        startLesson(course, l, false);
      };
    });
    const cur = $('.node.current');
    if (cur && anyDone) cur.scrollIntoView({ block: 'center' });
  }

  function showCourses() {
    const active = getCourse(S.course);
    render(`<div class="page">
      <header class="simple-top"><h1>무엇을 배울까요?</h1>${active ? '<button class="icon-btn back" aria-label="닫기">✕</button>' : ''}</header>
      <div class="course-grid">${COURSES.map((c) => {
        const done = c.flat.filter((l) => isDone(c, l)).length;
        return `<button class="course-card ${active === c ? 'active' : ''}" data-id="${c.id}">
          <span class="flag">${c.flag}</span>
          <span class="cname">${esc(c.name)}</span>
          <span class="cmeta">${c.units.length}개 유닛 · ${done}/${c.flat.length} 레슨</span>
          <span class="mini-bar"><span style="width:${Math.round((100 * done) / c.flat.length)}%"></span></span>
        </button>`;
      }).join('')}</div>
      <p class="more">다른 언어는 <a href="${GUIDE_URL}" target="_blank" rel="noopener">언어별 공부 자료</a>에서 볼 수 있어요.<br>레슨 코스는 계속 추가할 예정이에요.</p>
      <label class="toggle"><input type="checkbox" class="sound" ${S.sound ? 'checked' : ''}> 효과음 켜기</label>
    </div>`);
    const back = $('.back');
    if (back) back.onclick = showHome;
    $('.sound').onchange = (e) => { S.sound = e.target.checked; save(); };
    $$('.course-card').forEach((b) => {
      b.onclick = () => { S.course = b.dataset.id; save(); showHome(); };
    });
  }

  // ---------- lesson ----------
  let L = null;

  function startLesson(course, lesson, practice) {
    syncHearts();
    if (!practice && S.hearts <= 0) return showNoHearts(course);
    const queue = practice ? buildPractice(course) : buildLesson(course, lesson);
    if (!queue.length) return toast('복습할 레슨이 아직 없어요.');
    L = { course, lesson, practice, queue, pos: 0, total: queue.length, correct: 0, firstTry: 0, mistakes: 0, ctrl: null, phase: 'answer' };
    render(`<div class="lesson">
      <header class="lesson-top">
        <button class="icon-btn quit" aria-label="그만하기">✕</button>
        <div class="bar" role="progressbar" aria-label="진행도"><div class="bar-fill"></div></div>
        <div class="hearts">${practice ? '💪' : '❤️ <b>' + S.hearts + '</b>'}</div>
      </header>
      <main class="ex"></main>
      <footer class="foot"><div class="foot-inner"><div class="fb"></div><button class="btn check" disabled>확인</button></div></footer>
    </div>`);
    $('.quit').onclick = () => {
      if (confirm('레슨을 그만둘까요? 이번 레슨의 진행 상황은 저장되지 않아요.')) { L = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); showHome(); }
    };
    nextExercise();
  }

  function updateBar() {
    $('.bar-fill').style.width = Math.round((100 * L.correct) / L.total) + '%';
    const h = $('.hearts b');
    if (h) h.textContent = S.hearts;
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
      fb.innerHTML = `<div class="fb-title">${pick(['훌륭해요!', '정답이에요!', '잘했어요!', '완벽해요!'])}</div>${r.note ? `<div class="fb-ans">${r.note}</div>` : ''}`;
      if (r.say) speak(r.say, L.course.tts);
    } else {
      L.mistakes++;
      SFX.bad();
      foot.className = 'foot bad';
      fb.innerHTML = `<div class="fb-title">아쉬워요! 정답은:</div><div class="fb-ans">${r.answer}</div>`;
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
    render(`<div class="center">
      <div class="big-emoji">${perfect ? '🏆' : practice ? '💪' : '🎉'}</div>
      <h1>${title}</h1>
      ${streakUp ? `<p>🔥 <b>${currentStreak()}일</b> 연속 학습 중이에요!</p>` : ''}
      ${practice ? '<p>복습 보상으로 하트 1개를 받았어요 ❤️</p>' : ''}
      <div class="stats">
        <div class="stat-card" style="--c:var(--gold)"><div class="k">획득 XP</div><div class="v">⚡ ${xp}</div></div>
        <div class="stat-card" style="--c:var(--green)"><div class="k">정확도</div><div class="v">🎯 ${acc}%</div></div>
        <div class="stat-card" style="--c:var(--orange)"><div class="k">연속 학습</div><div class="v">🔥 ${currentStreak()}</div></div>
      </div>
      <button class="btn check">계속</button>
    </div>`);
    $('.check').onclick = showHome;
  }

  function showNoHearts(course) {
    L = null;
    syncHearts();
    save();
    const learned = course.flat.some((l) => isDone(course, l));
    render(`<div class="center">
      <div class="big-emoji">💔</div>
      <h1 class="red">하트가 다 떨어졌어요</h1>
      <p>하트는 30분마다 1개씩 다시 채워져요.<br>다음 하트까지 약 <b>${nextHeartMinutes()}분</b> 남았어요.${learned ? '<br>복습을 끝내면 하트를 바로 1개 받을 수 있어요!' : ''}</p>
      ${learned ? '<button class="btn blue practice">💪 복습해서 하트 받기</button>' : ''}
      <button class="btn ghost home">홈으로</button>
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
    const speakBtn = (text) => (speakOk ? `<button class="icon-btn speak" data-say="${esc(text)}" aria-label="듣기">🔊</button>` : '');
    const targetHtml = (x, withPinyin) => `<span lang="${course.lang}">${esc(x.disp)}</span>${withPinyin && x.p ? `<small class="pinyin">${esc(x.p)}</small>` : ''}`;
    const answerTarget = (x) => `${targetHtml(x, true)}<small>${esc(x.k)}</small>`;
    const card = (x) => `<div class="card">${speakBtn(x.disp)}<div class="target"><span class="target-text" lang="${course.lang}">${esc(x.disp)}</span>${x.p ? `<span class="pinyin">${esc(x.p)}</span>` : ''}</div></div>`;
    let ctrl;

    function choices(prompt, body, options, correct, optHtml, answer, extra) {
      main.innerHTML = `<h1 class="prompt">${prompt}</h1>${body}<div class="choices">${options.map((o, i) =>
        `<button class="choice" data-i="${i}"><span class="num">${i + 1}</span><span class="choice-text">${optHtml(o)}</span></button>`).join('')}</div>`;
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
      return Object.assign({
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
      }, extra || {});
    }

    function wordBank(prompt, body, answer, extra, joiner, answerHtml, tokLang, onPick) {
      const bank = shuffle(answer.concat(extra));
      main.innerHTML = `<h1 class="prompt">${prompt}</h1>${body}
        <div class="answer-line" lang="${tokLang}"></div>
        <div class="bank" lang="${tokLang}">${bank.map((t, i) => `<button class="tok" data-i="${i}">${esc(t)}</button>`).join('')}</div>`;
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

    switch (ex.type) {
      case 'intro': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.k)));
        ctrl = choices(it.sentence ? '이 문장은 무슨 뜻일까요?' : '새 표현이에요! 뜻을 고르세요', card(it), opts, opts.indexOf(it),
          (o) => esc(o.k), answerTarget(it));
        if (speakOk) setTimeout(() => say(it.disp), 250);
        break;
      }
      case 'kochoice': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.disp)));
        ctrl = choices(`${course.name}로 알맞은 것을 고르세요`, `<div class="card ko">${esc(it.k)}</div>`, opts, opts.indexOf(it),
          (o) => targetHtml(o, true), answerTarget(it), {});
        ctrl.say = it.disp;
        break;
      }
      case 'listen': {
        const opts = shuffle([it].concat(distractors(course, it, ex.pool, 3, (x) => x.p || x.disp.toLowerCase())));
        ctrl = choices('듣고 알맞은 것을 고르세요',
          `<div class="listen"><button class="big" data-say="${esc(it.disp)}" aria-label="듣기">🔊</button><button class="big slow" data-say="${esc(it.disp)}" data-slow="1" aria-label="천천히 듣기">🐢</button></div>`,
          opts, opts.indexOf(it), (o) => targetHtml(o, false), answerTarget(it));
        setTimeout(() => say(it.disp), 300);
        break;
      }
      case 'build': {
        ctrl = wordBank(`${course.name}로 옮겨 보세요`, `<div class="card ko">${esc(it.k)}</div>`,
          it.tokens, extraTokens(it, ex.pool, 'tokens', 3), course.joiner, answerTarget(it), course.lang,
          speakOk ? (t) => say(t) : null);
        ctrl.say = it.disp;
        break;
      }
      case 'kobuild': {
        ctrl = wordBank('한국어로 옮겨 보세요', card(it), it.kTokens, extraTokens(it, ex.pool, 'kTokens', 3), ' ',
          `${esc(it.k)}<small>${esc(it.disp)}</small>`, 'ko', null);
        if (speakOk) setTimeout(() => say(it.disp), 250);
        break;
      }
      case 'type': {
        main.innerHTML = `<h1 class="prompt">${course.name}로 써 보세요</h1>
          <div class="card ko">${esc(it.k)}</div>
          <input class="type-in" lang="${course.lang}" placeholder="${course.name}로 입력하세요" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          ${course.chars ? `<div class="chars">${course.chars.map((c) => `<button class="tok small" data-c="${c}">${c}</button>`).join('')}</div>` : ''}`;
        const input = $('.type-in', main);
        input.oninput = changed;
        $$('[data-c]', main).forEach((b) => {
          b.onclick = () => {
            const s = input.selectionStart, e = input.selectionEnd;
            input.value = input.value.slice(0, s) + b.dataset.c + input.value.slice(e);
            input.focus();
            input.setSelectionRange(s + 1, s + 1);
            changed();
          };
        });
        setTimeout(() => input.focus(), 50);
        const norm = (s) => s.toLowerCase().normalize('NFC').replace(PUNCT, ' ')
          .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
          .replace(/\s+/g, ' ').trim();
        ctrl = {
          ready: () => input.value.trim().length > 0,
          check: () => ({ ok: norm(input.value) === norm(it.t), answer: answerTarget(it) }),
          lock: () => { input.disabled = true; },
          say: it.disp,
        };
        break;
      }
      case 'match': {
        const items = ex.items;
        const left = shuffle(items), right = shuffle(items);
        main.innerHTML = `<h1 class="prompt">짝을 맞춰 보세요</h1>
          <div class="match">
            <div class="col">${left.map((x) => `<button class="tok mt" data-side="L" data-i="${items.indexOf(x)}" lang="${course.lang}">${esc(x.disp)}</button>`).join('')}</div>
            <div class="col">${right.map((x) => `<button class="tok mt" data-side="R" data-i="${items.indexOf(x)}">${esc(x.k)}</button>`).join('')}</div>
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
        ctrl = { ready: () => matched === items.length, check: () => ({ ok: true, answer: '' }) };
        break;
      }
    }

    $$('[data-say]', main).forEach((b) => { b.onclick = () => say(b.dataset.say, b.dataset.slow === '1'); });
    const baseCheck = ctrl.check;
    ctrl.check = () => {
      const r = baseCheck();
      if (r.ok && ex.type !== 'match') {
        r.note = `<span lang="${course.lang}">${esc(it.disp)}</span>${it.p ? ` · ${esc(it.p)}` : ''}<small>${esc(it.k)}</small>`;
        if (speakOk && ctrl.say) r.say = ctrl.say;
      }
      return r;
    };
    return ctrl;
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
