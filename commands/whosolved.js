// commands/whosolved.js — Find which current server members solved a given Codeforces problem
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllUsers } = require('../database/db');
const { getCFStatus } = require('../utils/codeforces');
const { chunkLines } = require('../utils/envHelper');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('whosolved')
    .setDescription('See who in this server has solved a specific Codeforces problem')
    .addStringOption(option =>
      option.setName('link')
        .setDescription('The Codeforces problem link')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const link = interaction.options.getString('link').trim();

    let contestId = null;
    let index = null;
    let isGym = false;

    const contestMatch = link.match(/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/i);
    const problemsetMatch = link.match(/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i);
    const gymMatch = link.match(/gym\/(\d+)\/problem\/([A-Za-z0-9]+)/i);

    if (contestMatch) {
      contestId = contestMatch[1];
      index = contestMatch[2].toUpperCase();
    } else if (problemsetMatch) {
      contestId = problemsetMatch[1];
      index = problemsetMatch[2].toUpperCase();
    } else if (gymMatch) {
      contestId = gymMatch[1];
      index = gymMatch[2].toUpperCase();
      isGym = true;
    } else {
      return interaction.editReply(
        '❌ Invalid Codeforces problem link. Expected e.g. `https://codeforces.com/contest/1915/problem/A` or `/problemset/problem/1915/A`.'
      );
    }

    const canonicalUrl = isGym
      ? `https://codeforces.com/gym/${contestId}/problem/${index}`
      : `https://codeforces.com/problemset/problem/${contestId}/${index}`;

    // Restrict exclusively to members of THIS server
    const fetched = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
    const memberIds = new Set(fetched.keys());
    const users = getAllUsers().filter(u => u.cf_handle && memberIds.has(u.discord_id));

    if (users.length === 0) {
      return interaction.editReply('❌ Nobody in this server has linked a Codeforces handle yet!');
    }

    const solvers = [];
    const BATCH_SIZE = 4;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async u => {
        const subs = await getCFStatus(u.cf_handle, 10000);
        if (!subs) return;
        const hasSolved = subs.some(sub =>
          sub.verdict === 'OK' &&
          sub.problem &&
          String(sub.problem.contestId) === contestId &&
          sub.problem.index?.toUpperCase() === index
        );
        if (hasSolved) solvers.push(u);
      }));
      if (i + BATCH_SIZE < users.length) {
        await new Promise(r => setTimeout(r, 700));
      }
    }

    const hasSolvers = solvers.length > 0;
    const embed = new EmbedBuilder()
      .setColor(hasSolvers ? 0x00E676 : 0x5865F2)
      .setAuthor({
        name: 'Codeforces Problem Intelligence',
        iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
      })
      .setTitle(`🔍 Solvers for Problem ${contestId}${index}`)
      .setURL(canonicalUrl)
      .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
      .setFooter({ text: 'BigOof Solver Directory · /whosolved' })
      .setTimestamp();

    if (!hasSolvers) {
      embed.setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 📌 **Problem:** [**${contestId}${index} on Codeforces ↗️**](${canonicalUrl})`,
        '> ⏳ **Status:** `Unclaimed in this server`',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '💡 **No one in this server has solved this problem yet!**',
        'Be the first coder to submit an **Accepted** solution and claim server glory! 🚀'
      ].join('\n'));
    } else {
      const solverLines = solvers.map((s, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🔹';
        return `${medal} <@${s.discord_id}> · [\`${s.cf_handle}\`](https://codeforces.com/profile/${encodeURIComponent(s.cf_handle)})`;
      });

      embed.setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 📌 **Problem:** [**${contestId}${index} on Codeforces ↗️**](${canonicalUrl})`,
        `> 🏆 **Solvers:** **\`${solvers.length}\`** server member${solvers.length > 1 ? 's' : ''}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'));

      chunkLines(solverLines, 1000).forEach((chunk, idx) => {
        embed.addFields({
          name: idx === 0 ? `✅ Server Solvers (${solvers.length})` : '✅ Server Solvers (cont.)',
          value: chunk,
          inline: false
        });
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }
};
