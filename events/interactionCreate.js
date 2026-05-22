// events/interactionCreate.js — Route slash commands and handle interactions
const { addReminder, getUpcomingContests } = require('../database/db');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'contest_subscribe_select') {
        const contestIds = interaction.values;
        
        let subbedCount = 0;
        for (const cid of contestIds) {
          addReminder(interaction.user.id, cid);
          subbedCount++;
        }

        return interaction.reply({
          content: `✅ Successfully subscribed to ${subbedCount} contest(s)! You will receive frequent DM reminders starting 2 hours before they begin.`,
          ephemeral: true
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return interaction.reply({ content: '❌ Unknown command.', flags: 64 });
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[interactionCreate] Error in /${interaction.commandName}:`, err);
      const reply = { content: `❌ Error: ${err.message}`, flags: 64 };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch (_) {}
    }
  }
};
