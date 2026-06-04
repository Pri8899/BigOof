// commands/build-teams.js — ICPC Automated Team Builder
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getAllUsers, getRatings } = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('build-teams')
    .setDescription('Auto-generate balanced ICPC teams based on members\' Codeforces stats and tags'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const allUsers = getAllUsers().filter(u => u.cf_handle);
      if (allUsers.length < 3) {
        return interaction.editReply('Not enough linked Codeforces users to build teams! You need at least 3.');
      }

      // 1. Get CF ratings from database
      const candidates = [];
      for (const u of allUsers) {
        const ratings = getRatings(u.discord_id);
        const cf = ratings.find(r => r.platform === 'cf');
        if (cf && cf.rating > 0) {
          candidates.push({ ...u, rating: cf.rating });
        }
      }

      if (candidates.length < 3) {
        return interaction.editReply('Not enough rated users to build teams. Need at least 3 users with a CF rating.');
      }

      // Sort by rating desc, pick top 15 (max 5 teams) to avoid rate limits
      candidates.sort((a, b) => b.rating - a.rating);
      const topCandidates = candidates.slice(0, 15);

      await interaction.editReply('🧠 **Analyzing problem solving history and tags for top users...** (This may take a few seconds)');

      // 2. Fetch recent submissions to find their top 3 tags (specialties)
      for (let i = 0; i < topCandidates.length; i++) {
        const c = topCandidates[i];
        try {
          const res = await axios.get(`https://codeforces.com/api/user.status?handle=${c.cf_handle}&from=1&count=300`, { timeout: 6000 });
          if (res.data.status === 'OK') {
            const tagCounts = {};
            for (const sub of res.data.result) {
              if (sub.verdict === 'OK' && sub.problem && sub.problem.tags) {
                for (const tag of sub.problem.tags) {
                  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
              }
            }
            
            // Get top 3 tags sorted by frequency
            const sortedTags = Object.entries(tagCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([tag]) => tag);
            
            c.topTags = sortedTags.slice(0, 3);
            c.specialty = c.topTags.join(', ').toUpperCase() || 'GENERALIST';
          } else {
            c.topTags = [];
            c.specialty = 'GENERALIST';
          }
        } catch (err) {
          c.topTags = [];
          c.specialty = 'GENERALIST';
        }
        // sleep 200ms to respect CF API limits
        await new Promise(r => setTimeout(r, 200));
      }

      // 3. Mathematical Optimization Engine (balances rating variance & maximizes tag coverage/synergy)
      const numTeams = Math.floor(topCandidates.length / 3);
      const selectedCandidates = topCandidates.slice(0, numTeams * 3);

      const getPartitionFitness = (partition) => {
        let totalCoverage = 0;
        const teamRatings = [];
        for (const team of partition) {
          const unionTags = new Set();
          let teamRating = 0;
          for (const member of team) {
            teamRating += member.rating;
            if (member.topTags) {
              member.topTags.forEach(t => unionTags.add(t));
            }
          }
          totalCoverage += unionTags.size;
          teamRatings.push(teamRating);
        }

        const meanRating = teamRatings.reduce((a, b) => a + b, 0) / numTeams;
        const variance = teamRatings.reduce((acc, r) => acc + Math.pow(r - meanRating, 2), 0) / numTeams;
        const stdDev = Math.sqrt(variance);

        // Fitness = Total Tag Coverage - (Standard Deviation of Ratings * 0.25)
        return totalCoverage - (stdDev * 0.25);
      };

      // Initial partition (balanced snake draft to have a strong starting point)
      let bestPartition = Array.from({ length: numTeams }, () => []);
      let dir = 1;
      let teamIdx = 0;
      for (let i = 0; i < numTeams * 3; i++) {
        bestPartition[teamIdx].push(selectedCandidates[i]);
        teamIdx += dir;
        if (teamIdx >= numTeams) {
          teamIdx = numTeams - 1;
          dir = -1;
        } else if (teamIdx < 0) {
          teamIdx = 0;
          dir = 1;
        }
      }

      let bestFitness = getPartitionFitness(bestPartition);

      // Hill Climbing / Local Search (10,000 swaps)
      for (let step = 0; step < 10000; step++) {
        const currentPartition = bestPartition.map(t => [...t]);

        // Pick two random teams
        const t1 = Math.floor(Math.random() * numTeams);
        const t2 = Math.floor(Math.random() * numTeams);
        if (t1 === t2) continue;

        // Pick a random member from each team to swap
        const m1 = Math.floor(Math.random() * 3);
        const m2 = Math.floor(Math.random() * 3);

        // Swap
        const temp = currentPartition[t1][m1];
        currentPartition[t1][m1] = currentPartition[t2][m2];
        currentPartition[t2][m2] = temp;

        const currentFitness = getPartitionFitness(currentPartition);
        if (currentFitness > bestFitness) {
          bestPartition = currentPartition;
          bestFitness = currentFitness;
        }
      }

      // Convert bestPartition to the teams array format
      const teams = bestPartition.map(members => {
        const totalRating = members.reduce((sum, m) => sum + m.rating, 0);
        return { members, totalRating };
      });

      // 4. Build embed
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🤖 ICPC Synergistic Team Matchmaker')
        .setDescription(`Mathematically optimized ${numTeams * 3} candidates to balance overall strength while maximizing specialty tag diversity within teams:`)
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/3214/3214695.png')
        .setTimestamp();

      teams.forEach((t, i) => {
        const avg = Math.floor(t.totalRating / 3);
        const memStr = t.members.map(m => `**${m.cf_handle}** (${m.rating}) — 🧠 \`${m.specialty}\``).join('\n');
        embed.addFields({
          name: `🛡️ Team ${i + 1}  (Avg Rating: ${avg})`,
          value: memStr,
          inline: false
        });
      });

      await interaction.editReply({ content: null, embeds: [embed] });

    } catch (err) {
      console.error('[build-teams error]', err);
      interaction.editReply('Failed to build teams. Codeforces API might be down or rate-limiting us.');
    }
  }
};
