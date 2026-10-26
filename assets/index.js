import {
  archivedBadge,
  describeError,
  escapeHtml,
  fetchJson,
  languageBadge,
  readCache,
  safeUrl,
  skeletonCards,
  statPills,
  timeElement,
  writeCache,
} from './shared.js';

const OWNER = 'James-HoneyBadger';
const SOURCE = 'data/pinned.json';
const CACHE_KEY = 'pinned-highlights-v1';

const grid = document.getElementById('starred-grid');
const status = document.getElementById('starred-status');

function renderCard(repo) {
  return `<article class="card">
      <div class="meta">${statPills(repo)}${languageBadge(repo.language)}${archivedBadge(repo.archived)}</div>
      <h3>${escapeHtml(repo.name)}</h3>
      <p class="desc">${repo.description ? escapeHtml(repo.description) : 'No description provided yet.'}</p>
      <div class="meta"><span>Owner · ${escapeHtml(repo.owner || OWNER)}</span><span>Last push · ${timeElement(repo.pushedAt)}</span></div>
      <div class="card-actions"><a class="btn secondary" href="${safeUrl(repo.url)}" target="_blank" rel="noreferrer">Open on GitHub</a></div>
    </article>`;
}

function render(repos) {
  const pinned = repos
    .filter((repo) => (repo.owner || OWNER).toLowerCase() === OWNER.toLowerCase())
    .sort((a, b) => (b.stars || 0) - (a.stars || 0));

  grid.setAttribute('aria-busy', 'false');

  if (!pinned.length) {
    status.classList.add('error');
    status.textContent = `No pinned repositories owned by @${OWNER} were found in the snapshot.`;
    grid.innerHTML = '';
    return;
  }

  status.classList.remove('error');
  status.textContent = '';
  grid.innerHTML = pinned.map(renderCard).join('');
}

function showSkeletons() {
  grid.innerHTML = skeletonCards(3);
  grid.setAttribute('aria-busy', 'true');
  status.classList.remove('error');
  status.textContent = 'Loading pinned repositories…';
}

function showError(error) {
  grid.setAttribute('aria-busy', 'false');

  if (grid.querySelector('.card:not(.skeleton)')) {
    // Keep whatever is on screen; a transient fetch failure should not blank it.
    status.classList.add('error');
    status.textContent = `Showing the last loaded highlights · ${describeError(error)}`;
    return;
  }

  grid.innerHTML = '';
  status.classList.add('error');
  status.innerHTML = `Unable to load pinned repositories · ${escapeHtml(describeError(error))} <button type="button" class="btn secondary btn-small" data-retry>Try again</button>`;
}

async function load() {
  const bucket = Math.floor(Date.now() / 3_600_000);

  try {
    const data = await fetchJson(`${SOURCE}?v=${bucket}`);

    if (!data || !Array.isArray(data.pinned)) {
      throw new Error('The pinned snapshot has an unexpected shape.');
    }
    if (data.pinned.length === 0) {
      throw new Error('The pinned snapshot is empty.');
    }

    render(data.pinned);
    writeCache(CACHE_KEY, {
      pinned: data.pinned,
      generatedAt: data.generatedAt || null,
      savedAt: Date.now(),
    });
  } catch (error) {
    showError(error);
  }
}

const cached = readCache(CACHE_KEY);
if (cached && Array.isArray(cached.pinned) && cached.pinned.length) {
  // Paint from the last successful load, then confirm against the snapshot.
  render(cached.pinned);
  load();
} else {
  showSkeletons();
  load();
}

status.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) {
    showSkeletons();
    load();
  }
});
