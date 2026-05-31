// commands/announce.js — Broadcast an announcement via a Modal
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getConfig }            = require('../database/db');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Broadcast a formatted announcement to the announcement channel with @everyone ping')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone),

  async execute(interaction) {
    // 1. Fetch the announcement channel first to fail early if missing
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

    // 2. Build the Modal
    const modal = new ModalBuilder()
      .setCustomId('announcementModal')
      .setTitle('Broadcast Announcement');

    const messageInput = new TextInputBuilder()
      .setCustomId('announcementMessage')
      .setLabel("Announcement Content")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Paste or type your formatted message here... (Markdown, links, and newlines are fully supported)')
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(actionRow);

    // 3. Show the Modal
    await interaction.showModal(modal);

    // 4. Wait for the submission (timeout: 5 minutes)
    const submitted = await interaction.awaitModalSubmit({
      time: 300000,
      filter: i => i.user.id === interaction.user.id && i.customId === 'announcementModal'
    }).catch(() => null);

    if (!submitted) {
      return; // Timed out or cancelled
    }

    const messageText = submitted.fields.getTextInputValue('announcementMessage');
    const content = `@everyone\n\n${messageText}`;

    try {
      await channel.send({ content });
      return submitted.reply({
        embeds: [successEmbed(
          'Announcement Broadcasted',
          `Successfully posted the announcement to ${channel}! 📢`
        )],
        ephemeral: true
      });
    } catch (err) {
      console.error('[Announce Modal Error]', err);
      return submitted.reply({
        embeds: [errorEmbed(
          'Failed to Send Announcement',
          `An error occurred while sending the message: ${err.message}`
        )],
        ephemeral: true
      });
    }
  }
};
