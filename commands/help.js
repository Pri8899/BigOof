// commands/help.js — Universal interactive command guide matching actual command signatures
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
      { name: '`/profile [member]`', value: 'View your profile card with ratings, solves, rank badges, and streaks.' },
      { name: '`/compare [user1] [user2] [handle1] [handle2]`', value: 'Head-to-head clash comparing ratings, solves, overlap, and duel history.' },
      { name: '`/solved [member]`', value: 'Detailed Codeforces division breakdown (Div 1 through Div 4).' },
      { name: '`/graph <platform> [member]`', value: 'Generate a rating history progression line chart.' },
      { name: '`/skills [member]`', value: 'RPG-style skill sheet measuring proficiency across algorithm domains.' }
    ]
  },
  contests: {
    label: 'Contests & Problems',
    emoji: '🏆',
    title: '🏆 Contests & Problem Solving',
    fields: [
      { name: '`/contests [platform]`', value: 'View upcoming contests across Codeforces, AtCoder, Toph, and custom server events.' },
      { name: '`/wrapup [contest] [broadcast]`', value: 'View finished Codeforces contest standings and your upsolve roadblock.' },
      { name: '`/leaderboard`', value: 'Display the server ranking leaderboard filtered to current members.' },
      { name: '`/suggest [tag] [rating] [div] [problems]`', value: 'Smart on-demand Codeforces problem recommender tailored to your rating.' },
      { name: '`/whosolved <link>`', value: 'Find everyone in this server who has solved a Codeforces problem.' },
      { name: '`/ask-help <problem> [image1..image5]`', value: 'Request community hints with optional code/screenshot attachments.' }
    ]
  },
  competitions: {
    label: 'Duels & Contests',
    emoji: '⚔️',
    title: '⚔️ Duels & Virtual Contests',
    fields: [
      { name: '`/vs <rating> [mode] [tag] [duration] [problems] [division]`', value: 'Start a 3x3 Battle Grid (1st AC: 100%, later: 1/3) or Classic Race.' },
      { name: '`/vc start <difficulty> [duration] [problems] [tag] [division] [type] [teams]`', value: 'Start an individual or team Virtual Contest round.' },
      { name: '`/vc status`', value: 'Check remaining time, problem set, and participants of the active VC.' },
      { name: '`/vc end`', value: 'Conclude the active Virtual Contest early and tally final scores.' },
      { name: '`/build-teams`', value: 'Auto-generate balanced 3-person ICPC teams based on CF ratings & tags.' }
    ]
  },
  github: {
    label: 'GitHub Integration',
    emoji: '🐙',
    title: '🐙 GitHub Integration Suite',
    fields: [
      { name: '`/github link <username>`', value: 'Link your GitHub account for automatic activity announcements.' },
      { name: '`/github profile [user]`', value: 'View a GitHub developer card with repositories and followers.' },
      { name: '`/github sync`', value: 'Instantly scan and post unannounced GitHub activities to `#github`.' },
      { name: '`/github unlink`', value: 'Unlink your GitHub account.' }
    ]
  },
  admin: {
    label: 'Server Administration',
    emoji: '⚙️',
    title: '⚙️ Server Administration Commands (Admin Only)',
    fields: [
      { name: '`/set-channel <feature> <channel>`', value: 'Route contest radar, dashboard, feeds, daily challenges, and alerts.' },
      { name: '`/view-channels`', value: 'Inspect all currently configured channels for this server.' },
      { name: '`/setup-roles`', value: 'Create and assign base `CP`, CF Rank tiers, and Streak roles.' },
      { name: '`/custom-contest <add|edit|delete|list>`', value: 'Schedule, edit, list, or delete custom server contests.' },
      { name: '`/force-unlink <member> [platform]`', value: 'Admin command to unlink or purge accounts for a member.' },
      { name: '`/announce [channel]`', value: 'Open an announcement modal and broadcast with `@everyone` mention.' },
      { name: '`/set-bot <avatar|username>`', value: 'Update bot avatar or username on Discord (Bot Owner only).' },
      { name: '`/backupdb` / `/restoredb`', value: 'Manage SQLite database backups & restores (Bot Owner only).' }
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

      if (cat.description) embed.setDescription(cat.description);
      if (cat.fields) embed.addFields(cat.fields);
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
        return i.reply({ content: 'Only the command invoker can change categories.', flags: 64 });
      }
      await i.update({ embeds: [buildCategoryEmbed(i.values[0])], components: [row] });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  }
};
