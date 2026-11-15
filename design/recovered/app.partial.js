(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'my-wave-demo-state-v2';

  const catalog = [
    { id: 'drift', title: 'Drift', artist: 'Kiasmos', album: 'II', genre: 'INDIE ELECTRONIC', year: '2024', duration: 316, cover: 'assets/cover-drift.svg', reason: 'Подобрано на основе твоих прослушиваний', mood: 'Мягкая энергия', familiarity: 0.88, energy: 0.42, style: 'Электроника', color: 'purple' },
    { id: 'kerala', title: 'Kerala', artist: 'Bonobo', album: 'Migration', genre: 'DOWNTEMPO', year: '2017', duration: 237, cover: 'assets/cover-afterglow.svg', reason: 'Близкое настроение', mood: 'Ритмичный грув', familiarity: 0.93, energy: 0.62, style: 'Downtempo', color: 'purple' },
    { id: 'weightless', title: 'Weightless', artist: 'Arlo Parks', album: 'Collapsed in Sunbeams', genre: 'ALTERNATIVE', year: '2021', duration: 222, cover: 'assets/cover-bluehour.svg', reason: 'Новый артист в знакомом звучании', mood: 'Спокойно и мягко', familiarity: 0.48, energy: 0.28, style: 'Indie', color: 'mint' },
    { id: 'open-eye', title: 'Open Eye Signal', artist: 'Jon Hopkins', album: 'Immunity', genre: 'ELECTRONIC', year: '2013', duration: 468, cover: 'assets/cover-signal.svg', reason: 'Ты часто слушаешь похожее', mood: 'Постепенно нарастает', familiarity: 0.82, energy: 0.78, style: 'Electronica', color: 'orange' },
    { id: 'stay-same', title: 'Stay the Same', artist: 'Bonobo, Andreya Triana', album: 'Black Sands', genre: 'DOWNTEMPO', year: '2010', duration: 272, cover: 'assets/cover-moon.svg', reason: 'Продолжение твоей подборки', mood: 'Тёплая атмосфера', familiarity: 0.87, energy: 0.39, style: 'Downtempo', color: 'blue' },
    { id: 'night-swim', title: 'Night Swim', artist: 'Tourist', album: 'Wild', genre: 'MELODIC ELECTRONIC', year: '2019', duration: 244, cover: 'assets/cover-afterglow.svg', reason: 'Созвучно твоим любимым трекам', mood: 'Ночной драйв', familiarity: 0.71, energy: 0.55, style: 'Electronic', color: 'purple' },
    { id: 'reverie', title: 'Reverie', artist: 'Ólafur Arnalds', album: 'Some Kind of Peace', genre: 'NEO CLASSICAL', year: '2020', duration: 206, cover: 'assets/cover-bluehour.svg', reason: 'Небольшое музыкальное открытие', mood: 'Созерцательно', familiarity: 0.36, energy: 0.19, style: 'Neo-classical', color: 'mint' },
    { id: 'emerald', title: 'Emerald Rush', artist: 'Jon Hopkins', album: 'Singularity', genre: 'ELECTRONIC', year: '2018', duration: 345, cover: 'assets/cover-signal.svg', reason: 'Больше энергии в твоём потоке', mood: 'Интенсивный ритм', familiarity: 0.78, energy: 0.91, style: 'Electronica', color: 'orange' },
    { id: 'atlas', title: 'Atlas', artist: 'Bicep', album: 'Bicep', genre: 'MELODIC HOUSE', year: '2021', duration: 301, cover: 'assets/cover-moon.svg', reason: 'Рядом с твоими электронными фаворитами', mood: 'Пульсирующий грув', familiarity: 0.66, energy: 0.73, style: 'House', color: 'blue' }
  ];
  const trackById = (id) => catalog.find((track) => track.id === id) || catalog[0];
  const defaultState = {
    currentId: 'drift', queue: ['kerala', 'weightless', 'open-eye', 'stay-same'],
    history: [], playing: false, currentTime: 0, liked: {}, disliked: {}, saved: {},
    preset: 'balanced', discovery: 32, shuffle: false, repeat: 'off', volume: 65,
    playlists: [], excludedArtists: [],
    familiarCount: 12, lessLikedStyles: [], lastUpdated: Date.now()
  };

  let state = loadState();
  let playbackTimer = null;
  let toastTimer = null;
  let activeTrackMenuId = null;
  const toast = $('.toast');
  const modalLayer = $('#modal-layer');

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return structuredClone(defaultState);
      return { ...structuredClone(defaultState), ...saved };
    } catch (_) {
      return structuredClone(defaultState);
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* Private browsing may block storage. */ }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function syncPlaybackButtons() {
    $$('[data-action="toggle-play"]').forEach((button) => {
      const icon = $('svg', button);
      if (icon) icon.innerHTML = state.playing
        ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z" />'
        : '<path d="m8 5 12 7-12 7z" />';
      if (button.classList.contains('play-hero')) {
        const text = $('span', button);
        if (text) text.textContent = state.playing ? 'Пауза' : 'Слушать волну';
      }
      button.setAttribute('aria-label', state.playing ? 'Пауза' : 'Воспроизвести');
    });
    document.body.classList.toggle('is-playing', state.playing);
  }

  function syncProgress() {
    const track = trackById(state.currentId);
    const ratio = track.duration ? Math.min(100, (state.currentTime / track.duration) * 100) : 0;
    const fill = $('#progress-fill');
    const rail = $('#progress-track');
    if (fill) fill.style.width = `${ratio}%`;
    if (rail) rail.setAttribute('aria-valuenow', String(Math.round(ratio)));
    const elapsed = $('#elapsed-time');
    const duration = $('#duration-time');
    if (elapsed) elapsed.textContent = formatTime(state.currentTime);
    if (duration) duration.textContent = formatTime(track.duration);
  }

  function renderFeedback() {
    const liked = Boolean(state.liked[state.currentId]);
    const disliked = Boolean(state.disliked[state.currentId]);
    $$('.like-button,.player-heart').forEach((button) => button.classList.toggle('active', liked));
    $('.dislike-button')?.classList.toggle('active', disliked);
    const saveButton = $('.save-action');
    if (saveButton) saveButton.textContent = state.saved[state.currentId] ? '✓ В медиатеке' : '＋ В медиатеку';
  }

  function renderCurrentTrack() {
    const track = trackById(state.currentId);
    const cover = $('#now-cover');
    const playerCover = $('#player-cover');
    if (cover) { cover.src = track.cover; cover.alt = `Обложка трека ${track.title}`; }
    if (playerCover) { playerCover.src = track.cover; playerCover.alt = `Обложка трека ${track.title}`; }
    $('#current-track').textContent = track.title;
    $('#current-artist').textContent = track.artist;
    $('#player-track-title').textContent = track.title;
    $('#player-track-artist').textContent = track.artist;
    $('#track-overline').innerHTML = `${escapeHTML(track.genre)} <span>·</span> ${escapeHTML(track.year)}`;
    $('#track-tags').innerHTML = `<span>${escapeHTML(track.style)}</span><span>${escapeHTML(track.mood)}</span>`;
    $('#track-reason').innerHTML = `<span class="reason-spark">✳</span> ${escapeHTML(track.reason)}`;
    renderFeedback();
    syncProgress();
    renderQueue();
  }

  function renderQueue() {
    const list = $('#queue-list');
    if (!list) return;
    const count = $('#queue-count');
    if (count) count.textContent = String(state.queue.length).padStart(2, '0');
    if (!state.queue.length) {
      list.innerHTML = '<div class="queue-empty"><span>Волна набирает следующий трек</span><button class="text-action" data-action="refresh">Обновить поток</button></div>';
      return;
    }
    list.innerHTML = state.queue.map((id, index) => {
      const track = trackById(id);
      return `<div class="track-row${index === 0 ? ' next-up' : ''}" data-track="${escapeHTML(id)}" role="button" tabindex="0" aria-label="Воспроизвести ${escapeHTML(track.title)}">
        <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
        <div class="track-cell"><img src="${escapeHTML(track.cover)}" alt=""/><div><b>${escapeHTML(track.title)}</b><small>${escapeHTML(track.artist)}</small></div></div>
        <span class="track-reason-cell"><span class="reason-dot ${escapeHTML(track.color)}"></span> ${escapeHTML(track.reason)}</span>
        <span class="track-duration">${formatTime(track.duration)}</span>
        <button class="row-more" aria-label="Действия с треком" data-action="track-more" data-track-id="${escapeHTML(id)}">···</button>
      </div>`;
    }).join('');
  }

  function getRecommendedQueue() {
    let candidates = catalog.filter((track) => track.id !== state.currentId && !state.excludedArtists.some((artist) => track.artist.toLowerCase().includes(artist.toLowerCase())));
    const discoveryWeight = state.discovery / 100;
    const familiarityWeight = 1 - discoveryWeight;
    candidates = candidates.map((track) => {
      let score = track.familiarity * familiarityWeight + (1 - track.familiarity) * discoveryWeight;
      if (state.preset === 'calm') score += (1 - track.energy) * 0.25;
      if (state.preset === 'energy') score += track.energy * 0.25;
      if (state.liked[track.id]) score += 0.15;
      if (state.disliked[track.id]) score -= 0.6;
      if (state.lessLikedStyles.includes(track.style)) score -= 0.28;
      return { track, score };
    }).filter((item) => !state.disliked[item.track.id] || item.score > 0.4);
    candidates.sort((a, b) => b.score - a.score);
    if (state.shuffle) candidates = candidates.sort(() => Math.random() - 0.5);
    else if (state.preset === 'discovery') candidates.sort((a, b) => a.track.familiarity - b.track.familiarity);
    else if (state.preset === 'familiar') candidates.sort((a, b) => b.track.familiarity - a.track.familiarity);
    else if (state.preset === 'calm') candidates.sort((a, b) => a.track.energy - b.track.energy);
    else if (state.preset === 'energy') candidates.sort((a, b) => b.track.energy - a.track.energy);
    return candidates.map((item) => item.track.id);
  }

  function refreshWave(quiet = false) {
    const currentQueue = state.queue.slice();
    const recommended = getRecommendedQueue();
    state.queue = recommended.filter((id) => !currentQueue.includes(id)).concat(currentQueue.filter((id) => recommended.includes(id))).slice(0, 6);
    if (state.queue.length < 3) state.queue = recommended.slice(0, 6);
    state.lastUpdated = Date.now();
    persist();
    renderQueue();
    const label = $('.updated-label');
    if (label) label.innerHTML = '<span class="tiny-green-dot"></span> Обновлено только что';
    if (!quiet) showToast('Волна обновлена — текущий трек сохранён');
  }

  function startPlaybackClock() {
    window.clearInterval(playbackTimer);
    playbackTimer = window.setInterval(() => {
      if (!state.playing) return;
      state.currentTime += 1;
      if (state.currentTime >= trackById(state.currentId).duration) {
        advanceTrack();
        return;
      }
      syncProgress();
    }, 1000);
  }

  function togglePlayback() {
    state.playing = !state.playing;
    syncPlaybackButtons();
    if (state.playing) {
      startPlaybackClock();
      showToast('Демо-воспроизведение · звук Spotify подключается отдельно');
    } else {
      window.clearInterval(playbackTimer);
      showToast('Демо-поток приостановлен');
    }
    persist();
  }

  function selectTrack(id, shouldPlay = true) {
    if (!catalog.some((track) => track.id === id)) return;
    if (id !== state.currentId) state.history.push(state.currentId);
    state.queue = state.queue.filter((queueId) => queueId !== id);
    state.currentId = id;
    state.currentTime = 0;
    if (shouldPlay) state.playing = true;
    renderCurrentTrack();
    syncPlaybackButtons();
    if (state.playing) startPlaybackClock();
    persist();
    showToast(`Сейчас: ${trackById(id).title} · демо-режим`);
  }

  function advanceTrack() {
    if (state.repeat === 'one') { state.currentTime = 0; syncProgress(); return; }
    if (!state.queue.length) refreshWave(true);
    if (!state.queue.length) return;
    const nextId = state.queue[0];
    state.queue = state.queue.slice(1);
    state.history.push(state.currentId);
    state.currentId = nextId;
    state.currentTime = 0;
    renderCurrentTrack();
    persist();
  }

  function previousTrack() {
    if (state.currentTime > 3) {
      state.currentTime = 0;
      syncProgress();
      return;
    }
    const previousId = state.history.pop();
    if (!previousId) { state.currentTime = 0; syncProgress(); showToast('Это первый трек в демо-сессии'); return; }
    state.queue.unshift(state.currentId);
    state.currentId = previousId;
    state.currentTime = 0;
    renderCurrentTrack();
    persist();
  }

  function setFeedback(kind) {
    const id = state.currentId;
    if (kind === 'like') {
      const next = !state.liked[id];
      state.liked[id] = next;
      delete state.disliked[id];
      showToast(next ? 'Добавлено в любимые — рекомендации учтут это' : 'Лайк отменён');
    } else {
      const next = !state.disliked[id];
      state.disliked[id] = next;
      delete state.liked[id];
      showToast(next ? 'Понял. Похожие треки будут встречаться реже' : 'Оценка отменена');
      if (next) advanceTrack();
    }
    renderFeedback();
    persist();
  }

  function toggleSaved() {
    const id = state.currentId;
    state.saved[id] = !state.saved[id];
    renderFeedback();
    renderLibrary();
    persist();
    showToast(state.saved[id] ? 'Трек добавлен в демо-медиатеку' : 'Трек удалён из демо-медиатеки');
  }

  function updateTaste() {
    const discovery = Math.max(0, Math.min(100, Number(state.discovery) || 0));
    const familiar = 100 - discovery;
    $('#familiar-value').textContent = `${familiar}%`;
    $('#discovery-value').textContent = `${discovery}%`;
    $('#familiar-meter').style.width = `${familiar}%`;
    $('#discovery-meter').style.width = `${discovery}%`;
  }

  function setPreset(preset) {
    const presets = {
      balanced: { 