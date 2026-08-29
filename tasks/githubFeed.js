// tasks/githubFeed.js — Live feed for GitHub commits, PRs, new repos, and activity
const cron = require('node-cron');
const { getAllUsers, db } = require('../database/db');
const { getUserRecentEvents, getCommitDetails } = require('../utils/github');
const { buildGitHubActivityEmbed } = require('../utils/embeds');
const { getTargetChannel } = require('../utils/envHelper');

let isPolling = false;

async function runGitHubFeed(client) {
  if (isPolling) return;
  isPolling = true;

  try {
    const channel = await getTargetChannel(
      client,
      'github_channel_id',
      'GITHUB_CHANNEL_ID',
      ['github', 'git-feed', 'git', 'commits']
    );

    if (!channel) {
      isPolling = false;
      return;
    }

    const users = getAllUsers().filter(u => u.github_handle);
    if (users.length === 0) {
      isPolling = false;
      return;
    }

    for (const user of users) {
      try {
        const events = await getUserRecentEvents(user.github_handle);
        if (!events || events.length === 0) continue;

        // Process only recent events (within the last 24 hours)
        const nowSec = Math.floor(Date.now() / 1000);
        const minTime = nowSec - 86400; // 24 hours

        // Process oldest to newest
        const sortedEvents = [...events].reverse();

        for (const event of sortedEvents) {
          const eventTime = Math.floor(new Date(event.created_at).getTime() / 1000);
          if (eventTime < minTime) continue;

          // Unique dedup key for each event
          const dedupKey = event.type === 'PushEvent' && event.payload?.head
            ? event.payload.head
            : `gh_event_${event.id}`;

          // Check if this event was already announced
          const alreadyProcessed = db.prepare('SELECT 1 FROM processed_github_commits WHERE sha = ?').get(dedupKey);
          if (alreadyProcessed) continue;

          // Fetch commit details if it's a push event
          let extraDetails = null;
          if (event.type === 'PushEvent' && event.payload?.head && event.repo?.name) {
            extraDetails = await getCommitDetails(event.repo.name, event.payload.head);
          }

          const embed = buildGitHubActivityEmbed(user, event, extraDetails);

          try {
            await channel.send({ embeds: [embed] });
            console.log(`[GitHubFeed] 🚀 Posted ${event.type} for ${user.github_handle} (${event.repo?.name || 'GitHub'})`);

            // Mark as processed in database
            db.prepare('INSERT OR IGNORE INTO processed_github_commits (sha, repo, author) VALUES (?, ?, ?)')
              .run(dedupKey, event.repo?.name || 'GitHub', user.github_handle);
          } catch (sendErr) {
            console.error(`[GitHubFeed] Error sending embed to #${channel.name}:`, sendErr.message);
          }

          // Polite pause between multiple event sends
          await new Promise(r => setTimeout(r, 1500));
        }

        // Polite delay between users to be gentle on GitHub API
        await new Promise(r => setTimeout(r, 2000));
      } catch (userErr) {
        console.error(`[GitHubFeed] Error processing ${user.github_handle}:`, userErr.message);
      }
    }
  } catch (err) {
    console.error('[GitHubFeed] Global error:', err.message);
  } finally {
    isPolling = false;
  }
}

function startGitHubFeed(client) {
  // Run every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    runGitHubFeed(client).catch(err => console.error('[GitHubFeed Task Error]', err));
  });

  // Run startup check 20 seconds after bot boots
  setTimeout(() => {
    console.log('[GitHubFeed] Startup check: Running initial GitHub feed poller...');
    runGitHubFeed(client).catch(err => console.error('[GitHubFeed Startup Error]', err));
  }, 20000);

  console.log('[GitHubFeed] GitHub live feed task scheduled (every 2 minutes).');
}

module.exports = { startGitHubFeed, runGitHubFeed };
