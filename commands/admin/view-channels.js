// commands/admin/view-channels.js — View all configured channels for this server safely
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getFullGuildConfig, getConfig } = require('../../database/db');
const { CHANNEL_DEFS, isBotOwner, chunkLines } = require('../../utils/envHelper');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('view-channels')
    .setDescription('View all currently configured channels for this server (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guildId = interaction.guildId;
    const config = getFullGuildConfig(guildId);

    let activeCount = 0;
    const formatChannel = async (channelId, desc) => {
      const channel = channelId
        ? (interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null))
        : null;
      if (channel) {
        activeCount++;
        return `🟢 ${channel} (\`#${channel.name}\`)\n> *${desc}*`;
      }
      if (channelId) {
        return `🔴 \`#${channelId}\` *(inaccessible or deleted)*\n> *${desc}*`;
      }
      return `⚪ \`Not configured\`\n> *${desc}*`;
    };

    const defsToRender = [...CHANNEL_DEFS];
    const ownerViewing = isBotOwner(interaction);
    const totalCount = ownerViewing ? defsToRender.length + 1 : defsToRender.length;

    const coreLines = [];
    for (const def of defsToRender.filter(d => d.group === 'core')) {
      coreLines.push(`**${def.label}**\n${await formatChannel(config[def.key], def.desc)}`);
    }

    const commLines = [];
    for (const def of defsToRender.filter(d => d.group === 'comm')) {
      commLines.push(`**${def.label}**\n${await formatChannel(config[def.key], def.desc)}`);
    }

    if (ownerViewing) {
      const backupId = getConfig('backup_channel_id', 'global');
      const status = backupId ? `🟢 Configured (\`<#${backupId}>\`)` : '⚪ `Not configured`';
      commLines.push(`**💾 Database Backups (Host Only)**\n${status}\n> *Automated hourly SQLite snapshot archive*`);
      if (backupId) activeCount++;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: 'Server Channel Configuration',
        iconURL: interaction.guild.iconURL({ dynamic: true }) || undefined
      })
      .setTitle(`⚙️ Channel Router — ${interaction.guild.name}`)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 🏛️ **Server:** **${interaction.guild.name}**`,
        `> 📡 **Active Feeds:** **\`${activeCount}\`** of **\`${totalCount}\`** configured`,
        '> 💡 **Quick Setup:** Run `/set-channel feature:All Features` to bind all feeds at once!',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'))
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'BigOof Admin Routing Suite · /set-channel to reconfigure' })
      .setTimestamp();

    chunkLines(coreLines, 1000, '\n\n').forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? '⚡ Competitive Feeds & Dashboards' : '⚡ Feeds (cont.)', value: chunk, inline: false });
    });
    chunkLines(commLines, 1000, '\n\n').forEach((chunk, idx) => {
      embed.addFields({ name: idx === 0 ? '📢 Community & Systems' : '📢 Systems (cont.)', value: chunk, inline: false });
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
