// events/interactionCreate.js — Centralized router for slash commands, autocomplete, buttons, selects, & modals
const { handleGitHubSyncInteraction } = require('../tasks/githubFeed');
const { handleStudyInteraction } = require('../tasks/studyTodo');

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

    if (
      (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith('study-')
    ) {
      try {
        await handleStudyInteraction(interaction, client);
      } catch (err) {
        console.error('[StudyTodo Interaction Error]', err);
        const reply = { content: `❌ Error: ${err.message}`, flags: 64 };
        if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'github_sync_btn') {
        try {
          await handleGitHubSyncInteraction(interaction, client);
        } catch (err) {
          console.error('[GitHub Button Error]', err);
          return interaction.editReply({ content: `❌ Sync error: ${err.message}` }).catch(() => {});
        }
        return;
      }

      if (interaction.customId.startsWith('vc-join-')) {
        const { handleVCJoinButton } = require('../commands/vc');
        try {
          await handleVCJoinButton(interaction);
        } catch (err) {
          console.error('[VC Button Error]', err);
          const reply = { content: `❌ Error: ${err.message}`, flags: 64 };
          if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
          else await interaction.reply(reply).catch(() => {});
        }
        return;
      }

      if (interaction.customId.startsWith('vs-')) {
        const { handleVSButton } = require('../utils/vsHandlers');
        try {
          await handleVSButton(interaction, client);
        } catch (err) {
          console.error('[VS Button Error]', err);
          const reply = { content: `❌ Error: ${err.message}`, flags: 64 };
          if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
          else await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return interaction.reply({ content: '❌ Unknown command.', flags: 64 });
    }

    if (command.guildOnly && !interaction.guild) {
      return interaction.reply({
        content: '⚠️ This command can only be used inside a Discord server.',
        flags: 64
      });
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[interactionCreate] Error in /${interaction.commandName}:`, err);
      const reply = { content: `❌ Error: ${err.message}`, flags: 64 };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
};
