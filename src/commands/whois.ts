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
    .setName('whois')
    .setDescription('Queries a Discord-WatIAM mapping')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('watiam')
        .setDescription('Provided a WatIAM ID, queries for the associated Discord tag')
        .addStringOption((option) =>
          option.setName('watiam').setDescription('The WatIAM ID to query').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('user')
        .setDescription('Provided a Discord tag, queries for the associated WatIAM ID')
        .addUserOption((option) =>
          option.setName('user').setDescription('The Discord tag to query').setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(interaction.guild?.id === process.env.SERVER_ID)) {
      InfoLog(
        `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) attempted to whois in without permission.`
      );
      await interaction.reply({
        content: 'You do not have permission to look up members. Please contact an administrator.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    try {
      let row: User | undefined;
      if (interaction.options.getSubcommand() === 'user') {
        const u = interaction.options.getUser('user');
        if (!u) {
          await interaction.reply({ content: 'User not found.', flags: [MessageFlags.Ephemeral] });
          return;
        }
        row = db.prepare('SELECT * FROM users WHERE userid = ?;').get(u.id) as User | undefined;
      } else {
        const u = interaction.options.getString('watiam');
        if (!u) {
          await interaction.reply({
            content: 'WatIAM not found.',
            flags: [MessageFlags.Ephemeral],
          });
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
        `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) is querying ${row.watiam}`
      );
      await interaction.reply({
        content: `Discord user ${interaction.user.tag} has WatIAM ID ${row.watiam}.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (e) {
      await interaction.reply({
        content: 'This user is not verified.',
        flags: [MessageFlags.Ephemeral],
      });
      ErrorLog(e);
      return;
    }
  },
};
