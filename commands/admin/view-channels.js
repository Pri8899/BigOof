// commands/admin/view-channels.js — View all configured channels for this server
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getFullGuildConfig } = require('../../database/db');

const CHANNEL_DEFS = [
  { key: 'contest_channel_id', label: '🏆 Contest Radar', desc: 'Upcoming contests overview message' },
  { key: 'dashboard_channel_id', label: '📊 Leaderboard Dashboard', desc: 'Live auto-updating member rankings' },
  { key: 'rating_channel_id', label: '📈 Rating Updates', desc: 'Rating change and tier promotion alerts' },
  { key: 'suggest_channel_id', label: '💡 Daily Challenges', desc: 'Daily algorithmic problem challenges & first blood' },
  { key: 'feed_channel_id', label: '⚡ Live Submissions Feed', desc: 'Accepted solves posted as they happen' },
  { key: 'github_channel_id', label: '🐙 GitHub Activity Feed', desc: 'Commits, releases, PRs, and new repos' },
  { key: 'announcement_channel_id', label: '📢 Announcements', desc: 'Channel used by /announce' },
  { key: 'general_channel_id', label: '💬 General Channel', desc: 'General server updates and alerts' },
  { key: 'backup_channel_id', label: '💾 Database Backups', desc: 'Bot host automated database snapshot destination' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('view-channels')
    .setDescription('View all currently configured channels for this server (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const config = getFullGuildConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`⚙️ Server Channels — ${interaction.guild.name}`)
      .setDescription('Here are the channels configured for automated feeds and alerts in this server.\nUse `/set-channel` to update any of them.\n\u200b')
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setTimestamp();

    for (const def of CHANNEL_DEFS) {
      const channelId = config[def.key];
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
      const val = channel ? `${channel} (\`#${channel.name}\`)` : (channelId ? `Channel ID: \`${channelId}\` (deleted or inaccessible)` : '`Not configured`');
      embed.addFields({
        name: def.label,
        value: `${val}\n*${def.desc}*`,
        inline: false
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
