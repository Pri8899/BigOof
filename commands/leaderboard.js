// commands/leaderboard.js — Show server leaderboard
const { SlashCommandBuilder } = require('discord.js');
const { getAllUsers, getAllRatings } = require('../database/db');
const { buildDashboardEmbed }       = require('../utils/embeds');

function computeLeaderboard(users, ratings) {
  const ratingMap = {};
  for (const r of ratings) {
    if (!ratingMap[r.discord_id]) ratingMap[r.discord_id] = {};
    ratingMap[r.discord_id][r.platform] = r;
  }

  const rows = users
    .filter(u => u.cf_handle || u.ac_handle)
    .map(u => {
      const cfR = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.rating ?? 0) : 0;
      const cfS = u.cf_handle ? (ratingMap[u.discord_id]?.cf?.solved ?? 0) : 0;
      const acR = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.rating ?? 0) : 0;
      const acS = u.ac_handle ? (ratingMap[u.discord_id]?.ac?.solved ?? 0) : 0;

      return {
        discord_id: u.discord_id,
        username:   u.username ?? 'Unknown',
        cf_rating:  cfR,
        cf_solved:  cfS,
        cf_linked:  !!u.cf_handle,
        ac_rating:  acR,
        ac_solved:  acS,
        ac_linked:  !!u.ac_handle,
        highest:    Math.max(cfR, acR)
      };
    })
    .sort((a, b) => b.highest - a.highest);

  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the server CP leaderboard'),

  async execute(interaction) {
    const users   = getAllUsers();
    const ratings = getAllRatings();
    const rows    = computeLeaderboard(users, ratings);
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis  = await getPlatformEmojis(interaction.guild);
    const embed   = buildDashboardEmbed(rows, [], emojis);
    return interaction.reply({ embeds: [embed] });
  },

  computeLeaderboard
};
