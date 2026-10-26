import fs from 'node:fs/promises';
import path from 'node:path';

const OWNER = process.env.GH_PINNED_USER || 'James-HoneyBadger';
const OUT_PATH = process.env.GH_PINNED_OUT || 'data/pinned.json';

const token = process.env.GITHUB_TOKEN || '';
if (!token) {
  console.error('Missing token. Set GITHUB_TOKEN (Actions secret PINNED_REPOS_TOKEN).');
  process.exit(1);
}

const query = `
  query($login: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes {
          ... on Repository {
            name
            description
            stargazerCount
            forkCount
            url
            pushedAt
            owner { login }
            primaryLanguage { name }
            isArchived
          }
        }
      }
    }
  }
`;

async function ghGraphql(body) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`GitHub GraphQL returned a non-JSON response (HTTP ${res.status}):`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
  if (!res.ok || json.errors) {
    console.error('GitHub GraphQL error:', JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

const result = await ghGraphql({ query, variables: { login: OWNER } });
const nodes = result?.data?.user?.pinnedItems?.nodes || [];

const pinned = nodes
  .filter(Boolean)
  .map((r) => ({
    owner: r.owner?.login || OWNER,
    name: r.name,
    url: r.url,
    description: r.description || '',
    language: r.primaryLanguage?.name || '',
    stars: r.stargazerCount || 0,
    forks: r.forkCount || 0,
    pushedAt: r.pushedAt || null,
    archived: Boolean(r.isArchived),
  }))
  // enforce: ONLY repos owned by the account
  .filter((r) => r.owner.toLowerCase() === OWNER.toLowerCase())
  // enforce: pinned, owned, sorted by stars desc
  .sort((a, b) => b.stars - a.stars);

// A run that finds nothing new must not rewrite the file: refreshing
// `generatedAt` alone would create an empty commit and a Pages deploy.
async function readPreviousPinned(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const previous = await readPreviousPinned(OUT_PATH);
const isSameData =
  previous !== null &&
  previous.user === OWNER &&
  JSON.stringify(previous.pinned) === JSON.stringify(pinned);

if (isSameData) {
  console.log(`No changes for @${OWNER}; leaving ${OUT_PATH} untouched.`);
  process.exit(0);
}

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(
  OUT_PATH,
  JSON.stringify({ user: OWNER, generatedAt: new Date().toISOString(), pinned }, null, 2) + '\n',
  'utf8',
);

console.log(`Wrote ${OUT_PATH} with ${pinned.length} pinned repos for @${OWNER}`);
