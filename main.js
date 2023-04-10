// MathSoc Verify
// Written by Evan Girardin, F22 MathSoc President
// first last at g mail dot com

const {
    Client, Collection, Events, GatewayIntentBits,
    ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('node:fs')
const path = require('node:path')
const sib = require('sib-api-v3-sdk');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const {db_path,token,sendinblue,clientId,serverId,templateId} = require('./config.json');
const {InfoLog, ErrorLog} = require('./utils/logger.js')

const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]});
const mailClient = sib.ApiClient.instance
const apiKey = mailClient.authentications['api-key']
apiKey.apiKey = sendinblue;

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command)
    } else {
        throw `Data or execute property missing from command at ${filePath}!`;
    }
}

client.on(Events.GuildMemberAdd, async member => {
    try {
    const db = await sqlite.open({
        filename: db_path,
        driver: sqlite3.Database
    });
    await db.run(`
        SELECT
            watiam
        FROM users
        WHERE
            userid = ?`,
    [member.id]);
    if (row) {
        InfoLog(`On ${member.guild.name}, user ${member.id} (${member.tag}) is already verified as ${row.watiam}. Giving roles...`);
        member.roles.add(interaction.guild.roles.cache.find(role => role.name === 'Verified'));
    }
    } catch (e) {
        ErrorLog("CRITICAL: Something went wrong after Events.GuildMemberAdd!")
        ErrorLog(e);
    }
});

// Command handler
client.on(Events.InteractionCreate, async interaction => {
    try {
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        ErrorLog(`No command matching ${interaction.commandName}!`);
    }
    try {
        await command.execute(interaction);
    } catch (e) {
        ErrorLog(e);
        await interaction.reply({content: 'There was an error processing your command.', ephemeral: true});
    }
    } catch (e) {
        ErrorLog(e);
        await interaction.reply({content: 'There was an error responding to the modal interaction.', ephemeral: true});
    }
});

// Button handler
client.on(Events.InteractionCreate, async interaction => {
    try {
    if (!interaction.isButton) return;
    if (interaction.customId === 'watiamButton' || interaction.customId === 'verifyButton') {
        const {userExistsInDB} = require('./utils/verify.js');
        const db = await sqlite.open({
            filename: db_path,
            driver: sqlite3.Database
        });
        const row = await userExistsInDB(interaction.user.id, db);
        if (row[0]) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) requested verify modal but is already verified. Giving roles...`)
            await interaction.reply({content: `You're already verified as ${row[0].watiam}. If this is a mistake, please contact an administrator.`, ephemeral: true});
            const role = await interaction.guild.roles.cache.find(role => role.name === 'Verified');
            await interaction.member.roles.add(role);
            await db.close();
            return;
        }
        await db.close();
    }
    if (interaction.customId === 'watiamButton') {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId('watiamModal')
                .setTitle('WatIAM Verification - WatIAM ID')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('watiamInput')
                            .setLabel('Please enter your WatIAM ID (e.g. j2smith).')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                )
        );
    }
    if (interaction.customId === 'verifyButton') {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId('verifyModal')
                .setTitle('WatIAM Verification - Code')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('codeInput')
                            .setLabel('Please enter your 6-digit verification code.')
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
        await interaction.reply({content: 'There was an error responding to the button interaction.', ephemeral: true});
    }
});

// Modal handler
client.on(Events.InteractionCreate, async interaction => {
    try {
    const {verify} = require('./utils/verify.js')
    const {iam} = require('./utils/iam.js')
    if (!interaction.isModalSubmit()) return;
    else if (interaction.customId === 'watiamModal') {
        try {
            await iam(interaction, interaction.fields.getTextInputValue('watiamInput'));
        } catch (e) {
            ErrorLog(e);
            await interaction.reply({content: 'There was an error responding to the modal interaction.', ephemeral: true});
        }
    }
    if (interaction.customId === 'verifyModal') {
        try {
            await verify(interaction, interaction.fields.getTextInputValue('codeInput'));
        } catch (e) {
            ErrorLog(e);
            await interaction.reply({content: 'There was an error responding to the modal interaction.', ephemeral: true});
        }
    }
    } catch (e) {
        ErrorLog(e);
        await interaction.reply({content: 'There was an error responding to the modal interaction.', ephemeral: true});
    }
});

// on ready, create db and tables if they don't already exist
client.once(Events.ClientReady, async () => {
    InfoLog(``);
    InfoLog(`************************`);
    InfoLog(`MathSoc Verify`);
    InfoLog(`(c) 2022 The Mathematics Society of the University of Waterloo`);
    InfoLog(`Logged in as ${client.user.tag}`);
    InfoLog(`************************`);

    let db = await sqlite.open({
        filename: db_path,
        driver: sqlite3.Database
    });

    await db.exec('CREATE TABLE IF NOT EXISTS usercodes(userid text, watiam text, code text, expires_at DATE DEFAULT (DATETIME(\'now\', \'+24 hours\')), PRIMARY KEY (userid))');
    await db.exec('CREATE TABLE IF NOT EXISTS users(userid text, watiam text, code text, PRIMARY KEY (userid))');

    await db.close();
});

let interrupts = 0;
process.on('SIGINT', function() {
    if (interrupts == 0) {
        InfoLog('Caught interrupt signal -- shutting down now!');
        process.exit();
    }
    ++interrupts;
});

client.login(token);
