// commands/github.js — GitHub account management and profile cards
const { SlashCommandBuilder } = require('discord.js');
const { getUser, upsertUser, linkPlatform, unlinkPlatform } = require('../database/db');
const { validateGitHubUser, getGitHubUser } = require('../utils/github');
const { successEmbed, errorEmbed, buildGitHubProfileEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('github')
    .setDescription('GitHub integration commands')
    .addSubcommand(sub =>
      sub.setName('link')
        .setDescription('Link your GitHub account')
        .addStringOption(opt =>
          opt.setName('username')
            .setDescription('Your GitHub username')
            .setRequired(true)
        )
    )
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
      sub.setName('unlink')
        .setDescription('Unlink your GitHub account')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // ─── Subcommand: Link ──────────────────────────────────────────
    if (subcommand === 'link') {
      await interaction.deferReply({ flags: 64 });
      const ghUsername = interaction.options.getString('username').trim();

      const isValid = await validateGitHubUser(ghUsername);
      if (!isValid) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'Invalid GitHub Username',
            `🐙 Could not find GitHub user **\`${ghUsername}\`**.\nPlease verify your username on [github.com](https://github.com/${ghUsername}) and try again.`
          )]
        });
      }

      upsertUser(userId, username);
      linkPlatform(userId, 'github', ghUsername);

      const ghData = await getGitHubUser(ghUsername);
      const profileEmbed = ghData ? buildGitHubProfileEmbed(ghData) : null;

      return interaction.editReply({
        embeds: [
          successEmbed(
            'GitHub Account Linked! 🐙',
            `Your GitHub account **[${ghUsername}](https://github.com/${ghUsername})** has been linked!\n` +
            `Whenever you push code (including CP solutions via browser extensions), your commits will be posted to the **#github** channel.`
          ),
          ...(profileEmbed ? [profileEmbed] : [])
        ]
      });
    }

    // ─── Subcommand: Profile ───────────────────────────────────────
    if (subcommand === 'profile') {
      await interaction.deferReply();
      const targetDiscordUser = interaction.options.getUser('user') || interaction.user;
      const dbUser = getUser(targetDiscordUser.id);

      if (!dbUser || !dbUser.github_handle) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'No GitHub Account Linked',
            targetDiscordUser.id === userId
              ? '🐙 You have not linked your GitHub account yet.\nUse `/github link <username>` to connect your GitHub!'
              : `🐙 **${targetDiscordUser.username}** has not linked their GitHub account yet.`
          )]
        });
      }

      const ghData = await getGitHubUser(dbUser.github_handle);
      if (!ghData) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'Error Fetching Profile',
            `Could not load GitHub profile for **${dbUser.github_handle}**.`
          )]
        });
      }

      const embed = buildGitHubProfileEmbed(ghData);
      return interaction.editReply({ embeds: [embed] });
    }

    // ─── Subcommand: Unlink ────────────────────────────────────────
    if (subcommand === 'unlink') {
      const dbUser = getUser(userId);
      if (!dbUser || !dbUser.github_handle) {
        return interaction.reply({
          embeds: [errorEmbed('Not Linked', "🐙 You don't have a GitHub account linked.")],
          flags: 64
        });
      }

      unlinkPlatform(userId, 'github');
      return interaction.reply({
        embeds: [successEmbed('GitHub Unlinked', '🐙 Your GitHub account has been unlinked.')],
        flags: 64
      });
    }
  }
};
