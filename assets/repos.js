import {
  archivedBadge,
  clearCache,
  debounce,
  describeError,
  escapeHtml,
  fetchJson,
  languageBadge,
  readCache,
  relativeTime,
  safeUrl,
  skeletonCards,
  statPills,
  timeElement,
  topicChips,
  writeCache,
} from './shared.js';

const OWNER = 'James-HoneyBadger';
const SNAPSHOT_URL = 'data/repos.json';
const API_BASE = 'https://api.github.com';
const CACHE_KEY = 'repos-directory-v1';
const CACHE_FRESH_MS = 30 * 60 * 1000;
const MAX_API_PAGES = 5;

const els = {
  grid: document.getElementById('repo-grid'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty'),
  stamp: document.getElementById('stamp'),
  refresh: document.getElementById('refresh'),
  clear: document.getElementById('clear-filters'),
  search: document.getElementById('search'),
  language: document.getElementById('language'),
  sort: document.getElementById('sort'),
};

const SORTERS = {
  updated: (a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0),
  created: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  stars: (a, b) => (b.stars || 0) - (a.stars || 0),
  forks: (a, b) => (b.forks || 0) - (a.forks || 0),
  name: (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
};

const state = { repos: [], generatedAt: null, loadedAt: 0, source: '' };

/** Accepts both the snapshot shape (data/repos.json) and raw REST objects. */
function normalize(repo) {
  return {
    name: String(repo.name || ''),
    url: repo.url || repo.html_url || '',
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stars ?? repo.stargazers_count ?? 0,
    forks: repo.forks ?? repo.forks_count ?? 0,
    pushedAt: repo.pushedAt || repo.pushed_at || null,
    createdAt: repo.createdAt || repo.created_at || null,
    archived: Boolean(repo.archived),
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    license: typeof repo.license === 'string' ? repo.license : repo.license?.spdx_id || '',
    homepage: repo.homepage || '',
  };
}

function ownedOnly(repos) {
  return repos
    .filter((repo) => (repo.owner?.login || OWNER).toLowerCase() === OWNER.toLowerCase())
    .filter((repo) => !repo.fork)
    .map(normalize);
}

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const sort = params.get('sort');
  return {
    q: params.get('q') || '',
    lang: params.get('lang') || '',
    sort: sort && SORTERS[sort] ? sort : 'updated',
  };
}

function syncUrl({ term, language, sort }) {
  const params = new URLSearchParams();
  if (term) params.set('q', term);
  if (language) params.set('lang', language);
  if (sort && sort !== 'updated') params.set('sort', sort);

  const query = params.toString();
  history.replaceState(null, '', query ? `${location.pathname}?${query}` : location.pathname);
}

function currentFilters() {
  return {
    term: els.search.value.trim().toLowerCase(),
    language: els.language.value,
    sort: els.sort.value,
  };
}

function matches(repo, term) {
  if (!term) return true;
  return [repo.name, repo.description, repo.language, ...repo.topics]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(term));
}

function setLanguages() {
  const languages = [...new Set(state.repos.map((repo) => repo.language).filter(Boolean))].sort();
  const previous = els.language.value || pendingLanguage;
  pendingLanguage = '';
  els.language.length = 1; // keep the "Any language" placeholder
  for (const language of languages) {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = language;
    els.language.appendChild(option);
  }
  els.language.value = languages.includes(previous) ? previous : '';
}

function renderCard(repo) {
  const topics = topicChips(repo.topics);
  const extras = [
    repo.license ? `<span>${escapeHtml(repo.license)}</span>` : '',
    repo.homepage
      ? `<a class="card-link" href="${safeUrl(repo.homepage)}" target="_blank" rel="noreferrer">Docs</a>`
      : '',
  ].join('');

  return `<article class="card">
      <div class="meta">${statPills(repo)}${languageBadge(repo.language)}${archivedBadge(repo.archived)}</div>
      <h3><a href="${safeUrl(repo.url)}" target="_blank" rel="noreferrer">${escapeHtml(repo.name)}</a></h3>
      <p class="desc">${repo.description ? escapeHtml(repo.description) : 'No description provided yet.'}</p>
      ${topics}
      <div class="meta"><span>Last push · ${timeElement(repo.pushedAt)}</span>${extras}</div>
    </article>`;
}

function render() {
  const filters = currentFilters();
  const list = state.repos
    .filter((repo) => matches(repo, filters.term))
    .filter((repo) => !filters.language || repo.language === filters.language)
    .sort(SORTERS[filters.sort] || SORTERS.updated);

  const total = state.repos.length;
  els.grid.setAttribute('aria-busy', 'false');
  els.results.textContent = total
    ? `Showing ${list.length} of ${total} ${total === 1 ? 'repository' : 'repositories'}`
    : '';

  if (!list.length) {
    els.grid.innerHTML = '';
    els.empty.hidden = total === 0;
    syncUrl(filters);
    return;
  }

  els.empty.hidden = true;
  els.grid.innerHTML = list.map(renderCard).join('');
  syncUrl(filters);
}

function paint({ repos, generatedAt, source, loadedAt }) {
  state.repos = repos;
  state.generatedAt = generatedAt;
  state.source = source;
  state.loadedAt = loadedAt || Date.now();

  setLanguages();
  render();
  updateStamp();

  els.status.textContent = '';
  els.status.classList.remove('error');
}

function updateStamp() {
  if (!els.stamp) return;
  const source =
    { snapshot: 'the site snapshot', live: 'the live GitHub API', cache: 'the local cache' }[
      state.source
    ] || 'the site snapshot';
  const when = state.generatedAt ? relativeTime(state.generatedAt) : 'recently';
  els.stamp.textContent = `Data updated ${when} · from ${source}.`;
}

function showSkeletons() {
  els.grid.innerHTML = skeletonCards(6);
  els.grid.setAttribute('aria-busy', 'true');
  els.results.textContent = 'Loading repositories…';
  els.empty.hidden = true;
}

function showError(error) {
  els.grid.setAttribute('aria-busy', 'false');

  if (state.repos.length) {
    els.results.textContent = `Showing cached data · ${describeError(error)}`;
    return;
  }

  els.grid.innerHTML = '';
  els.results.textContent = '';
  els.status.classList.add('error');
  els.status.innerHTML = `${escapeHtml(describeError(error))} <button type="button" class="btn secondary btn-small" data-retry>Try again</button>`;
}

async function loadSnapshot({ force = false } = {}) {
  // Bucket the cache-buster to the hour so repeat views reuse the cached file.
  const bucket = force ? Date.now() : Math.floor(Date.now() / 3_600_000);
  const data = await fetchJson(`${SNAPSHOT_URL}?v=${bucket}`);

  if (!data || !Array.isArray(data.repos)) {
    throw new Error('The snapshot has an unexpected shape.');
  }

  return {
    repos: ownedOnly(data.repos),
    generatedAt: data.generatedAt || null,
    source: 'snapshot',
  };
}

async function loadLive() {
  const raw = [];

  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const batch = await fetchJson(
      `${API_BASE}/users/${OWNER}/repos?per_page=100&page=${page}&sort=updated`,
    );
    if (!Array.isArray(batch)) throw new Error('The API returned an unexpected shape.');
    raw.push(...batch);
    if (batch.length < 100) break;
  }

  return {
    repos: ownedOnly(raw),
    generatedAt: new Date().toISOString(),
    source: 'live',
  };
}

async function refresh({ force = false } = {}) {
  if (!state.repos.length) showSkeletons();

  let ok = true;
  try {
    paint(await loadSnapshot({ force }));
  } catch (snapshotError) {
    try {
      // The snapshot is usually a same-origin file; if it is missing (first
      // deploy, local preview) fall back to the live API.
      paint(await loadLive());
    } catch (liveError) {
      ok = false;
      showError(liveError.status ? liveError : snapshotError);
    }
  }

  if (ok) {
    writeCache(CACHE_KEY, {
      repos: state.repos,
      generatedAt: state.generatedAt,
      savedAt: state.loadedAt,
    });
  }
}

const initial = readUrlState();
els.search.value = initial.q;
els.sort.value = initial.sort;
let pendingLanguage = initial.lang;

const cached = readCache(CACHE_KEY);
if (cached && Array.isArray(cached.repos) && cached.repos.length) {
  paint({
    repos: cached.repos.map(normalize),
    generatedAt: cached.generatedAt,
    source: 'cache',
    loadedAt: cached.savedAt,
  });

  const fresh = Date.now() - (cached.savedAt || 0) < CACHE_FRESH_MS;
  if (!fresh) refresh();
} else {
  showSkeletons();
  refresh();
}

const onSearch = debounce(() => render(), 150);

els.search.addEventListener('input', onSearch);
els.language.addEventListener('change', render);
els.sort.addEventListener('change', render);

els.clear.addEventListener('click', () => {
  els.search.value = '';
  els.language.value = '';
  els.sort.value = 'updated';
  render();
  els.search.focus();
});

els.refresh.addEventListener('click', () => {
  clearCache(CACHE_KEY);
  refresh({ force: true });
});

els.status.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) refresh({ force: true });
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    els.search.focus();
    els.search.select();
    return;
  }

  if (event.key === 'Escape' && (typing || els.search.value)) {
    if (els.search.value) {
      els.search.value = '';
      render();
    }
    els.search.blur();
  }
});
