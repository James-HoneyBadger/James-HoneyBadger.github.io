import fs from 'node:fs/promises';

const OWNER = process.env.GH_PINNED_USER || 'James-HoneyBadger';
const OUT_PATH = process.env.GH_PINNED_OUT || 'data/pinned.json';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
if (!token) {
  console.error('Missing token. Set GITHUB_TOKEN (Actions) or GH_TOKEN (local).');
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
            isPrivate
            isFork
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
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
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
    repo: r.name,
    link: r.url,
    description: r.description || '',
    language: r.primaryLanguage?.name || '',
    stars: r.stargazerCount || 0,
    forks: r.forkCount || 0,
    pushedAt: r.pushedAt || null,
    isPrivate: Boolean(r.isPrivate),
    isFork: Boolean(r.isFork),
  }))
  .filter((r) => r.owner.toLowerCase() === OWNER.toLowerCase())
  .sort((a, b) => b.stars - a.stars);

await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT_PATH, JSON.stringify({ user: OWNER, generatedAt: new Date().toISOString(), pinned }, null, 2) + '\n', 'utf8');
console.log(`Wrote ${OUT_PATH} with ${pinned.length} pinned repos for @${OWNER}`);
