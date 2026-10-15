const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllUsers } = require('../database/db');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whosolved')
    .setDescription('See who in the server has solved a specific Codeforces problem')
    .addStringOption(option => 
      option.setName('link')
        .setDescription('The Codeforces problem link')
        .setRequired(true)
    ),
    
  async execute(interaction) {
    await interaction.deferReply();
    const link = interaction.options.getString('link');

    let contestId, index;
    const contestMatch = link.match(/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/i);
    const problemsetMatch = link.match(/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i);
    
    if (contestMatch) {
      contestId = contestMatch[1];
      index = contestMatch[2].toUpperCase();
    } else if (problemsetMatch) {
      contestId = problemsetMatch[1];
      index = problemsetMatch[2].toUpperCase();
    } else {
      return interaction.editReply('❌ Invalid Codeforces problem link. Please provide a valid link like `https://codeforces.com/contest/1915/problem/A`.');
    }

    const users = getAllUsers().filter(u => u.cf_handle);
    if (users.length === 0) {
      return interaction.editReply('❌ Nobody in this server has linked their Codeforces handle yet!');
    }

    const solvers = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (u) => {
        try {
          const res = await axios.get(`https://codeforces.com/api/user.status?handle=${u.cf_handle}`, { timeout: 10000 });
          if (res.data.status === 'OK') {
            const hasSolved = res.data.result.some(sub => 
              sub.verdict === 'OK' && 
              sub.problem && 
              String(sub.problem.contestId) === contestId && 
              sub.problem.index.toUpperCase() === index
            );
            if (hasSolved) {
              solvers.push(u);
            }
          }
        } catch (err) {
          console.error(`[whosolved] Failed to fetch status for ${u.cf_handle}: ${err.message}`);
        }
      }));
      // wait a bit between batches to avoid rate limiting
      await new Promise(r => setTimeout(r, 600));
    }

    const hasSolvers = solvers.length > 0;
    const embed = new EmbedBuilder()
      .setColor(hasSolvers ? 0x00E676 : 0x5865F2)
      .setAuthor({
        name: 'Codeforces Problem Intelligence',
        iconURL: 'https://codeforces.org/s/0/images/codeforces-telegram-square.png'
      })
      .setTitle(`🔍 Solvers for Problem ${contestId}${index}`)
      .setURL(link)
      .setThumbnail('https://cdn-icons-png.flaticon.com/512/3112/3112946.png')
      .setTimestamp();

    if (!hasSolvers) {
      embed.setDescription(
        `╭─ 📌 **Problem**: [${contestId}${index} on Codeforces ↗️](${link})\n` +
        `╰─ ⏳ **Status**: Unclaimed in this server\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `> 💡 **No one has solved this problem yet!**\n` +
        `> Be the first pioneer to submit an **Accepted** solution and earn bragging rights! 🚀`
      );
    } else {
      const solverLines = solvers.map((s, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🔹';
        return `${medal} <@${s.discord_id}> · [\`${s.cf_handle}\`](https://codeforces.com/profile/${s.cf_handle})`;
      });

      embed.setDescription(
        `╭─ 📌 **Problem**: [${contestId}${index} on Codeforces ↗️](${link})\n` +
        `╰─ 🏆 **Solvers**: **${solvers.length}** server member${solvers.length > 1 ? 's' : ''}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        solverLines.join('\n')
      );
    }

    embed.setFooter({ text: 'BigOof Solver Directory · /whosolved' });

    return interaction.editReply({ embeds: [embed] });
  }
};
