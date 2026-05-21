const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { postDailySuggestions } = require('../../tasks/dailyChallenge');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force-suggest')
    .setDescription('[Admin] Immediately force a new Daily Suggestions post')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      await postDailySuggestions(interaction.client);
      
      const embed = successEmbed(
        'Forced Suggestions',
        'Successfully generated and posted a new set of Daily Suggestions! The old message has been removed.'
      );
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[ForceSuggest] Error:', err.message);
      return interaction.editReply({ content: '❌ Failed to post daily suggestions.' });
    }
  }
};
