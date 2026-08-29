document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Hero carousel — 8 full-bleed slides with real HD photography (Unsplash,
// free license), Hordstake-style: full-width image, bottom-left text
// block, prev/next + dots, autoplay every 5s.
// -----------------------------------------------------------------------
function unsplash(id, w) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w || 1800}&q=80`;
}

const SLIDES = [
  { eyebrow: 'AI LIVE STUDIO', title: 'Transform your look, live.', text: 'Real-time AI face transformation streamed straight from your browser.', img: unsplash('photo-1637065463674-4595b7f32adc') },
  { eyebrow: 'CREATOR TOOLS', title: 'Choose from curated AI looks.', text: 'Cyberpunk, sculpture, anime, android — or upload your own reference face.', img: unsplash('photo-1567596296091-0a257a028e72') },
  { eyebrow: 'HD STREAMING', title: 'Broadcast in crisp HD.', text: 'Configurable quality and resolution, tuned for smooth, natural motion.', img: unsplash('photo-1755997268256-31b838ebd238') },
  { eyebrow: 'OBS READY', title: 'Pipe straight into OBS.', text: 'Add your transformed feed as a Browser Source and go out to any platform.', img: unsplash('photo-1623281295661-1c8fcc5140dd') },
  { eyebrow: 'CONTENT CREATION', title: 'Built for creators and educators.', text: 'Present lessons or content with a consistent, professional on-camera presence.', img: unsplash('photo-1633410465502-6eaa81fdf5eb') },
  { eyebrow: 'PRO SETUP', title: 'Studio-grade, from your desk.', text: 'No green screen, no render farm — just your webcam and Creoveya.', img: unsplash('photo-1760278042167-2e42c883e087') },
  { eyebrow: 'FLEXIBLE PLANS', title: 'Pay only for what you stream.', text: 'Simple credit plans by bank transfer or crypto — no subscriptions required.', img: unsplash('photo-1676208974216-59348ecd9e15') },
  { eyebrow: 'GO LIVE NOW', title: 'Your AI studio is one click away.', text: 'Create an account, choose a plan, and you could be live in minutes.', img: unsplash('photo-1636294155447-b1a63a5cb084') },
];

let slideIndex = 0;
let carouselTimer = null;

function renderCarousel() {
  const track = document.getElementById('carouselTrack');
  const dots = document.getElementById('carouselDots');
  track.innerHTML = SLIDES.map((s, i) => `
    <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-index="${i}" style="background-image:url('${s.img}')">
      <div class="carousel-slide-content">
        <div class="carousel-slide-eyebrow">${s.eyebrow}</div>
        <h2>${s.title}</h2>
        <p>${s.text}</p>
        <a href="/register.html" class="btn btn-primary">Get Started</a>
      </div>
    </div>
  `).join('');
  dots.innerHTML = SLIDES.map((_, i) => `<button data-index="${i}" class="${i === 0 ? 'active' : ''}"></button>`).join('');

  dots.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => goToSlide(parseInt(btn.dataset.index, 10)));
  });
}

function goToSlide(index) {
  slideIndex = (index + SLIDES.length) % SLIDES.length;
  document.querySelectorAll('.carousel-slide').forEach((el, i) => el.classList.toggle('active', i === slideIndex));
  document.querySelectorAll('.carousel-dots button').forEach((el, i) => el.classList.toggle('active', i === slideIndex));
  resetAutoplay();
}

function resetAutoplay() {
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => goToSlide(slideIndex + 1), 5000);
}

renderCarousel();
resetAutoplay();
document.getElementById('carouselPrev').addEventListener('click', () => goToSlide(slideIndex - 1));
document.getElementById('carouselNext').addEventListener('click', () => goToSlide(slideIndex + 1));

// -----------------------------------------------------------------------
// Global live-activity toast — fixed to the bottom-left of the viewport
// (independent of the carousel), cycling through 40 activity lines.
// -----------------------------------------------------------------------
const CITIES = ['Lagos', 'Manila', 'London', 'Austin', 'Nairobi', 'Toronto', 'Berlin', 'Jakarta', 'Cairo', 'Mumbai', 'São Paulo', 'Accra', 'Dubai', 'Karachi', 'Seoul', 'Nairobi', 'Bristol', 'Ontario', 'Kigali', 'Warsaw'];
const ACTIONS = [
  'started an AI live session', 'switched to the Cyberpunk look', 'went live in 1080p',
  'connected OBS via Browser Source', 'started a teaching session', 'topped up their credits',
  'created a new account', 'uploaded a custom reference face', 'approved a bank transfer payment',
  'went live on the Creator plan', 'shared their stream link', 'joined Creoveya',
  'switched to the Android look', 'hit 20 minutes of live streaming', 'connected a second camera',
  'started streaming from mobile', 'reached 100 viewers', 'upgraded from Starter to Creator',
  'enabled enhance mode', 'saved a new custom look',
];
function buildActivityMessages(count) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    const city = CITIES[i % CITIES.length];
    const action = ACTIONS[(i * 7 + 3) % ACTIONS.length];
    messages.push(`Someone in ${city} just ${action}`);
  }
  return messages;
}
const ACTIVITY_MESSAGES = buildActivityMessages(40);

function initLiveActivityToast() {
  let idx = 0;
  let dismissed = false;
  let toastEl = null;

  function showNext() {
    if (dismissed) return;
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div');
    toastEl.className = 'live-activity-toast';
    toastEl.innerHTML = `
      <span class="dot"></span>
      <div><strong>Live Activity</strong><span>${ACTIVITY_MESSAGES[idx % ACTIVITY_MESSAGES.length]}</span></div>
      <button class="close-x" aria-label="Dismiss">×</button>
    `;
    document.body.appendChild(toastEl);
    toastEl.querySelector('.close-x').addEventListener('click', () => {
      dismissed = true;
      toastEl.remove();
    });
    idx += 1;
  }

  showNext();
  setInterval(showNext, 4500);
}
initLiveActivityToast();

// -----------------------------------------------------------------------
// Dynamic plans (removes any dummy/hardcoded pricing — always pulled live
// from the admin-managed database).
// -----------------------------------------------------------------------
async function loadPlans() {
  try {
    const data = await apiFetch('/api/payments/plans');
    const grid = document.getElementById('plansGrid');
    if (!data.plans.length) {
      grid.innerHTML = '<p class="text-muted text-center">No plans are available right now — check back soon.</p>';
      return;
    }
    grid.innerHTML = data.plans.map((p) => `
      <div class="card">
        <h3>${p.name}</h3>
        <div style="font-size:2rem; font-weight:800; color:var(--blue-900); margin-bottom:6px;">$${p.price}</div>
        <p>${p.credits.toLocaleString()} credits · ≈ ${p.minutes} minutes of live streaming</p>
        ${p.description ? `<p class="text-muted">${p.description}</p>` : ''}
        <a href="/register.html" class="btn btn-outline btn-block">Choose ${p.name}</a>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('plansGrid').innerHTML = '<p class="text-muted text-center">Could not load plans right now.</p>';
  }
}
loadPlans();

// -----------------------------------------------------------------------
// Telegram support link (admin-configurable, not hardcoded)
// -----------------------------------------------------------------------
apiFetch('/api/pages/telegram-link').then((data) => {
  const link = document.getElementById('telegramLink');
  if (data.url) link.href = data.url;
}).catch(() => {});

// -----------------------------------------------------------------------
// Contact form
// -----------------------------------------------------------------------
document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('contactError');
  const successEl = document.getElementById('contactSuccess');
  errorEl.classList.remove('show');
  successEl.classList.remove('show');

  try {
    await apiFetch('/api/pages/contact', {
      method: 'POST',
      body: {
        name: document.getElementById('contactName').value,
        message: document.getElementById('contactMessage').value,
      },
    });
    successEl.textContent = 'Thanks — your message has been sent. We\'ll get back to you soon.';
    successEl.classList.add('show');
    e.target.reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('show');
  }
});

// Mobile nav toggle (uses inline style so it works regardless of the
// desktop/mobile media-query default for .nav-links)
document.getElementById('navToggle')?.addEventListener('click', () => {
  const nav = document.querySelector('.nav-links');
  const isOpen = nav.style.display === 'flex';
  nav.style.display = isOpen ? 'none' : 'flex';
  nav.style.cssText += isOpen ? '' : 'flex-direction:column; position:absolute; top:64px; left:0; right:0; background:#fff; padding:16px 24px; border-bottom:1px solid var(--border); gap:14px; z-index: 90;';
});
