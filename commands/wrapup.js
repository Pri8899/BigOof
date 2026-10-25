// commands/wrapup.js — On-demand Contest Wrap-up & Upsolve Radar
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const {
  getAllUsers, getConfig
} = require('../database/db');
const {
  buildContestWrapupEmbed, getWrapupChannel
} = require('../tasks/contestWrapup');

const CF_BASE = 'https://codeforces.com/api';
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

let cachedFinishedContests = [];
let lastFinishedFetch = 0;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wrapup')
    .setDescription('View the latest Codeforces contest standings and personalized upsolve roadblock')
    .addIntegerOption(opt =>
      opt.setName('contest')
        .setDescription('Optional Codeforces contest ID (defaults to latest finished round)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addBooleanOption(opt =>
      opt.setName('broadcast')
        .setDescription('Broadcast this recap to the general channel (Admin only)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toString().toLowerCase();
    const now = Date.now();

    if (now - lastFinishedFetch > 60000 || cachedFinishedContests.length === 0) {
      try {
        const res = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 10000, headers: CF_HEADERS });
        if (res.data.status === 'OK') {
          cachedFinishedContests = res.data.result
            .filter(c => c.phase === 'FINISHED')
            .slice(0, 25);
          lastFinishedFetch = now;
        }
      } catch (err) {
        // ignore
      }
    }

    const filtered = cachedFinishedContests
      .filter(c => 
        String(c.id).includes(focusedValue) || 
        c.name.toLowerCase().includes(focusedValue)
      )
      .slice(0, 25)
      .map(c => ({
        name: `${c.id} — ${c.name.length > 80 ? c.name.slice(0, 77) + '...' : c.name}`,
        value: c.id
      }));

    await interaction.respond(filtered).catch(() => {});
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const contestIdInput = interaction.options.getInteger('contest');
    const shouldBroadcast = interaction.options.getBoolean('broadcast') || false;
    const guild = interaction.guild;

    // Check admin permission if broadcasting
    if (shouldBroadcast && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({
        content: '⚠️ Only server administrators can use the `broadcast` option to post publicly.'
      });
    }

    // 1. Fetch finished contests list
    let targetContest = null;
    try {
      const listRes = await axios.get(`${CF_BASE}/contest.list?gym=false`, { timeout: 15000, headers: CF_HEADERS });
      if (listRes.data.status === 'OK') {
        const finished = listRes.data.result.filter(c => c.phase === 'FINISHED');
        if (contestIdInput) {
          targetContest = finished.find(c => c.id === contestIdInput);
        } else {
          targetContest = finished[0];
        }
      }
    } catch (err) {
      return interaction.editReply({
        content: `❌ Failed to fetch contest list from Codeforces: ${err.message}`
      });
    }

    if (!targetContest) {
      return interaction.editReply({
        content: `❌ Could not find a finished contest matching ID \`${contestIdInput || 'latest'}\`.`
      });
    }

    // 2. Fetch standings
    let standingsData = null;
    try {
      const res = await axios.get(`${CF_BASE}/contest.standings?contestId=${targetContest.id}`, { timeout: 20000, headers: CF_HEADERS });
      if (res.data.status === 'OK' && res.data.result) {
        standingsData = res.data.result;
      }
    } catch (err) {
      return interaction.editReply({
        content: `❌ Failed to fetch contest standings from Codeforces: ${err.message}`
      });
    }

    if (!standingsData || !standingsData.problems) {
      return interaction.editReply({
        content: '❌ No problem data available for this contest.'
      });
    }

    const contestProblems = standingsData.problems;
    const rowByHandle = new Map();
    if (Array.isArray(standingsData.rows)) {
      for (const row of standingsData.rows) {
        if (row.party && Array.isArray(row.party.members) && row.party.members.length > 0) {
          const h = row.party.members[0].handle.toLowerCase();
          rowByHandle.set(h, row);
        }
      }
    }

    const users = getAllUsers().filter(u => u.cf_handle);
    const memberResults = [];

    for (const user of users) {
      // Check guild membership if run in a guild
      if (guild) {
        const member = await guild.members.fetch(user.discord_id).catch(() => null);
        if (!member) continue;
      }

      const h = user.cf_handle.toLowerCase();
      const row = rowByHandle.get(h);
      if (!row) continue;

      const problemResults = row.problemResults || [];
      const solvedIndices = [];
      let attemptedUnsolvedIdx = -1;
      let firstUnattemptedIdx = -1;

      for (let i = 0; i < contestProblems.length; i++) {
        const pr = problemResults[i];
        const prob = contestProblems[i];
        if (pr && pr.points > 0) {
          solvedIndices.push(prob.index);
        } else if (pr && pr.rejectedAttemptCount > 0) {
          if (attemptedUnsolvedIdx === -1) attemptedUnsolvedIdx = i;
        } else {
          if (firstUnattemptedIdx === -1) firstUnattemptedIdx = i;
        }
      }

      const allSolved = solvedIndices.length === contestProblems.length;
      let roadblock = null;
      let verdict = 'Unattempted';

      if (!allSolved) {
        const targetIdx = attemptedUnsolvedIdx !== -1 ? attemptedUnsolvedIdx : firstUnattemptedIdx;
        if (targetIdx !== -1) {
          roadblock = contestProblems[targetIdx];
          if (attemptedUnsolvedIdx !== -1) {
            try {
              const subRes = await axios.get(
                `${CF_BASE}/user.status?handle=${user.cf_handle}&from=1&count=30`,
                { timeout: 6000, headers: CF_HEADERS }
              );
              if (subRes.data.status === 'OK') {
                const sub = subRes.data.result.find(s => s.contestId === targetContest.id && s.problem?.index === roadblock.index);
                if (sub) {
                  const testNum = (sub.passedTestCount || 0) + 1;
                  if (sub.verdict === 'WRONG_ANSWER') verdict = `WA on test ${testNum}`;
                  else if (sub.verdict === 'TIME_LIMIT_EXCEEDED') verdict = `TLE on test ${testNum}`;
                  else if (sub.verdict === 'MEMORY_LIMIT_EXCEEDED') verdict = `MLE on test ${testNum}`;
                  else if (sub.verdict === 'RUNTIME_ERROR') verdict = `RTE on test ${testNum}`;
                  else if (sub.verdict === 'COMPILATION_ERROR') verdict = 'Compilation Error';
                  else verdict = sub.verdict ? sub.verdict.replace(/_/g, ' ') : 'Failed';
                }
              }
            } catch (_) {
              verdict = 'Attempted';
            }
          }
        }
      }

      memberResults.push({
        discord_id: user.discord_id,
        cf_handle: user.cf_handle,
        rank: row.rank || 0,
        solvedCount: solvedIndices.length,
        solvedIndices,
        allSolved,
        roadblock,
        verdict
      });
    }

    if (memberResults.length === 0) {
      return interaction.editReply({
        content: `ℹ️ None of the linked members in this server participated in **${targetContest.name}** (ID \`${targetContest.id}\`).`
      });
    }

    const embed = buildContestWrapupEmbed(targetContest, memberResults);

    if (shouldBroadcast && guild) {
      const channel = getWrapupChannel(guild);
      if (channel) {
        await channel.send({ embeds: [embed] }).catch(() => {});
        return interaction.editReply({
          content: `✅ Contest recap for **${targetContest.name}** broadcasted to ${channel}!`
        });
      }
    }

    return interaction.editReply({ embeds: [embed] });
  }
};
