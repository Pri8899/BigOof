// utils/github.js — GitHub REST API wrapper for profile & activity tracking
const axios = require('axios');

const GITHUB_API = 'https://api.github.com';
const eventEtagCache = new Map();

const SUPPORTED_EVENT_TYPES = new Set([
  'PushEvent',
  'CreateEvent',
  'PullRequestEvent',
  'IssuesEvent',
  'ReleaseEvent',
  'ForkEvent'
]);

function getGitHubHeaders() {
  const headers = {
    'User-Agent': 'BigOof-Bot/1.0 (Discord Competitive Programming Bot)',
    'Accept': 'application/vnd.github+json'
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token && !token.includes('your_')) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Validate if a GitHub username exists.
 */
async function validateGitHubUser(username) {
  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}`, {
      headers: getGitHubHeaders(),
      timeout: 8000
    });
    return res.status === 200 && Boolean(res.data?.login);
  } catch {
    return false;
  }
}

/**
 * Fetch normalized GitHub user profile data.
 */
async function getGitHubUser(username) {
  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}`, {
      headers: getGitHubHeaders(),
      timeout: 8000
    });
    if (res.status !== 200 || !res.data) return null;
    const data = res.data;
    return {
      login: data.login,
      name: data.name || data.login,
      avatarUrl: data.avatar_url,
      bio: data.bio || null,
      publicRepos: data.public_repos ?? 0,
      followers: data.followers ?? 0,
      following: data.following ?? 0,
      profileUrl: data.html_url,
      createdAt: data.created_at
    };
  } catch (err) {
    console.error(`[GitHub] Error fetching profile for ${username}:`, err.message);
    return null;
  }
}

/**
 * Shared conditional GET helper with ETag caching so polling returns 304 without burning rate limit.
 */
async function fetchWithETag(url, { params = {}, useETag = false, etagKey = null, timeout = 10000 } = {}) {
  const cacheKey = etagKey ? String(etagKey).toLowerCase() : null;
  const headers = getGitHubHeaders();
  if (useETag && cacheKey) {
    const cached = eventEtagCache.get(cacheKey);
    if (cached) headers['If-None-Match'] = cached;
  }

  try {
    const res = await axios.get(url, {
      params,
      headers,
      timeout,
      validateStatus: status => status === 200 || status === 304
    });

    if (res.status === 304) {
      return { data: [], notModified: true, rateLimited: false };
    }

    if (cacheKey && res.headers?.etag) {
      eventEtagCache.set(cacheKey, res.headers.etag);
    }

    return {
      data: Array.isArray(res.data) ? res.data : [],
      notModified: false,
      rateLimited: false
    };
  } catch (err) {
    const status = err.response?.status;
    const rateLimited = status === 403 || status === 429;
    console.error(`[GitHub] GET ${url} failed:`, err.message);
    return { data: [], notModified: false, rateLimited };
  }
}

/**
 * Fetch public repositories sorted by most recent push timestamp (reliable real-time push detection).
 */
async function getUserPushedRepos(username, { useETag = false, etagKey = null, perPage = 15 } = {}) {
  const res = await fetchWithETag(`${GITHUB_API}/users/${encodeURIComponent(username)}/repos`, {
    params: { type: 'all', sort: 'pushed', per_page: perPage },
    useETag,
    etagKey: etagKey || `repos:${username}`,
    timeout: 10000
  });
  return { repos: res.data, notModified: res.notModified, rateLimited: res.rateLimited };
}

/**
 * Fetch recent commits on a repository with exact committer/author dates and logins.
 */
async function getRepoRecentCommits(repoFullName, { sinceIso = null, perPage = 10 } = {}) {
  try {
    const safeRepo = repoFullName.split('/').map(encodeURIComponent).join('/');
    const params = { per_page: perPage };
    if (sinceIso) params.since = sinceIso;

    const res = await axios.get(`${GITHUB_API}/repos/${safeRepo}/commits`, {
      params,
      headers: getGitHubHeaders(),
      timeout: 10000
    });
    if (res.status !== 200 || !Array.isArray(res.data)) return [];
    return res.data.map(c => ({
      sha: c.sha,
      shortSha: c.sha.substring(0, 7),
      message: c.commit?.message || 'Commit pushed',
      date: c.commit?.committer?.date || c.commit?.author?.date || null,
      authorLogin: c.author?.login || null,
      committerLogin: c.committer?.login || null,
      url: c.html_url
    }));
  } catch (err) {
    if (err.response?.status !== 409) { // 409 = empty git repository
      console.warn(`[GitHub] Error fetching commits for ${repoFullName}:`, err.message);
    }
    return [];
  }
}

/**
 * Fetch recent public GitHub events for a user (secondary feed for PRs, issues, releases, branches, forks).
 */
async function getUserRecentEvents(username, { useETag = false, withMeta = false, etagKey = null } = {}) {
  const res = await fetchWithETag(`${GITHUB_API}/users/${encodeURIComponent(username)}/events/public`, {
    params: { per_page: 30 },
    useETag,
    etagKey: etagKey || `events:${username}`,
    timeout: 10000
  });
  if (res.notModified || res.rateLimited) {
    return withMeta ? { events: [], notModified: res.notModified, rateLimited: res.rateLimited } : [];
  }
  const filtered = res.data.filter(event => SUPPORTED_EVENT_TYPES.has(event.type));
  return withMeta ? { events: filtered, notModified: false, rateLimited: false } : filtered;
}

/**
 * Fetch detailed commit information.
 */
async function getCommitDetails(repoFullName, sha) {
  try {
    const safeRepo = repoFullName.split('/').map(encodeURIComponent).join('/');
    const res = await axios.get(`${GITHUB_API}/repos/${safeRepo}/commits/${encodeURIComponent(sha)}`, {
      headers: getGitHubHeaders(),
      timeout: 10000
    });
    if (res.status !== 200 || !res.data) return null;
    const data = res.data;
    return {
      sha: data.sha,
      shortSha: data.sha.substring(0, 7),
      message: data.commit?.message || 'Commit pushed',
      authorName: data.commit?.author?.name || 'Unknown',
      commitUrl: data.html_url,
      stats: data.stats || { total: 0, additions: 0, deletions: 0 },
      files: (data.files || []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions
      }))
    };
  } catch (err) {
    console.error(`[GitHub] Error fetching commit ${sha} for ${repoFullName}:`, err.message);
    return null;
  }
}

/**
 * Infer language display metadata from filename extension.
 */
function detectLanguage(filename) {
  if (!filename) return { name: 'Code', emoji: '💻' };
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return { name: 'C++', emoji: '🟦' };
    case 'c':
    case 'h':
      return { name: 'C', emoji: '🔷' };
    case 'py':
      return { name: 'Python', emoji: '🐍' };
    case 'java':
      return { name: 'Java', emoji: '☕' };
    case 'dart':
      return { name: 'Dart/Flutter', emoji: '🎯' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { name: 'JavaScript', emoji: '🟨' };
    case 'ts':
    case 'tsx':
      return { name: 'TypeScript', emoji: '🔷' };
    case 'rs':
      return { name: 'Rust', emoji: '🦀' };
    case 'go':
      return { name: 'Go', emoji: '🐹' };
    case 'kt':
      return { name: 'Kotlin', emoji: '🟣' };
    case 'cs':
      return { name: 'C#', emoji: '🟩' };
    case 'sql':
      return { name: 'SQL', emoji: '🗄️' };
    case 'md':
      return { name: 'Markdown', emoji: '📝' };
    default:
      return { name: ext?.toUpperCase() || 'Code', emoji: '💻' };
  }
}

module.exports = {
  validateGitHubUser,
  getGitHubUser,
  getUserPushedRepos,
  getRepoRecentCommits,
  getUserRecentEvents,
  getCommitDetails,
  detectLanguage
};
