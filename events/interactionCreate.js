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

    if (interaction.isButton()) {
      if (interaction.customId === 'github_sync_btn') {
        try {
          await interaction.deferReply({ flags: 64 });
          const { runGitHubFeed } = require('../tasks/githubFeed');
          const { getUser } = require('../database/db');
          const dbUser = getUser(interaction.user.id);

          if (!dbUser || !dbUser.github_handle) {
            return interaction.editReply({
              content: '❌ You have not linked your GitHub account yet. Use `/github link <username>` first!'
            });
          }

          const result = await runGitHubFeed(client, interaction.user.id);
          if (!result.success && result.reason) {
            return interaction.editReply({ content: `❌ Sync failed: ${result.reason}` });
          }

          if (result.count > 0) {
            return interaction.editReply({
              content: `🚀 **Caught up!** Posted **${result.count}** unannounced activities for **${dbUser.github_handle}** to **#github**!`
            });
          } else {
            return interaction.editReply({
              content: `🟢 **Up-to-date!** All recent commits and activities for **${dbUser.github_handle}** are already posted in **#github**.`
            });
          }
        } catch (err) {
          console.error('[GitHub Button Error]', err);
          return interaction.editReply({ content: `❌ Sync error: ${err.message}` }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith('vs-')) {
        const { handleVSButton } = require('../utils/vsHandlers');
        try {
          await handleVSButton(interaction, client);
        } catch (err) {
          console.error('[VS Button Error]', err);
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: `❌ Error: ${err.message}`, flags: 64 });
            } else {
              await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 });
            }
          } catch (_) {}
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
