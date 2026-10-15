// commands/admin/force-unlink.js — Admin command to unlink a member's accounts
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getUser, unlinkPlatform, purgeUser } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { updateDashboard } = require('../../tasks/ratingSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force-unlink')
    .setDescription('Force unlink a member\'s competitive programming or GitHub accounts (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('The member whose account to unlink')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Platform to unlink (default: all)')
        .setRequired(false)
        .addChoices(
          { name: '🌐 All Platforms (Purge)', value: 'all' },
          { name: '🏆 Codeforces', value: 'cf' },
          { name: '🎯 AtCoder', value: 'ac' },
          { name: '⚡ Toph', value: 'toph' },
          { name: '🐙 GitHub', value: 'github' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser('member');
    const platform = interaction.options.getString('platform') || 'all';
    const dbUser = getUser(targetUser.id);

    if (!dbUser) {
      return interaction.editReply({
        embeds: [errorEmbed('User Not Found', `**${targetUser.username}** does not have any linked accounts in the bot database.`)]
      });
    }

    if (platform === 'all') {
      const linked = [];
      if (dbUser.cf_handle) linked.push(`Codeforces: \`${dbUser.cf_handle}\``);
      if (dbUser.ac_handle) linked.push(`AtCoder: \`${dbUser.ac_handle}\``);
      if (dbUser.toph_handle) linked.push(`Toph: \`${dbUser.toph_handle}\``);
      if (dbUser.github_handle) linked.push(`GitHub: \`${dbUser.github_handle}\``);

      purgeUser(targetUser.id);
      updateDashboard(interaction.client, interaction.guildId).catch(() => {});

      return interaction.editReply({
        embeds: [successEmbed(
          'Member Unlinked',
          `Successfully unlinked and purged all accounts for **${targetUser.username}**.\n\n` +
          `**Removed Handles:**\n${linked.length > 0 ? linked.join('\n') : 'None'}`
        )]
      });
    } else {
      const platKey = `${platform}_handle`;
      if (!dbUser[platKey]) {
        return interaction.editReply({
          embeds: [errorEmbed('Not Linked', `**${targetUser.username}** does not have a \`${platform}\` account linked.`)]
        });
      }

      const handle = dbUser[platKey];
      unlinkPlatform(targetUser.id, platform);
      updateDashboard(interaction.client, interaction.guildId).catch(() => {});

      return interaction.editReply({
        embeds: [successEmbed(
          'Account Unlinked',
          `Successfully unlinked \`${platform.toUpperCase()}\` handle (\`${handle}\`) for **${targetUser.username}**.`
        )]
      });
    }
  }
};
