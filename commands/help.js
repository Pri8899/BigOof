const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Request help in the debug help lobby')
    .addStringOption(opt =>
      opt.setName('problem')
        .setDescription('Describe your problem')
        .setRequired(true)
    ),

  async execute(interaction) {
    const channelName = interaction.channel?.name?.toLowerCase() || '';
    
    // Check if the command is run in a channel containing "debug" or "help"
    // Typically "debug-help-lobby"
    if (!channelName.includes('debug') && !channelName.includes('help')) {
      return interaction.reply({ 
        content: 'This command can only be used in the **debug help lobby**.', 
        ephemeral: true 
      });
    }

    const problem = interaction.options.getString('problem');
    const user = interaction.user;

    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🚨 Help Required!')
      .setDescription(`**${user.username}** is facing an issue and needs some assistance.`)
      .addFields({ name: 'Problem Description', value: problem })
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Debug Help Lobby' })
      .setTimestamp();

    await interaction.reply({ 
      content: `@everyone, ${user} needs your help!`, 
      embeds: [embed] 
    });
  }
};
