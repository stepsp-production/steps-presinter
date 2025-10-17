publishBtn.addEventListener('click', async () => {
  if(!sdkReady()) return alert('LiveKit SDK غير محمَّل.');
  try {
    publishBtn.disabled = true;
    const roomName = roomSel.value || 'room-1';
    const identity = (displayName.value || '').trim() || ('user-' + Math.random().toString(36).slice(2,8));
    setLKStatus('جلب توكن…');

    const tokenEndpoint = 'https://steps-livekit-api.onrender.com/token';

    // 1) جرّب GET
    let res = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`);
    // 2) لو فشل GET (404/500) جرّب POST
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      console.warn('GET /token failed:', res.status, text);
      res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ room: roomName, identity })
      });
      if (!res.ok) {
        const text2 = await res.text().catch(()=> '');
        console.error('POST /token failed:', res.status, text2);
        publishBtn.disabled = false;
        alert('فشل طلب التوكن (تحقق من السيرفر/المسار /token ومتغيّرات البيئة).');
        setLKStatus('فشل جلب التوكن');
        return;
      }
    }

    let json;
    try { json = await res.json(); }
    catch(e) {
      const txt = await res.text().catch(()=> '');
      console.error('Token response not JSON:', txt);
      publishBtn.disabled = false;
      alert('استجابة توكن ليست JSON صالحة.');
      setLKStatus('توكن غير صالح');
      return;
    }

    const url   = json.url || json.wsUrl || json.host;
    const token = json.token;
    if(!url || !token){
      console.error('Bad token payload:', json);
      publishBtn.disabled = false;
      alert('استجابة توكن غير صحيحة. يجب أن تكون: { url, token }');
      setLKStatus('توكن غير صالح');
      return;
    }

    setLKStatus('الاتصال بالغرفة…');
    lkRoom = new LK.Room({ adaptiveStream: true, dynacast: true });
    lkRoom.on(LK.RoomEvent.Disconnected, () => setLKStatus('LiveKit: غير متصل'));
    await lkRoom.connect(url, token);

    setLKStatus('نشر المسارات…');
    for (const tr of localTracks) {
      await lkRoom.localParticipant.publishTrack(tr);
    }
    setLKStatus(`LiveKit: متصل (${roomName})`);
  } catch (err) {
    console.error('Publish error:', err);
    alert('تعذر النشر — تحقق من صلاحيات المتصفح، الشبكة، وصحة التوكن.');
    setLKStatus('فشل النشر');
    publishBtn.disabled = false;
  }
});
