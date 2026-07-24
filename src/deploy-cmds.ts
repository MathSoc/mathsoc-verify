import { REST, Routes } from 'discord.js';
import unverify from './commands/unverify.ts';
import verifier from './commands/verifier.ts';
import whois from './commands/whois.ts';

const commands = [unverify.data.toJSON(), verifier.data.toJSON(), whois.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN ?? '');

try {
  console.log(`Started refreshing ${commands.length} application (/) commands.`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), { body: commands });

  console.log(`Successfully reloaded application (/) commands.`);
} catch (error) {
  console.error(error);
}
process.exit(0);
