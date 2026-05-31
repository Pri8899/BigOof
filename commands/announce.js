// commands/announce.js — Broadcast an announcement with @everyone ping
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig }            = require('../database/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Broadcast an announcement to the announcement channel with @everyone ping')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('The announcement message (supports markdown and newlines)')
        .setRequired(true)),

  async execute(interaction) {
    const messageText = interaction.options.getString('message');

    let channelId = getConfig('announcement_channel_id');
    let channel = null;

    if (channelId) {
      channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    }

    if (!channel) {
      // Fallback: search for a text channel containing 'announcement' or '📢' in its name
      channel = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        (c.name.toLowerCase().includes('announcement') || c.name.includes('📢'))
      );
    }

    if (!channel) {
      return interaction.reply({
        embeds: [errorEmbed(
          'Announcement Channel Not Found',
          'Please set the announcement channel first using `/set-announcement-channel` or name a channel `#announcements`.'
        )],
        ephemeral: true
      });
    }

    // Post the announcement with @everyone ping
    const content = `@everyone\n\n${messageText}`;
    
    try {
      await channel.send({ content });
      return interaction.reply({
        embeds: [successEmbed(
          'Announcement Broadcasted',
          `Successfully posted the announcement to ${channel}! 📢`
        )],
        ephemeral: true
      });
    } catch (err) {
      console.error('[Announce Command Error]', err);
      return interaction.reply({
        embeds: [errorEmbed(
          'Failed to Send Announcement',
          `An error occurred while sending the message: ${err.message}`
        )],
        ephemeral: true
      });
    }
  }
};
