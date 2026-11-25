// commands/admin/announce.js — Broadcast a formatted announcement with permission checks
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require('discord.js');
const { getConfig } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Broadcast a formatted announcement with @everyone ping (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post in (defaults to configured announcement channel or current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  async execute(interaction) {
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

    const me = interaction.guild.members.me;
    const perms = me && targetChannel?.permissionsFor(me);
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        embeds: [errorEmbed(
          'Missing Channel Permissions',
          `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${targetChannel || 'that channel'}.`
        )],
        flags: 64
      });
    }

    const modalId = `announcementModal_${interaction.id}`;
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('Broadcast Announcement');

    const messageInput = new TextInputBuilder()
      .setCustomId('announcementMessage')
      .setLabel('Announcement Content')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(3900)
      .setPlaceholder('Paste or type your formatted message here... (Markdown & links supported)')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
      time: 300000,
      filter: i => i.user.id === interaction.user.id && i.customId === modalId
    }).catch(() => null);

    if (!submitted) return;
    await submitted.deferReply({ flags: 64 });

    const messageContent = submitted.fields.getTextInputValue('announcementMessage').trim();

    try {
      const announcementEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
          name: `${interaction.guild.name} · Official Announcement`,
          iconURL: interaction.guild.iconURL({ dynamic: true }) || interaction.client.user.displayAvatarURL()
        })
        .setTitle('📢 Community Announcement')
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `${messageContent}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setFooter({
          text: `Broadcast by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp();

      const canPingEveryone = perms.has(PermissionFlagsBits.MentionEveryone);
      await targetChannel.send({
        content: canPingEveryone ? '@everyone' : undefined,
        embeds: [announcementEmbed]
      });

      return submitted.editReply({
        embeds: [successEmbed(
          'Announcement Sent!',
          `Your announcement has been broadcast to ${targetChannel}${canPingEveryone ? ' with an `@everyone` mention' : ' (without `@everyone` — bot lacks Mention Everyone permission)'}! 🎉`
        )]
      });
    } catch (err) {
      console.error('[announce] Failed to send message:', err.message);
      return submitted.editReply({
        embeds: [errorEmbed(
          'Failed to Send',
          `Could not send announcement to ${targetChannel}: ${err.message}`
        )]
      });
    }
  }
};
