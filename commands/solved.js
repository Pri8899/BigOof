// commands/solved.js — CF-only solved breakdown by division
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const { getCFDivisionBreakdown } = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solved')
    .setDescription('View your or another member\'s Codeforces solved breakdown by division')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (leave blank for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getMember('member') ?? interaction.member;
    const user = getUser(target.id);

    if (!user || !user.cf_handle) {
      return interaction.reply({
        embeds: [errorEmbed('No Codeforces Account', `${target.displayName} hasn't linked a Codeforces account yet.\nUse \`/link\` to link one.`)],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const ratings = getRatings(target.id);
      let cfSolved = 0;
      for (const r of ratings) {
        if (r.platform === 'cf') cfSolved = r.solved;
      }

      const emojis = await getPlatformEmojis(interaction.guild);

      const embed = new EmbedBuilder()
        .setColor(0x1F8DD6)
        .setTitle(`📊 Solved Problems — ${target.displayName}`)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .addFields({
          name: `${emojis.cf} Codeforces`,
          value: `Total solved: **${cfSolved}** problems\n\u200b`,
          inline: false
        });

      const breakdown = await getCFDivisionBreakdown(user.cf_handle);
      if (breakdown) {
        const buildBar = (count) => {
          const length = 10;
          const total = breakdown.total || 1;
          const filled = Math.min(length, Math.round((count / total) * length));
          const empty = length - filled;
          const pct = Math.round((count / total) * 100);
          return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\` **${count}** solved (${pct}%)`;
        };

        embed.addFields(
          { name: `${emojis.cf} Division Breakdown (\`${user.cf_handle}\`)`, value: '\u200b', inline: false },
          { name: '🏆 Division 1', value: buildBar(breakdown.div1),   inline: false },
          { name: '🥇 Division 2', value: buildBar(breakdown.div2),   inline: false },
          { name: '🥈 Division 3', value: buildBar(breakdown.div3),   inline: false },
          { name: '🥉 Division 4', value: buildBar(breakdown.div4),   inline: false },
          { name: '📦 Others',     value: buildBar(breakdown.others), inline: false }
        );
      } else {
        embed.addFields({ name: 'Breakdown', value: '❌ Failed to load submission details.', inline: false });
      }

      embed.setTimestamp().setFooter({ text: 'Stats update every hour' });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/solved] Error:', err);
      return interaction.editReply({
        embeds: [errorEmbed('Command Error', `An error occurred: ${err.message}`)]
      });
    }
  }
};
