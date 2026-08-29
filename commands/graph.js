// commands/graph.js — Rating history graph via QuickChart.io
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUser, getRatingHistory }          = require('../database/db');
const { errorEmbed }                         = require('../utils/embeds');

const PLATFORM_NAMES  = { cf: 'Codeforces', ac: 'AtCoder', toph: 'Toph' };
const PLATFORM_COLORS = { cf: '#1F8DD6',    ac: '#E74C3C', toph: '#7B2FBE' };

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
          { name: '🎯 AtCoder',    value: 'ac' },
          { name: '⚡ Toph',       value: 'toph' }
        ))
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (default: yourself)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const platform = interaction.options.getString('platform');
    const target   = interaction.options.getMember('member') ?? interaction.member;
    const userId   = target.id;

    const user    = getUser(userId);
    const history = getRatingHistory(userId, platform, 40);

    if (!user || !user[`${platform}_handle`]) {
      return interaction.editReply({
        embeds: [errorEmbed('No Account Linked', `${target.displayName} hasn't linked a ${PLATFORM_NAMES[platform]} account.`)]
      });
    }

    if (history.length < 2) {
      return interaction.editReply({
        embeds: [errorEmbed('Not Enough Data', `Need at least 2 data points for a graph. Rating history builds up over time as the bot syncs hourly.`)]
      });
    }

    // Build chart using QuickChart.io (free, no API key)
    const labels  = history.map(h => {
      const d = new Date(h.recorded_at * 1000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const ratings = history.map(h => h.rating);

    const chartConfig = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label:           `${PLATFORM_NAMES[platform]} Rating`,
          data:            ratings,
          borderColor:     PLATFORM_COLORS[platform],
          backgroundColor: PLATFORM_COLORS[platform] + '33',
          borderWidth:     2,
          pointRadius:     3,
          tension:         0.3,
          fill:            true
        }]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#ffffff', font: { size: 14 } } }
        },
        scales: {
          x: { ticks: { color: '#aaaaaa' }, grid: { color: '#333333' } },
          y: { ticks: { color: '#aaaaaa' }, grid: { color: '#333333' } }
        }
      }
    };

    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=800&h=400&bkg=%231a1a2e`;

    const minR  = Math.min(...ratings);
    const maxR  = Math.max(...ratings);
    const lastR = ratings[ratings.length - 1];
    const diff  = lastR - ratings[0];
    const sign  = diff >= 0 ? `+${diff}` : `${diff}`;

    const embedColor = parseInt(PLATFORM_COLORS[platform].replace('#', ''), 16);
    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const platformEmoji = platform === 'cf' ? emojis.cf : platform === 'ac' ? emojis.ac : emojis.toph || '🟣';

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${platformEmoji} ${PLATFORM_NAMES[platform]} Rating History — ${target.displayName}`)
      .setImage(chartUrl)
      .addFields(
        { name: '📊 Current',  value: `**${lastR}**`,  inline: true },
        { name: '🔺 Peak',     value: `**${maxR}**`,   inline: true },
        { name: '🔻 Lowest',   value: `**${minR}**`,   inline: true },
        { name: '📉 Net Change', value: `**${sign}**`, inline: true },
        { name: '📋 Data Points', value: `${history.length}`, inline: true }
      )
      .setFooter({ text: 'History updates every hour' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
