const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const {db_path, serverId} = require('../config.json');
const {InfoLog, ErrorLog} = require('../utils/logger.js');
const {isValidId} = require('../utils/verify.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whois')
        .setDescription('Queries a Discord-WatIAM mapping')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('watiam')
                .setDescription('Provided a WatIAM ID, queries for the associated Discord tag')
                .addStringOption(option => option.setName('watiam').setDescription('The WatIAM ID to query').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Provided a Discord tag, queries for the associated WatIAM ID')
                .addUserOption(option => option.setName('user').setDescription('The Discord tag to query').setRequired(true))),

    async execute(interaction) {
        if (!(interaction.guild.id === serverId)) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) attempted to whois in without permission.`);
            await interaction.reply({content: 'You do not have permission to unverify members. Please contact an administrator.', ephemeral: true});
            return;
        }
        let db = await sqlite.open({
            filename: db_path,
            driver: sqlite3.Database
        });
        let isUser = (interaction.options.getSubcommand() === 'user');
        let u = (isUser ? interaction.options.getUser('user') : interaction.options.getString('watiam'));
        InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) is querying ` + (isUser ? `${u.id} (${u.tag}).` : `${u}`));
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
        } catch (e) {
            await interaction.reply({content: 'This user is not verified.', ephemeral: true});
            await db.close();
            ErrorLog(e);
            return;
        }
        if (row) {
            if (isUser) {
                await interaction.reply({content: `Discord user ${u} has WatIAM ID ${row.watiam}.`, ephemeral: true});
            } else {
                let tag = await interaction.client.users.fetch(row.userid);
                await interaction.reply({content: `Discord user ${tag ?? row.userid} has WatIAM ID ${id}.`, ephemeral: true});
            }
        } else {
            await interaction.reply({content: `This user is not verified.`, ephemeral: true});
        }
        await db.close();
    }
}
