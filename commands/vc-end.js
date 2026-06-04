// commands/vc-end.js — Manually end a running Virtual Contest
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getActiveVCForChannel } = require('../database/db');
const { errorEmbed, successEmbed } = require('../utils/embeds');

// Import concludeVC + the in-memory timer map from vc-start
const vcStart = require('./vc-start');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vc-end')
    .setDescription('End the active Virtual Contest in this channel early'),

  async execute(interaction) {
    await interaction.deferReply();

    const channelId = interaction.channelId;
    const userId    = interaction.user.id;

    // 1. Check if there's an active VC in this channel
    const vc = getActiveVCForChannel(channelId);
    if (!vc) {
      return interaction.editReply({
        embeds: [errorEmbed('No Active Contest', 'There is no virtual contest running in this channel.')]
      });
    }

    // 2. Only the creator or someone with Manage Server can end it
    const isCreator = vc.started_by === userId;
    const isAdmin   = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isCreator && !isAdmin) {
      return interaction.editReply({
        embeds: [errorEmbed('Permission Denied', 'Only the contest creator or a server admin can end the contest.')]
      });
    }

    // 3. Clear the scheduled auto-end timer
    if (vcStart.vcTimers && vcStart.vcTimers.has(vc.id)) {
      clearTimeout(vcStart.vcTimers.get(vc.id));
      vcStart.vcTimers.delete(vc.id);
    }

    // 4. Conclude (grade + post results + mark ended in DB)
    const problems = vc.problems ?? [];
    await vcStart.concludeVC(interaction.client, vc.id, channelId, problems);

    // 5. Confirm to the user
    await interaction.editReply({
      embeds: [successEmbed('Contest Ended', `The virtual contest **${vc.id}** has been ended. Results have been posted above.`)]
    });
  }
};
