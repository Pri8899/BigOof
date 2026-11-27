// tasks/githubFeed.js — Real-time GitHub push/commit feed (via repos?sort=pushed + commits) & event stream
const cron = require('node-cron');
const {
  getAllUsers,
  getUser,
  getLastSubmission,
  setLastSubmission,
  db
} = require('../database/db');
const {
  getUserPushedRepos,
  getRepoRecentCommits,
  getUserRecentEvents,
  getCommitDetails
} = require('../utils/github');
const { buildGitHubActivityEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { getTargetChannel } = require('../utils/envHelper');
const { getTimeZone } = require('../utils/time');

let isGlobalPolling = false;
const activeUserSyncs = new Set();

const LIVE_LOOKBACK_SEC = 3600;         // Live auto-poll max lookback (1h)
const EVENT_PUSH_FALLBACK_SEC = 900;    // Strict 15m guard for /events/public PushEvents to block stale lag
const MANUAL_SYNC_LOOKBACK_SEC = 86400; // Manual /github sync lookback (24h)

function isKeyProcessed(key) {
  return Boolean(db.prepare('SELECT 1 FROM processed_github_commits WHERE sha = ?').get(key));
}

function markKeysProcessed(keys, repo, author) {
  const stmt = db.prepare('INSERT OR IGNORE INTO processed_github_commits (sha, repo, author) VALUES (?, ?, ?)');
  for (const k of keys) {
    if (k) stmt.run(k, repo || 'GitHub', author);
  }
}

async function resolveGitHubChannelsForUser(client, discordId) {
  const channels = [];
  const seenIds = new Set();

  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;

    const ch = await getTargetChannel(client, 'github_channel_id', 'GITHUB_CHANNEL_ID', guild.id);
    if (ch && !seenIds.has(ch.id)) {
      seenIds.add(ch.id);
      channels.push(ch);
    }
  }

  if (channels.length === 0) {
    const globalCh = await getTargetChannel(client, 'github_channel_id', 'GITHUB_CHANNEL_ID');
    if (globalCh) channels.push(globalCh);
  }

  return channels;
}

async function broadcastToChannels(channels, embed) {
  let sentCount = 0;
  for (const ch of channels) {
    try {
      await ch.send({ embeds: [embed] });
      sentCount++;
    } catch (err) {
      console.error(`[GitHubFeed] Error sending embed in #${ch.name}:`, err.message);
    }
  }
  return sentCount > 0;
}

/**
 * Seeds baseline cursor & marks existing recent repo heads/events read so initial setup never floods Discord.
 */
async function seedUserBaseline(user, nowSec) {
  const handleLower = user.github_handle.toLowerCase();
  const [reposRes, eventsRes] = await Promise.all([
    getUserPushedRepos(user.github_handle, { useETag: false, perPage: 10 }),
    getUserRecentEvents(user.github_handle, { useETag: false, withMeta: true })
  ]);

  if (reposRes.rateLimited && eventsRes.rateLimited) {
    return { count: 0, seeded: false };
  }

  let highestTime = nowSec;
  for (const repo of (reposRes.repos || []).slice(0, 5)) {
    const pushedSec = Math.floor(new Date(repo.pushed_at).getTime() / 1000);
    if (Number.isFinite(pushedSec) && pushedSec > highestTime) highestTime = pushedSec;
    if (!Number.isFinite(pushedSec) || pushedSec < nowSec - MANUAL_SYNC_LOOKBACK_SEC) continue;

    const commits = await getRepoRecentCommits(repo.full_name, { perPage: 5 });
    const shas = commits
      .filter(c =>
        repo.owner?.login?.toLowerCase() === handleLower ||
        c.authorLogin?.toLowerCase() === handleLower ||
        c.committerLogin?.toLowerCase() === handleLower
      )
      .map(c => c.sha);
    markKeysProcessed(shas, repo.full_name, user.github_handle);
  }

  for (const event of eventsRes.events || []) {
    const keys = [`gh_event_${event.id}`];
    if (event.type === 'PushEvent' && event.payload?.head) keys.push(event.payload.head);
    markKeysProcessed(keys, event.repo?.name, user.github_handle);
  }

  setLastSubmission(user.discord_id, 'github', highestTime);
  console.log(`[GitHubFeed] Seeded real-time cursor for ${user.github_handle}.`);
  return { count: 0, seeded: true };
}

async function syncUserGitHub(client, user, { manualSync = false, seedOnly = false } = {}) {
  if (activeUserSyncs.has(user.discord_id)) {
    return { count: 0, skippedReason: 'Sync already in progress for this user.' };
  }

  activeUserSyncs.add(user.discord_id);
  let postedCount = 0;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const prevCursorTime = getLastSubmission(user.discord_id, 'github');

    if (seedOnly || (prevCursorTime === null && !manualSync)) {
      return seedUserBaseline(user, nowSec);
    }

    const channels = await resolveGitHubChannelsForUser(client, user.discord_id);
    if (channels.length === 0) {
      return { count: 0, noChannels: true };
    }

    const handleLower = user.github_handle.toLowerCase();
    const minTime = manualSync
      ? nowSec - MANUAL_SYNC_LOOKBACK_SEC
      : Math.max((prevCursorTime || nowSec) - 30, nowSec - LIVE_LOOKBACK_SEC);

    let highestSeenTime = prevCursorTime || 0;

    // 1. Primary live push tracker: /users/{handle}/repos?sort=pushed + /repos/{full_name}/commits
    const reposRes = await getUserPushedRepos(user.github_handle, {
      useETag: !manualSync,
      etagKey: `repos:${user.discord_id}:${user.github_handle}`
    });

    if (!reposRes.notModified && !reposRes.rateLimited && Array.isArray(reposRes.repos)) {
      const activeRepos = reposRes.repos
        .map(repo => ({ repo, pushedSec: Math.floor(new Date(repo.pushed_at).getTime() / 1000) }))
        .filter(({ pushedSec }) => Number.isFinite(pushedSec) && pushedSec >= minTime)
        .sort((a, b) => a.pushedSec - b.pushedSec);

      for (const { repo, pushedSec } of activeRepos) {
        if (pushedSec > highestSeenTime) highestSeenTime = pushedSec;

        const sinceIso = new Date((minTime - 60) * 1000).toISOString();
        const commits = await getRepoRecentCommits(repo.full_name, { sinceIso, perPage: 10 });
        const ownerMatches = repo.owner?.login?.toLowerCase() === handleLower;

        const newCommits = commits
          .filter(c => {
            const cTime = Math.floor(new Date(c.date || repo.pushed_at).getTime() / 1000);
            if (!Number.isFinite(cTime) || cTime < minTime) return false;
            if (!ownerMatches) {
              const actorMatch =
                c.authorLogin?.toLowerCase() === handleLower ||
                c.committerLogin?.toLowerCase() === handleLower;
              if (!actorMatch) return false;
            }
            return !isKeyProcessed(c.sha);
          })
          .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

        if (newCommits.length === 0) continue;

        const headCommit = newCommits[newCommits.length - 1];
        const headTime = Math.floor(new Date(headCommit.date || repo.pushed_at).getTime() / 1000);
        if (Number.isFinite(headTime) && headTime > highestSeenTime) highestSeenTime = headTime;

        const extraDetails = await getCommitDetails(repo.full_name, headCommit.sha);
        const enrichedDetails = extraDetails
          ? { ...extraDetails, groupedCommits: newCommits }
          : {
              sha: headCommit.sha,
              shortSha: headCommit.shortSha,
              message: headCommit.message,
              commitUrl: headCommit.url,
              groupedCommits: newCommits
            };

        const syntheticPushEvent = {
          id: `repo_${repo.id}_${headCommit.shortSha}`,
          type: 'PushEvent',
          created_at: headCommit.date || repo.pushed_at,
          repo: { name: repo.full_name },
          actor: {
            login: headCommit.authorLogin || repo.owner?.login || user.github_handle,
            avatar_url: repo.owner?.avatar_url
          },
          payload: {
            ref: `refs/heads/${repo.default_branch || 'main'}`,
            head: headCommit.sha,
            commits: newCommits.map(c => ({ message: c.message, sha: c.sha, url: c.url }))
          }
        };

        const embed = buildGitHubActivityEmbed(user, syntheticPushEvent, enrichedDetails);
        const sent = await broadcastToChannels(channels, embed);
        if (sent) {
          postedCount++;
          markKeysProcessed(newCommits.map(c => c.sha), repo.full_name, user.github_handle);
          console.log(`[GitHubFeed] Posted ${newCommits.length} commit(s) for ${user.github_handle} (${repo.full_name})`);
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // 2. Secondary feed: PRs, Issues, Releases, Create/Fork events (and <15m external repo PushEvents)
    const eventsRes = await getUserRecentEvents(user.github_handle, {
      useETag: !manualSync,
      withMeta: true,
      etagKey: `events:${user.discord_id}:${user.github_handle}`
    });

    if (!eventsRes.notModified && !eventsRes.rateLimited && Array.isArray(eventsRes.events)) {
      const sortedEvents = [...eventsRes.events].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      for (const event of sortedEvents) {
        const eventTime = Math.floor(new Date(event.created_at).getTime() / 1000);
        if (!Number.isFinite(eventTime) || eventTime <= 0) continue;

        const isPush = event.type === 'PushEvent';
        const effectiveMin = isPush
          ? (manualSync ? minTime : Math.max(minTime, nowSec - EVENT_PUSH_FALLBACK_SEC))
          : minTime;

        if (eventTime < effectiveMin) continue;
        if (eventTime > highestSeenTime) highestSeenTime = eventTime;

        const keys = [`gh_event_${event.id}`];
        if (isPush && event.payload?.head) keys.push(event.payload.head);
        if (keys.some(isKeyProcessed)) continue;

        let extraDetails = null;
        if (isPush && event.payload?.head && event.repo?.name) {
          extraDetails = await getCommitDetails(event.repo.name, event.payload.head);
        }

        const embed = buildGitHubActivityEmbed(user, event, extraDetails);
        const sent = await broadcastToChannels(channels, embed);
        if (sent) {
          postedCount++;
          markKeysProcessed(keys, event.repo?.name, user.github_handle);
          console.log(`[GitHubFeed] Posted ${event.type} for ${user.github_handle} (${event.repo?.name || 'GitHub'})`);
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    if (highestSeenTime > (prevCursorTime || 0)) {
      setLastSubmission(user.discord_id, 'github', highestSeenTime);
    }

    return { count: postedCount };
  } finally {
    activeUserSyncs.delete(user.discord_id);
  }
}

async function runGitHubFeed(client, specificDiscordId = null, options = {}) {
  if (!specificDiscordId && isGlobalPolling) {
    return { success: false, count: 0, reason: 'Already polling' };
  }

  if (!specificDiscordId) isGlobalPolling = true;
  let totalPosted = 0;

  try {
    let users = getAllUsers().filter(u => u.github_handle);
    if (specificDiscordId) {
      users = users.filter(u => u.discord_id === specificDiscordId);
    }
    if (users.length === 0) {
      return { success: true, count: 0, reason: 'No linked GitHub accounts found.' };
    }

    for (const user of users) {
      try {
        const res = await syncUserGitHub(client, user, options);
        totalPosted += res.count;
        if (specificDiscordId && res.noChannels) {
          return {
            success: false,
            count: 0,
            reason: 'No #github channel configured yet. Ask an admin to run `/set-channel`.'
          };
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (userErr) {
        console.error(`[GitHubFeed] Error processing ${user.github_handle}:`, userErr.message);
      }
    }

    return { success: true, count: totalPosted };
  } catch (err) {
    console.error('[GitHubFeed] Global error:', err.message);
    return { success: false, count: totalPosted, reason: err.message };
  } finally {
    if (!specificDiscordId) isGlobalPolling = false;
  }
}

function startGitHubFeed(client) {
  cron.schedule('*/2 * * * *', () => {
    runGitHubFeed(client).catch(err => console.error('[GitHubFeed Task Error]', err));
  }, { timezone: getTimeZone(), noOverlap: true });

  setTimeout(() => {
    console.log('[GitHubFeed] Startup check: Running initial GitHub feed...');
    runGitHubFeed(client).catch(err => console.error('[GitHubFeed Startup Error]', err));
  }, 20000);

  console.log('[GitHubFeed] Live feed task scheduled (every 2 minutes via repos + events).');
}

/**
 * Shared handler for `/github sync` and the interactive `github_sync_btn` button.
 */
async function handleGitHubSyncInteraction(interaction, client = interaction.client) {
  await interaction.deferReply({ flags: 64 });
  const dbUser = getUser(interaction.user.id);

  if (!dbUser || !dbUser.github_handle) {
    return interaction.editReply({
      embeds: [errorEmbed('Not Linked', '🐙 Please link your GitHub account first using `/link platform:🐙 GitHub`.')]
    });
  }

  const result = await runGitHubFeed(client, interaction.user.id, { manualSync: true });
  if (!result.success && result.reason) {
    return interaction.editReply({
      embeds: [errorEmbed('Sync Failed', result.reason)]
    });
  }

  const profileLink = `[${dbUser.github_handle}](https://github.com/${encodeURIComponent(dbUser.github_handle)})`;
  if (result.count > 0) {
    return interaction.editReply({
      embeds: [successEmbed(
        'GitHub Activity Synced! 🚀',
        `Scanned **${profileLink}** and posted **${result.count}** new push/event card(s) to your GitHub channel!`
      )]
    });
  }

  return interaction.editReply({
    embeds: [successEmbed(
      'Everything Up-to-Date! 🟢',
      `Scanned **${profileLink}**. All recent activities are already posted!`
    )]
  });
}

module.exports = { startGitHubFeed, runGitHubFeed, handleGitHubSyncInteraction };
