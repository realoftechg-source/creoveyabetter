// Common utilities used across all frontend pages

/**
 * Make an API fetch request with automatic JSON serialization
 * @param {string} url - API endpoint
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise} JSON response from the API
 */
async function apiFetch(url, options = {}) {
  const fetchOptions = {
    method: options.method || 'GET',
    credentials: 'include',
  };

  if (options.body instanceof FormData) {
    fetchOptions.body = options.body;
  } else {
    fetchOptions.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (options.body !== undefined && options.body !== null) {
      fetchOptions.body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }

  return data;
}

/**
 * Get the current user's session/profile
 * @returns {Promise} User object or null if not logged in
 */
async function getSession() {
  try {
    const data = await apiFetch('/api/me');
    return data.user;
  } catch (err) {
    return null;
  }
}

// Utility to format seconds into a readable time format
function formatMinutes(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Handle logout button clicks
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await apiFetch('/auth/logout', { method: 'POST' });
        window.location.href = '/';
      } catch (err) {
        console.error('Logout failed:', err);
      }
    });
  }
});
