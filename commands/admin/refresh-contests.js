// commands/admin/refresh-contests.js — Force-refresh upcoming contests and overview
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { performContestRefresh } = require('../../tasks/contestFetcher');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh-contests')
    .setDescription('Force fetch contests & refresh the CP contest overview now (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      console.log('[refresh-contests] Manual contest refresh requested by', interaction.user.tag);
      await performContestRefresh(interaction.client);
      return interaction.editReply({
        embeds: [successEmbed('Contests Refreshed', 'Upcoming contests have been successfully updated and posted! ✅')]
      });
    } catch (err) {
      console.error('[refresh-contests] Error:', err);
      return interaction.editReply({
        embeds: [errorEmbed('Refresh Failed', `Could not update upcoming contests: ${err.message}`)]
      });
    }
  }
};
