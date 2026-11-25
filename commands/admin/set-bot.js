// commands/admin/set-bot.js — Configure bot avatar and username (Bot Owner only)
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { isBotOwner } = require('../../utils/envHelper');
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
            .setDescription('HTTPS URL of the new avatar image')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('username')
        .setDescription('Update the bot username on Discord')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('New bot username (2–32 characters)')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(32)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    if (!isBotOwner(interaction)) {
      return interaction.editReply({
        embeds: [errorEmbed('Permission Denied', 'Managing the bot profile and avatar is restricted to the Bot Owner.')]
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'avatar') {
      const attachment = interaction.options.getAttachment('image');
      const url = interaction.options.getString('url')?.trim();
      let imageBuffer = null;

      try {
        if (attachment) {
          const res = await axios.get(attachment.url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            maxContentLength: 8 * 1024 * 1024
          });
          imageBuffer = Buffer.from(res.data);
        } else if (url) {
          if (!/^https?:\/\//i.test(url)) {
            return interaction.editReply({
              embeds: [errorEmbed('Invalid URL', 'Avatar URL must start with `https://` or `http://`.')]
            });
          }
          const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            maxContentLength: 8 * 1024 * 1024
          });
          imageBuffer = Buffer.from(res.data);
        } else {
          const defaultPath = path.join(__dirname, '../../assets/bot-avatar.png');
          if (!fs.existsSync(defaultPath)) {
            return interaction.editReply({
              embeds: [errorEmbed('No Image Provided', 'Please attach an image or provide an image URL.')]
            });
          }
          imageBuffer = fs.readFileSync(defaultPath);
        }

        await interaction.client.user.setAvatar(imageBuffer);
        return interaction.editReply({
          embeds: [successEmbed(
            'Bot Avatar Updated! 🎨',
            'The bot avatar has been updated on Discord.\n\n*Note: Discord rate-limits avatar updates to 2 per 10 minutes.*'
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
          embeds: [successEmbed('Bot Username Updated! 🏷️', `The bot username has been changed to **${newName}**.`)]
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
