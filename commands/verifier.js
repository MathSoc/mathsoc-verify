const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const {InfoLog, ErrorLog} = require('../utils/logger.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verifier')
        .setDescription('Send a welcome/verification message in the current channel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    async execute(interaction) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('watiamButton')
                    .setLabel('Submit WatIAM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('verifyButton')
                    .setLabel('Enter verification code')
                    .setStyle(ButtonStyle.Primary)
            );
        await interaction.deferReply();
        await interaction.deleteReply();
        await interaction.channel.send({
            content: `Welcome to ${interaction.guild.name}! This is a MathSoc-affiliated Discord server. To verify that you are a University of Waterloo student, please click the "Submit WatIAM" button below.\n- Your WatIAM ID will be stored on the Computer Science Club servers, and is accessible only by MathSoc executives.\n- Your WatIAM ID will only be used to verify account uniqueness, or in the case that a law or University policy is broken.\n- If you would not like your WatIAM ID to be stored, please contact the VPC and ask for an alternate method of verification.`,
            components: [row]
        });
    }
}
