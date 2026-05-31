// events/interactionCreate.js — Route slash commands and handle reactions
module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          console.error('[Autocomplete Error]', err);
        }
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
