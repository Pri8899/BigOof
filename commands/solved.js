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
      let cfRating = 0;
      let cfRank = 'Unrated';
      for (const r of ratings) {
        if (r.platform === 'cf') {
          cfSolved = r.solved || 0;
          cfRating = r.rating || 0;
          cfRank = r.rank || 'Unrated';
        }
      }

      const { getCFRankColor } = require('../utils/embeds');
      const emojis = await getPlatformEmojis(interaction.guild);

      const embed = new EmbedBuilder()
        .setColor(getCFRankColor(cfRating))
        .setAuthor({
          name: `${target.displayName}'s Codeforces Solve Breakdown`,
          iconURL: target.user.displayAvatarURL({ dynamic: true }),
          url: `https://codeforces.com/profile/${user.cf_handle}`
        })
        .setTitle(`📊 Codeforces Portfolio — @${user.cf_handle}`)
        .setURL(`https://codeforces.com/profile/${user.cf_handle}`)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .setDescription([
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 👤 **Handle:** [\`${user.cf_handle}\`](https://codeforces.com/profile/${user.cf_handle})`,
          `> 🏅 **Rating:** **${cfRating > 0 ? cfRating : 'Unrated'}** · *${cfRank}*`,
          `> 🧩 **Total Solved:** **\`${cfSolved.toLocaleString()}\`** problems`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        ].join('\n'));

      const breakdown = await getCFDivisionBreakdown(user.cf_handle);
      if (breakdown) {
        const buildBar = (count) => {
          const length = 12;
          const total = breakdown.total || 1;
          const filled = Math.min(length, Math.max(0, Math.round((count / total) * length)));
          const empty = length - filled;
          const pct = Math.round((count / total) * 100);
          return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${count}** solves · **${pct}%**`;
        };

        embed.addFields(
          { name: '🏆 Division 1 (Hard / Expert+)', value: buildBar(breakdown.div1),   inline: false },
          { name: '🥇 Division 2 (Intermediate)',   value: buildBar(breakdown.div2),   inline: false },
          { name: '🥈 Division 3 (Core Practice)',  value: buildBar(breakdown.div3),   inline: false },
          { name: '🥉 Division 4 (Foundations)',    value: buildBar(breakdown.div4),   inline: false },
          { name: '📦 Others & Gym Contests',       value: buildBar(breakdown.others), inline: false }
        );
      } else {
        embed.addFields({ name: '⚠️ Breakdown Unavailable', value: 'Could not fetch submission details from Codeforces API.', inline: false });
      }

      embed.setTimestamp().setFooter({ text: 'BigOof Solve Analytics · Cached hourly', iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png' });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/solved] Error:', err);
      return interaction.editReply({
        embeds: [errorEmbed('Command Error', `An error occurred: ${err.message}`)]
      });
    }
  }
};
