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

      // 2. Fetch recent submissions to find their "Specialty" (most frequent tag)
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
            // Find max tag
            let bestTag = 'implementation';
            let maxCount = 0;
            for (const [tag, count] of Object.entries(tagCounts)) {
              if (tag !== 'implementation' && tag !== 'math' && count > maxCount) { // prefer specific tags
                bestTag = tag;
                maxCount = count;
              }
            }
            c.specialty = bestTag.toUpperCase();
          } else {
            c.specialty = 'GENERALIST';
          }
        } catch (err) {
          c.specialty = 'GENERALIST';
        }
        // sleep 200ms to respect CF API limits
        await new Promise(r => setTimeout(r, 200));
      }

      // 3. Build snake-draft balanced teams
      const numTeams = Math.floor(topCandidates.length / 3);
      const teams = Array.from({ length: numTeams }, () => ({ members: [], totalRating: 0 }));

      // Snake draft to balance rating
      // 1 2 3 -> 3 2 1 -> 1 2 3
      let dir = 1;
      let teamIdx = 0;
      for (let i = 0; i < numTeams * 3; i++) {
        const user = topCandidates[i];
        teams[teamIdx].members.push(user);
        teams[teamIdx].totalRating += user.rating;

        teamIdx += dir;
        if (teamIdx >= numTeams) {
          teamIdx = numTeams - 1;
          dir = -1;
        } else if (teamIdx < 0) {
          teamIdx = 0;
          dir = 1;
        }
      }

      // 4. Build embed
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🤖 ICPC Automated Team Builder')
        .setDescription(`Analyzed ${numTeams * 3} members based on their Codeforces rating and historical problem tags. Here are the optimized synergistic teams:`)
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
