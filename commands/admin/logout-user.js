// commands/admin/logout-user.js — Force logout and purge all linked accounts of a user
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getUser, purgeUser } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { updateDashboard } = require('../../tasks/ratingSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logout-user')
    .setDescription('[Admin] Force logout and unlink all accounts for a server member')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('The member to log out and unlink')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser('member');
    const dbUser = getUser(targetUser.id);

    if (!dbUser) {
      return interaction.editReply({
        embeds: [errorEmbed('User Not Found', `**${targetUser.username}** does not have any linked accounts or data in this server.`)]
      });
    }

    const linked = [];
    if (dbUser.cf_handle) linked.push(`Codeforces: \`${dbUser.cf_handle}\``);
    if (dbUser.ac_handle) linked.push(`AtCoder: \`${dbUser.ac_handle}\``);
    if (dbUser.toph_handle) linked.push(`Toph: \`${dbUser.toph_handle}\``);
    if (dbUser.github_handle) linked.push(`GitHub: \`${dbUser.github_handle}\``);
    if (dbUser.lc_handle) linked.push(`LeetCode: \`${dbUser.lc_handle}\``);

    const linkedStr = linked.length > 0 ? linked.join('\n') : 'No handles linked';

    purgeUser(targetUser.id);

    updateDashboard(interaction.client).catch(err =>
      console.error('[logout-user] Dashboard update error:', err.message)
    );

    return interaction.editReply({
      embeds: [successEmbed(
        'User Logged Out & Purged',
        `Successfully logged out **${targetUser.username}** and removed all their data from the server.\n\n` +
        `**Unlinked Accounts:**\n${linkedStr}`
      )]
    });
  }
};
