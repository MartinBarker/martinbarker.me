const { SlashCommandBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Helper functions to extract IDs from different platforms
function extractYouTubeId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}

function extractSpotifyId(url) {
    // Handle both URLs and URIs (spotify:track:...)
    const match = url.match(/(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/) ||
                  url.match(/spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/);
    return match && `${match[1]}_${match[2]}`;
}

function extractSoundCloudId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^\/\s]+)\/([^\/\s\?]+)/);
    return match && `${match[1]}_${match[2]}`;
}

function extractBandcampId(url) {
    const match = url.match(/(?:https?:\/\/)?([^\.]+)\.bandcamp\.com\/(?:track|album)\/([^\/\s\?]+)/);
    return match && `${match[1]}_${match[2]}`;
}

// Function to chunk array into groups of specified size
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('makeplaylists')
        .setDescription('Fetch all media links and create YouTube playlist URLs (50 videos each)')
        .addChannelOption(option =>
            option
                .setName('inputchannel')
                .setDescription('Channel to fetch messages from (optional, defaults to current channel)')
                .setRequired(false))
        .addChannelOption(option =>
            option
                .setName('outputchannel')
                .setDescription('Channel to send output messages to (optional, defaults to input channel)')
                .setRequired(false))
        .addIntegerOption(option =>
            option
                .setName('repeat')
                .setDescription('Repeat this command every X hours (e.g., 24 for daily)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(168))
        .addBooleanOption(option =>
            option
                .setName('embedd')
                .setDescription('If true, prevents video embedding by wrapping URLs in angle brackets (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('debugsave_locally')
                .setDescription('If true, saves all video IDs to a local JSON file (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('outputyoutubeids')
                .setDescription('Send .txt file with all YouTube IDs after playlists (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('save_json')
                .setDescription('If true, saves all links organized by media source to a JSON file (default: false)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const inputChannel = interaction.options.getChannel('inputchannel') || interaction.channel;
        const outputChannel = interaction.options.getChannel('outputchannel') || inputChannel;
        const repeatHours = interaction.options.getInteger('repeat');
        const embedd = interaction.options.getBoolean('embedd') || false;
        const debugSaveLocally = interaction.options.getBoolean('debugsave_locally') || false;
        const outputAllIdsAsTxt = interaction.options.getBoolean('outputyoutubeids') || false;
        const saveJson = interaction.options.getBoolean('save_json') || false;

        // Check if input channel exists and is accessible
        if (!inputChannel) {
            await interaction.editReply('Input channel must be specified or command must be used in a text channel.');
            return;
        }

        // Check if input channel is a text channel
        if (inputChannel.type !== ChannelType.GuildText) {
            await interaction.editReply('Input channel must be a text channel.');
            return;
        }

        // Check if output channel is a text channel
        if (!outputChannel || outputChannel.type !== ChannelType.GuildText) {
            await interaction.editReply('Output channel must be a text channel.');
            return;
        }

        // Check if bot has permission to view and read messages in input channel
        const inputPerms = inputChannel.permissionsFor(interaction.client.user);
        if (!inputPerms || !inputPerms.has('ViewChannel')) {
            await interaction.editReply('I do not have permission to view the specified input channel. Please ensure the bot has "View Channel" permission.');
            return;
        }
        if (!inputPerms.has('ReadMessageHistory')) {
            await interaction.editReply('I do not have permission to read messages in the specified input channel.');
            return;
        }

        // Check if bot has permission to view and send messages in output channel
        const outputPerms = outputChannel.permissionsFor(interaction.client.user);
        if (!outputPerms || !outputPerms.has('ViewChannel')) {
            await interaction.editReply('I do not have permission to view the specified output channel. Please ensure the bot has "View Channel" permission.');
            return;
        }
        if (!outputPerms.has('SendMessages')) {
            await interaction.editReply('I do not have permission to send messages in the specified output channel.');
            return;
        }

        // Print command and flag information
        console.log(`\n📝 Command: /makeplaylists`);
        console.log(`   Input Channel: ${inputChannel.name} (ID: ${inputChannel.id})`);
        if (outputChannel.id !== inputChannel.id) {
            console.log(`   Output Channel: ${outputChannel.name} (ID: ${outputChannel.id})`);
        } else {
            console.log(`   Output Channel: ${outputChannel.name} (ID: ${outputChannel.id}) [same as input]`);
        }
        console.log(`   Flags:`);
        console.log(`     - repeat: ${repeatHours || 'not set'}`);
        console.log(`     - embedd: ${embedd}`);
        console.log(`     - debugsave_locally: ${debugSaveLocally}`);
        console.log(`     - outputyoutubeids: ${outputAllIdsAsTxt}`);
        console.log(`     - save_json: ${saveJson}`);
        console.log(``);

        try {
            let allMessages = [];
            let lastId;

            // Regular expressions for different music platforms
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?[a-zA-Z0-9_-]+/g;
            const youtubeIdRegex = /\b[a-zA-Z0-9_-]{11}\b/g; // Standalone YouTube IDs (11 characters)
            const spotifyRegex = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/g;
            const spotifyUriRegex = /spotify:(track|album|playlist|artist):[a-zA-Z0-9]+/g; // Spotify URIs
            const soundcloudRegex = /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/[^\/\s]+\/[^\/\s\?]+/g;
            const bandcampRegex = /(?:https?:\/\/)?[^\.]+\.bandcamp\.com\/(?:track|album)\/[^\/\s\?]+/g;

            const channelName = inputChannel.name || 'Unknown Channel';

            console.log(`Fetching messages from channel: ${channelName} (ID: ${inputChannel.id})`);

            while (true) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }

                const messages = await inputChannel.messages.fetch(options);
                allMessages = allMessages.concat(Array.from(messages.values()));
                
                lastId = messages.last()?.id;

                if (messages.size != 100 || !lastId) {
                    break;
                }
            }

            console.log(`Received ${allMessages.length} messages`);

            // Process each message to find music platform links
            const mediaLinks = {
                youtube: new Set(),
                spotify: new Set(),
                soundcloud: new Set(),
                bandcamp: new Set()
            };
            
            // For save_json: store full URLs, not just IDs
            const mediaLinksFull = {
                youtube: new Set(),
                spotify: new Set(),
                soundcloud: new Set(),
                bandcamp: new Set()
            };

            allMessages.forEach((message) => {
                if (message.content) {
                    // Check for YouTube links
                    const youtubeLinks = message.content.match(youtubeRegex);
                    if (youtubeLinks) {
                        youtubeLinks.forEach(link => {
                            const linkId = extractYouTubeId(link);
                            if (linkId) {
                                mediaLinks.youtube.add(linkId);
                                if (saveJson) {
                                    // Normalize URL: remove http:// and https://
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaLinksFull.youtube.add(normalized);
                                }
                            }
                        });
                    }
                    
                    // Check for standalone YouTube IDs (11 characters, not part of a URL)
                    if (saveJson) {
                        const youtubeIds = message.content.match(youtubeIdRegex);
                        if (youtubeIds) {
                            youtubeIds.forEach(id => {
                                // Only add if it's not already part of a YouTube URL
                                const isPartOfUrl = message.content.match(new RegExp(`https?://[^\\s]*${id}`, 'g'));
                                if (!isPartOfUrl && !mediaLinks.youtube.has(id)) {
                                    mediaLinks.youtube.add(id);
                                    mediaLinksFull.youtube.add(id);
                                }
                            });
                        }
                    }

                    // Check for Spotify links
                    const spotifyLinks = message.content.match(spotifyRegex);
                    if (spotifyLinks) {
                        spotifyLinks.forEach(link => {
                            const linkId = extractSpotifyId(link);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    // Normalize URL: remove http:// and https://
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaLinksFull.spotify.add(normalized);
                                }
                            }
                        });
                    }
                    
                    // Check for Spotify URIs (spotify:track:...)
                    const spotifyUris = message.content.match(spotifyUriRegex);
                    if (spotifyUris) {
                        spotifyUris.forEach(uri => {
                            const linkId = extractSpotifyId(uri);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    // Keep Spotify URIs as-is (they don't have http://)
                                    mediaLinksFull.spotify.add(uri);
                                }
                            }
                        });
                    }

                    // Check for SoundCloud links
                    const soundcloudLinks = message.content.match(soundcloudRegex);
                    if (soundcloudLinks) {
                        soundcloudLinks.forEach(link => {
                            const linkId = extractSoundCloudId(link);
                            if (linkId) {
                                mediaLinks.soundcloud.add(linkId);
                                if (saveJson) {
                                    // Normalize URL: remove http:// and https://
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaLinksFull.soundcloud.add(normalized);
                                }
                            }
                        });
                    }

                    // Check for Bandcamp links
                    const bandcampLinks = message.content.match(bandcampRegex);
                    if (bandcampLinks) {
                        bandcampLinks.forEach(link => {
                            const linkId = extractBandcampId(link);
                            if (linkId) {
                                mediaLinks.bandcamp.add(linkId);
                                if (saveJson) {
                                    // Normalize URL: remove http:// and https://
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaLinksFull.bandcamp.add(normalized);
                                }
                            }
                        });
                    }
                }

                // Check for music links in embeds
                message.embeds.forEach(embed => {
                    if (embed.url) {
                        if (embed.url.match(youtubeRegex)) {
                            const linkId = extractYouTubeId(embed.url);
                            if (linkId) {
                                mediaLinks.youtube.add(linkId);
                                if (saveJson) {
                                    // Normalize URL: remove http:// and https://
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaLinksFull.youtube.add(normalized);
                                }
                            }
                        }
                        // Check for Spotify in embeds
                        if (embed.url.match(spotifyRegex)) {
                            const linkId = extractSpotifyId(embed.url);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaLinksFull.spotify.add(normalized);
                                }
                            }
                        }
                        // Check for SoundCloud in embeds
                        if (embed.url.match(soundcloudRegex)) {
                            const linkId = extractSoundCloudId(embed.url);
                            if (linkId) {
                                mediaLinks.soundcloud.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaLinksFull.soundcloud.add(normalized);
                                }
                            }
                        }
                        // Check for Bandcamp in embeds
                        if (embed.url.match(bandcampRegex)) {
                            const linkId = extractBandcampId(embed.url);
                            if (linkId) {
                                mediaLinks.bandcamp.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaLinksFull.bandcamp.add(normalized);
                                }
                            }
                        }
                    }
                });
            });

            // Convert YouTube Set to array and create playlists
            const youtubeIds = Array.from(mediaLinks.youtube);
            
            // Save JSON file with organized media sources if save_json flag is enabled
            if (saveJson) {
                console.log('💾 save_json flag is enabled - preparing to save organized JSON file...');
                try {
                    // Build allTracks array: YouTube IDs (just the ID) and normalized URLs for other platforms
                    const allTracks = [];
                    
                    // Add YouTube IDs (just the ID, not the full URL)
                    youtubeIds.forEach(id => {
                        allTracks.push(id);
                    });
                    
                    // Add normalized URLs for other platforms (already normalized, without http://)
                    Array.from(mediaLinksFull.spotify).forEach(url => {
                        allTracks.push(url);
                    });
                    Array.from(mediaLinksFull.soundcloud).forEach(url => {
                        allTracks.push(url);
                    });
                    Array.from(mediaLinksFull.bandcamp).forEach(url => {
                        allTracks.push(url);
                    });
                    
                    // Build the JSON structure
                    // For YouTube, store normalized URLs (without http://) in the youtube array
                    // For allTracks, use just the IDs for YouTube
                    const jsonData = {
                        channelName: inputChannel.name || 'Unknown Channel',
                        channelId: inputChannel.id,
                        dateRan: new Date().toISOString(),
                        spotify: Array.from(mediaLinksFull.spotify),
                        bandcamp: Array.from(mediaLinksFull.bandcamp),
                        soundcloud: Array.from(mediaLinksFull.soundcloud),
                        youtube: Array.from(mediaLinksFull.youtube),
                        allTracks: allTracks
                    };
                    
                    // Get the directory where index.js is located (discord-bot folder)
                    const botDirectory = path.join(__dirname, '..');
                    const filename = `playlist-data-${Date.now()}.json`;
                    const filepath = path.join(botDirectory, filename);
                    
                    console.log(`📁 Saving organized JSON file...`);
                    console.log(`   📄 Filename: ${filename}`);
                    console.log(`   📂 Directory: ${botDirectory}`);
                    console.log(`   🔗 Full Path: ${filepath}`);
                    console.log(`   📊 Data: ${allTracks.length} total tracks from channel "${inputChannel.name}"`);
                    console.log(`   📺 YouTube: ${mediaLinksFull.youtube.size}`);
                    console.log(`   🎵 Spotify: ${mediaLinksFull.spotify.size}`);
                    console.log(`   🎧 SoundCloud: ${mediaLinksFull.soundcloud.size}`);
                    console.log(`   💿 Bandcamp: ${mediaLinksFull.bandcamp.size}`);
                    
                    fs.writeFileSync(filepath, JSON.stringify(jsonData, null, 2), 'utf8');
                    
                    console.log(`✅ Successfully saved organized JSON file`);
                    console.log(`   📄 File: ${filename}`);
                    console.log(`   📂 Location: ${filepath}`);
                    
                    // Send message to Discord about saved JSON file
                    try {
                        const jsonAttachment = new AttachmentBuilder(filepath, {
                            name: filename,
                            description: `Organized media links from ${inputChannel.name}`
                        });
                        
                        await outputChannel.send({
                            content: `💾 **JSON file saved successfully!**\n` +
                                   `📄 **File:** ${filename}\n` +
                                   `📊 **Total tracks:** ${allTracks.length}\n` +
                                   `   📺 YouTube: ${mediaLinksFull.youtube.size}\n` +
                                   `   🎵 Spotify: ${mediaLinksFull.spotify.size}\n` +
                                   `   🎧 SoundCloud: ${mediaLinksFull.soundcloud.size}\n` +
                                   `   💿 Bandcamp: ${mediaLinksFull.bandcamp.size}`,
                            files: [jsonAttachment]
                        });
                        
                        console.log(`✅ Sent JSON file message to ${outputChannel.name}`);
                    } catch (error) {
                        console.error('❌ Error sending JSON file message to Discord:', error);
                        // Don't fail the whole command if message sending fails
                    }
                } catch (error) {
                    console.error('❌ Error saving organized JSON file:');
                    console.error(`   Error: ${error.message}`);
                    console.error(`   Stack: ${error.stack}`);
                    
                    // Send error message to Discord
                    try {
                        await outputChannel.send(`❌ **Error saving JSON file:** ${error.message}`);
                    } catch (sendError) {
                        console.error('❌ Error sending error message to Discord:', sendError);
                    }
                }
            }
            
            // Save to local JSON file if DEBUG flag is enabled
            if (debugSaveLocally) {
                console.log('🔍 DEBUG: DEBUGsave_locally flag is enabled - preparing to save JSON file...');
                try {
                    const dataToSave = {
                        timestamp: new Date().toISOString(),
                        channelName: inputChannel.name,
                        channelId: inputChannel.id,
                        totalVideos: youtubeIds.length,
                        videoIds: youtubeIds,
                        playlists: chunkArray(youtubeIds, 50).map((chunk, index) => ({
                            playlistNumber: index + 1,
                            videoCount: chunk.length,
                            videoIds: chunk,
                            url: `http://www.youtube.com/watch_videos?video_ids=${chunk.join(',')}`
                        }))
                    };
                    
                    // Get the directory where index.js is located (discord-bot folder)
                    // __dirname is the commands folder, go up one level to get discord-bot folder
                    const botDirectory = path.join(__dirname, '..');
                    const filename = `youtube-ids-${Date.now()}.json`;
                    const filepath = path.join(botDirectory, filename);
                    
                    console.log(`📁 DEBUG: Saving JSON file...`);
                    console.log(`   📄 Filename: ${filename}`);
                    console.log(`   📂 Directory: ${botDirectory}`);
                    console.log(`   🔗 Full Path: ${filepath}`);
                    console.log(`   📊 Data: ${youtubeIds.length} video IDs from channel "${inputChannel.name}"`);
                    
                    fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
                    
                    console.log(`✅ DEBUG: Successfully saved ${youtubeIds.length} video IDs to JSON file`);
                    console.log(`   📄 File: ${filename}`);
                    console.log(`   📂 Location: ${filepath}`);
                } catch (error) {
                    console.error('❌ DEBUG: Error saving video IDs to file:');
                    console.error(`   Error: ${error.message}`);
                    console.error(`   Stack: ${error.stack}`);
                }
            }
            
            const playlistChunks = chunkArray(youtubeIds, 50);
            const playlistUrls = playlistChunks.map(chunk => {
                const idsString = chunk.join(',');
                return `http://www.youtube.com/watch_videos?video_ids=${idsString}`;
            });

            // Build response message with plain URLs (no markdown links)
            let response = `**Media Links Found:**\n`;
            response += `📺 YouTube: ${mediaLinks.youtube.size}\n`;
            response += `🎵 Spotify: ${mediaLinks.spotify.size}\n`;
            response += `🎧 SoundCloud: ${mediaLinks.soundcloud.size}\n`;
            response += `💿 Bandcamp: ${mediaLinks.bandcamp.size}\n\n`;

            if (youtubeIds.length === 0) {
                response += `No YouTube links found to create playlists.`;
            } else {
                response += `**YouTube Playlists (${playlistUrls.length} playlist${playlistUrls.length > 1 ? 's' : ''}):**\n\n`;
                playlistUrls.forEach((url, index) => {
                    const urlFormat = embedd ? url : `<${url}>`;
                    response += `[YouTube Playlist ${index + 1} (${playlistChunks[index].length} videos)](${urlFormat})\n`;
                });
            }

            // Discord has a 2000 character limit for messages
            // If message is too long, we'll need to split it intelligently
            if (response.length > 2000) {
                const parts = [];
                const header = `**Media Links Found:**\n`;
                const headerContent = `📺 YouTube: ${mediaLinks.youtube.size}\n`;
                const headerContent2 = `🎵 Spotify: ${mediaLinks.spotify.size}\n`;
                const headerContent3 = `🎧 SoundCloud: ${mediaLinks.soundcloud.size}\n`;
                const headerContent4 = `💿 Bandcamp: ${mediaLinks.bandcamp.size}\n\n`;
                const playlistHeader = `**YouTube Playlists (${playlistUrls.length} playlist${playlistUrls.length > 1 ? 's' : ''}):**\n\n`;
                
                // Start with header in first message
                let currentPart = header + headerContent + headerContent2 + headerContent3 + headerContent4 + playlistHeader;

                // Add playlist URLs, splitting when needed
                playlistUrls.forEach((url, index) => {
                    const urlFormat = embedd ? url : `<${url}>`;
                    const playlistLine = `[YouTube Playlist ${index + 1} (${playlistChunks[index].length} videos)](${urlFormat})\n`;
                    // Check if adding this line would exceed limit (leave some buffer)
                    if (currentPart.length + playlistLine.length > 1950) {
                        parts.push(currentPart.trim());
                        currentPart = playlistLine;
                    } else {
                        currentPart += playlistLine;
                    }
                });
                
                // Add remaining content
                if (currentPart.length > 0) {
                    parts.push(currentPart.trim());
                }

                // Send all parts to output channel
                for (const part of parts) {
                    await outputChannel.send(part);
                }
            } else {
                await outputChannel.send(response);
            }

            // Send .txt file with all YouTube IDs if flag is enabled
            if (outputAllIdsAsTxt && youtubeIds.length > 0) {
                try {
                    // Create comma-separated string of all YouTube IDs
                    const idsText = youtubeIds.join(',');
                    
                    // Create a buffer from the text
                    const buffer = Buffer.from(idsText, 'utf8');
                    
                    // Create attachment
                    const attachment = new AttachmentBuilder(buffer, {
                        name: `youtube-ids-${Date.now()}.txt`,
                        description: `All ${youtubeIds.length} YouTube video IDs comma-separated`
                    });
                    
                    // Send the file to the output channel
                    await outputChannel.send({
                        content: `📄 **All YouTube Video IDs** (${youtubeIds.length} total)`,
                        files: [attachment]
                    });
                    
                    console.log(`✅ Sent .txt file with ${youtubeIds.length} YouTube IDs to ${outputChannel.name}`);
                } catch (error) {
                    console.error('❌ Error sending .txt file:', error);
                    // Don't fail the whole command if file sending fails
                }
            }

            // Confirm to user
            let confirmMessage = `✅ Successfully created ${playlistUrls.length} YouTube playlist(s) with ${youtubeIds.length} total videos. ${outputChannel.id !== inputChannel.id ? `Sent to ${outputChannel}.` : ''}`;
            
            await interaction.editReply(confirmMessage);

            console.log(`Created ${playlistUrls.length} YouTube playlist(s) with ${youtubeIds.length} total videos`);

        } catch (error) {
            console.error('Error fetching messages:', error);
            let errorMessage = `An error occurred while fetching messages and creating playlists: ${error.message}`;
            
            // Provide more helpful error messages for common permission issues
            if (error.code === 50001) {
                errorMessage = `Missing Access: The bot does not have permission to access the output channel (${outputChannel.name}). Please ensure the bot has "View Channel" and "Send Messages" permissions in that channel.`;
            } else if (error.code === 50013) {
                errorMessage = `Missing Permissions: The bot is missing required permissions. Please check that the bot has "View Channel", "Send Messages", and "Read Message History" permissions.`;
            }
            
            await interaction.editReply(errorMessage);
        }
    },
};

