// commands/ask-help.js — Request community assistance with deferred attachment forwarding
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('ask-help')
  .setDescription('Ask community members for assistance on a problem or code bug')
  .addStringOption(opt =>
    opt.setName('problem')
      .setDescription('Description of the issue or what you are trying to solve')
      .setRequired(true)
  );

for (let i = 1; i <= 5; i++) {
  data.addAttachmentOption(opt =>
    opt.setName(`image${i}`)
      .setDescription(`Attach image ${i} (screenshot/code snippet)`)
      .setRequired(false)
  );
}

module.exports = {
  guildOnly: true,
  data,
  async execute(interaction) {
    await interaction.deferReply();

    const problem = interaction.options.getString('problem');
    const user = interaction.user;

    const attachments = [];
    for (let i = 1; i <= 5; i++) {
      const attachment = interaction.options.getAttachment(`image${i}`);
      if (attachment) attachments.push(attachment.url);
    }

    const quotedProblem = problem.replace(/\r?\n/g, '\n> ').slice(0, 3500);
    const embed = new EmbedBuilder()
      .setColor(0xFF9800)
      .setAuthor({
        name: 'Community Problem Solving Support',
        iconURL: user.displayAvatarURL({ dynamic: true })
      })
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `> 👤 **Author:** <@${user.id}>`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '**Problem & Context:**',
        `> ${quotedProblem}`,
        '',
        '💡 *Got an idea, edge case, or complexity hint? Jump in to discuss!*'
      ].join('\n').slice(0, 4096))
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'BigOof Peer Support · /ask-help', iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    try {
      await interaction.editReply({
        content: `🔔 Community notification: ${user} asked for help!`,
        embeds: [embed],
        files: attachments
      });
    } catch {
      // Fallback if attachments exceed upload size limits
      if (attachments.length > 0) {
        embed.addFields({
          name: '📎 Attachments',
          value: attachments.map((u, idx) => `[Attachment ${idx + 1}](${u})`).join(' · '),
          inline: false
        });
      }
      await interaction.editReply({
        content: `🔔 Community notification: ${user} asked for help!`,
        embeds: [embed]
      });
    }
  }
};
