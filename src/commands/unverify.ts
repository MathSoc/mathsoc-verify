import {
  SlashCommandBuilder,
  PermissionsBitField,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { InfoLog, ErrorLog } from '../utils/logger.ts';
import { isValidId } from '../utils/verify.ts';
import { db } from '../utils/db.ts';
import type { User } from '../utils/types.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('unverify')
    .setDescription('Removes Discord-WatIAM mapping from verification database')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('watiam')
        .setDescription('Provided a WatIAM ID, unverifies the associated user')
        .addStringOption((option) =>
          option.setName('watiam').setDescription('The WatIAM ID to unverify').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('user')
        .setDescription('Provided a Discord tag, unverifies the associated user')
        .addUserOption((option) =>
          option.setName('user').setDescription('The Discord tag to unverify').setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(interaction.guild?.id === process.env.SERVER_ID)) {
      InfoLog(
        `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) attempted to unverify without permission.`
      );
      await interaction.reply({
        content: 'You do not have permission to unverify members. Please contact an administrator.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    let row: User | undefined;
    if (interaction.options.getSubcommand() === 'user') {
      const u = interaction.options.getUser('user');
      if (!u) {
        await interaction.reply({ content: 'User not found.' });
        return;
      }
      row = db.prepare('SELECT * FROM users WHERE userid = ?;').get(u.id) as User | undefined;
    } else {
      const u = interaction.options.getString('watiam');
      if (!u) {
        await interaction.reply({ content: 'WatIAM not provided.' });
        return;
      }
      const id = isValidId(u, interaction);
      row = db.prepare('SELECT * FROM users WHERE watiam = ?;').get(id) as User | undefined;
    }
    if (!row) {
      await interaction.reply({
        content: 'This user is not verified.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    InfoLog(
      `User ${interaction.user.id} (${interaction.user.tag}) is unverifying ${row.userid} (${row.watiam}).`
    );
    try {
      interaction.client.guilds.cache.forEach(async (guild) => {
        try {
          const role = guild.roles.cache.find((role) => role.name === 'Verified');
          if (!role) {
            await interaction.reply({ content: 'Verified role does not exist.' });
            return;
          }
          const member = await guild.members.fetch(row.userid);
          await member.roles.remove(role);
        } catch (e) {
          ErrorLog(`Failed to unverify user on guild ${guild.id}.`);
          ErrorLog(e);
        }
      });
      db.prepare(`DELETE FROM users WHERE userid = ?;`).run(row.userid);
    } catch (e) {
      await interaction.reply({
        content: 'This user is not verified.',
        flags: [MessageFlags.Ephemeral],
      });
      ErrorLog(e);
      return;
    }
    await interaction.reply({
      content: `User ${row.userid} (${row.watiam}) has been unverified.`,
      flags: [MessageFlags.Ephemeral],
    });
  },
};
