// commands/help.js — Universal interactive command guide for CP Bot
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');

const CATEGORIES = {
  general: {
    label: 'Overview',
    emoji: '🧭',
    title: '🏆 BigOof — Command & Feature Directory',
    description: [
      'Welcome to **BigOof**, the autonomous competitive programming companion for Discord.',
      '*Because every O(n²) solution ends in a Big Oof 💀*',
      '',
      '**Quick Start:**',
      '1. Link your platform accounts with `/link`',
      '2. View your statistics with `/profile` and division breakdown with `/solved`',
      '3. Compete in duels with `/vs` or simulated contest rounds with `/vc start`',
      '4. Admins can configure automated feeds with `/set-channel` and roles with `/setup-roles`',
      '',
      'Use the dropdown below to explore commands by category.'
    ].join('\n')
  },
  accounts: {
    label: 'Accounts & Profile',
    emoji: '👤',
    title: '👤 Account & Profile Commands',
    fields: [
      { name: '`/link <platform> <handle>`', value: 'Link your Codeforces, AtCoder, Toph, or GitHub account.' },
      { name: '`/unlink <platform>`', value: 'Remove a linked account from your Discord profile.' },
      { name: '`/profile [member]`', value: 'View an elegant profile card with ratings, solves, rank badges, and streaks.' },
      { name: '`/compare [user1] [user2] [handle1] [handle2]`', value: 'Head-to-head clash comparing ratings, solves, common problem overlap, and duel history.' },
      { name: '`/solved [member]`', value: 'Detailed Codeforces division breakdown (Div 1 through Div 4).' },
      { name: '`/graph <platform> [member]`', value: 'Generate a rating history progression line chart.' },
      { name: '`/skills [member]`', value: 'RPG-style skill tree radar chart measuring proficiency in algorithms and data structures.' }
    ]
  },
  contests: {
    label: 'Contests & Problems',
    emoji: '🏆',
    title: '🏆 Contests & Problem Solving',
    fields: [
      { name: '`/contests [platform]`', value: 'View upcoming contests across Codeforces, AtCoder, Toph, and custom server events.' },
      { name: '`/wrapup [contest]`', value: 'View the latest Codeforces contest wrap-up and your personal upsolve roadblock.' },
      { name: '`/leaderboard`', value: 'Display the server ranking leaderboard filtered to current server members.' },
      { name: '`/suggest [tag] [rating] [div]`', value: 'Smart on-demand Codeforces problem recommender tailored to your rating.' },
      { name: '`/whosolved <problem_link>`', value: 'Find everyone in the server who has already solved a specific Codeforces problem.' },
      { name: '`/ask-help <problem> [details]`', value: 'Request community assistance or hints on a difficult problem without channel restrictions.' }
    ]
  },
  competitions: {
    label: 'Duels & Contests',
    emoji: '⚔️',
    title: '⚔️ Duels & Virtual Contests',
    fields: [
      { name: '`/compare [user1] [user2]`', value: 'Head-to-head clash comparing two rivals, problem overlaps, and 1v1 record.' },
      { name: '`/vs <rating> [mode] [duration] [tag]`', value: 'Start a 1v1 or multiplayer 3x3 Lockout Grid battle or classic race with live tile locking.' },
      { name: '`/vc start <difficulty> [duration]`', value: 'Start a simulated Virtual Contest round (individual or team mode).' },
      { name: '`/vc status`', value: 'Check remaining time, problem set, and standings of the active virtual contest.' },
      { name: '`/vc end`', value: 'Conclude an active virtual contest early and tally the final scores.' },
      { name: '`/build-teams`', value: 'Auto-generate balanced 3-person ICPC teams based on members\' Codeforces strengths.' }
    ]
  },
  github: {
    label: 'GitHub Integration',
    emoji: '🐙',
    title: '🐙 GitHub Integration Suite',
    fields: [
      { name: '`/github link <username>`', value: 'Link your GitHub account to enable automatic activity announcements.' },
      { name: '`/github profile [member]`', value: 'View a GitHub developer card with repositories, stars, and languages.' },
      { name: '`/github sync`', value: 'Instantly scan and announce any unposted commits and activities to the feed.' },
      { name: '`/github unlink`', value: 'Unlink your GitHub account.' }
    ]
  },
  admin: {
    label: 'Server Administration',
    emoji: '⚙️',
    title: '⚙️ Server Administration Commands (Admin Only)',
    fields: [
      { name: '`/set-channel <feature> <channel>`', value: 'Configure target channels for contest radar, dashboard, feeds, daily challenges, and alerts.' },
      { name: '`/view-channels`', value: 'Inspect all currently configured channels for this server.' },
      { name: '`/setup-roles`', value: 'Automatically create and configure server rank and streak roles based on ratings.' },
      { name: '`/custom-contest <add|edit|delete|list>`', value: 'Schedule, update, or remove custom local or university contests.' },
      { name: '`/force-unlink <member> [platform]`', value: 'Admin command to forcefully unlink accounts for a member.' },
      { name: '`/announce [channel]`', value: 'Broadcast a formatted announcement modal with optional channel selection.' },
      { name: '`/set-bot <avatar|username>`', value: 'Update the bot profile picture or username on Discord (Bot Owner only).' },
      { name: '`/backupdb` / `/restoredb`', value: 'Manage SQLite database backups and cloud recovery (Bot Owner only).' }
    ]
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explore all BigOof commands and features'),

  async execute(interaction) {
    const buildCategoryEmbed = (catKey) => {
      const cat = CATEGORIES[catKey] || CATEGORIES.general;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(cat.title)
        .setThumbnail(interaction.client.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'BigOof · The Competitive Programming Discord Companion', iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

      if (cat.description) {
        embed.setDescription(cat.description);
      }

      if (cat.fields) {
        embed.addFields(cat.fields);
      }

      return embed;
    };

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_category_select')
      .setPlaceholder('Select a category to view commands...')
      .addOptions(
        Object.entries(CATEGORIES).map(([key, data]) => ({
          label: data.label,
          value: key,
          emoji: data.emoji,
          description: `View ${data.label.toLowerCase()} commands`
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const reply = await interaction.reply({
      embeds: [buildCategoryEmbed('general')],
      components: [row]
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120000
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'Only the command invoker can change categories.', ephemeral: true });
      }

      const selected = i.values[0];
      await i.update({
        embeds: [buildCategoryEmbed(selected)],
        components: [row]
      });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  }
};
