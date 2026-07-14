// commands/solved.js — View a member's solved breakdown by Codeforces division
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const { getCFDivisionBreakdown } = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solved')
    .setDescription('View your or another member\'s solved problems breakdown by division')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (leave blank for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getMember('member') ?? interaction.member;
    const user = getUser(target.id);

    if (!user || (!user.cf_handle && !user.ac_handle && !user.toph_handle)) {
      return interaction.reply({
        embeds: [errorEmbed('No Profile Found', `${target.displayName} hasn't linked any accounts yet.`)],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const ratings = getRatings(target.id);
      let cfSolved   = 0;
      let tophSolved = 0;

      for (const r of ratings) {
        if (r.platform === 'cf')   cfSolved   = r.solved;
        if (r.platform === 'toph') tophSolved = r.solved;
      }

      const totalSolved = cfSolved + tophSolved;
      const emojis = await getPlatformEmojis(interaction.guild);

      // Build overall stats line — only show linked platforms
      const platformParts = [];
      if (user.cf_handle)   platformParts.push(`${emojis.cf} **${cfSolved}**`);
      if (user.toph_handle) platformParts.push(`${emojis.toph} **${tophSolved}**`);

      const embed = new EmbedBuilder()
        .setColor(0x1F8DD6)
        .setTitle(`📊 Solved Problems Statistics — ${target.displayName}`)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .addFields({
          name: '🏆 Overall Stats',
          value: `**Total Solved: ${totalSolved}**\n${platformParts.join('  |  ')}\n\u200b`,
          inline: false
        });

      // CF Division Breakdown
      if (user.cf_handle) {
        const breakdown = await getCFDivisionBreakdown(user.cf_handle);
        if (breakdown) {
          const buildBar = (count) => {
            const length = 10;
            const total = breakdown.total || 1;
            const filled = Math.min(length, Math.round((count / total) * length));
            const empty = length - filled;
            const bar = '█'.repeat(filled) + '░'.repeat(empty);
            const pct = Math.round((count / total) * 100);
            return `\`${bar}\` **${count}** solved (${pct}%)`;
          };

          embed.addFields(
            { name: `${emojis.cf} Codeforces Breakdown (\`${user.cf_handle}\`)`, value: '\u200b', inline: false },
            { name: '🏆 Division 1', value: buildBar(breakdown.div1),   inline: false },
            { name: '🥇 Division 2', value: buildBar(breakdown.div2),   inline: false },
            { name: '🥈 Division 3', value: buildBar(breakdown.div3),   inline: false },
            { name: '🥉 Division 4', value: buildBar(breakdown.div4),   inline: false },
            { name: '📦 Others',     value: buildBar(breakdown.others), inline: false }
          );
        } else {
          embed.addFields({ name: `${emojis.cf} Codeforces Breakdown`, value: '❌ Failed to load submission details.', inline: false });
        }
      }

      // Toph total solved (no breakdown API available yet)
      if (user.toph_handle && tophSolved > 0) {
        embed.addFields({
          name: `${emojis.toph} Toph (\`${user.toph_handle}\`)`,
          value: `Total solved: **${tophSolved}** problems`,
          inline: false
        });
      }

      embed.setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/solved] Command execution error:', err);
      return interaction.editReply({
        embeds: [errorEmbed('Command Error', `An error occurred while fetching solve statistics: ${err.message}`)]
      });
    }
  }
};
