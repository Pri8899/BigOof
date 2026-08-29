const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setConfig } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-github-channel')
    .setDescription('[Admin] Set the channel for GitHub push and commit feeds')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post GitHub updates in')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    setConfig('github_channel_id', channel.id);

    const embed = successEmbed(
      'GitHub Feed Channel Set 🐙',
      `GitHub commits and pushed solutions will now be posted in <#${channel.id}>.`
    );
    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};
