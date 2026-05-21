// commands/admin/refresh-dashboard.js — Force-refresh the leaderboard dashboard
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { syncAllRatings, updateDashboard } = require('../../tasks/ratingSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh-dashboard')
    .setDescription('Force sync ratings & refresh the CP leaderboard dashboard now (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      await syncAllRatings(interaction.client);
      await updateDashboard(interaction.client);
      return interaction.editReply({
        embeds: [successEmbed('Dashboard Refreshed', 'The CP leaderboard has been updated! ✅')]
      });
    } catch (err) {
      console.error('[refresh-dashboard]', err);
      return interaction.editReply({
        embeds: [errorEmbed('Refresh Failed', `Could not update the dashboard: ${err.message}`)]
      });
    }
  }
};
