// app.js

/* ========= تكوين عام ========= */
const PROXY_BASE = 'https://hls-proxy.it-f2c.workers.dev';
const STREAMS = [
  { id: 'main',  title: 'Main',  path: '/hls/live/playlist.m3u8'  },
   { id: 'Cam1',  title: 'Cam 1', path: '/hls/lastone/playlist.m3u8' },
  { id: 'Cam2', title: 'Cam 2', path: '/hls/live2/playlist.m3u8' },
  { id: 'Cam3', title: 'Cam 3', path: '/hls/live3/playlist.m3u8' },
  { id: 'Cam4', title: 'Cam 4', path: '/hls/live4/playlist.m3u8' },
  { id: 'Cam5', title: 'Cam 5', path: '/hls/live5/playlist.m3u8' },
  { id: 'Cam6', title: 'Cam 6', path: '/hls/live6/playlist.m3u8' },
  { id: 'Cam7', title: 'Cam 7', path: '/hls/live7/playlist.m3u8' },
];

const ROOMS = Array.from({ length: 10 }, (_, i) => `room-${i+1}`);

let currentRoom = ROOMS[0];
let hlsPlayers = []; // { id, video, destroy }

/* ========= DOM ========= */
const topbar = document.getElementById('topbar');
const roomsMenu = document.getElementById('roomsMenu');
const statusBadge = document.getElementById('statusBadge');
const grid = document.getElementById('videoGrid');
const btnPermission = document.getElementById('btn-permission');
const btnPublish = document.getElementById('btn-publish');
const btnStop = document.getElementById('btn-stop');
const btnReloadHls = document.getElementById('btn-reload-hls');
const proxyBaseEl = document.getElementById('proxyBase');

/* ========= واجهة الغرف (قائمة منسدلة تظهر عند تحريك الماوس) ========= */
(function setupHoverReveal() {
  let timer;
  function onMove() {
    topbar.classList.add('mouse-active');
    clearTimeout(timer);
    timer = setTimeout(() => topbar.classList.remove('mouse-active'), 1800);
  }
  window.addEventListener('mousemove', onMove, { passive: true });
})();

function renderRooms() {
  roomsMenu.innerHTML = '';
  ROOMS.forEach(room => {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = room + (room === currentRoom ? ' (الحالية)' : '');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      currentRoom = room;
      renderRooms();
      status(`تم اختيار ${room}`);
    });
    roomsMenu.appendChild(a);
  });
}
renderRooms();

/* ========= شبكة الفيديو & HLS ========= */
function renderGrid() {
  grid.innerHTML = '';
  hlsPlayers.forEach(p => p.destroy?.());
  hlsPlayers = [];

  STREAMS.forEach(stream => {
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('header');
    const h4 = document.createElement('div');
    h4.textContent = stream.title;
    const span = document.createElement('span');
    span.className = 'hint';
    span.textContent = stream.path;
    header.appendChild(h4); header.appendChild(span);
    const video = document.createElement('video');
    video.playsInline = true; video.controls = true; video.muted = true; // mute لتسهيل التشغيل التلقائي

    card.appendChild(header); card.appendChild(video);
    grid.appendChild(card);

    const url = PROXY_BASE + stream.path;
    const destroy = window.attachHlsTo(video, url);
    hlsPlayers.push({ id: stream.id, video, destroy });
  });

  proxyBaseEl.textContent = PROXY_BASE;
}
renderGrid();

btnReloadHls.addEventListener('click', () => {
  renderGrid();
  status('أُعيد تهيئة HLS');
});

/* ========= ستيتس ========= */
function status(msg) {
  statusBadge.textContent = msg;
}

/* ========= سماح & نشر (LiveKit) ========= */
btnPermission.addEventListener('click', async () => {
  try {
    await window.LK.requestPermissions();
    status('تم منح الإذن');
  } catch (e) {
    console.error(e);
    status('تعذّر منح الإذن — راجع إعدادات المتصفح');
  }
});

btnPublish.addEventListener('click', async () => {
  try {
    await window.LK.publishToRoom(currentRoom);
    status(`تم النشر في ${currentRoom}`);
  } catch (e) {
    console.error(e);
    status('تعذّر النشر — تحقّق من صلاحيات الكاميرا/المايك والتوكن');
  }
});

btnStop.addEventListener('click', async () => {
  try {
    await window.LK.stopPublishing();
    status('تم الإيقاف');
  } catch (e) {
    console.error(e);
    status('لا يوجد نشر نشط');
  }
});
