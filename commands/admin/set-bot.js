// commands/admin/set-bot.js — Configure bot profile (avatar and username)
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-bot')
    .setDescription('Update bot profile avatar or username (Bot Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('avatar')
        .setDescription('Update the bot avatar icon')
        .addAttachmentOption(opt =>
          opt.setName('image')
            .setDescription('Upload a new avatar image (PNG/JPG)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('URL of the new avatar image')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('username')
        .setDescription('Update the bot username on Discord')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('New bot username')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const isOwner = interaction.user.id === process.env.OWNER_ID ||
      (interaction.client.application && interaction.client.application.owner &&
       (interaction.client.application.owner.id === interaction.user.id ||
        (interaction.client.application.owner.members && interaction.client.application.owner.members.has(interaction.user.id))));

    if (!isOwner) {
      return interaction.editReply({
        embeds: [errorEmbed('Permission Denied', 'Managing the bot profile and avatar is restricted to the Bot Owner.')]
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'avatar') {
      const attachment = interaction.options.getAttachment('image');
      const url = interaction.options.getString('url');

      let imageBuffer = null;

      try {
        if (attachment) {
          const res = await axios.get(attachment.url, { responseType: 'arraybuffer', timeout: 15000 });
          imageBuffer = Buffer.from(res.data);
        } else if (url) {
          const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
          imageBuffer = Buffer.from(res.data);
        } else {
          // Default to bundled official assets/bot-avatar.png
          const defaultPath = path.join(__dirname, '../../assets/bot-avatar.png');
          if (fs.existsSync(defaultPath)) {
            imageBuffer = fs.readFileSync(defaultPath);
          } else {
            return interaction.editReply({
              embeds: [errorEmbed('No Image Provided', 'Please attach an image or provide a valid image URL.')]
            });
          }
        }

        await interaction.client.user.setAvatar(imageBuffer);

        return interaction.editReply({
          embeds: [successEmbed(
            'Bot Avatar Updated! 🎨',
            'The bot avatar has been successfully updated on Discord.\n\n*Note: Discord strictly limits avatar updates to 2 per 10 minutes.*'
          )]
        });
      } catch (err) {
        console.error('[set-bot] Avatar error:', err.message);
        return interaction.editReply({
          embeds: [errorEmbed('Avatar Update Failed', `Discord returned an error: ${err.message}`)]
        });
      }
    }

    if (subcommand === 'username') {
      const newName = interaction.options.getString('name').trim();
      try {
        await interaction.client.user.setUsername(newName);
        return interaction.editReply({
          embeds: [successEmbed(
            'Bot Username Updated! 🏷️',
            `The bot username has been changed to **${newName}**.`
          )]
        });
      } catch (err) {
        console.error('[set-bot] Username error:', err.message);
        return interaction.editReply({
          embeds: [errorEmbed('Username Update Failed', `Discord returned an error: ${err.message}`)]
        });
      }
    }
  }
};
