// commands/build-teams.js — Balanced ICPC 3-person team builder with CF headers & remainder notes
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllUsers, getRatings } = require('../database/db');
const { getCFStatus } = require('../utils/codeforces');
const { chunkLines } = require('../utils/envHelper');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('build-teams')
    .setDescription("Auto-generate balanced ICPC teams based on members' Codeforces stats and tags"),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const fetched = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
      const memberIds = new Set(fetched.keys());

      const allUsers = getAllUsers().filter(u => u.cf_handle && memberIds.has(u.discord_id));
      if (allUsers.length < 3) {
        return interaction.editReply('Not enough linked Codeforces users in this server to build teams! Need at least 3.');
      }

      const candidates = [];
      for (const u of allUsers) {
        const cf = getRatings(u.discord_id).find(r => r.platform === 'cf');
        if (cf && cf.rating > 0) {
          candidates.push({ ...u, rating: cf.rating });
        }
      }

      if (candidates.length < 3) {
        return interaction.editReply('Not enough rated Codeforces users to build teams. Need at least 3 rated members.');
      }

      candidates.sort((a, b) => b.rating - a.rating);
      const topCandidates = candidates.slice(0, 15);
      const numTeams = Math.floor(topCandidates.length / 3);
      const selectedCandidates = topCandidates.slice(0, numTeams * 3);
      const unplacedCandidates = candidates.slice(numTeams * 3);

      await interaction.editReply('🧠 **Analyzing problem solving history and tags...** *(this may take a few seconds)*');

      for (const c of selectedCandidates) {
        const subs = await getCFStatus(c.cf_handle, 300);
        if (subs) {
          const tagCounts = {};
          for (const sub of subs) {
            if (sub.verdict === 'OK' && sub.problem?.tags) {
              for (const tag of sub.problem.tags) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          }
          const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
          c.topTags = sortedTags.slice(0, 3);
          c.specialty = c.topTags.join(', ').toUpperCase() || 'GENERALIST';
        } else {
          c.topTags = [];
          c.specialty = 'GENERALIST';
        }
        await new Promise(r => setTimeout(r, 250));
      }

      const getPartitionFitness = (partition) => {
        let totalCoverage = 0;
        const teamRatings = [];
        for (const team of partition) {
          const unionTags = new Set();
          let teamRating = 0;
          for (const member of team) {
            teamRating += member.rating;
            if (member.topTags) member.topTags.forEach(t => unionTags.add(t));
          }
          totalCoverage += unionTags.size;
          teamRatings.push(teamRating);
        }
        const meanRating = teamRatings.reduce((a, b) => a + b, 0) / numTeams;
        const variance = teamRatings.reduce((acc, r) => acc + Math.pow(r - meanRating, 2), 0) / numTeams;
        return totalCoverage - Math.sqrt(variance) * 0.25;
      };

      // Snake draft seed
      let bestPartition = Array.from({ length: numTeams }, () => []);
      let dir = 1;
      let teamIdx = 0;
      for (let i = 0; i < numTeams * 3; i++) {
        bestPartition[teamIdx].push(selectedCandidates[i]);
        teamIdx += dir;
        if (teamIdx >= numTeams) { teamIdx = numTeams - 1; dir = -1; }
        else if (teamIdx < 0) { teamIdx = 0; dir = 1; }
      }

      let bestFitness = getPartitionFitness(bestPartition);
      if (numTeams > 1) {
        for (let step = 0; step < 10000; step++) {
          const current = bestPartition.map(t => [...t]);
          const t1 = Math.floor(Math.random() * numTeams);
          const t2 = Math.floor(Math.random() * numTeams);
          if (t1 === t2) continue;

          const m1 = Math.floor(Math.random() * 3);
          const m2 = Math.floor(Math.random() * 3);
          [current[t1][m1], current[t2][m2]] = [current[t2][m2], current[t1][m1]];

          const fit = getPartitionFitness(current);
          if (fit > bestFitness) {
            bestPartition = current;
            bestFitness = fit;
          }
        }
      }

      const teams = bestPartition.map(members => ({
        members,
        totalRating: members.reduce((sum, m) => sum + m.rating, 0)
      }));

      const embed = new EmbedBuilder()
        .setColor(0x7C4DFF)
        .setAuthor({
          name: 'ICPC Team Matchmaker & Synergy Engine',
          iconURL: 'https://cdn-icons-png.flaticon.com/512/3214/3214695.png'
        })
        .setTitle(`🏆 Balanced ICPC Rosters (${teams.length} Squad${teams.length > 1 ? 's' : ''})`)
        .setDescription(
          '> 🧠 **Optimization Complete!**\n' +
          `> Balanced **${numTeams * 3}** members into **${numTeams}** synergistic 3-person squads.\n\n` +
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        )
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/3214/3214695.png')
        .setFooter({ text: 'BigOof ICPC Synergy Engine · Ready for Team Contest rounds' })
        .setTimestamp();

      teams.forEach((t, i) => {
        const avg = Math.floor(t.totalRating / 3);
        const memLines = t.members.map((m, idx) => {
          const roleIcon = idx === 0 ? '👑' : idx === 1 ? '⚔️' : '🛡️';
          return `${roleIcon} <@${m.discord_id}> ([\`${m.cf_handle}\`](https://codeforces.com/profile/${encodeURIComponent(m.cf_handle)})) · ⭐ **${m.rating}** · 🧠 \`${m.specialty}\``;
        });

        chunkLines(memLines, 1000).forEach((chunk, cIdx) => {
          embed.addFields({
            name: cIdx === 0 ? `🛡️ Squad ${i + 1} · Combined: ${t.totalRating} pts (Avg: ${avg})` : `🛡️ Squad ${i + 1} (cont.)`,
            value: chunk,
            inline: false
          });
        });
      });

      if (unplacedCandidates.length > 0) {
        const reserve = unplacedCandidates.slice(0, 6).map(u => `<@${u.discord_id}> (${u.rating})`).join(', ');
        const extraNote = unplacedCandidates.length > 6 ? ` +${unplacedCandidates.length - 6} more` : '';
        embed.addFields({
          name: `⏳ Reserves (${unplacedCandidates.length} not in a full 3-person squad)`,
          value: `${reserve}${extraNote}`,
          inline: false
        });
      }

      return interaction.editReply({ content: null, embeds: [embed] });
    } catch (err) {
      console.error('[build-teams error]', err);
      return interaction.editReply('❌ Failed to build teams. Codeforces API may be temporarily unavailable.').catch(() => {});
    }
  }
};
