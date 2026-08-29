// commands/github.js — GitHub account management, profile cards, and instant sync
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUser, upsertUser, linkPlatform, unlinkPlatform } = require('../database/db');
const { validateGitHubUser, getGitHubUser } = require('../utils/github');
const { successEmbed, errorEmbed, buildGitHubProfileEmbed } = require('../utils/embeds');
const { runGitHubFeed } = require('../tasks/githubFeed');

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
      sub.setName('sync')
        .setDescription('🔄 Instantly scan and post any unannounced GitHub activity to #github')
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

      // Trigger instant catch-up sync for the newly linked user
      const syncRes = await runGitHubFeed(interaction.client, userId).catch(() => ({ count: 0 }));

      const ghData = await getGitHubUser(ghUsername);
      const profileEmbed = ghData ? buildGitHubProfileEmbed(ghData) : null;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('github_sync_btn')
          .setLabel('🔄 Sync GitHub Activity Now')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setLabel('View on GitHub ↗️')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://github.com/${ghUsername}`)
      );

      return interaction.editReply({
        embeds: [
          successEmbed(
            'GitHub Account Linked! 🐙',
            `Your GitHub account **[${ghUsername}](https://github.com/${ghUsername})** has been linked!\n` +
            `Whenever you push code or solve problems, your activity will be posted to **#github**.\n` +
            (syncRes && syncRes.count > 0 ? `\n🚀 **Caught up:** Posted **${syncRes.count}** recent activities to #github right now!` : '')
          ),
          ...(profileEmbed ? [profileEmbed] : [])
        ],
        components: [row]
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

    // ─── Subcommand: Sync (Secret manual catch-up trigger) ─────────
    if (subcommand === 'sync') {
      await interaction.deferReply({ flags: 64 });
      const dbUser = getUser(userId);

      if (!dbUser || !dbUser.github_handle) {
        return interaction.editReply({
          embeds: [errorEmbed('Not Linked', '🐙 Please link your GitHub account first using `/github link <username>`.')]
        });
      }

      const result = await runGitHubFeed(interaction.client, userId);
      if (!result.success && result.reason) {
        return interaction.editReply({
          embeds: [errorEmbed('Sync Failed', result.reason)]
        });
      }

      if (result.count > 0) {
        return interaction.editReply({
          embeds: [successEmbed(
            'GitHub Activity Synced! 🚀',
            `Successfully scanned **[${dbUser.github_handle}](https://github.com/${dbUser.github_handle})** and posted **${result.count}** new activities to **#github**!`
          )]
        });
      } else {
        return interaction.editReply({
          embeds: [successEmbed(
            'Everything Up-to-Date! 🟢',
            `Scanned **[${dbUser.github_handle}](https://github.com/${dbUser.github_handle})**. All recent commits and activities are already posted in **#github**!`
          )]
        });
      }
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
