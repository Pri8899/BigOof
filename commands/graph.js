// commands/graph.js — Rating history graph via QuickChart.io using latest chronological history
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatingHistory } = require('../database/db');
const { errorEmbed, resolveTargetMeta } = require('../utils/embeds');
const { getPlatformEmojis, PLATFORM_INFO } = require('../utils/emojis');

const PLATFORM_COLORS = { cf: '#1F8DD6', ac: '#E74C3C', toph: '#7B2FBE' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('graph')
    .setDescription('View rating history graph for a member')
    .addStringOption(opt =>
      opt.setName('platform')
        .setDescription('Which platform to graph')
        .setRequired(true)
        .addChoices(
          { name: '🏆 Codeforces', value: 'cf' },
          { name: '🎯 AtCoder', value: 'ac' },
          { name: '⚡ Toph', value: 'toph' }
        )
    )
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (default: yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const platform = interaction.options.getString('platform');
    const target = interaction.options.getMember('member')
      || interaction.options.getUser('member')
      || interaction.member
      || interaction.user;

    const { id: userId, displayName, avatarUrl } = resolveTargetMeta(target);
    const platName = PLATFORM_INFO[platform].name;

    const user = getUser(userId);
    const history = getRatingHistory(userId, platform, 30);

    if (!user || !user[`${platform}_handle`]) {
      return interaction.editReply({
        embeds: [errorEmbed('No Account Linked', `${displayName} hasn't linked a ${platName} account.`)]
      });
    }

    if (history.length < 2) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Enough Data', 'Need at least 2 recorded rating points for a graph. Rating changes accumulate automatically over time.')]
      });
    }

    const labels = history.map(h => {
      const d = new Date(h.recorded_at * 1000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const ratings = history.map(h => h.rating);

    const chartConfig = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${platName} Rating`,
          data: ratings,
          borderColor: PLATFORM_COLORS[platform],
          backgroundColor: `${PLATFORM_COLORS[platform]}33`,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        plugins: { legend: { labels: { color: '#ffffff', font: { size: 14 } } } },
        scales: {
          x: { ticks: { color: '#aaaaaa' }, grid: { color: '#333333' } },
          y: { ticks: { color: '#aaaaaa' }, grid: { color: '#333333' } }
        }
      }
    };

    let chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=800&h=400&bkg=%231a1a2e`;
    if (chartUrl.length > 2000) {
      // Trim older points if URL ever gets close to Discord's 2048-char image URL limit
      const compactConfig = {
        ...chartConfig,
        data: {
          labels: labels.slice(-20),
          datasets: [{ ...chartConfig.data.datasets[0], data: ratings.slice(-20) }]
        }
      };
      chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(compactConfig))}&w=800&h=400&bkg=%231a1a2e`;
    }

    const minR = Math.min(...ratings);
    const maxR = Math.max(...ratings);
    const lastR = ratings[ratings.length - 1];
    const diff = lastR - ratings[0];
    const sign = diff >= 0 ? `+${diff}` : `${diff}`;

    const embedColor = parseInt(PLATFORM_COLORS[platform].replace('#', ''), 16);
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = platform === 'cf' ? emojis.cf : platform === 'ac' ? emojis.ac : (emojis.toph || '🟣');

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setAuthor({
        name: `${platName} Career Rating Trajectory`,
        iconURL: avatarUrl
      })
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 👤 **Member:** <@${userId}> (\`${displayName}\`)`,
        `> 🌐 **Platform:** ${platformEmoji} **${platName}**`,
        `> 🏆 **Peak (Window):** **${maxR}**`,
        `> 📈 **Net Change:** **${sign}** (\`${ratings[0]}\` ➔ \`${lastR}\`)`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'))
      .setImage(chartUrl)
      .addFields(
        { name: '📊 Current', value: `\`${lastR}\``, inline: true },
        { name: '🔺 Peak', value: `\`${maxR}\``, inline: true },
        { name: '🔻 Floor', value: `\`${minR}\``, inline: true },
        { name: '📈 Net Shift', value: `\`${sign}\``, inline: true },
        { name: '📋 Points Plotted', value: `\`${history.length}\``, inline: true }
      )
      .setFooter({ text: 'BigOof Rating Analytics · Syncs every 5 min' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
