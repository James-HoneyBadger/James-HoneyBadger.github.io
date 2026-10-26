import fs from 'node:fs/promises';
import path from 'node:path';

const OWNER = process.env.GH_PINNED_USER || 'James-HoneyBadger';
const OUT_PATH = process.env.GH_REPOS_OUT || 'data/repos.json';

// A token is optional here (the REST API is public) but avoids the 60/hour
// anonymous limit during CI runs.
const token = process.env.GITHUB_TOKEN || '';

const PER_PAGE = 100;
const MAX_PAGES = 10;

async function fetchPage(page) {
  const res = await fetch(
    `https://api.github.com/users/${OWNER}/repos?per_page=${PER_PAGE}&page=${page}&sort=updated`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${OWNER}-pages-build`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    console.error(`GitHub REST error: HTTP ${res.status} on page ${page}`);
    console.error((await res.text()).slice(0, 500));
    process.exit(1);
  }

  const batch = await res.json();
  if (!Array.isArray(batch)) {
    console.error(
      'GitHub REST returned an unexpected payload:',
      JSON.stringify(batch).slice(0, 500),
    );
    process.exit(1);
  }

  return batch;
}

async function fetchAllRepos() {
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await fetchPage(page);
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  return all;
}

async function readPrevious(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const raw = await fetchAllRepos();

const repos = raw
  .filter((r) => (r.owner?.login || '').toLowerCase() === OWNER.toLowerCase())
  .filter((r) => !r.fork)
  .map((r) => ({
    name: r.name,
    url: r.html_url,
    description: r.description || '',
    language: r.language || '',
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    pushedAt: r.pushed_at || null,
    createdAt: r.created_at || null,
    archived: Boolean(r.archived),
    topics: Array.isArray(r.topics) ? r.topics : [],
    license: r.license?.spdx_id || '',
    homepage: r.homepage || '',
    openIssues: r.open_issues_count || 0,
  }))
  .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0));

// Same rule as the pinned generator: a run that finds nothing new must not
// rewrite the file, or every scheduled run would create an empty commit.
const previous = await readPrevious(OUT_PATH);
const isSameData =
  previous !== null &&
  previous.user === OWNER &&
  JSON.stringify(previous.repos) === JSON.stringify(repos);

if (isSameData) {
  console.log(`No changes for @${OWNER}; leaving ${OUT_PATH} untouched.`);
  process.exit(0);
}

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(
  OUT_PATH,
  JSON.stringify({ user: OWNER, generatedAt: new Date().toISOString(), repos }, null, 2) + '\n',
  'utf8',
);

console.log(
  `Wrote ${OUT_PATH} with ${repos.length} repositories for @${OWNER}` +
    (token ? '' : ' (unauthenticated request)'),
);
