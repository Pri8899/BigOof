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

  // Build streak map per user per platform
  const streakMap = {};
  for (const s of streaks) {
    if (!streakMap[s.discord_id]) streakMap[s.discord_id] = {};
    streakMap[s.discord_id][s.platform] = s.current_streak;
  }

  const rows = users
    .filter(u => u.cf_handle || u.ac_handle || u.toph_handle)
    .map(u => {
      const cfR = u.cf_handle   ? (ratingMap[u.discord_id]?.cf?.rating   ?? 0) : 0;
      const cfS = u.cf_handle   ? (ratingMap[u.discord_id]?.cf?.solved   ?? 0) : 0;
      const cfRank = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.rank_title ?? 'Unrated') : null;
      const acR = u.ac_handle   ? (ratingMap[u.discord_id]?.ac?.rating   ?? 0) : 0;
      const acS = u.ac_handle   ? (ratingMap[u.discord_id]?.ac?.solved   ?? 0) : 0;
      const acRank = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.rank_title ?? 'Unrated') : null;
      const tophR = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.rating  ?? 0) : 0;
      const tophS = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.solved  ?? 0) : 0;
      const tophRank = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.rank_title ?? 'Unrated') : null;

      const cfStreak   = u.cf_handle   ? (streakMap[u.discord_id]?.cf   ?? 0) : 0;
      const acStreak   = u.ac_handle   ? (streakMap[u.discord_id]?.ac   ?? 0) : 0;
      const tophStreak = u.toph_handle ? (streakMap[u.discord_id]?.toph ?? 0) : 0;

      return {
        discord_id:  u.discord_id,
        username:    u.username ?? 'Unknown',
        cf_handle:   u.cf_handle,
        ac_handle:   u.ac_handle,
        toph_handle: u.toph_handle,
        cf_rating:   cfR,
        cf_solved:   cfS,
        cf_rank:     cfRank,
        cf_linked:   !!u.cf_handle,
        ac_rating:   acR,
        ac_solved:   acS,
        ac_rank:     acRank,
        ac_linked:   !!u.ac_handle,
        toph_rating: tophR,
        toph_solved: tophS,
        toph_rank:   tophRank,
        toph_linked: !!u.toph_handle,
        cf_streak:   cfStreak,
        ac_streak:   acStreak,
        toph_streak: tophStreak,
        highest:     Math.max(cfR, acR, tophR)
      };
    })
    .sort((a, b) => {
      const aTotalRating = a.cf_rating + a.ac_rating + a.toph_rating;
      const bTotalRating = b.cf_rating + b.ac_rating + b.toph_rating;
      if (aTotalRating !== bTotalRating) return bTotalRating - aTotalRating;
      const aTotalSolved = a.cf_solved + a.ac_solved + a.toph_solved;
      const bTotalSolved = b.cf_solved + b.ac_solved + b.toph_solved;
      if (aTotalSolved !== bTotalSolved) return bTotalSolved - aTotalSolved;
      return Math.max(b.cf_streak, b.ac_streak, b.toph_streak) - Math.max(a.cf_streak, a.ac_streak, a.toph_streak);
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
