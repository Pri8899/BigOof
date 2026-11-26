// commands/admin/set-channel.js — Unified multi-tenant channel configuration
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig } = require('../../database/db');
const { CHANNEL_DEFS, isBotOwner } = require('../../utils/envHelper');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const FEATURES = [
  { name: '🌐 All Features (One-Click Setup: route everything here)', value: 'all_features', label: 'All Bot Features' },
  ...CHANNEL_DEFS.map(def => ({
    name: `${def.label} (${def.optionDesc})`,
    value: def.key,
    label: def.shortLabel
  })),
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
      for (const def of CHANNEL_DEFS) {
        setConfig(def.key, channel.id, guildId);
      }
      setConfig('dashboard_message_id', '', guildId);
      setConfig('contest_summary_msg_id', '', guildId);

      const { ensureTodayStudyFormForGuild } = require('../../tasks/studyTodo');
      ensureTodayStudyFormForGuild(interaction.client, guildId).catch(() => {});

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
    if (featureKey === 'study_channel_id') {
      const { ensureTodayStudyFormForGuild } = require('../../tasks/studyTodo');
      ensureTodayStudyFormForGuild(interaction.client, guildId).catch(() => {});
    }

    return interaction.reply({
      embeds: [successEmbed(
        'Channel Configured',
        `**${featureLabel}** will now post to ${channel}.\n\nUse \`/view-channels\` anytime to inspect your server's routing.${permWarning}`
      )],
      flags: 64
    });
  }
};
