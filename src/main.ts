// MathSoc Verify
// Written by Evan Girardin, F22 MathSoc President
// first last at g mail dot com

import {
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
} from 'discord.js';
import { InfoLog, ErrorLog } from './utils/logger.ts';
import { userExistsInDB } from './utils/verify.ts';
import { db } from './utils/db.ts';
import unverify from './commands/unverify.ts';
import verifier from './commands/verifier.ts';
import whois from './commands/whois.ts';

import { verify } from './utils/verify.ts';
import { iam } from './utils/iam.ts';
import type { User } from './utils/types.ts';

const main = async () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const commands = {
    unverify,
    verifier,
    whois,
  };

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const row = db.prepare('SELECT watiam FROM users WHERE userid = ?;').get(member.id) as User;
      if (row) {
        InfoLog(
          `On ${member.guild.name}, user ${member.id} (${member.user.username}) is already verified as ${row.watiam}. Giving roles...`
        );
        const role = member.guild.roles.cache.find((role) => role.name === 'Verified');
        if (role) {
          await member.roles.add(role);
        }
      }
    } catch (e) {
      ErrorLog('CRITICAL: Something went wrong after Events.GuildMemberAdd!');
      ErrorLog(e);
    }
  });

  // Command handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const command = commands[interaction.commandName as keyof typeof commands];
    if (!command) {
      ErrorLog(`No command matching ${interaction.commandName}!`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (e) {
      ErrorLog(e);
      await interaction.reply({
        content: 'There was an error processing your command.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  });

  // Button handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    try {
      if (interaction.customId === 'watiamButton' || interaction.customId === 'verifyButton') {
        const row = userExistsInDB(interaction.user.id);
        if (row[0]) {
          InfoLog(
            `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) requested verify modal but is already verified. Giving roles...`
          );
          await interaction.reply({
            content: `You're already verified as ${row[0].watiam}. If this is a mistake, please contact an administrator.`,
            flags: [MessageFlags.Ephemeral],
          });
          const role = interaction.guild?.roles.cache.find((role) => role.name === 'Verified');
          if (!interaction.member || !role) {
            await interaction.reply({
              content: `${role ? 'Member' : 'Verified role'} not found!`,
              flags: [MessageFlags.Ephemeral],
            });
            return;
          }
          const member = await interaction.guild?.members.fetch(interaction.member?.user.id);
          await member?.roles.add(role);
          return;
        }
      }
      if (interaction.customId === 'watiamButton') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('watiamModal')
            .setTitle('WatIAM Verification - WatIAM ID')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('WatIAM')
                .setDescription('Your WatIAM ID (e.g. j2smith).')
                .setTextInputComponent((textInput) =>
                  textInput
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setCustomId('watiamInput')
                )
            )
        );
      }
      if (interaction.customId === 'verifyButton') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('verifyModal')
            .setTitle('WatIAM Verification - Code')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('Verification code')
                .setDescription('Please enter your 6-digit verification code.')
                .setTextInputComponent((textInput) =>
                  textInput
                    .setCustomId('codeInput')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(6)
                    .setMinLength(6)
                    .setRequired(true)
                )
            )
        );
      }
    } catch (e) {
      ErrorLog(e);
      await interaction.reply({
        content: 'There was an error responding to the button interaction.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  });

  // Modal handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) {
      return;
    }
    try {
      if (interaction.customId === 'watiamModal') {
        try {
          await iam(interaction, interaction.fields.getTextInputValue('watiamInput'));
        } catch (e) {
          ErrorLog(e);
          await interaction.reply({
            content: 'There was an error responding to the modal interaction.',
            flags: [MessageFlags.Ephemeral],
          });
        }
      } else if (interaction.customId === 'verifyModal') {
        try {
          await verify(interaction, interaction.fields.getTextInputValue('codeInput'));
        } catch (e) {
          ErrorLog(e);
          await interaction.reply({
            content: 'There was an error responding to the modal interaction.',
            flags: [MessageFlags.Ephemeral],
          });
        }
      }
    } catch (e) {
      ErrorLog(e);
      await interaction.reply({
        content: 'There was an error responding to the modal interaction.',
        flags: [MessageFlags.Ephemeral],
      });
    }
  });

  // on ready, create db and tables if they don't already exist
  client.once(Events.ClientReady, () => {
    InfoLog(``);
    InfoLog(`************************`);
    InfoLog(`MathSoc Verify`);
    InfoLog(`(c) 2022 The Mathematics Society of the University of Waterloo`);
    InfoLog(`Logged in as ${client.user?.tag}`);
    InfoLog(`************************`);

    db.prepare(
      "CREATE TABLE IF NOT EXISTS usercodes(userid text, watiam text, code text, expires_at DATE DEFAULT (DATETIME('now', '+24 hours')), PRIMARY KEY (userid))"
    ).run();
    db.prepare(
      'CREATE TABLE IF NOT EXISTS users(userid text, watiam text, code text, PRIMARY KEY (userid))'
    ).run();
  });

  let interrupts = 0;
  process.on('SIGINT', function () {
    if (interrupts === 0) {
      InfoLog('Caught interrupt signal -- shutting down now!');
      process.exit();
    }
    ++interrupts;
  });

  await client.login(process.env.TOKEN);
};

await main();
