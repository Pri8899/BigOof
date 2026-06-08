// commands/update.js — Manually trigger rating, solved count, and streak sync for a member
const { SlashCommandBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const { syncSingleUser, updateDashboard } = require('../tasks/ratingSync');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Manually sync your competitive programming handles and update the dashboard')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to update (leave blank for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ flags: 64 }); // Ephemeral reply

    const target = interaction.options.getMember('member') ?? interaction.member;
    const user = getUser(target.id);

    if (!user || (!user.cf_handle && !user.ac_handle)) {
      return interaction.editReply({
        embeds: [errorEmbed(
          'No Linked Accounts',
          `${target} does not have any competitive programming accounts linked.\nUse \`/link\` to connect Codeforces or AtCoder first.`
        )]
      });
    }

    try {
      // Perform the sync
      await syncSingleUser(interaction.client, user);

      // Refresh the dashboard
      await updateDashboard(interaction.client);

      const ratings = getRatings(target.id);
      let cfInfo = 'Not Linked';
      let acInfo = 'Not Linked';

      for (const r of ratings) {
        if (r.platform === 'cf') {
          cfInfo = `Rating: **${r.rating}** (Solved: **${r.solved}**)`;
        } else if (r.platform === 'ac') {
          acInfo = `Rating: **${r.rating}** (Solved: **${r.solved}**)`;
        }
      }

      const { getPlatformEmojis } = require('../utils/emojis');
      const emojis = await getPlatformEmojis(interaction.guild);

      const fields = [];
      if (user.cf_handle) {
        fields.push({ name: `${emojis.cf} Codeforces (\`${user.cf_handle}\`)`, value: cfInfo, inline: true });
      }
      if (user.ac_handle) {
        fields.push({ name: `${emojis.ac} AtCoder (\`${user.ac_handle}\`)`, value: acInfo, inline: true });
      }

      return interaction.editReply({
        embeds: [successEmbed(
          'Profile Synced!',
          `Successfully synced stats for ${target} and updated the server leaderboard! ⚡`
        ).addFields(fields)]
      });
    } catch (err) {
      console.error(`[/update] Command failed for ${target.user.username}:`, err);
      return interaction.editReply({
        embeds: [errorEmbed(
          'Sync Failed',
          `An error occurred while syncing stats for ${target}.\n*Error: ${err.message}*`
        )]
      });
    }
  }
};
