// utils/github.js — GitHub API wrapper for profile and push event tracking
const axios = require('axios');

const GITHUB_API = 'https://api.github.com';
const GITHUB_HEADERS = {
  'User-Agent': 'DC-Bot/1.0 (Discord Competitive Programming Bot)',
  'Accept': 'application/vnd.github.v3+json'
};

/**
 * Validate if a GitHub username exists
 * @param {string} username
 * @returns {Promise<boolean>}
 */
async function validateGitHubUser(username) {
  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}`, {
      headers: GITHUB_HEADERS,
      timeout: 8000
    });
    return res.status === 200 && !!res.data.login;
  } catch (err) {
    return false;
  }
}

/**
 * Fetch GitHub user profile data
 * @param {string} username
 * @returns {Promise<Object|null>}
 */
async function getGitHubUser(username) {
  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}`, {
      headers: GITHUB_HEADERS,
      timeout: 8000
    });
    if (res.status !== 200) return null;
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
 * Fetch recent public PushEvents for a user
 * @param {string} username
 * @returns {Promise<Array>}
 */
async function getUserRecentPushEvents(username) {
  try {
    const res = await axios.get(`${GITHUB_API}/users/${encodeURIComponent(username)}/events/public`, {
      headers: GITHUB_HEADERS,
      timeout: 10000
    });
    if (res.status !== 200 || !Array.isArray(res.data)) return [];
    return res.data.filter(event => event.type === 'PushEvent' && event.payload && event.payload.head);
  } catch (err) {
    console.error(`[GitHub] Error fetching events for ${username}:`, err.message);
    return [];
  }
}

/**
 * Fetch detailed commit information
 * @param {string} repoFullName - e.g. "parthopaul69/CP"
 * @param {string} sha - commit SHA
 * @returns {Promise<Object|null>}
 */
async function getCommitDetails(repoFullName, sha) {
  try {
    const res = await axios.get(`${GITHUB_API}/repos/${repoFullName}/commits/${sha}`, {
      headers: GITHUB_HEADERS,
      timeout: 10000
    });
    if (res.status !== 200) return null;
    const data = res.data;
    return {
      sha: data.sha,
      shortSha: data.sha.substring(0, 7),
      message: data.commit.message,
      authorName: data.commit.author.name,
      commitUrl: data.html_url,
      stats: data.stats || { total: 0, additions: 0, deletions: 0 },
      files: (data.files || []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch
      }))
    };
  } catch (err) {
    console.error(`[GitHub] Error fetching commit ${sha} for ${repoFullName}:`, err.message);
    return null;
  }
}

/**
 * Helper to get programming language name and badge emoji from filename
 * @param {string} filename
 * @returns {{ name: string, emoji: string }}
 */
function detectLanguage(filename) {
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
      return { name: 'JavaScript', emoji: '🟨' };
    case 'ts':
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
  getUserRecentPushEvents,
  getCommitDetails,
  detectLanguage
};
