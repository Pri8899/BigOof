// commands/compare.js — Head-to-head Codeforces comparison across members or arbitrary handles
const { SlashCommandBuilder } = require('discord.js');
const { getUser, getStreak, getHeadToHeadVersus } = require('../database/db');
const { getCFUser, getCFSolvedSet } = require('../utils/codeforces');
const { buildCompareEmbed, errorEmbed } = require('../utils/embeds');

const CF_ICON = 'https://codeforces.org/s/0/images/codeforces-telegram-square.png';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Head-to-head comparison between two competitive programmers')
    .addUserOption(opt =>
      opt.setName('user1')
        .setDescription('First member to compare')
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt.setName('user2')
        .setDescription('Second member to compare (defaults to yourself)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('handle1')
        .setDescription('Compare arbitrary Codeforces handle 1')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('handle2')
        .setDescription('Compare arbitrary Codeforces handle 2')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const u1 = interaction.options.getMember('user1') || interaction.options.getUser('user1');
    const u2 = interaction.options.getMember('user2') || interaction.options.getUser('user2');
    const handle1Opt = interaction.options.getString('handle1')?.trim() || null;
    const handle2Opt = interaction.options.getString('handle2')?.trim() || null;

    let cfHandle1 = null, cfHandle2 = null;
    let name1 = null, name2 = null;
    let avatar1 = CF_ICON, avatar2 = CF_ICON;
    let discordId1 = null, discordId2 = null;

    const resolveMemberMeta = (target) => {
      const id = target.id;
      const name = target.displayName || target.username || 'Member';
      const avatar = typeof target.user?.displayAvatarURL === 'function'
        ? target.user.displayAvatarURL({ dynamic: true })
        : (typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ dynamic: true }) : CF_ICON);
      return { id, name, avatar };
    };

    if (handle1Opt && handle2Opt) {
      cfHandle1 = handle1Opt;
      cfHandle2 = handle2Opt;
      name1 = cfHandle1;
      name2 = cfHandle2;
    } else if (!u1 && !u2 && (handle1Opt || handle2Opt)) {
      const callerDb = getUser(interaction.user.id);
      if (!callerDb?.cf_handle) {
        const provided = handle1Opt || handle2Opt;
        return interaction.editReply({
          embeds: [errorEmbed(
            'Handle Required',
            `You haven't linked a Codeforces account yet. Link yours with \`/link\` or specify both handles: \`/compare handle1:${provided} handle2:your_handle\`.`
          )]
        });
      }
      const callerMeta = resolveMemberMeta(interaction.member || interaction.user);
      discordId1 = callerMeta.id;
      name1 = callerMeta.name;
      avatar1 = callerMeta.avatar;
      cfHandle1 = callerDb.cf_handle;
      cfHandle2 = handle1Opt || handle2Opt;
      name2 = cfHandle2;
    } else if ((u1 || u2) && (handle1Opt || handle2Opt)) {
      const target = u1 || u2;
      const meta = resolveMemberMeta(target);
      const dbU = getUser(meta.id);
      if (!dbU?.cf_handle) {
        return interaction.editReply({
          embeds: [errorEmbed('Unlinked Account', `**${meta.name}** has not linked a Codeforces account yet.`)]
        });
      }
      discordId1 = meta.id;
      name1 = meta.name;
      avatar1 = meta.avatar;
      cfHandle1 = dbU.cf_handle;
      cfHandle2 = handle1Opt || handle2Opt;
      name2 = cfHandle2;
    } else if (u1 || u2) {
      const target1 = (u1 && u2) ? u1 : (interaction.member || interaction.user);
      const target2 = (u1 && u2) ? u2 : (u1 || u2);

      const m1 = resolveMemberMeta(target1);
      const m2 = resolveMemberMeta(target2);
      const user1 = getUser(m1.id);
      const user2 = getUser(m2.id);

      if (!user1?.cf_handle) {
        return interaction.editReply({
          embeds: [errorEmbed('Unlinked Account', `**${m1.name}** has not linked a Codeforces account yet! Use \`/link\` first.`)]
        });
      }
      if (!user2?.cf_handle) {
        return interaction.editReply({
          embeds: [errorEmbed('Unlinked Account', `**${m2.name}** has not linked a Codeforces account yet! Use \`/link\` first.`)]
        });
      }

      discordId1 = m1.id;
      discordId2 = m2.id;
      name1 = m1.name;
      name2 = m2.name;
      avatar1 = m1.avatar;
      avatar2 = m2.avatar;
      cfHandle1 = user1.cf_handle;
      cfHandle2 = user2.cf_handle;
    } else {
      return interaction.editReply({
        embeds: [errorEmbed(
          'Missing Arguments',
          'Specify at least one member or handle, e.g. `/compare user1:@Member` or `/compare handle1:tourist handle2:Benq`.'
        )]
      });
    }

    const [cfData1, cfData2, solvedSet1, solvedSet2] = await Promise.all([
      getCFUser(cfHandle1),
      getCFUser(cfHandle2),
      getCFSolvedSet(cfHandle1),
      getCFSolvedSet(cfHandle2)
    ]);

    if (!cfData1) {
      return interaction.editReply({
        embeds: [errorEmbed('Codeforces Lookup Error', `Could not find Codeforces profile for \`${cfHandle1}\`.`)]
      });
    }
    if (!cfData2) {
      return interaction.editReply({
        embeds: [errorEmbed('Codeforces Lookup Error', `Could not find Codeforces profile for \`${cfHandle2}\`.`)]
      });
    }

    let commonCount = 0;
    for (const p of solvedSet1) {
      if (solvedSet2.has(p)) commonCount++;
    }

    const solvedSet1Size = solvedSet1.size || cfData1.solved || 0;
    const solvedSet2Size = solvedSet2.size || cfData2.solved || 0;
    const unique1 = Math.max(0, solvedSet1Size - commonCount);
    const unique2 = Math.max(0, solvedSet2Size - commonCount);

    const h2h = (discordId1 && discordId2)
      ? getHeadToHeadVersus(discordId1, discordId2)
      : { total: 0, wins1: 0, wins2: 0, ties: 0 };

    const streak1 = discordId1 ? (getStreak(discordId1, 'cf')?.current_streak || 0) : null;
    const streak2 = discordId2 ? (getStreak(discordId2, 'cf')?.current_streak || 0) : null;

    const embed = buildCompareEmbed({
      name1, name2,
      avatar1, avatar2,
      cfHandle1, cfHandle2,
      cfData1, cfData2,
      solvedSet1Size,
      solvedSet2Size,
      commonCount,
      unique1,
      unique2,
      h2h,
      streak1,
      streak2
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
