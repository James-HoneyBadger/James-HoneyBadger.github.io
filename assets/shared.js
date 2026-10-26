// Helpers shared by the pinned-highlights page and the repository directory.

export class HttpError extends Error {
  constructor(message, { status = 0, remaining = null, reset = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.remaining = remaining;
    this.resetAt = reset ? new Date(Number(reset) * 1000) : null;
  }
}

export async function fetchJson(url, { timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status}`, {
        status: response.status,
        remaining: response.headers.get('x-ratelimit-remaining'),
        reset: response.headers.get('x-ratelimit-reset'),
      });
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function describeError(error) {
  if (error?.name === 'AbortError') {
    return 'The request timed out before the data arrived.';
  }

  if (error instanceof HttpError) {
    if (error.status === 403 && error.remaining === '0') {
      return error.resetAt
        ? `GitHub's API rate limit for this network is exhausted. It resets at ${error.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : "GitHub's API rate limit for this network is exhausted.";
    }

    return `The data source responded with HTTP ${error.status}.`;
  }

  return 'The data source could not be reached.';
}

export function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: caching is best-effort only.
  }
}

export function clearCache(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function escapeHtml(str) {
  return String(str ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? escapeHtml(url.href) : '#';
  } catch {
    return '#';
  }
}

// Dates are pinned to UTC so every visitor sees the same day as GitHub.
const absoluteDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const relativeDate = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const RELATIVE_STEPS = [
  ['year', 31_536e6],
  ['month', 2_592e6],
  ['week', 604_800e3],
  ['day', 86_400e3],
  ['hour', 3_600e3],
  ['minute', 60_000],
];

export function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : absoluteDate.format(date);
}

export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown date';

  const delta = date.getTime() - Date.now();
  for (const [unit, ms] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= ms) return relativeDate.format(Math.round(delta / ms), unit);
  }

  return 'just now';
}

/** Machine-readable <time> with the human value inside and the exact date in the tooltip. */
export function timeElement(iso, text = relativeTime(iso)) {
  if (!iso) return '—';
  return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(formatDate(iso))}">${escapeHtml(text)}</time>`;
}

export function debounce(fn, wait = 150) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function statPills({ stars, forks }) {
  // The visually-hidden labels sit inside .pill without becoming flex items, so
  // the visible "⭐ 24" text keeps its original spacing.
  return `<span class="pill"><span class="sr-only">Stars: </span>⭐ ${stars ?? 0}</span><span class="pill"><span class="sr-only">Forks: </span>🍴 ${forks ?? 0}</span>`;
}

export function languageBadge(language) {
  return language ? `<span class="badge">${escapeHtml(language)}</span>` : '';
}

export function archivedBadge(archived) {
  return archived ? '<span class="badge badge-archived">Archived</span>' : '';
}

export function topicChips(topics, limit = 4) {
  if (!Array.isArray(topics) || topics.length === 0) return '';

  const shown = topics
    .slice(0, limit)
    .map((topic) => `<span class="chip">${escapeHtml(topic)}</span>`)
    .join('');
  const rest = topics.length > limit ? `<span class="chip">+${topics.length - limit}</span>` : '';

  return `<div class="topics">${shown}${rest}</div>`;
}

export function skeletonCards(count = 6) {
  return Array.from(
    { length: count },
    () => `<article class="card skeleton" aria-hidden="true">
        <div class="skeleton-line skeleton-line-short"></div>
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-line-short"></div>
      </article>`,
  ).join('');
}
