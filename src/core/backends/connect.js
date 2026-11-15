// Режим «пульт»: управляем любым устройством Spotify Connect (приложение на ПК, телефон, колонка) через Web API.
// Состояние узнаём опросом GET /me/player: официального push-канала у Web API нет. Опрос адаптивный и бережёт квоту.
import { normTrack } from '../../spotify/api.js';

export function createConnectBackend({ api, now = () => Date.now(), schedule = setTimeout, clear = clearTimeout, isHidden = () => (typeof document !== 'undefined' && document.hidden) } = {}) {
  let deviceId = null;
  let onState = () => {};
  let timer = null;
  let running = false;
  let fails = 0;
  let last = null;

  const interval = () => {
    if (fails) return Math.min(30_000, 3000 * 2 ** fails);
    if (!last) return isHidden() ? 15_000 : 4000;
    if (last.paused) return isHidden() ? 20_000 : 5000;
    const remain = last.durationMs - last.positionMs;
    // вкладка в фоне: браузер и так притормаживает таймеры, а квота режима разработки небольшая
    if (isHidden()) return remain < 12_000 ? 2000 : 10_000;
    return remain < 7000 ? 800 : 2500; // у конца трека опрашиваем чаще, чтобы вовремя заметить смену
  };

  async function poll() {
    try {
      const raw = await api.playerState();
      fails = 0;
      if (!raw || !raw.item || raw.currently_playing_type === 'ad') { last = null; onState(null, { ad: raw?.currently_playing_type === 'ad' }); return; }
      const track = normTrack(raw.item);
      if (!track) { last = null; onState(null, { local: true }); return; }
      // следуем за активным устройством; если пользователь переключил его в приложении Spotify — подхватываем
      if (raw.device?.id) deviceId = raw.device.id;
      last = { track, positionMs: raw.progress_ms ?? 0, durationMs: track.durationMs, paused: !raw.is_playing, at: now(), deviceName: raw.device?.name ?? null };
      onState(last);
    } catch (e) {
      fails = Math.min(fails + 1, 4);
      onState(undefined, { error: e });
    }
  }

  function loop() {
    if (!running) return;
    timer = schedule(async () => { await poll(); loop(); }, interval());
  }

  return {
    kind: 'connect',
    get deviceId() { return deviceId; },
    setDevice(id) { deviceId = id; },
    async start(cb) { onState = cb; running = true; await poll(); loop(); return deviceId; },
    stop() { running = false; if (timer) clear(timer); timer = null; },
    poll,
    kick() { if (running) { if (timer) clear(timer); poll().then(loop); } },
    play: (uris, positionMs) => api.play({ deviceId, uris, positionMs }),
    queueAdd: (uri) => api.queueAdd(uri, deviceId),
    pause: () => api.pause(deviceId),
    resume: () => api.resume(deviceId),
    seek: (ms) => api.seek(ms, deviceId),
    next: () => api.next(deviceId),
    volume: (pct) => api.volume(pct, deviceId),
  };
}
