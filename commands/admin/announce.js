// commands/admin/announce.js — Broadcast an announcement via a Modal
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getConfig }            = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Broadcast a formatted announcement with @everyone ping (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post in (leave empty to use configured announcement channel or this channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  async execute(interaction) {
    // 1. Resolve target channel
    let targetChannel = interaction.options.getChannel('channel');

    if (!targetChannel) {
      const channelId = getConfig('announcement_channel_id', interaction.guildId);
      if (channelId) {
        targetChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      }
    }

    if (!targetChannel) {
      targetChannel = interaction.channel;
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

    await submitted.deferReply({ flags: 64 });

    const messageContent = submitted.fields.getTextInputValue('announcementMessage').trim();

    try {
      // 5. Send message with @everyone to target channel
      await targetChannel.send({
        content: `@everyone\n\n${messageContent}`
      });

      await submitted.editReply({
        embeds: [successEmbed(
          'Announcement Sent!',
          `Your announcement has been broadcast to ${targetChannel} with an \`@everyone\` mention! 🎉`
        )]
      });
    } catch (err) {
      console.error('[announce] Failed to send message:', err.message);
      await submitted.editReply({
        embeds: [errorEmbed(
          'Failed to Send',
          `Could not send announcement to ${targetChannel}.\nPlease ensure the bot has **Send Messages** and **Mention Everyone** permissions in that channel.`
        )]
      });
    }
  }
};
