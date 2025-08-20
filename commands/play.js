const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const musicIcons = require('../UI/icons/musicicons.js');
const SpotifyWebApi = require('spotify-web-api-node');
const { getData } = require('spotify-url-info')(require('node-fetch'));
const requesters = new Map();

const spotifyApi = new SpotifyWebApi({
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
});

async function getSpotifyPlaylistTracks(playlistId) {
    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body.access_token);

        let tracks = [];
        let offset = 0;
        let limit = 100;
        let total = 0;

        do {
            const response = await spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
            total = response.body.total;
            offset += limit;

            for (const item of response.body.items) {
                if (item.track && item.track.name && item.track.artists) {
                    const trackName = (item.track.name || 'Unknown Track') + ' - ' + 
                        (item.track.artists || []).map(a => a.name || 'Unknown Artist').join(', ');
                    tracks.push(trackName);
                }
            }
        } while (tracks.length < total);

        return tracks;
    } catch (error) {
        console.error("Error fetching Spotify playlist tracks:", error);
        return [];
    }
}

async function play(client, interaction, lang) {
    let hasDeferred = false;
    
    try {
        const query = interaction.options.getString('name');

        // Kiểm tra nhanh trước khi defer
        if (!interaction.member.voice.channelId) {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setAuthor({
                    name: lang.play.embed.error,
                    iconURL: musicIcons.alertIcon,
                    url: config.SupportServer
                })
                .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                .setDescription(lang.play.embed.noVoiceChannel);

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (!client.riffy.nodes || client.riffy.nodes.size === 0) {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setAuthor({
                    name: lang.play.embed.error,
                    iconURL: musicIcons.alertIcon,
                    url: config.SupportServer
                })
                .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                .setDescription(lang.play.embed.noLavalinkNodes);

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Defer reply ngay sau validation
        await interaction.deferReply();
        hasDeferred = true;

        // XÓA VÀ TẠO LẠI PLAYER - FIX CHÍNH
        let player = client.riffy.players.get(interaction.guildId);
        if (player) {
            console.log("Đã tìm thấy player cũ, đang xóa...");
            player.destroy();
            console.log("Đã xóa player cũ");
        }

        console.log("Đang tạo player mới...");
        player = client.riffy.createConnection({
            guildId: interaction.guildId,
            voiceChannel: interaction.member.voice.channelId,
            textChannel: interaction.channelId,
            deaf: true
        });

        // Đảm bảo player được kết nối
        if (!player.connected) {
            console.log("Player chưa kết nối, đang kết nối...");
            await new Promise(resolve => setTimeout(resolve, 1000)); // Chờ 1 giây
        }

        console.log("Player mới đã được tạo và kết nối");

        let tracksToQueue = [];
        let isPlaylist = false;

        if (query.includes('spotify.com')) {
            try {
                const spotifyData = await getData(query);

                if (spotifyData.type === 'track') {
                    const trackName = (spotifyData.name || 'Unknown Track') + ' - ' + 
                        (spotifyData.artists || []).map(a => a.name || 'Unknown Artist').join(', ');
                    tracksToQueue.push(trackName);
                } else if (spotifyData.type === 'playlist') {
                    isPlaylist = true;
                    const playlistId = query.split('/playlist/')[1].split('?')[0];
                    tracksToQueue = await getSpotifyPlaylistTracks(playlistId);
                }
            } catch (err) {
                console.error('Lỗi khi lấy dữ liệu Spotify:', err);
                if (hasDeferred && !interaction.replied) {
                    await interaction.followUp({ content: "❌ Không thể lấy dữ liệu từ Spotify." });
                }
                return;
            }
        } else {
            console.log("Đang resolve track cho query:", query);
            try {
                const resolve = await client.riffy.resolve({ query, requester: interaction.user.username });
                console.log("Resolved loadType:", resolve.loadType);
                console.log("Số lượng tracks tìm được:", resolve.tracks ? resolve.tracks.length : 0);

                if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setAuthor({ 
                            name: lang.play.embed.error,
                            iconURL: musicIcons.alertIcon,
                            url: config.SupportServer
                        })
                        .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                        .setDescription(lang.play.embed.noResults);

                    if (hasDeferred && !interaction.replied) {
                        await interaction.followUp({ embeds: [errorEmbed] });
                    }
                    return;
                }

                if (resolve.loadType === 'playlist') {
                    isPlaylist = true;
                    for (const track of resolve.tracks) {
                        if (track.info) {
                            track.info.requester = interaction.user.username;
                            player.queue.add(track);
                            requesters.set(track.info.uri, interaction.user.username);
                        }
                    }
                } else if (resolve.loadType === 'search' || resolve.loadType === 'track') {
                    const track = resolve.tracks[0];
                    if (track && track.info) {
                        track.info.requester = interaction.user.username;
                        player.queue.add(track);
                        requesters.set(track.info.uri, interaction.user.username);
                        console.log("Đã thêm track vào queue:", track.info.title);
                    }
                } else {
                    console.log("LoadType không xác định:", resolve.loadType);
                    const errorEmbed = new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setAuthor({ 
                            name: lang.play.embed.error,
                            iconURL: musicIcons.alertIcon,
                            url: config.SupportServer
                        })
                        .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon })
                        .setDescription(lang.play.embed.noResults);

                    if (hasDeferred && !interaction.replied) {
                        await interaction.followUp({ embeds: [errorEmbed] });
                    }
                    return;
                }
            } catch (resolveError) {
                console.error('Lỗi khi resolve track:', resolveError);
                if (hasDeferred && !interaction.replied) {
                    await interaction.followUp({ content: "❌ Không thể resolve track." });
                }
                return;
            }
        }

        // Xử lý Spotify tracks
        for (const trackQuery of tracksToQueue) {
            try {
                const resolve = await client.riffy.resolve({ query: trackQuery, requester: interaction.user.username });
                if (resolve && resolve.tracks && resolve.tracks.length > 0) {
                    const trackInfo = resolve.tracks[0];
                    if (trackInfo && trackInfo.info) {
                        trackInfo.info.requester = interaction.user.username;
                        player.queue.add(trackInfo);
                        requesters.set(trackInfo.info.uri, interaction.user.username);
                        console.log("Đã thêm Spotify track vào queue:", trackInfo.info.title);
                    }
                } 
            } catch (err) {
                console.error('Lỗi khi resolve Spotify track:', err);
                // Tiếp tục với các track khác ngay cả khi có lỗi
            }
        }

        // Kiểm tra và bắt đầu phát nhạc
        console.log("Kích thước queue:", player.queue.size);
        console.log("Player đang phát:", player.playing);
        console.log("Player bị tạm dừng:", player.paused);
        console.log("Player đã kết nối:", player.connected);
        
        if (player.queue.size > 0) {
            // Đảm bảo player được kết nối trước khi phát
            if (!player.connected) {
                console.log("Player chưa kết nối, đang thử kết nối lại...");
                await new Promise(resolve => setTimeout(resolve, 2000)); // Chờ 2 giây
            }
            
            if (!player.playing && !player.paused) {
                console.log("Đang bắt đầu phát nhạc...");
                player.play();
                
                // THÊM MONITORING CODE
                setTimeout(async () => {
                    console.log("=== KIỂM TRA SAU 3 GIÂY ===");
                    console.log("Player đang phát:", player.playing);
                    console.log("Position:", player.position);
                    console.log("Current track:", player.current ? player.current.info.title : "không có");
                    console.log("Player connected:", player.connected);
                    console.log("Connection state:", player.connection ? player.connection.state : "undefined");
                    console.log("Voice channel ID:", player.voiceChannel);
                    console.log("Queue size:", player.queue.size);
                    
                    // Nếu bị disconnect thì reconnect
                    if (!player.connected && player.queue.size > 0) {
                        console.log("⚠️  Player bị disconnect, đang thử reconnect...");
                        try {
                            await player.connect();
                            if (!player.playing && player.current) {
                                console.log("Đang restart playback...");
                                player.play();
                            }
                        } catch (err) {
                            console.error("❌ Lỗi reconnect:", err);
                        }
                    }
                    
                    // Nếu không phát mà vẫn có track
                    if (!player.playing && player.current && player.connected) {
                        console.log("⚠️  Player connected nhưng không phát, thử force play...");
                        try {
                            player.play();
                        } catch (err) {
                            console.error("❌ Lỗi force play:", err);
                        }
                    }
                }, 3000);
                
                // Thêm check thứ 2 sau 10 giây
                setTimeout(async () => {
                    console.log("=== KIỂM TRA SAU 10 GIÂY ===");
                    console.log("Player playing:", player.playing);
                    console.log("Player connected:", player.connected);
                    console.log("Position:", player.position);
                    
                    if (player && !player.playing && player.queue.size > 0 && player.connected) {
                        console.log("⚠️  Player vẫn không phát sau 10 giây, thử restart...");
                        try {
                            player.stop();
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            player.play();
                        } catch (err) {
                            console.error("❌ Lỗi restart player:", err);
                        }
                    }
                    
                    if (!player.connected) {
                        console.log("❌ Player đã disconnect sau 10 giây - có thể là lỗi node Lavalink");
                    }
                }, 10000);
                
            } else if (player.paused) {
                console.log("Player bị tạm dừng, đang resume...");
                player.pause(false);
            }
        } else {
            console.log("Cảnh báo: Queue trống sau khi thêm tracks");
        }

        const randomEmbed = new EmbedBuilder()
            .setColor(config.embedColor)
            .setAuthor({
                name: lang.play.embed.requestUpdated,
                iconURL: musicIcons.beats2Icon,
                url: config.SupportServer
            })
            .setDescription(lang.play.embed.successProcessed)
            .setFooter({ text: lang.footer, iconURL: musicIcons.heartIcon });

        if (hasDeferred && !interaction.replied) {
            const message = await interaction.followUp({ embeds: [randomEmbed] });

            setTimeout(() => {
                message.delete().catch(() => {});
            }, 3000);
        }

    } catch (error) {
        console.error('Lỗi khi xử lý lệnh play:', error);
        
        try {
            if (!hasDeferred && !interaction.replied) {
                await interaction.reply({ content: "❌ Có lỗi xảy ra khi xử lý yêu cầu.", ephemeral: true });
            } else if (hasDeferred && !interaction.replied) {
                await interaction.followUp({ content: "❌ Có lỗi xảy ra khi xử lý yêu cầu." });
            }
        } catch (replyError) {
            console.error('Lỗi khi gửi thông báo lỗi:', replyError);
        }
    }
}

module.exports = {
    name: "play",
    description: "Play a song from a name or link",
    permissions: "0x0000000000000800",
    options: [{
        name: 'name',
        description: 'Enter song name / link or playlist',
        type: ApplicationCommandOptionType.String,
        required: true
    }],
    run: play,
    requesters: requesters,
};