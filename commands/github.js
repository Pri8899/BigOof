// commands/github.js — GitHub developer profile cards and instant activity sync
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUser } = require('../database/db');
const { getGitHubUser } = require('../utils/github');
const { errorEmbed, buildGitHubProfileEmbed } = require('../utils/embeds');
const { handleGitHubSyncInteraction } = require('../tasks/githubFeed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('github')
    .setDescription('GitHub developer profile and live activity sync')
    .addSubcommand(sub =>
      sub.setName('profile')
        .setDescription('View GitHub developer profile')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Server member to check (leave empty for yourself)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('sync')
        .setDescription('🔄 Instantly scan and post any unannounced GitHub activity')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'profile') {
      await interaction.deferReply();
      const targetDiscordUser = interaction.options.getUser('user') || interaction.user;
      const dbUser = getUser(targetDiscordUser.id);

      if (!dbUser || !dbUser.github_handle) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'No GitHub Account Linked',
            targetDiscordUser.id === userId
              ? '🐙 You have not linked your GitHub account yet.\nUse `/link platform:🐙 GitHub` to connect your GitHub!'
              : `🐙 **${targetDiscordUser.username}** has not linked their GitHub account yet.`
          )]
        });
      }

      const ghData = await getGitHubUser(dbUser.github_handle);
      if (!ghData) {
        return interaction.editReply({
          embeds: [errorEmbed('Error Fetching Profile', `Could not load GitHub profile for **${dbUser.github_handle}**.`)]
        });
      }

      const embed = buildGitHubProfileEmbed(ghData);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('github_sync_btn')
          .setLabel('🔄 Sync GitHub Activity Now')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setLabel('View on GitHub ↗️')
          .setStyle(ButtonStyle.Link)
          .setURL(ghData.profileUrl)
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (subcommand === 'sync') {
      return handleGitHubSyncInteraction(interaction, interaction.client);
    }
  }
};
