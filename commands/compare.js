// commands/compare.js — Head-to-head competitive programming comparison
const { SlashCommandBuilder } = require('discord.js');
const { getUser, getRatings, getStreak, getHeadToHeadVersus } = require('../database/db');
const { getCFUser, getCFSolvedSet } = require('../utils/codeforces');
const { buildCompareEmbed, errorEmbed } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Head-to-head comparison between two competitive programmers')
    .addUserOption(opt =>
      opt.setName('user1')
        .setDescription('First member to compare')
        .setRequired(false))
    .addUserOption(opt =>
      opt.setName('user2')
        .setDescription('Second member to compare (defaults to yourself)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('handle1')
        .setDescription('Compare arbitrary Codeforces handle 1')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('handle2')
        .setDescription('Compare arbitrary Codeforces handle 2')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const handle1Opt = interaction.options.getString('handle1');
    const handle2Opt = interaction.options.getString('handle2');

    let member1 = null;
    let member2 = null;
    let user1 = null;
    let user2 = null;
    let cfHandle1 = null;
    let cfHandle2 = null;
    let name1 = null;
    let name2 = null;
    let avatar1 = null;
    let avatar2 = null;
    let discordId1 = null;
    let discordId2 = null;

    if (handle1Opt && handle2Opt) {
      cfHandle1 = handle1Opt.trim();
      cfHandle2 = handle2Opt.trim();
      name1 = cfHandle1;
      name2 = cfHandle2;
      avatar1 = 'https://codeforces.org/s/0/images/codeforces-telegram-square.png';
      avatar2 = 'https://codeforces.org/s/0/images/codeforces-telegram-square.png';
    } else {
      const u1 = interaction.options.getMember('user1');
      const u2 = interaction.options.getMember('user2');

      if (!u1 && !u2 && !handle1Opt) {
        return interaction.editReply({
          embeds: [errorEmbed('Missing Arguments', 'Please specify at least one member to compare, e.g. `/compare user1:@Member` or provide two handles `/compare handle1:tourist handle2:Benq`.')]
        });
      }

      if (u1 && u2) {
        member1 = u1;
        member2 = u2;
      } else if (u1 && !u2) {
        member1 = interaction.member;
        member2 = u1;
      } else if (!u1 && u2) {
        member1 = interaction.member;
        member2 = u2;
      } else if (handle1Opt && !handle2Opt) {
        const callerUser = getUser(interaction.user.id);
        if (!callerUser?.cf_handle) {
          return interaction.editReply({
            embeds: [errorEmbed('Handle Required', `You haven't linked a Codeforces account yet. Please link your account with \`/link\` or specify both handles: \`/compare handle1:${handle1Opt} handle2:your_handle\`.`)]
          });
        }
        member1 = interaction.member;
        cfHandle1 = callerUser.cf_handle;
        cfHandle2 = handle1Opt.trim();
        name1 = interaction.member.displayName;
        name2 = cfHandle2;
        avatar1 = interaction.user.displayAvatarURL({ dynamic: true });
        avatar2 = 'https://codeforces.org/s/0/images/codeforces-telegram-square.png';
      }

      if (member1 && member2) {
        user1 = getUser(member1.id);
        user2 = getUser(member2.id);
        discordId1 = member1.id;
        discordId2 = member2.id;
        name1 = member1.displayName;
        name2 = member2.displayName;
        avatar1 = member1.user.displayAvatarURL({ dynamic: true });
        avatar2 = member2.user.displayAvatarURL({ dynamic: true });

        if (!user1?.cf_handle) {
          return interaction.editReply({
            embeds: [errorEmbed('Unlinked Account', `**${name1}** has not linked a Codeforces account yet! Use \`/link\` first.`)]
          });
        }
        if (!user2?.cf_handle) {
          return interaction.editReply({
            embeds: [errorEmbed('Unlinked Account', `**${name2}** has not linked a Codeforces account yet! Use \`/link\` first.`)]
          });
        }

        cfHandle1 = user1.cf_handle;
        cfHandle2 = user2.cf_handle;
      }
    }

    // Fetch stats in parallel
    const [cfData1, cfData2, solvedSet1, solvedSet2] = await Promise.all([
      getCFUser(cfHandle1),
      getCFUser(cfHandle2),
      getCFSolvedSet(cfHandle1),
      getCFSolvedSet(cfHandle2)
    ]);

    if (!cfData1) {
      return interaction.editReply({
        embeds: [errorEmbed('Codeforces Lookup Error', `Could not find Codeforces profile for handle \`${cfHandle1}\`.`)]
      });
    }
    if (!cfData2) {
      return interaction.editReply({
        embeds: [errorEmbed('Codeforces Lookup Error', `Could not find Codeforces profile for handle \`${cfHandle2}\`.`)]
      });
    }

    // Compute problem overlap
    let commonCount = 0;
    for (const p of solvedSet1) {
      if (solvedSet2.has(p)) commonCount++;
    }

    const unique1 = Math.max(0, solvedSet1.size - commonCount);
    const unique2 = Math.max(0, solvedSet2.size - commonCount);

    // Versus match record if both are guild members
    let h2h = { total: 0, wins1: 0, wins2: 0, ties: 0 };
    if (discordId1 && discordId2) {
      h2h = getHeadToHeadVersus(discordId1, discordId2);
    }

    // Streaks if members
    const streak1 = discordId1 ? (getStreak(discordId1, 'cf')?.current_streak || 0) : null;
    const streak2 = discordId2 ? (getStreak(discordId2, 'cf')?.current_streak || 0) : null;

    const emojis = await getPlatformEmojis(interaction.guild);

    const embed = buildCompareEmbed({
      name1, name2,
      avatar1, avatar2,
      cfHandle1, cfHandle2,
      cfData1, cfData2,
      solvedSet1Size: solvedSet1.size || cfData1.solved,
      solvedSet2Size: solvedSet2.size || cfData2.solved,
      commonCount,
      unique1,
      unique2,
      h2h,
      streak1,
      streak2,
      emojis
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
