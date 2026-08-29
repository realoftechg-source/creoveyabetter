// Renders the user-area sidebar + profile menu identically across
// dashboard.html and studio.html, and wires up mobile toggle + logout.

const NAV_ITEMS = [
  { href: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { href: '/studio', icon: '🎬', label: 'Studio' },
  { href: '/dashboard#credits', icon: '💳', label: 'Credits & Billing' },
  { href: '/dashboard#history', icon: '🧾', label: 'Payment History' },
];

async function renderUserChrome() {
  const user = await getSession();
  if (!user) { window.location.href = '/login.html'; return null; }
  if (!user.isAdmin && !user.hasActiveAccess) { window.location.href = '/payment'; return null; }

  const path = window.location.pathname;
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="/"><img src="/img/logo.svg" class="brand-mark" alt="Creoveya">Creoveya</a>
    ${NAV_ITEMS.map((item) => `
      <a class="sidebar-link ${path.startsWith(item.href.split('#')[0]) ? 'active' : ''}" href="${item.href}">
        <span class="icon">${item.icon}</span>${item.label}
      </a>`).join('')}
    <div class="sidebar-divider"></div>
    <a class="sidebar-link" href="/pages/help.html"><span class="icon">❓</span>Help &amp; Tutorial</a>
  `;

  document.getElementById('topbarRight').innerHTML = `
    <div class="profile-menu-wrap">
      <button class="profile-btn" id="profileBtn">
        <span class="profile-avatar" id="profileInitial"></span>
        <span id="profileName" class="text-muted" style="font-size:.9rem;"></span>
      </button>
      <div class="profile-dropdown" id="profileDropdown">
        <a href="/dashboard#credits">💳 Credits: <strong id="creditsQuick"></strong></a>
        <a href="/dashboard">👤 My Account</a>
        <button id="logoutBtn">🚪 Log Out</button>
      </div>
    </div>
  `;
  document.getElementById('creditsQuick').textContent = user.creditsBalance.toLocaleString();

  initProfileMenu(user);

  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  return user;
}
