// commands/leaderboard.js — Show server leaderboard
const { SlashCommandBuilder } = require('discord.js');
const { getAllUsers, getAllRatings } = require('../database/db');
const { buildDashboardEmbed }       = require('../utils/embeds');

function computeLeaderboard(users, ratings, streaks = []) {
  const ratingMap = {};
  for (const r of ratings) {
    if (!ratingMap[r.discord_id]) ratingMap[r.discord_id] = {};
    ratingMap[r.discord_id][r.platform] = r;
  }

  const streakMap = {};
  for (const s of streaks) {
    if (s.platform === 'cf') {
      streakMap[s.discord_id] = s.current_streak;
    }
  }

  const rows = users
    .filter(u => u.cf_handle || u.ac_handle)
    .map(u => {
      const cfR = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.rating ?? 0) : 0;
      const cfS = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.solved ?? 0) : 0;
      const acR = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.rating ?? 0) : 0;
      const acS = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.solved ?? 0) : 0;
      const cfStreak = u.cf_handle ? (streakMap[u.discord_id] ?? 0) : 0;

      return {
        discord_id: u.discord_id,
        username:   u.username ?? 'Unknown',
        cf_rating:  cfR,
        cf_solved:  cfS,
        cf_linked:  !!u.cf_handle,
        ac_rating:  acR,
        ac_solved:  acS,
        ac_linked:  !!u.ac_handle,
        cf_streak:  cfStreak,
        highest:    Math.max(cfR, acR)
      };
    })
    .sort((a, b) => {
      // 1. Total Rating (CF Rating + AtCoder Rating)
      const aTotalRating = a.cf_rating + a.ac_rating;
      const bTotalRating = b.cf_rating + b.ac_rating;
      if (aTotalRating !== bTotalRating) {
        return bTotalRating - aTotalRating;
      }
      // 2. CF Solve Total
      if (a.cf_solved !== b.cf_solved) {
        return b.cf_solved - a.cf_solved;
      }
      // 3. AC Solve Total
      if (a.ac_solved !== b.ac_solved) {
        return b.ac_solved - a.ac_solved;
      }
      // 4. CF Streak
      return b.cf_streak - a.cf_streak;
    });

  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the server CP leaderboard'),

  async execute(interaction) {
    const users   = getAllUsers();
    const ratings = getAllRatings();
    const { getAllStreaks } = require('../database/db');
    const streaks = getAllStreaks();
    const rows    = computeLeaderboard(users, ratings, streaks);
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis  = await getPlatformEmojis(interaction.guild);
    const embed   = buildDashboardEmbed(rows, streaks, emojis);
    return interaction.reply({ embeds: [embed] });
  },

  computeLeaderboard
};
