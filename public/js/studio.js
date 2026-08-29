let currentUser = null;
let localStream = null;
let realtimeSession = null;
let heartbeatTimer = null;
let clockTimer = null;
let secondsRemaining = 0;
let secondsElapsedThisSession = 0;
let selectedLook = null; // { id, name, prompt } or null = "My Camera" (live prompt box only)
let mirrored = false;

const cameraWrap = document.getElementById('cameraWrap');
const localPreview = document.getElementById('localPreview');
const transformedFeed = document.getElementById('transformedFeed');
const placeholder = document.getElementById('cameraPlaceholder');
const liveBadge = document.getElementById('liveBadge');
const timerBadge = document.getElementById('timerBadge');
const goLiveBtn = document.getElementById('goLiveBtn');
const usageBanner = document.getElementById('usageBanner');
const cameraControls = document.getElementById('cameraControls');

async function init() {
  currentUser = await renderUserChrome();
  if (!currentUser) return;
  secondsRemaining = currentUser.secondsBalance;
  updateUsageBanner();
  await loadLooks();
  bindControls();
}

function updateUsageBanner() {
  if (secondsRemaining <= 0) {
    usageBanner.textContent = "You're out of streaming time. Purchase another credit plan to keep going live.";
    usageBanner.classList.add('show');
    goLiveBtn.disabled = true;
  } else if (secondsRemaining < 60) {
    usageBanner.textContent = `Heads up — you have less than a minute of streaming time left (${secondsRemaining}s).`;
    usageBanner.classList.add('show');
  } else {
    usageBanner.classList.remove('show');
    goLiveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Camera preview (local, pre-stream)
// ---------------------------------------------------------------------
document.getElementById('previewBtn').addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localPreview.srcObject = localStream;
    localPreview.style.display = 'block';
    placeholder.style.display = 'none';
    cameraControls.classList.remove('hidden');
  } catch (err) {
    alert('Could not access your camera/microphone. Please check permissions.');
  }
});

function bindControls() {
  document.getElementById('mirrorBtn').addEventListener('click', () => {
    mirrored = !mirrored;
    cameraWrap.classList.toggle('mirrored', mirrored);
  });

  document.getElementById('micBtn').addEventListener('click', (e) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    e.target.style.opacity = track.enabled ? '1' : '.4';
  });

  // Fullscreen toggle — matches the icon/behavior used on the public
  // watch page for consistency.
  const fsBtn = document.getElementById('fullscreenBtn');
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) cameraWrap.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement === cameraWrap ? '⤡' : '⤢';
  });

  document.getElementById('promptInput').addEventListener('input', () => {
    if (realtimeSession) updatePipelineParameters();
  });

  goLiveBtn.addEventListener('click', () => {
    if (realtimeSession) stopLiveStream('user_stopped');
    else goLive();
  });

  document.getElementById('addLookBtn').addEventListener('click', () => {
    document.getElementById('lookModalBackdrop').classList.add('open');
  });
  document.getElementById('lookModalClose').addEventListener('click', () => {
    document.getElementById('lookModalBackdrop').classList.remove('open');
  });
  document.getElementById('lookForm').addEventListener('submit', submitLook);
}

// ---------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------
async function loadLooks() {
  const data = await apiFetch('/api/studio/looks');
  const grid = document.getElementById('lookGrid');
  const cards = [{ id: null, name: 'My Camera', builtin: true }, ...data.looks];
  grid.innerHTML = cards.map((look) => `
    <div class="look-card ${selectedLook?.id === look.id ? 'active' : ''}" data-look="${look.id ?? ''}">
      <div class="look-avatar">${look.builtin ? '📷' : `<img src="/api/studio/looks/${look.id}/image" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`}</div>
      <span>${look.name}</span>
    </div>
  `).join('');
  grid.querySelectorAll('[data-look]').forEach((el) => {
    el.addEventListener('click', () => selectLook(el.dataset.look || null));
  });
}

async function selectLook(lookId) {
  if (!lookId) {
    selectedLook = null;
    document.querySelectorAll('[data-look]').forEach((el) => el.classList.toggle('active', el.dataset.look === ''));
    if (realtimeSession) updatePipelineParameters();
    return;
  }
  try {
    const data = await apiFetch(`/api/studio/looks/${lookId}/select`, { method: 'POST' });
    selectedLook = data.look;
    document.querySelectorAll('[data-look]').forEach((el) => el.classList.toggle('active', el.dataset.look === String(lookId)));
    if (realtimeSession) updatePipelineParameters();
  } catch (err) {
    if (err.data?.code === 'no_balance') showOutOfBalance();
    else alert(err.message);
  }
}

async function submitLook(e) {
  e.preventDefault();
  const errEl = document.getElementById('lookError');
  errEl.classList.remove('show');
  const fd = new FormData();
  fd.append('name', document.getElementById('lookName').value);
  fd.append('prompt', document.getElementById('lookPrompt').value);
  fd.append('image', document.getElementById('lookImage').files[0]);
  try {
    await apiFetch('/api/studio/looks', { method: 'POST', body: fd });
    document.getElementById('lookModalBackdrop').classList.remove('open');
    document.getElementById('lookForm').reset();
    await loadLooks();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  }
}

// ---------------------------------------------------------------------
// Decart realtime connection — ported directly from the working
// Node.js prototype (public/app.js in creoveya_3.zip). The token
// exchange, model selection, getUserMedia constraints, and
// client.realtime.connect/set/disconnect calls are unchanged; what's
// new here is the server-enforced start/heartbeat/stop wrapping it.
// ---------------------------------------------------------------------
async function goLive() {
  if (secondsRemaining <= 0) return showOutOfBalance();

  goLiveBtn.textContent = 'Connecting...';
  goLiveBtn.disabled = true;

  try {
    // 1. Ask our backend for permission to start — this is the
    //    server-side usage gate; it fails with 402 if out of balance.
    await apiFetch('/api/studio/stream/start', { method: 'POST' });

    // 2. Load the Decart SDK and get a short-lived client token from
    //    our server (the permanent API key never reaches the browser).
    const { createDecartClient, models } = await import('https://cdn.jsdelivr.net/npm/@decartai/sdk@0.1.14/+esm');
    const tokenRes = await apiFetch('/api/studio/realtime-token', { method: 'POST' });

    const model = models.realtime('lucy-2.1');

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { frameRate: model.fps, width: model.width, height: model.height },
        audio: false,
      });
    }

    const client = createDecartClient({ apiKey: tokenRes.apiKey });
    realtimeSession = await client.realtime.connect(localStream, {
      model,
      mirror: 'auto',
      onRemoteStream: (stream) => {
        placeholder.style.display = 'none';
        localPreview.style.display = 'none';
        transformedFeed.srcObject = stream;
        transformedFeed.style.display = 'block';
        liveBadge.textContent = 'LIVE';
        liveBadge.style.background = 'var(--danger)';
        goLiveBtn.textContent = '🛑 End Stream';
        goLiveBtn.disabled = false;
      },
    });

    await updatePipelineParameters();
    startHeartbeat();
    startClock();
  } catch (err) {
    console.error('Decart connection failed:', err);
    alert('Could not start the stream. Please check your camera permissions and try again.');
    await stopLiveStream('error').catch(() => {});
  }
}

async function updatePipelineParameters() {
  if (!realtimeSession) return;
  const promptValue = document.getElementById('promptInput').value.trim() || selectedLook?.prompt || 'Apply a natural, high-fidelity AI transformation.';
  try {
    await realtimeSession.set({ prompt: promptValue, enhance: true });
  } catch (e) {
    console.warn('Pipeline parameter sync warning:', e);
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    try {
      const data = await apiFetch('/api/studio/stream/heartbeat', { method: 'POST' });
      secondsRemaining = data.secondsRemaining;
      updateUsageBanner();
      if (data.exhausted) {
        alert("You've used up your available streaming time. Ending the stream — purchase another plan to continue.");
        await stopLiveStream('exhausted', /*skipServerStop*/ true);
      }
    } catch (err) {
      // If the heartbeat call itself fails (e.g. session expired), stop
      // the stream client-side rather than leaving it silently running.
      console.error('Heartbeat failed:', err);
      await stopLiveStream('heartbeat_error', true).catch(() => {});
    }
  }, 10000);
}

function startClock() {
  secondsElapsedThisSession = 0;
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    secondsElapsedThisSession += 1;
    const m = String(Math.floor(secondsElapsedThisSession / 60)).padStart(2, '0');
    const s = String(secondsElapsedThisSession % 60).padStart(2, '0');
    timerBadge.textContent = `${m}:${s}`;
  }, 1000);
}

async function stopLiveStream(reason, skipServerStop) {
  clearInterval(heartbeatTimer);
  clearInterval(clockTimer);

  if (realtimeSession) {
    try { realtimeSession.disconnect(); } catch (e) {}
    realtimeSession = null;
  }
  if (!skipServerStop) {
    try {
      const data = await apiFetch('/api/studio/stream/stop', { method: 'POST' });
      secondsRemaining = data.secondsRemaining;
    } catch (e) { /* already ended server-side */ }
  }

  transformedFeed.srcObject = null;
  transformedFeed.style.display = 'none';
  if (localStream) { localPreview.style.display = 'block'; } else { placeholder.style.display = 'flex'; }
  liveBadge.textContent = 'IDLE';
  liveBadge.style.background = '';
  goLiveBtn.textContent = '🔴 Go Live';
  goLiveBtn.disabled = false;
  updateUsageBanner();
}

function showOutOfBalance() {
  usageBanner.textContent = "You're out of streaming time. Purchase another credit plan to keep going live.";
  usageBanner.classList.add('show');
  usageBanner.scrollIntoView({ behavior: 'smooth' });
}

init();
