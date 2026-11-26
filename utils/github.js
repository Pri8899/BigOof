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
 * Fetch recent public GitHub events for a user (supports conditional ETag requests to avoid burning rate limits).
 */
async function getUserRecentEvents(username, { useETag = false, withMeta = false, etagKey = null } = {}) {
  const cacheKey = String(etagKey || username).toLowerCase();
  const headers = getGitHubHeaders();
  if (useETag) {
    const cachedEtag = eventEtagCache.get(cacheKey);
    if (cachedEtag) headers['If-None-Match'] = cachedEtag;
  }

  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}/events/public`, {
      params: { per_page: 30 },
      headers,
      timeout: 10000,
      validateStatus: status => status === 200 || status === 304
    });

    if (res.status === 304) {
      return withMeta ? { events: [], notModified: true, rateLimited: false } : [];
    }

    if (res.headers?.etag) {
      eventEtagCache.set(cacheKey, res.headers.etag);
    }

    const filtered = Array.isArray(res.data)
      ? res.data.filter(event => SUPPORTED_EVENT_TYPES.has(event.type))
      : [];
    return withMeta ? { events: filtered, notModified: false, rateLimited: false } : filtered;
  } catch (err) {
    const status = err.response?.status;
    const rateLimited = status === 403 || status === 429;
    console.error(`[GitHub] Error fetching events for ${username}:`, err.message);
    return withMeta ? { events: [], notModified: false, rateLimited } : [];
  }
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
  getUserRecentEvents,
  getCommitDetails,
  detectLanguage
};
