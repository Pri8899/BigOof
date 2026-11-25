// commands/leaderboard.js — Server CP leaderboard (CF-primary with AC/Toph fallback ranking)
const { SlashCommandBuilder } = require('discord.js');
const { getAllUsers, getAllRatings, getAllStreaks } = require('../database/db');
const { buildDashboardEmbed } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

function computeLeaderboard(users, ratings, streaks = []) {
  const ratingMap = {};
  for (const r of ratings) {
    if (!ratingMap[r.discord_id]) ratingMap[r.discord_id] = {};
    ratingMap[r.discord_id][r.platform] = r;
  }

  const streakMap = {};
  for (const s of streaks) {
    if (!streakMap[s.discord_id]) streakMap[s.discord_id] = {};
    streakMap[s.discord_id][s.platform] = s.current_streak;
  }

  return users
    .filter(u => u.cf_handle || u.ac_handle || u.toph_handle)
    .map(u => {
      const cfR = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.rating ?? 0) : 0;
      const cfS = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.solved ?? 0) : 0;
      const cfRank = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.rank_title ?? 'Unrated') : null;

      const acR = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.rating ?? 0) : 0;
      const acS = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.solved ?? 0) : 0;
      const acRank = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.rank_title ?? 'Unrated') : null;

      const tophR = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.rating ?? 0) : 0;
      const tophS = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.solved ?? 0) : 0;
      const tophRank = u.toph_handle ? (ratingMap[u.discord_id]?.toph?.rank_title ?? 'Unrated') : null;

      const cfStreak = u.cf_handle ? (streakMap[u.discord_id]?.cf ?? 0) : 0;
      const acStreak = u.ac_handle ? (streakMap[u.discord_id]?.ac ?? 0) : 0;
      const tophStreak = u.toph_handle ? (streakMap[u.discord_id]?.toph ?? 0) : 0;

      return {
        discord_id: u.discord_id,
        username: u.username ?? 'Unknown',
        cf_handle: u.cf_handle,
        ac_handle: u.ac_handle,
        toph_handle: u.toph_handle,
        cf_rating: cfR,
        cf_solved: cfS,
        cf_rank: cfRank,
        cf_linked: Boolean(u.cf_handle),
        ac_rating: acR,
        ac_solved: acS,
        ac_rank: acRank,
        ac_linked: Boolean(u.ac_handle),
        toph_rating: tophR,
        toph_solved: tophS,
        toph_rank: tophRank,
        toph_linked: Boolean(u.toph_handle),
        cf_streak: cfStreak,
        ac_streak: acStreak,
        toph_streak: tophStreak,
        total_solved: cfS + acS + tophS,
        highest: Math.max(cfR, acR, tophR)
      };
    })
    .sort((a, b) => {
      if (a.cf_rating !== b.cf_rating) return b.cf_rating - a.cf_rating;
      if (a.highest !== b.highest) return b.highest - a.highest;
      if (a.total_solved !== b.total_solved) return b.total_solved - a.total_solved;
      return Math.max(b.cf_streak, b.ac_streak, b.toph_streak) - Math.max(a.cf_streak, a.ac_streak, a.toph_streak);
    });
}

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the server CP leaderboard'),

  async execute(interaction) {
    await interaction.deferReply();

    const fetched = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
    const memberIds = new Set(fetched.keys());

    const serverUsers = getAllUsers().filter(u => memberIds.has(u.discord_id));
    const ratings = getAllRatings();
    const streaks = getAllStreaks();
    const rows = computeLeaderboard(serverUsers, ratings, streaks);
    const emojis = await getPlatformEmojis(interaction.guild);

    const embed = buildDashboardEmbed(rows, streaks, emojis);
    return interaction.editReply({ embeds: [embed] });
  },

  computeLeaderboard
};
