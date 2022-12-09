const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const {db_path, serverId} = require('../config.json');
const {InfoLog, ErrorLog} = require('../utils/logger.js');
const {isValidId} = require('../utils/verify.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription('Removes Discord-WatIAM mapping from verification database')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('watiam')
                .setDescription('Provided a WatIAM ID, unverifies the associated user')
                .addStringOption(option => option.setName('watiam').setDescription('The WatIAM ID to unverify').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Provided a Discord tag, unverifies the associated user')
                .addUserOption(option => option.setName('user').setDescription('The Discord tag to unverify').setRequired(true))),

    async execute(interaction) {
        if (!(interaction.guild.id === serverId)) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) attempted to unverify without permission.`);
            await interaction.reply({content: 'You do not have permission to unverify members. Please contact an administrator.', ephemeral: true});
            return;
        }

        let db = await sqlite.open({
            filename: db_path,
            driver: sqlite3.Database
        });
        let isUser = (interaction.options.getSubcommand() === 'user');
        let u = (isUser ? interaction.options.getUser('user') : interaction.options.getString('watiam'));
        InfoLog(`User ${interaction.user.id} (${interaction.user.tag}) is unverifying ` + (isUser ? `${u.id} (${u.tag}).` : `${u}`));
        let row;
        let id;
        try {
            id = (isUser ? null : await isValidId(u, interaction));
            row = await db.get(`SELECT * FROM users WHERE ` + (isUser ? `userid = ?` : `watiam = ?`), [isUser ? u.id : id]);
            if (!row) {
                await interaction.reply({content: 'This user is not verified.', ephemeral: true});
                await db.close();
                return;
            }
            await interaction.client.guilds.cache.forEach(async (guild) => {
                try {
                    const role = await guild.roles.cache.find(role => role.name === 'Verified');
                    const bruh = await guild.members.fetch(isUser ? interaction.guild.members.cache.get(u.id) : row.userid)
                    await bruh.roles.remove(role);
                } catch (e) {
                    ErrorLog(`Failed to unverify user on guild ${guild.id}.`)
                }
            });
            await db.run(`DELETE FROM users WHERE ` + (isUser ? `userid = ?` : `watiam = ?`), [isUser ? u.id : id]);
        } catch (e) {
            await interaction.reply({content: 'This user is not verified.', ephemeral: true});
            await db.close();
            ErrorLog(e);
            return;
        }
        await interaction.reply({content: `User ${isUser ? u : id} has been unverified.`, ephemeral: true});
        await db.close();
    }
}
