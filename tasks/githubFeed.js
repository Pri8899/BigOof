// tasks/githubFeed.js — Live feed for GitHub commits, PRs, releases, and repositories
const cron = require('node-cron');
const { getAllUsers, getUser, db } = require('../database/db');
const { getUserRecentEvents, getCommitDetails } = require('../utils/github');
const { buildGitHubActivityEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { getTargetChannel } = require('../utils/envHelper');
const { getTimeZone } = require('../utils/time');

let isGlobalPolling = false;
const activeUserSyncs = new Set();

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

async function syncUserGitHub(client, user) {
  if (activeUserSyncs.has(user.discord_id)) {
    return { count: 0, skippedReason: 'Sync already in progress for this user.' };
  }

  activeUserSyncs.add(user.discord_id);
  let postedCount = 0;

  try {
    const channels = await resolveGitHubChannelsForUser(client, user.discord_id);
    if (channels.length === 0) {
      return { count: 0, noChannels: true };
    }

    const events = await getUserRecentEvents(user.github_handle);
    if (!events || events.length === 0) {
      return { count: 0 };
    }

    const minTime = Math.floor(Date.now() / 1000) - (90 * 86400);
    const sortedEvents = [...events].reverse();

    for (const event of sortedEvents) {
      const eventTime = Math.floor(new Date(event.created_at).getTime() / 1000);
      if (eventTime < minTime) continue;

      const dedupKey = event.type === 'PushEvent' && event.payload?.head
        ? event.payload.head
        : `gh_event_${event.id}`;

      const alreadyProcessed = db.prepare('SELECT 1 FROM processed_github_commits WHERE sha = ?').get(dedupKey);
      if (alreadyProcessed) continue;

      let extraDetails = null;
      if (event.type === 'PushEvent' && event.payload?.head && event.repo?.name) {
        extraDetails = await getCommitDetails(event.repo.name, event.payload.head);
      }

      const embed = buildGitHubActivityEmbed(user, event, extraDetails);
      const sent = await broadcastToChannels(channels, embed);

      if (sent) {
        postedCount++;
        db.prepare('INSERT OR IGNORE INTO processed_github_commits (sha, repo, author) VALUES (?, ?, ?)')
          .run(dedupKey, event.repo?.name || 'GitHub', user.github_handle);
        console.log(`[GitHubFeed] Posted ${event.type} for ${user.github_handle} (${event.repo?.name || 'GitHub'})`);
      }

      await new Promise(r => setTimeout(r, 600));
    }

    return { count: postedCount };
  } finally {
    activeUserSyncs.delete(user.discord_id);
  }
}

async function runGitHubFeed(client, specificDiscordId = null) {
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
        const res = await syncUserGitHub(client, user);
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

  console.log('[GitHubFeed] Live feed task scheduled (every 2 minutes).');
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

  const result = await runGitHubFeed(client, interaction.user.id);
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
        `Scanned **${profileLink}** and posted **${result.count}** new activities to your GitHub channel!`
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
