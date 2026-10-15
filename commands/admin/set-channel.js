// commands/admin/set-channel.js — Unified channel configuration for server features
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const FEATURES = [
  { name: '🌐 All Features (One-Click Setup: route everything here)', value: 'all_features', label: 'All Bot Features' },
  { name: '🏆 Contest Radar (Upcoming contests overview)', value: 'contest_channel_id', label: 'Contest Radar' },
  { name: '📊 Leaderboard Dashboard (Auto-updating rankings)', value: 'dashboard_channel_id', label: 'Leaderboard Dashboard' },
  { name: '📈 Rating Updates (Rating change & rank up alerts)', value: 'rating_channel_id', label: 'Rating Updates' },
  { name: '💡 Daily Challenges (Daily problem suggestions & first blood)', value: 'suggest_channel_id', label: 'Daily Challenges' },
  { name: '⚡ Live Submissions Feed (Real-time accepted solves)', value: 'feed_channel_id', label: 'Live Submissions Feed' },
  { name: '🐙 GitHub Activity Feed (Commits, PRs, and repositories)', value: 'github_channel_id', label: 'GitHub Activity Feed' },
  { name: '📢 Announcements (Broadcast channel for /announce)', value: 'announcement_channel_id', label: 'Announcements' },
  { name: '💬 General Channel (General alerts & first blood broadcasts)', value: 'general_channel_id', label: 'General Channel' },
  { name: '💾 Database Backups (Bot Host only)', value: 'backup_channel_id', label: 'Database Backups' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-channel')
    .setDescription('Configure which channels receive specific bot feeds and alerts (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('feature')
        .setDescription('The feature/feed to configure')
        .setRequired(true)
        .addChoices(
          ...FEATURES.map(f => ({ name: f.name, value: f.value }))
        )
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The text channel to use for this feature')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  async execute(interaction) {
    const featureKey = interaction.options.getString('feature');
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    // Restrict backup channel to bot owner
    if (featureKey === 'backup_channel_id') {
      const isOwner = interaction.user.id === process.env.OWNER_ID ||
        (interaction.client.application && interaction.client.application.owner &&
         (interaction.client.application.owner.id === interaction.user.id ||
          (interaction.client.application.owner.members && interaction.client.application.owner.members.has(interaction.user.id))));

      if (!isOwner) {
        return interaction.reply({
          embeds: [errorEmbed('Permission Denied', 'Configuring the database backup channel is restricted to the Bot Owner.')],
          ephemeral: true
        });
      }
      // Also save backup channel to global config
      setConfig('backup_channel_id', channel.id, 'global');
    }

    if (featureKey === 'all_features') {
      const keys = [
        'contest_channel_id',
        'dashboard_channel_id',
        'rating_channel_id',
        'suggest_channel_id',
        'feed_channel_id',
        'github_channel_id',
        'announcement_channel_id',
        'general_channel_id'
      ];
      for (const k of keys) {
        setConfig(k, channel.id, guildId);
      }
      setConfig('dashboard_message_id', '', guildId);
      setConfig('contest_summary_msg_id', '', guildId);

      return interaction.reply({
        embeds: [successEmbed(
          'All Features Configured',
          `🎉 **All bot feeds and alerts** will now post to ${channel}!\n\n*(You can still override individual features to different channels at any time).*`
        )],
        ephemeral: true
      });
    }

    const featureObj = FEATURES.find(f => f.value === featureKey);
    const featureLabel = featureObj ? featureObj.label : featureKey;

    // Save to multi-tenant guild config
    setConfig(featureKey, channel.id, guildId);

    // If setting dashboard, reset cached message ID so a fresh dashboard is posted
    if (featureKey === 'dashboard_channel_id') {
      setConfig('dashboard_message_id', '', guildId);
    }
    // If setting contest radar, reset cached message ID
    if (featureKey === 'contest_channel_id') {
      setConfig('contest_summary_msg_id', '', guildId);
    }

    return interaction.reply({
      embeds: [successEmbed(
        'Channel Configured',
        `**${featureLabel}** will now post to ${channel}.\n\nUse \`/view-channels\` anytime to inspect your server's configuration.`
      )],
      ephemeral: true
    });
  }
};
