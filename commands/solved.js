// commands/solved.js — Codeforces solved breakdown by division (fixes rank_title lookup)
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatings } = require('../database/db');
const { getCFDivisionBreakdown } = require('../utils/codeforces');
const { getPlatformEmojis } = require('../utils/emojis');
const { getCFRankColor, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solved')
    .setDescription("View your or another member's Codeforces solved breakdown by division")
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (leave blank for yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getMember('member')
      || interaction.options.getUser('member')
      || interaction.member
      || interaction.user;

    const displayName = target.displayName || target.username || 'Member';
    const avatarUrl = typeof target.user?.displayAvatarURL === 'function'
      ? target.user.displayAvatarURL({ dynamic: true })
      : (typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ dynamic: true }) : undefined);

    const user = getUser(target.id);
    if (!user || !user.cf_handle) {
      return interaction.reply({
        embeds: [errorEmbed('No Codeforces Account', `${displayName} hasn't linked a Codeforces account yet.\nUse \`/link\` to link one.`)],
        flags: 64
      });
    }

    await interaction.deferReply();

    try {
      const ratings = getRatings(target.id);
      const cf = ratings.find(r => r.platform === 'cf');
      const cfSolved = cf?.solved || 0;
      const cfRating = cf?.rating || 0;
      const cfRank = cf?.rank_title || 'Unrated';

      const emojis = await getPlatformEmojis(interaction.guild);
      const encodedHandle = encodeURIComponent(user.cf_handle);
      const profileUrl = `https://codeforces.com/profile/${encodedHandle}`;

      const embed = new EmbedBuilder()
        .setColor(getCFRankColor(cfRating))
        .setAuthor({
          name: `${displayName}'s Codeforces Solve Breakdown`,
          iconURL: avatarUrl,
          url: profileUrl
        })
        .setTitle(`📊 Codeforces Portfolio — @${user.cf_handle}`)
        .setURL(profileUrl)
        .setThumbnail(avatarUrl)
        .setDescription([
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `> ${emojis.cf} **Handle:** [\`${user.cf_handle}\`](${profileUrl})`,
          `> 🏅 **Rating:** **${cfRating > 0 ? cfRating : 'Unrated'}** · *${cfRank}*`,
          `> 🧩 **Total Solved:** **\`${cfSolved.toLocaleString()}\`** problems`,
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
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
          { name: '🏆 Division 1 (Hard / Expert+)', value: buildBar(breakdown.div1), inline: false },
          { name: '🥇 Division 2 (Intermediate)', value: buildBar(breakdown.div2), inline: false },
          { name: '🥈 Division 3 (Core Practice)', value: buildBar(breakdown.div3), inline: false },
          { name: '🥉 Division 4 (Foundations)', value: buildBar(breakdown.div4), inline: false },
          { name: '📦 Others & Gym Contests', value: buildBar(breakdown.others), inline: false }
        );
      } else {
        embed.addFields({
          name: '⚠️ Breakdown Unavailable',
          value: 'Could not fetch submission details from Codeforces API.',
          inline: false
        });
      }

      embed.setTimestamp().setFooter({
        text: 'BigOof Solve Analytics · Live from Codeforces API',
        iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
      });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/solved] Error:', err);
      return interaction.editReply({
        embeds: [errorEmbed('Command Error', `An error occurred: ${err.message}`)]
      });
    }
  }
};
