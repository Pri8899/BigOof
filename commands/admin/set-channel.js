// commands/admin/set-channel.js — Unified multi-tenant channel configuration
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig } = require('../../database/db');
const { isBotOwner } = require('../../utils/envHelper');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const FEATURES = [
  { name: '🌐 All Features (One-Click Setup: route everything here)', value: 'all_features', label: 'All Bot Features' },
  { name: '🏆 Contest Radar (Upcoming contests & reminders)', value: 'contest_channel_id', label: 'Contest Radar' },
  { name: '📊 Leaderboard Dashboard (Auto-updating rankings)', value: 'dashboard_channel_id', label: 'Leaderboard Dashboard' },
  { name: '📈 Rating Updates (Rating change & rank alerts)', value: 'rating_channel_id', label: 'Rating Updates' },
  { name: '💡 Daily Challenges (Daily problem suggestions)', value: 'suggest_channel_id', label: 'Daily Challenges' },
  { name: '⚡ Live Submissions Feed (Real-time accepted solves)', value: 'feed_channel_id', label: 'Live Submissions Feed' },
  { name: '🌅 Contest Wrap-up (Next-day 9AM contest recap & upsolve)', value: 'wrapup_channel_id', label: 'Contest Wrap-up' },
  { name: '🐙 GitHub Activity Feed (Commits, PRs, and repositories)', value: 'github_channel_id', label: 'GitHub Activity Feed' },
  { name: '📢 Announcements (Broadcast channel for /announce)', value: 'announcement_channel_id', label: 'Announcements' },
  { name: '💬 General Channel (General chat, first blood & sweep alerts)', value: 'general_channel_id', label: 'General Channel' },
  { name: '💾 Database Backups (Bot Host only)', value: 'backup_channel_id', label: 'Database Backups' }
];

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-channel')
    .setDescription('Configure which channels receive specific bot feeds and alerts (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('feature')
        .setDescription('The feature/feed to configure')
        .setRequired(true)
        .addChoices(...FEATURES.map(f => ({ name: f.name, value: f.value })))
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

    const me = interaction.guild.members.me;
    const perms = me && channel.permissionsFor(me);
    const permWarning = (!perms || !perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks))
      ? '\n\n⚠️ *Warning: I am currently missing View Channel, Send Messages, or Embed Links permissions in that channel.*'
      : '';

    if (featureKey === 'backup_channel_id') {
      if (!isBotOwner(interaction)) {
        return interaction.reply({
          embeds: [errorEmbed('Permission Denied', 'Configuring the database backup channel is restricted to the Bot Owner.')],
          flags: 64
        });
      }

      setConfig('backup_channel_id', channel.id, 'global');
      return interaction.reply({
        embeds: [successEmbed(
          'Backup Channel Configured',
          `**Database Backups** will now be archived to ${channel} (Global Host Setting).${permWarning}`
        )],
        flags: 64
      });
    }

    if (featureKey === 'all_features') {
      const keys = [
        'contest_channel_id',
        'dashboard_channel_id',
        'rating_channel_id',
        'suggest_channel_id',
        'feed_channel_id',
        'wrapup_channel_id',
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
          `🎉 **All server feeds and alerts** will now post to ${channel}!\n\n*(You can still override individual features anytime).*${permWarning}`
        )],
        flags: 64
      });
    }

    const featureObj = FEATURES.find(f => f.value === featureKey);
    const featureLabel = featureObj ? featureObj.label : featureKey;

    setConfig(featureKey, channel.id, guildId);
    if (featureKey === 'dashboard_channel_id') setConfig('dashboard_message_id', '', guildId);
    if (featureKey === 'contest_channel_id') setConfig('contest_summary_msg_id', '', guildId);

    return interaction.reply({
      embeds: [successEmbed(
        'Channel Configured',
        `**${featureLabel}** will now post to ${channel}.\n\nUse \`/view-channels\` anytime to inspect your server's routing.${permWarning}`
      )],
      flags: 64
    });
  }
};
