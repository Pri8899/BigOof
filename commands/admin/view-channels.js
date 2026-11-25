// commands/admin/view-channels.js — View all configured channels for this server safely
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getFullGuildConfig, getConfig } = require('../../database/db');
const { isBotOwner, chunkLines } = require('../../utils/envHelper');

const CHANNEL_DEFS = [
  { key: 'contest_channel_id', label: '🏆 Contest Radar', desc: 'Upcoming contests & reminders' },
  { key: 'dashboard_channel_id', label: '📊 Leaderboard Dashboard', desc: 'Live auto-updating member rankings' },
  { key: 'rating_channel_id', label: '📈 Rating Updates', desc: 'Rating change & tier promotion alerts' },
  { key: 'suggest_channel_id', label: '💡 Daily Challenges', desc: 'Daily algorithmic challenges' },
  { key: 'feed_channel_id', label: '⚡ Live Submissions Feed', desc: 'Accepted solves posted as they happen' },
  { key: 'wrapup_channel_id', label: '🌅 Contest Wrap-up', desc: 'Next-day 9AM recap & upsolve radar' },
  { key: 'github_channel_id', label: '🐙 GitHub Activity Feed', desc: 'Commits, releases, PRs, and new repos' },
  { key: 'announcement_channel_id', label: '📢 Announcements', desc: 'Channel used by /announce' },
  { key: 'general_channel_id', label: '💬 General Channel', desc: 'Submissions, weekly digest, first blood & sweep alerts' }
];

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('view-channels')
    .setDescription('View all currently configured channels for this server (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId;
    const config = getFullGuildConfig(guildId);

    let activeCount = 0;
    const formatChannel = async (channelId, desc) => {
      const channel = channelId
        ? (interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null))
        : null;
      if (channel) {
        activeCount++;
        return `🟢 ${channel} (\`#${channel.name}\`)\n> *${desc}*`;
      }
      if (channelId) {
        return `🔴 \`#${channelId}\` *(inaccessible or deleted)*\n> *${desc}*`;
      }
      return `⚪ \`Not configured\`\n> *${desc}*`;
    };

    const defsToRender = [...CHANNEL_DEFS];
    const ownerViewing = isBotOwner(interaction);
    const totalCount = ownerViewing ? defsToRender.length + 1 : defsToRender.length;

    const coreLines = [];
    for (const def of defsToRender.slice(0, 6)) {
      coreLines.push(`**${def.label}**\n${await formatChannel(config[def.key], def.desc)}`);
    }

    const commLines = [];
    for (const def of defsToRender.slice(6)) {
      commLines.push(`**${def.label}**\n${await formatChannel(config[def.key], def.desc)}`);
    }

    if (ownerViewing) {
      const backupId = getConfig('backup_channel_id', 'global');
      const status = backupId ? `🟢 Configured (\`<#${backupId}>\`)` : '⚪ `Not configured`';
      commLines.push(`**💾 Database Backups (Host Only)**\n${status}\n> *Automated hourly SQLite snapshot archive*`);
      if (backupId) activeCount++;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: 'Server Channel Configuration',
        iconURL: interaction.guild.iconURL({ dynamic: true }) || undefined
      })
      .setTitle(`⚙️ Channel Router — ${interaction.guild.name}`)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 🏛️ **Server:** **${interaction.guild.name}**`,
        `> 📡 **Active Feeds:** **\`${activeCount}\`** of **\`${totalCount}\`** configured`,
        '> 💡 **Quick Setup:** Run `/set-channel feature:All Features` to bind all feeds at once!',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'))
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'BigOof Admin Routing Suite · /set-channel to reconfigure' })
      .setTimestamp();

    chunkLines(coreLines, 1000, '\n\n').forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? '⚡ Competitive Feeds & Dashboards' : '⚡ Feeds (cont.)', value: chunk, inline: false });
    });
    chunkLines(commLines, 1000, '\n\n').forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? '📢 Community & Systems' : '📢 Systems (cont.)', value: chunk, inline: false });
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
