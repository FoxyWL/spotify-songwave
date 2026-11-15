// Контроллер воспроизведения: связывает движок рекомендаций с плеером Spotify.
//
// Главная задача — чтобы Spotify никогда не включил свой автоплей и играли только наши треки.
//  * current  — то, что играет сейчас;
//  * queued   — уже отправлено в очередь Spotify (её нельзя переставить или очистить через API → считаем «замороженным»);
//  * reserved — наш план на будущее, его можно пересобрать в любой момент (реакция на лайк, смену режима и т. д.).
// Первый трек запускается через PUT /me/player/play (контекст из одного трека), остальные добавляются в очередь.

export const HORIZON = 2; // сколько треков держим в очереди Spotify
export const RESERVE = 6; // сколько треков планируем заранее

const WHY_EXTERNAL = ['Включено не из волны'];

export function createPlayback({ engine, api, backend, now = () => Date.now(), onToast = () => {} } = {}) {
  let current = null;
  let queued = [];
  let reserved = [];
  let status = 'idle'; // idle | starting | playing | paused | no-device | error
  let pos = { ms: 0, at: 0, paused: true, dur: 0 };
  let pending = null; // ожидаем, что Spotify переключится на этот трек; всё остальное считаем устаревшим состоянием
  let chain = Promise.resolve();
  let lastError = null;
  let adBreak = false;
  const listeners = new Set();
  const savedOverride = new Map(); // trackId → true/false: сохранения в этой сессии поверх кэша медиатеки
  let savedBase = null;

  const emit = (type = 'change', data = {}) => { for (const l of listeners) { try { l({ type, ...data }); } catch { /* слушатель не должен ломать плеер */ } } };
  const toast = (kind, text) => { onToast({ kind, text }); emit('toast', { kind, text }); };
  const setStatus = (s) => { if (status !== s) status = s; };

  /** Все действия идут по одной цепочке: события плеера и команды пользователя не перебивают друг друга. */
  const enqueue = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const position = () => {
    if (!current) return 0;
    const raw = pos.ms + (pos.paused ? 0 : now() - pos.at);
    return Math.max(0, Math.min(raw, pos.dur || current.track.durationMs || raw));
  };
  const nearEnd = () => {
    const dur = pos.dur || current?.track.durationMs || 0;
    return dur > 0 && dur - position() < Math.max(4000, dur * 0.05);
  };

  function setPos(ms, paused, dur) { pos = { ms, at: now(), paused, dur: dur || pos.dur || current?.track.durationMs || 0 }; }

  // ---------- оценка прослушивания ----------
  function finalize(forced) {
    const rec = current;
    if (!rec) return;
    const dur = pos.dur || rec.track.durationMs || 0;
    const played = position();
    const base = { track: rec.track, genres: rec.genres, durationMs: dur, playedMs: played };
    if (forced === 'dislike') return; // дизлайк уже записан
    if (forced === 'skip' || !nearEnd()) engine.feedback({ ...base, type: 'skip' });
    else engine.feedback({ ...base, type: 'complete', playedMs: dur });
  }

  function begin(rec, { expect = false } = {}) {
    current = rec;
    pending = expect ? { id: rec.track.id, until: now() + 8000 } : null;
    setPos(0, false, rec.track.durationMs);
    engine.feedback({ type: 'play', track: rec.track, genres: rec.genres, source: rec.source });
    setStatus(expect ? 'starting' : 'playing');
  }

  function isSaved(id) {
    if (savedOverride.has(id)) return savedOverride.get(id);
    savedBase ||= engine.savedIds?.() ?? new Set();
    return savedBase.has(id);
  }

  // ---------- план ----------
  const planned = () => [current, ...queued, ...reserved].filter(Boolean);

  async function topUpReserve() {
    const need = RESERVE - reserved.length;
    if (need <= 0) return;
    try {
      const add = await engine.next(need, { after: planned() });
      reserved.push(...add);
    } catch (e) {
      if (e.code !== 'NO_CANDIDATES') lastError = e;
    }
  }

  /** Добавляет в очередь Spotify из резерва, пока не наберётся HORIZON. Недоступные треки молча заменяются. */
  async function fillQueue() {
    for (let guard = 0; guard < 12 && queued.length < HORIZON; guard++) {
      if (!reserved.length) await topUpReserve();
      const rec = reserved.shift();
      if (!rec) break;
      if (engine.isBlocked(rec.track)) continue;
      try {
        await backend.queueAdd(rec.track.uri);
        queued.push(rec);
      } catch (e) {
        if (e.isQuota || e.isRateLimit) { reserved.unshift(rec); toast('warn', 'Spotify просит подождать, очередь пополню позже'); break; }
        if (e.isNoDevice) { reserved.unshift(rec); setStatus('no-device'); break; }
        engine.markUnavailable(rec.track.id); // 400/403/404: трек недоступен в регионе или удалён
      }
    }
    await topUpReserve();
  }

  async function replan() {
    engine.release(reserved);
    reserved = [];
    await topUpReserve();
    emit();
  }

  // ---------- запуск ----------
  /** Новый контекст: PUT play одним треком, затем очередь. Спотифайный автоплей до этого не доходит. */
  /** Нет известного устройства (ничего не играло): выбираем активное, иначе Web Player этой вкладки, иначе первое. */
  async function ensureDevice() {
    if (backend.deviceId) return;
    try {
      const list = await api.devices();
      const pick = list.find((d) => d.active) || list.find((d) => /web player/i.test(d.name)) || list.find((d) => !d.restricted) || null;
      if (pick) backend.setDevice(pick.id);
    } catch { /* ошибку покажет сам запуск */ }
  }

  async function launch(first, rest = []) {
    await ensureDevice();
    let attempt = first;
    const spare = [...rest];
    for (let i = 0; i < 6 && attempt; i++) {
      try {
        await backend.play([attempt.track.uri]);
        queued = [];
        reserved = spare;
        begin(attempt, { expect: true });
        lastError = null;
        return true;
      } catch (e) {
        if (e.isNoDevice) { setStatus('no-device'); lastError = e; engine.release([attempt, ...spare]); throw e; }
        if (e.isPremium) { setStatus('error'); lastError = e; throw e; }
        if (e.isQuota || e.isRateLimit) { lastError = e; engine.release([attempt, ...spare]); throw e; }
        engine.markUnavailable(attempt.track.id);
        attempt = spare.shift();
      }
    }
    throw Object.assign(new Error('Не удалось запустить ни один трек'), { code: 'NOTHING_PLAYABLE' });
  }

  async function startWave() {
    setStatus('starting');
    emit();
    let recs;
    try {
      recs = await engine.next(1 + HORIZON + 2, { after: [] });
    } catch (e) { setStatus('error'); lastError = e; emit(); throw e; }
    try {
      await launch(recs[0], recs.slice(1));
    } catch (e) { if (status === 'starting') setStatus('error'); lastError = e; emit('error', { error: e }); throw e; }
    await fillQueue();
    emit();
  }

  // ---------- события плеера ----------
  function handleState(st, meta = {}) {
    if (st === undefined) { // ошибка опроса
      if (meta.error?.isQuota) toast('warn', 'Лимит запросов Spotify: управление может отвечать медленнее');
      return;
    }
    if (!st) { // ничего не играет, реклама или локальный файл
      adBreak = !!meta.ad;
      if (current && !pending && status !== 'starting') { setStatus(adBreak ? 'playing' : 'idle'); emit(); }
      return;
    }
    adBreak = false;
    const id = st.track.id;
    if (pending) {
      if (id === pending.id) pending = null;
      else if (now() < pending.until) return; // устаревшее состояние до переключения
      else pending = null;
    }
    if (current && id === current.track.id) {
      // тот же трек: если позиция резко ушла назад из конца — это повтор, считаем как дослушанный
      const wasNearEnd = nearEnd();
      if (wasNearEnd && st.positionMs < (pos.dur || 0) * 0.3 && !st.paused) {
        finalize();
        begin(current);
      }
      setPos(st.positionMs, st.paused, st.durationMs);
      setStatus(st.paused ? 'paused' : 'playing');
      emit();
      return;
    }
    enqueue(() => trackChanged(st));
  }

  async function trackChanged(st) {
    const id = st.track.id;
    const natural = current ? nearEnd() : false;
    const idx = queued.findIndex((r) => r.track.id === id);
    if (idx >= 0) {
      for (const skipped of queued.slice(0, idx)) engine.markUnavailable(skipped.track.id); // Spotify сам перепрыгнул — трек не проигрался
      const rec = queued[idx];
      queued = queued.slice(idx + 1);
      finalize(natural ? undefined : 'skip');
      begin(rec);
      setPos(st.positionMs, st.paused, st.durationMs);
      setStatus(st.paused ? 'paused' : 'playing');
      if (engine.isBlocked(rec.track)) { await backend.next().catch(() => {}); } // пользователь исключил артиста, пока трек ждал в очереди
      await fillQueue();
      emit();
      return;
    }
    // Трек, которого нет в плане. Либо у Spotify закончился контекст и он включил автоплей, либо пользователь сам выбрал трек.
    finalize(natural ? undefined : 'skip');
    if (natural) {
      // предыдущий трек доигран, а следующим включился не наш: Spotify ушёл в автоплей или потерял очередь — берём управление обратно
      current = null;
      await startWave().catch(() => {});
      return;
    }
    const rec = { track: st.track, source: 'external', genres: [], score: 0, why: WHY_EXTERNAL };
    const known = st.track.artists[0]?.id;
    if (known) { try { const a = await api.artist(known); rec.genres = a?.genres?.slice(0, 4) ?? []; } catch { /* не критично */ } }
    begin(rec);
    setPos(st.positionMs, st.paused, st.durationMs);
    setStatus(st.paused ? 'paused' : 'playing');
    await fillQueue();
    emit();
  }

  function handleEvent(e) {
    if (e.type === 'device-lost') { setStatus('no-device'); toast('warn', 'Плеер отключился. Выбери устройство или перезапусти волну.'); emit(); }
    else if (e.type === 'fatal') { lastError = e.error; setStatus('error'); emit('error', { error: e.error }); }
    else if (e.type === 'autoplay-blocked') toast('warn', 'Браузер заблокировал звук. Нажми «Играть» ещё раз.');
    else if (e.type === 'playback-error') toast('warn', 'Spotify не смог проиграть трек, перехожу к следующему');
  }

  // ---------- команды пользователя ----------
  async function skipCurrent(reason) {
    if (!current) return startWave();
    const rec = current;
    finalize(reason);
    if (!queued.length) await fillQueue();
    const nxt = queued.shift();
    if (nxt) {
      pending = { id: nxt.track.id, until: now() + 8000 };
      try {
        await backend.next();
      } catch (e) {
        // next не сработал — запускаем следующий трек напрямую
        queued = [];
        await launch(nxt, reserved);
        emit();
        return;
      }
      begin(nxt, { expect: true });
      await fillQueue();
    } else {
      current = null;
      await startWave();
    }
    emit();
    return rec;
  }

  const guard = (fn) => async (...a) => {
    try { return await enqueue(() => fn(...a)); } catch (e) { lastError = e; if (e.isNoDevice) setStatus('no-device'); emit('error', { error: e }); throw e; }
  };

  const api_ = {
    kind: backend.kind,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async init(onUserGesture) {
      onUserGesture?.();
      const id = await backend.start(handleState, handleEvent);
      return id;
    },
    stop() { backend.stop(); },

    start: guard(async () => { current = null; await startWave(); }),
    restart: guard(async () => { engine.release(reserved); reserved = []; const keep = current; if (keep) finalize('skip'); current = null; await startWave(); }),
    toggle: guard(async () => {
      if (!current || status === 'idle' || status === 'error') { current = null; return startWave(); }
      if (pos.paused || status === 'paused') { await backend.resume(); setPos(position(), false); setStatus('playing'); }
      else { setPos(position(), pos.paused); await backend.pause(); setPos(position(), true); setStatus('paused'); }
      emit();
    }),
    next: guard(() => skipCurrent('skip')),
    previous: guard(async () => { if (!current) return; await backend.seek(0); setPos(0, pos.paused); emit(); }),
    seek: guard(async (ms) => { if (!current) return; await backend.seek(ms); setPos(ms, pos.paused); emit(); }),

    like: guard(async () => {
      const rec = current; if (!rec) return;
      engine.feedback({ type: 'like', track: rec.track, genres: rec.genres });
      emit();
      await replan();
    }),
    unlike: guard(async () => {
      const rec = current; if (!rec) return;
      engine.feedback({ type: 'unlike', track: rec.track, genres: rec.genres });
      emit();
      await replan();
    }),
    /** «В медиатеку»: отдельное действие Spotify (Liked Songs), не то же самое, что лайк волны. */
    save: guard(async () => {
      const rec = current; if (!rec) return;
      savedOverride.set(rec.track.id, true); emit();
      try { await api.saveToLibrary([rec.track.uri]); toast('ok', 'Добавлено в медиатеку Spotify'); } catch (e) { savedOverride.delete(rec.track.id); emit(); toast('warn', e.isQuota ? 'Не добавилось: лимит запросов Spotify' : 'Не удалось добавить в медиатеку Spotify'); }
    }),
    unsave: guard(async () => {
      const rec = current; if (!rec) return;
      savedOverride.set(rec.track.id, false); emit();
      try { await api.removeFromLibrary([rec.track.uri]); toast('ok', 'Убрано из медиатеки Spotify'); } catch (e) { savedOverride.delete(rec.track.id); emit(); toast('warn', 'Не удалось убрать из медиатеки Spotify'); }
    }),
    dislike: guard(async () => {
      const rec = current; if (!rec) return;
      engine.feedback({ type: 'dislike', track: rec.track, genres: rec.genres, playedMs: position(), durationMs: pos.dur });
      await replan();
      await skipCurrent('dislike');
    }),
    excludeArtist: guard(async () => {
      const rec = current; if (!rec) return;
      engine.feedback({ type: 'excludeArtist', track: rec.track, genres: rec.genres });
      await replan();
      await skipCurrent('dislike');
    }),
    more: guard(async () => { const r = current; if (!r) return; engine.feedback({ type: 'more', track: r.track, genres: r.genres }); await replan(); }),
    less: guard(async () => { const r = current; if (!r) return; engine.feedback({ type: 'less', track: r.track, genres: r.genres }); await replan(); }),

    /** Включить конкретный трек (поиск, строка очереди); волна продолжится после него. */
    playTrack: guard(async (track, source = 'search') => {
      const rec = { track, source, genres: [], score: 0, why: ['Выбрано тобой'] };
      try { const a = await api.artist(track.artists[0]?.id); rec.genres = a?.genres?.slice(0, 4) ?? []; } catch { /* не критично */ }
      if (current) finalize('skip');
      engine.release(reserved);
      await launch(rec, []);
      await fillQueue();
      emit();
    }),
    jumpTo: guard(async (trackId) => {
      const rec = reserved.find((r) => r.track.id === trackId) || queued.find((r) => r.track.id === trackId);
      if (!rec) return;
      reserved = reserved.filter((r) => r !== rec);
      queued = queued.filter((r) => r !== rec);
      if (current) finalize('skip');
      await launch(rec, reserved);
      await fillQueue();
      emit();
    }),
    /** Убрать трек из плана (только из резерва: то, что уже в очереди Spotify, снять нельзя). */
    dropPlanned: guard(async (trackId) => {
      const rec = reserved.find((r) => r.track.id === trackId);
      if (!rec) return;
      reserved = reserved.filter((r) => r !== rec);
      engine.feedback({ type: 'excludeTrack', track: rec.track, genres: rec.genres });
      await topUpReserve();
      emit();
    }),
    async setVolume(pct) { try { await backend.volume(pct); } catch (e) { toast('warn', 'Это устройство не даёт менять громкость отсюда'); } },

    /** Смена настроек/режима/«Встряхнуть»: пересобираем только резерв; то, что уже в очереди Spotify, доигрывается. */
    replan: guard(replan),
    shake: guard(async () => { engine.release(reserved); reserved = []; await engine.refresh(); await topUpReserve(); emit(); }),

    async selectDevice(id) {
      return enqueue(async () => {
        backend.setDevice(id);
        await api.transfer(id, !!current && status !== 'paused');
        backend.kick();
        setStatus(current ? 'starting' : 'idle');
        emit();
      });
    },
    // состояние для интерфейса
    view() {
      return {
        status, current, queued: [...queued], reserved: [...reserved], paused: pos.paused, position: position(), duration: pos.dur || current?.track.durationMs || 0,
        liked: current ? engine.isLiked(current.track.id) : false,
        saved: current ? isSaved(current.track.id) : false, adBreak, error: lastError, kind: backend.kind, deviceId: backend.deviceId,
      };
    },
    position,
    // для тестов
    _handleState: handleState,
    _idle: () => chain,
  };
  return api_;
}
