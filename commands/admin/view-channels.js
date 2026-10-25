// commands/admin/view-channels.js — View all configured channels for this server
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getFullGuildConfig } = require('../../database/db');

const CHANNEL_DEFS = [
  { key: 'contest_channel_id', label: '🏆 Contest Radar', desc: 'Upcoming contests overview message' },
  { key: 'dashboard_channel_id', label: '📊 Leaderboard Dashboard', desc: 'Live auto-updating member rankings' },
  { key: 'rating_channel_id', label: '📈 Rating Updates', desc: 'Rating change and tier promotion alerts' },
  { key: 'suggest_channel_id', label: '💡 Daily Challenges', desc: 'Daily algorithmic problem challenges & first blood' },
  { key: 'feed_channel_id', label: '⚡ Live Submissions Feed', desc: 'Accepted solves posted as they happen' },
  { key: 'wrapup_channel_id', label: '🌅 Contest Wrap-up', desc: 'Next-day 9AM round recap & personalized upsolve radar' },
  { key: 'github_channel_id', label: '🐙 GitHub Activity Feed', desc: 'Commits, releases, PRs, and new repos' },
  { key: 'announcement_channel_id', label: '📢 Announcements', desc: 'Channel used by /announce' },
  { key: 'general_channel_id', label: '💬 General Channel', desc: 'General server updates, alerts & auto-wrapup' },
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

    let activeCount = 0;
    const formatChannel = (def) => {
      const channelId = config[def.key];
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
      if (channel) {
        activeCount++;
        return `🟢 ${channel} (\`#${channel.name}\`)\n> *${def.desc}*`;
      } else if (channelId) {
        return `🔴 \`#${channelId}\` *(inaccessible or deleted)*\n> *${def.desc}*`;
      }
      return `⚪ \`Not configured\`\n> *${def.desc}*`;
    };

    const coreFeeds = [
      CHANNEL_DEFS[0], // contest radar
      CHANNEL_DEFS[1], // dashboard
      CHANNEL_DEFS[2], // rating updates
      CHANNEL_DEFS[3], // daily challenges
      CHANNEL_DEFS[4], // live submissions
      CHANNEL_DEFS[5]  // contest wrapup
    ];

    const commAndSys = [
      CHANNEL_DEFS[6], // github
      CHANNEL_DEFS[7], // announcements
      CHANNEL_DEFS[8], // general
      CHANNEL_DEFS[9]  // backups
    ];

    const coreFields = coreFeeds.map(def => `**${def.label}**\n${formatChannel(def)}`).join('\n\n');
    const commFields = commAndSys.map(def => `**${def.label}**\n${formatChannel(def)}`).join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: 'Server Channel Configuration',
        iconURL: interaction.guild.iconURL({ dynamic: true }) || undefined
      })
      .setTitle(`⚙️ Channel Router — ${interaction.guild.name}`)
      .setDescription([
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `> 🏛️ **Server:** **${interaction.guild.name}**`,
        `> 📡 **Active Feeds:** **\`${activeCount}\`** of **\`${CHANNEL_DEFS.length}\`** configured`,
        `> 💡 **Quick Setup:** Run \`/set-channel feature:All Features\` to bind all feeds at once!`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      ].join('\n'))
      .addFields(
        { name: '⚡ Competitive Feeds & Dashboards', value: coreFields, inline: false },
        { name: '📢 Community, Integrations & Systems', value: commFields, inline: false }
      )
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'BigOof Admin Routing Suite · /set-channel to reconfigure' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
