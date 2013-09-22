(function () {
    'use strict';

    // get them before IE errors out
    if (!Object.prototype.hasOwnProperty.call(window, 'WebSocket')) {
        window.location = 'no-websocket.html';
        return;
    }

    var PONY_WIDTH = 168, PONY_HEIGHT = 168;

    var avatars = [], inventoryItems = [];

    var socket, connected = false, ignoreDisconnect = false, pageFocussed = false, unseenHighlights = 0,
        me, myNick, myRoom = null, myRoomWidth = 0, myRoomHeight = 0, mySpecialStatus, avatarInventory, inventory = [], friends = [],
        blockMovement = false, moveInterval = null, oldImgIndex = 0,
        roomwidgetstate = [],
        currentUser = null,
        lastmove = (new Date().getTime()),
        globalUserCount = 0, globalModCount = 0,
        openProfiles = {}, openPMLogs = {};

    var container,
        overlay,
        loginbox, nickbox, personasubmit, loginsubmit,
        topbuttons,
        accountsettings, accountsettingsbutton, changepassbutton, rmpassbutton,
        outerstage, stage,
        chooser, chooserbutton,
        inventorylist, inventorylistbutton,
        friendslist, friendslistbutton,
        roomlistbutton, roomlist, roomlistopen = false, refreshbutton, homebutton,
        roomedit, roomeditbutton, roomeditreset, roomeditvisible,
        background, roomwidgets,
        chatbar, chatbox, chatboxholder, chatbutton, chatlog, chatloglock, chatloglocked = false;

    var userManager = {
        users: {},
        userCount: 0,
        userCounter: null,

        initGUI: function () {
            this.userCounter = document.createElement('div');
            this.userCounter.id = 'usercounter';
            this.userCounter.style.display = 'none';
            this.updateCounter();
            overlay.appendChild(this.userCounter);
        },
        showUserCounter: function () {
            this.userCounter.style.display = 'block';
        },
        add: function (nick, obj, special, me, doLog) {
            if (this.has(nick)) {
                throw new Error("Ya existe un usuario con ese nombre.");
            }

            var isOwnNick = nick === myNick;

            var elem = document.createElement('div');
            elem.className = 'pony';

            var chat = document.createElement('p');
            chat.className = 'chatbubble';
            elem.appendChild(chat);

            var nickTag = document.createElement('p');
            nickTag.className = 'nick-tag';

            var nickName = document.createElement('span');
            nickName.className = 'nickname' + (isOwnNick ? ' own' : '');
            appendText(nickName, nick);
            if (special) {
                nickName.className += ' ' + special;
            }
            if (!isOwnNick) {
                nickName.onclick = function () {
                    socket.send(JSON.stringify({
                        type: 'profile_get',
                        nick: nick
                    }));
                };
            }
            nickTag.appendChild(nickName);

            elem.appendChild(nickTag);

            stage.appendChild(elem);

            this.users[nick] = {
                obj: obj,
                nick: nick,
                elem: {
                    root: elem,
                    chat: chat,
                    nickTag: nickTag,
                    nickName: nickName,
                    img: null
                },
                imgURL: null,
                effect: null,
                special: special
            };

            this.update(nick, obj);
            this.userCount++;
            this.updateCounter();
            if (doLog) {
                logJoinInChat(nick, special);
            }
        },
        update: function (nick, obj) {
            this.hasCheck(nick);

            var user = this.users[nick];
            user.elem.root.style.left = obj.x + 'px';
            user.elem.root.style.top = obj.y + 'px';
            if (nick === myNick) {
                translateViewport();
            }
            if (avatars.hasOwnProperty(obj.img_name)) {
                if (avatars[obj.img_name].hasOwnProperty(obj.img_index)) {
                    var imgURL = '/media/avatars/' + avatars[obj.img_name][obj.img_index];
                    if (imgURL !== user.imgURL || obj.effect !== user.effect) {
                        user.imgURL = imgURL;
                        user.effect = obj.effect;
                        user.elem.root.style.backgroundImage = 'url(' + imgURL + ')';
                        user.elem.img = document.createElement('img');
                        user.elem.img.src = imgURL;
                        user.elem.img.onload = function () {
                            var newHeight = user.elem.img.height;
                            var newWidth = user.elem.img.width;

                            if (obj.effect === 'effect_shrink') {
                                newHeight /= 2;
                                newWidth /= 2;
                                user.elem.root.className = 'pony shrink';
                            } else {
                                user.elem.root.className = 'pony';
                            }
                            user.elem.root.style.backgroundSize = newWidth + 'px ' + newHeight + 'px';

                            // adjust bounding box size
                            user.elem.root.style.width = newWidth + 'px';
                            user.elem.root.style.height = newHeight + 'px';

                            // adjust bounding box margin (translate about image centre)
                            user.elem.root.style.marginLeft = -newWidth/2 + 'px';
                            user.elem.root.style.marginTop = -newHeight/2 + 'px';

                            // adjust positioning of nick tag and chat bubble
                            user.elem.chat.style.bottom = newHeight + 'px';
                            user.elem.chat.style.marginLeft = (newWidth - 168) / 2 + 'px';
                            user.elem.nickTag.style.top = newHeight + 'px';
                            user.elem.nickTag.style.marginLeft = (newWidth - 188) / 2 + 'px';
                        };
                    }
                }
            } else {
                user.elem.root.style.backgroundImage = 'none';
                user.elem.root.style.height = PONY_HEIGHT + 'px';
            }

            user.elem.chat.innerHTML = '';
            appendText(user.elem.chat, obj.chat);
            if (obj.chat !== user.obj.chat && obj.chat !== '') {
                logInChat(nick, obj.chat, user.special);
            }

            user.obj = obj;
        },
        kill: function (nick, doLog) {
            this.hasCheck(nick);

            var user = this.users[nick];
            this.userCount--;
            this.updateCounter();
            if (doLog) {
                logLeaveInChat(nick, user.special);
            }
            stage.removeChild(user.elem.root);
            delete this.users[nick];
        },
        has: function (nick) {
            return this.users.hasOwnProperty(nick);
        },
        hasCheck: function (nick) {
            if (!this.has(nick)) {
                throw new Error('Ningún usuario se llama "' + nick + '"');
            }
        },
        forEach: function (callback) {
            for (var nick in this.users) {
                if (this.users.hasOwnProperty(nick)) {
                    if (callback(nick) === 'stop') {
                        return;
                    }
                }
            }
        },
        updateCounter: function () {
            this.userCounter.innerHTML = '';
            var str;
            if (myRoom !== null) {
                if (myRoom.type === 'real') {
                    str = myRoom.name;
                } else if (myRoom.type === 'ephemeral') {
                    str = myRoom.name + " (de " + myRoom.user_nick + ")";
                } else if (myRoom.type === 'house') {
                    str = myRoom.user_nick + "(casa)";
                }
                str += ' - ' + this.userCount + '/' + globalUserCount + ' usuarios';
            } else {
                str = globalUserCount + ' usuarios conectados';
            }
            str += ' (' + globalModCount + ' mods conectados)';
            appendText(this.userCounter, str);
        }
    };

    function pushState() {
        if (connected) {
            socket.send(JSON.stringify({
                type: 'update',
                obj: me
            }));
        }
    }

    function pushAndUpdateState(newState) {
        userManager.update(myNick, newState);
        pushState();
    }

    function translateViewport() {
        var vpW = window.innerWidth, vpH = window.innerHeight - 36;
        var rmW = myRoomWidth, rmH = myRoomHeight;
        var offsetX, offsetY;

        offsetX = Math.min(Math.max(vpW / 2 - me.x, vpW - rmW), 0);
        offsetY = Math.min(Math.max(vpH / 2 - me.y, vpH - rmH), 0);

        stage.style.left = offsetX + 'px';
        stage.style.top = offsetY + 'px';
    }

    function appendText(parent, text) {
        parent.appendChild(document.createTextNode(text));
    }

    function appendNickname(parent, nick, special) {
        var nickname = document.createElement('span');
        nickname.className = 'nickname' + (nick === myNick ? ' own' : '');
        if (special !== false) {
            nickname.className += ' ' + special;
        }
        nickname.onclick = function () {
            socket.send(JSON.stringify({
                type: 'profile_get',
                nick: nick
            }));
        };
        appendText(nickname, nick);
        parent.appendChild(nickname);
    }

    function appendTextAutoLink(parent, text) {
        var pos;
        while (((pos = text.indexOf('http://')) !== -1) || ((pos = text.indexOf('https://')) !== -1)) {
            var pos2 = text.indexOf(' ', pos);
            var anchor = document.createElement('a');
            anchor.className = 'chat-link';
            anchor.target = '_blank';
            if (pos2 === -1) {
                appendText(parent, text.substr(0, pos));
                anchor.href = text.substr(pos);
                appendText(anchor, text.substr(pos));

                text = '';
            } else {
                appendText(parent, text.substr(0, pos));
                anchor.href = text.substr(pos, pos2 - pos);
                appendText(anchor, text.substr(pos, pos2 - pos));
                text = text.substr(pos2);
            }
            parent.appendChild(anchor);
        }
        appendText(parent, text);
    }

    function tabNotify() {
        if (!pageFocussed) {
            unseenHighlights++;
            document.title = '(' + unseenHighlights + ') ponyplace';
        }
    }

    function chatPrint(targets, bits, className) {
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];

            var span = document.createElement('span');
            span.className = 'chat-line';

            if (className) {
                span.className += ' ' + className;
            }

            for (var j = 0; j < bits.length; j++) {
                var bit = bits[j];

                if (bit[0] === 'nick') {
                    appendNickname(span, bit[1], bit[2]);
                } else if (bit[0] === 'text') {
                    appendTextAutoLink(span, bit[1]);
                }
            }

            span.appendChild(document.createElement('br'));

            if (target === 'chatlog') {
                chatlog.appendChild(span);
                if (!chatloglocked) {
                    chatlog.scrollTop = chatlog.scrollHeight;
                }
            } else {
                target.appendChild(span);
            }
        }
    }

    function highlightCheck(msg) {
        if (msg.indexOf(myNick) !== -1) {
            tabNotify();
            return 'highlight';
        }
        return '';
    }

    function modCheck(special) {
        if (special !== false) {
            return 'modspeak';
        }
        return '';
    }

    function logMineInChat(nick, msg) {
        chatPrint(['chatlog'], [
            ['nick', nick, mySpecialStatus],
            ['text', ': ' + msg]
        ], highlightCheck(msg) + ' ' + modCheck(mySpecialStatus));
    }

    function logInChat(nick, msg, special) {
        chatPrint(['chatlog'], [
            ['nick', nick, special],
            ['text', ': ' + msg]
        ], highlightCheck(msg) + ' ' + modCheck(special));
    }

    function logKickNoticeInChat(modNick, modSpecial, kickeeNick, kickeeSpecial, reason) {
        var lines = [
            ['nick', kickeeNick, kickeeSpecial],
            ['text', ' fué kickeado por '],
            ['nick', modNick, modSpecial]
        ];
        if (reason) {
            lines.push(['text', ' razón: "' + reason + '"']);
        }
        chatPrint(['chatlog'], lines, 'kick');
    }

    function logKickBanNoticeInChat(modNick, modSpecial, kickeeNick, kickeeSpecial, reason) {
        var lines = [
            ['nick', kickeeNick, kickeeSpecial],
            ['text', ' fué kickeado y baneado por '],
            ['nick', modNick, modSpecial]
        ];
        if (reason) {
            lines.push(['text', ' razón: "' + reason + '"']);
        }
        chatPrint(['chatlog'], lines, 'kick');
    }

    function logBroadcastInChat(msg) {
        chatPrint(['chatlog'], [
            ['text', 'MENSAJE: ' + msg]
        ], 'broadcast');
    }

    function logSentConsoleCommandInChat(msg) {
        chatPrint(['chatlog'], [
            ['text', 'CONSOLA <- /' + msg]
        ], 'console');
    }

    function logConsoleMessageInChat(msg) {
        chatPrint(['chatlog'], [
            ['text', 'CONSOLA -> ' + msg]
        ], 'console');
    }

    function logJoinInChat(nick, special) {
        chatPrint(['chatlog'], [
            ['nick', nick, special],
            ['text', ' entró a la sala']
        ], 'leave-join');
    }

    function logLeaveInChat(nick, special) {
        chatPrint(['chatlog'], [
            ['nick', nick, special],
            ['text', ' se fué']
        ], 'leave-join');
    }

    function logRoomJoinInChat(name, name_full) {
        chatPrint(['chatlog'], [
            ['nick', myNick, mySpecialStatus],
            ['text', ' ha entrado en la sala ' + name + ' ("' + name_full + '")']
        ], 'leave-join');
    }

    function logEphemeralRoomJoinInChat(name) {
        chatPrint(['chatlog'], [
            ['nick', myNick, mySpecialStatus],
            ['text', ' ha entrado en la sala ephemeral "' + name + '"']
        ], 'leave-join');
    }

    function logHouseRoomJoinInChat(nick) {
        if (nick !== myNick) {
            chatPrint(['chatlog'], [
                ['nick', myNick, mySpecialStatus],
                ['text', ' ha entrado en la casa de "' + nick + '"']
            ], 'leave-join');
        } else {
            chatPrint(['chatlog'], [
                ['nick', myNick, mySpecialStatus],
                ['text', ' ha entrado en tu casa']
            ], 'leave-join');
        }
    }

    function updateRoomList(rooms) {
        var preview, img, title;
        roomlist.innerHTML = '';

        // refresh button
        var refreshbutton = document.createElement('button');
        appendText(refreshbutton, 'Recargar lista');
        refreshbutton.onclick = function () {
            socket.send(JSON.stringify({
                type: 'room_list'
            }));
        };
        roomlist.appendChild(refreshbutton);

        // create new button
        var newbtn = document.createElement('button');
        appendText(newbtn, 'Crear sala');
        newbtn.onclick = function () {
            var roomName = prompt('Creando una sala ephemeral:\nElige un nombre de sala (sin espacios)', '');
            if (roomName.indexOf(' ') === -1) {
                socket.send(JSON.stringify({
                    type: 'room_change',
                    name: roomName
                }));
                roomlist.style.display = 'none';
                roomlistopen = false;
            } else {
                alert('Los nombres de sala no deben contener espacios.');
            }
        };
        roomlist.appendChild(newbtn);

        for (var i = 0; i < rooms.length; i++) {
            var data = rooms[i];
            var preview = document.createElement('div');
            preview.className = 'room-preview';
            
            var img = document.createElement('img');
            img.src = data.thumbnail;
            preview.appendChild(img);

            var title = document.createElement('div');
            title.className = 'room-title';
            if (data.type === 'real') {
                appendText(title, data.name_full + ' (' + data.user_count + ' ' + data.user_noun + ')');
            } else if (data.type === 'ephemeral') {
                appendText(title, '"' + data.name + '" (ephemeral; ' + data.user_count + ' usuarios)');
            } else if (data.type === 'house') {
                appendText(title, data.user_nick + "'(casa," + data.user_count + " usuarios)");
            }
            preview.appendChild(title);
            
            (function (name) {
                preview.onclick = function () {
                    socket.send(JSON.stringify({
                        type: 'room_change',
                        name: name
                    }));
                    roomlist.style.display = 'none';
                    roomlistopen = false;
                };
            }(data.name));
            
            roomlist.appendChild(preview);
        }

        // show list button
        roomlistbutton.disabled = false;
    }

    function createIframeWidget(config, root) {
        root.className += ' iframe-widget';

        var iframe = document.createElement('iframe');
        iframe.src = config.src;
        root.appendChild(iframe);
    }

    function createPartyWidget(config, root) {
        root.className += ' party-widget';

        root.innerHTML = '<iframe width="320" height="240" src="http://www.youtube.com/embed/videoseries?list=PLuyBiw2l8OdpAGly7cY6Ar5YgYovW2Ps7&amp;hl=en_US&amp;autoplay=1&amp;loop=1" frameborder="0" allowfullscreen></iframe>';

        // "graceful degredation" for those poor IE10 users :'(
        if (root.style.hasOwnProperty('pointerEvents')) {
            root.style.pointerEvents = 'none';

            var lastColor = '';
            setInterval(function () {
                do {
                    var newColor = 'rgba('
                        + Math.floor(Math.random()*2)*255
                        + ','
                        + Math.floor(Math.random()*2)*255
                        + ','
                        + Math.floor(Math.random()*2)*255
                        + ',0.5)'
                } while (lastColor === newColor)
                root.style.backgroundColor = newColor;
                lastColor = newColor;
            }, 400);
        }
    }

    function updateRoomWidgets(widgetdata) {
        widgetdata = widgetdata || roomwidgetstate;
        roomwidgets.innerHTML = '';
        for (var i = 0; i < widgetdata.length; i++) {
            var widget = widgetdata[i];
            var element = document.createElement('div');
            element.className = 'room-widget';
            element.style.left = widget.left + 'px';
            element.style.top = widget.top + 'px';
            element.style.width = widget.width + 'px';
            element.style.height = widget.height + 'px';
            switch (widget.type) {
                case 'iframe':
                    createIframeWidget(widget, element);
                break;
                case 'party':
                    createPartyWidget(widget, element);
                break;
                default:
                    console.log('No se encuentra el widget: ' + widget.type);
                    return;
                break;
            }
            roomwidgets.appendChild(element);
        }
        roomwidgetstate = widgetdata;
    }

    function changeRoom(room) {
        // change room background and widgets
        roomwidgets.innerHTML = '';
        roomwidgetstate = [];
        background.src = room.background.data;
        stage.style.width = room.background.width + 'px';
        stage.style.height = room.background.height + 'px';
        myRoomWidth = room.background.width;
        myRoomHeight = room.background.height;
        if (room.hasOwnProperty('widgets')) {
            updateRoomWidgets(room.widgets);
        }

        // clear users
        userManager.forEach(function (nick) {
            userManager.kill(nick, false);
        });

        myRoom = room;

        // add me
        userManager.add(myNick, me, mySpecialStatus, true, false);

        // go to random position
        me.x = me.x || Math.floor(Math.random() * room.background.width);
        me.y = me.y || Math.floor(Math.random() * room.background.height);

        // push state
        pushAndUpdateState(me);

        if (room.type === 'real') {
            logRoomJoinInChat(room.name, room.name_full);
        } else if (room.type === 'house') {
            logHouseRoomJoinInChat(room.user_nick);
        } else if (room.type === 'ephemeral') {
            logEphemeralRoomJoinInChat(room.name);
        }

        // update URL hash
        window.location.hash = room.name;

        // hide/show room edit button
        if ((room.type === 'house' || room.type === 'ephemeral') && myNick === room.user_nick) {
            roomeditbutton.style.display = 'block';
        } else {
            roomeditbutton.style.display = 'none';
            roomedit.style.display = 'none';
            roomeditvisible = false;
        }
    }

    function handleItemClick(name, obj) {
        if (obj.type === 'room_background') {
            if ((myRoom.type === 'house' || myRoom.type === 'ephemeral') && myNick === myRoom.user_nick) {
                if (confirm('Quieres cambiar el fondo de esta sala a "' + obj.name_full + '"?')) {
                    socket.send(JSON.stringify({
                        type: 'change_room_background',
                        bg_name: name,
                        room: myRoom.name
                    }));
                }
            } else {
                alert("Sólo puedes cambiarle el fondo a tus salas y a tu casa.");
            }
        } else if (obj.type === 'effect') {
            me.effect = obj.effect;
            pushAndUpdateState(me);
        }
    }

    function doAvatarRevert() {
        if (oldImgIndex !== null) {
            me.img_index = oldImgIndex;
        }
    }

    function doAvatarFlip(dir) {
        me.img_index = (me.img_index | 1) - (dir ? 0 : 1);
    }

    function doRunningAvatarSwap(to) {
        oldImgIndex = null;
        var imgs = avatars[me.img_name];
        var start = (me.img_index & 1);
        for (var i = start; i < imgs.length; i += 2) {
            if (imgs[i].indexOf('_run') !== -1) {
                oldImgIndex = me.img_index;
                me.img_index = i;
                return;
            }
        }
        for (var i = start; i < imgs.length; i += 2) {
            if (imgs[i].indexOf('_walk') !== -1) {
                oldImgIndex = me.img_index;
                me.img_index = i;
                return;
            }
        }
    }

    function doFlyingAvatarSwap() {
        oldImgIndex = null;
        var imgs = avatars[me.img_name];
        var start = (me.img_index & 1);
        for (var i = start; i < imgs.length; i += 2) {
            if (imgs[i].indexOf('_hover') !== -1) {
                oldImgIndex = me.img_index;
                me.img_index = i;
                return;
            }
        }
    }

    function doMove(x, y) {
        var cur = (new Date().getTime());
        if (cur - lastmove > 400) {
            doAvatarFlip(x > me.x);
            me.x = x;
            me.y = y;
            pushAndUpdateState(me);
            lastmove = cur;
        } else {
            chatPrint(['chatlog'], [
                ['text', 'Estás haciendo eso muchas veces.']
            ], 'console');
        }
    }

    function showPMLog(nick) {
        function log (from, body, special) {
            chatPrint([messages], [
                ['nick', from, special],
                ['text', ': ' + body]
            ]);
            messages.scrollTop = messages.scrollHeight;
        }
        function logFail () {
            chatPrint([messages], [
                ['text', 'error: el usuario no está online']
            ], 'leave-join');
            messages.scrollTop = messages.scrollHeight;
        }
        function doSend () {
            if (replybox.value) {
                socket.send(JSON.stringify({
                    type: 'priv_msg',
                    nick: nick,
                    msg: replybox.value
                }));

                log(myNick, replybox.value, mySpecialStatus);

                replybox.value = '';
            }
        }

        if (openPMLogs.hasOwnProperty(nick)) {
            openPMLogs[nick].popup.show();
        } else {
            var popup = makePopup('.pm-log', 'Mensaje Privado - ' + nick, true, 250, 250, true, function () {
                delete openPMLogs[nick];
                popup.destroy();
            });

            var messages = document.createElement('div');
            messages.className = 'pm-log-messages';
            popup.content.appendChild(messages);

            var replybox = document.createElement('input');
            replybox.type = 'text';
            replybox.className = 'pm-log-replybox';
            replybox.onkeypress = function (e) {
                // enter
                if (e.which === 13) {
                    doSend();
                    e.preventDefault();
                    replybox.blur();
                    return false;
                }
            };
            replybox.onfocus = function () {
                blockMovement = true;
            };
            replybox.onblur = function () {
                blockMovement = false;
            };
            popup.content.appendChild(replybox);

            var replybtn = document.createElement('button');
            replybtn.className = 'pm-log-replybtn';
            appendText(replybtn, 'Enviar');
            replybtn.onclick = function () {
                doSend();
            };
            popup.content.appendChild(replybtn);

            var pmlog = {
                popup: popup,
                replybox: replybox,
                replybtn: replybtn,
                messages: messages,
                log: log,
                logFail: logFail
            };

            openPMLogs[nick] = pmlog;
        }
    }

    function logPrivmsgInChat(nick, msg, special) {
        showPMLog(nick);
        openPMLogs[nick].log(nick, msg, special);
        tabNotify();
    }

    function logPrivmsgFailInChat(nick) {
        showPMLog(nick);
        openPMLogs[nick].logFail();
    }

    function showProfile(profile, modMode) {
        if (openProfiles.hasOwnProperty(profile.nick)) {
            openProfiles[profile.nick].hide();
        }

        var popup = makePopup('.profile', 'Perfil - ' + profile.nick, true, 250, 250, true, function () {
            delete openProfiles[profile.nick];
            popup.destroy();
        });

        var h3 = document.createElement('h3');
        appendText(h3, profile.nick);
        popup.content.appendChild(h3);

        if (profile.online) {
            appendText(popup.content, profile.nick + ' está conectado');
        } else {
            appendText(popup.content, profile.nick + " no está conectado");
        }

        var button;

        if (friends.indexOf(profile.nick) !== -1) {
            button = document.createElement('button');
            appendText(button, 'Eliminar amigo');
            button.onclick = function (e) {
                socket.send(JSON.stringify({
                    type: 'friend_remove',
                    nick: profile.nick
                }));
                popup.hide();
            };
            popup.content.appendChild(button);
        } else {
            button = document.createElement('button');
            appendText(button, 'Agregar amigo');
            button.onclick = function (e) {
                socket.send(JSON.stringify({
                    type: 'friend_add',
                    nick: profile.nick
                }));
                popup.hide();
            };
            popup.content.appendChild(button);
        }

        button = document.createElement('button');
        var icon = document.createElement('img');
        icon.src = '/media/icons/house.png';
        icon.className = 'house-link';
        button.appendChild(icon);
        appendText(button, 'Visitar casa');
        button.onclick = function (e) {
            socket.send(JSON.stringify({
                type: 'room_change',
                name: 'house ' + profile.nick
            }));
            popup.hide();
        };
        popup.content.appendChild(button);

        button = document.createElement('button');
        appendText(button, 'Reportar a moderadores');
        button.onclick = function () {
            var reason = prompt('Esto reportará este usuario a los moderadores.\nSólo debes hacerlo si crees que han echo algo malo.\n\nRazón del reporte:', '');
            if (reason !== null) {
                if (confirm('Al hacer click en OK aceptas que los reportes frívolos o falsos pueden resultar en advertencias, kicks o incluso baneos.')) {
                    socket.send(JSON.stringify({
                        type: 'user_report',
                        nick: profile.nick,
                        reason: reason
                    }));
                    alert('El reporte ha sido enviado y será visto por nuestros moderadores pronto.');
                    popup.hide();
                }
            } else {
                alert('Debes especificar una razón para reportar.');
            }
        };
        popup.content.appendChild(button);

        if (profile.online) {
            button = document.createElement('button');
            appendText(button, 'Enviar mensaje privado');
            button.onclick = function (e) {
                showPMLog(profile.nick);
                popup.hide();
            };
            popup.content.appendChild(button);

            button = document.createElement('button');
            appendText(button, 'Ir a sala donde está');
            button.onclick = function (e) {
                socket.send(JSON.stringify({
                    type: 'room_change',
                    name: profile.room
                }));
                popup.hide();
            };
            if (profile.room === null) {
                button.disabled = true;
            }
            popup.content.appendChild(button);

            if (modMode) {
                popup.content.appendChild(document.createElement('hr'));

                button = document.createElement('button');
                appendText(button, 'Kickear');
                button.onclick = function (e) {
                    var reason = prompt('Razón del kick:', '');
                    if (reason !== null) {
                        socket.send(JSON.stringify({
                            type: 'console_command',
                            cmd: 'kick ' + profile.nick + ' ' + reason
                        }));
                        popup.hide();
                    }
                };
                popup.content.appendChild(button);

                button = document.createElement('button');
                appendText(button, 'Kickban');
                button.onclick = function (e) {
                    var reason = prompt('Razón del kickban:', '');
                    if (reason !== null) {
                        socket.send(JSON.stringify({
                            type: 'console_command',
                            cmd: 'kickban ' + profile.nick + ' ' + reason
                        }));
                        popup.hide();
                    }
                };
                popup.content.appendChild(button);

                button = document.createElement('button');
                appendText(button, 'List Aliases');
                button.onclick = function (e) {
                    socket.send(JSON.stringify({
                        type: 'console_command',
                        cmd: 'aliases ' + profile.nick
                    }));
                    popup.hide();
                };
                popup.content.appendChild(button);
            }
        }
        if (modMode) {
            button = document.createElement('button');
            appendText(button, 'Warn');
            button.onclick = function (e) {
                var reason = prompt('Warning reason:', '');
                if (reason !== null) {
                    socket.send(JSON.stringify({
                        type: 'console_command',
                        cmd: 'warn ' + profile.nick + ' ' + reason
                    }));
                    popup.hide();
                }
            };
            popup.content.appendChild(button);

            button = document.createElement('button');
            appendText(button, 'Last 10 Mod Reports');
            button.onclick = function (e) {

                socket.send(JSON.stringify({
                    type: 'console_command',
                    cmd: 'modmsgs 10 ' + profile.nick
                }));
                popup.hide();
            };
            popup.content.appendChild(button);
        }

        openProfiles[profile.nick] = popup;
    }

    function makePopup(tag, title, moveable, x, y, hideable, onhide, onshow) {
        var popup = {
            container: null,
            titlebar: null,
            title: null,
            closebutton: null,
            content: null,
            visible: true,
            hide: function () {
                if (this.visible) {
                    this.visible = false;
                    this.container.style.display = 'none';
                    if (onhide) {
                        onhide();
                    }
                }
            },
            show: function () {
                if (!this.visible) {
                    this.visible = true;
                    this.container.style.display = 'block';
                    if (onshow) {
                        onshow();
                    }
                }
            },
            destroy: function () {
                container.removeChild(this.container);
                var keys = Object.keys(this);
                for (var i = 0; i < keys.length; i++) {
                    delete this[keys];
                }
            }
        };

        popup.container = document.createElement('div');
        popup.container.className = 'popup';
        if (tag[0] === '.') {
            popup.container.className += ' ' + tag.substr(1);;
        } else if (tag[0] === '#') {
            popup.container.id = tag.substr(1);
        }

        popup.titlebar = document.createElement('div');
        popup.titlebar.className = 'popup-titlebar';
        popup.container.appendChild(popup.titlebar);

        popup.title = document.createElement('h2');
        appendText(popup.title, title);
        popup.titlebar.appendChild(popup.title);

        if (moveable) {
            var oX, oY, popupX, popupY, down = false;

            popup.container.style.left = x + 'px';
            popup.container.style.top = y + 'px';

            popup.titlebar.onmousedown = function (e) {
                down = true;
                oX = e.clientX;
                oY = e.clientY;
                popupX = parseInt(popup.container.style.left);
                popupY = parseInt(popup.container.style.top);
                document.body.onmousemove = popup.titlebar.onmousemove;
            };
            popup.titlebar.onmousemove = function (e) {
                if (down) {
                    popup.container.style.left = (e.clientX - oX) + popupX + 'px';
                    popup.container.style.top = (e.clientY - oY) + popupY + 'px';
                }
            };
            popup.titlebar.onmouseup = function () {
                down = false;
                document.body.onmousemove = null;
            };
        }

        if (hideable) {
            popup.hidebutton = document.createElement('button');
            popup.hidebutton.className = 'popup-hide';
            popup.hidebutton.title = 'Hide popup';
            popup.hidebutton.onclick = function () {
                popup.hide();
            };
            appendText(popup.hidebutton, 'x');
            popup.titlebar.appendChild(popup.hidebutton);
        }

        popup.content = document.createElement('div');
        popup.content.className = 'popup-content';
        popup.container.appendChild(popup.content);

        container.appendChild(popup.container);

        return popup;
    }

    function renderFriendsList() {
        friendslist.content.innerHTML = '';
        if (friends.length) {
            var ul = document.createElement('ul');
            for (var i = 0; i < friends.length; i++) {
                var li = document.createElement('li');
                var a = document.createElement('a');
                a.className = 'friend';
                appendText(a, friends[i]);
                (function (friend) {
                    a.onclick = function () {
                        socket.send(JSON.stringify({
                            type: 'profile_get',
                            nick: friend
                        }));
                    };
                }(friends[i]));
                li.appendChild(a);

                appendText(li, ' (');

                var delbtn = document.createElement('button');
                delbtn.className = 'friend-remove';
                (function (friend) {
                    delbtn.onclick = function () {
                        socket.send(JSON.stringify({
                            type: 'friend_remove',
                            nick: friend
                        }));
                    };
                }(friends[i]));
                appendText(delbtn, 'remove');
                li.appendChild(delbtn);

                appendText(li, ')');

                ul.appendChild(li);
            }
            friendslist.content.appendChild(ul);
        } else {
            appendText(friendslist.content, 'You have no friends.');
        }
    }

    function renderChooser() {
        chooser.content.innerHTML = '';
        for (var i = 0; i < avatarInventory.length; i++) {
            var name = avatarInventory[i];
            if (avatars.hasOwnProperty(name)) {
                var preview = document.createElement('div');
                preview.style.backgroundImage = 'url(/media/avatars/' + avatars[name][0] + ')';
                preview.className = 'chooser-preview';
                (function (images, name) {
                    preview.onclick = function () {
                        var subChooser = makePopup('.chooser', 'Change avatar - ' + name, true, 300, 300, true, function () {
                            subChooser.destroy();
                        }, null);
                        for (var i = 0; i < images.length; i++) {
                            var preview = document.createElement('div');
                            preview.style.backgroundImage = 'url(/media/avatars/' + images[i] + ')';
                            preview.className = 'chooser-preview';
                            (function (imgid) {
                                preview.onclick = function () {
                                    me.img_name = name;
                                    me.img_index = imgid;
                                    localStorage.setItem('last-avatar', name);
                                    pushAndUpdateState(me);
                                    subChooser.hide();
                                    if (images[imgid].indexOf('_upsidedown') !== -1) {
                                        container.className = 'upside-down';
                                    } else {
                                        container.className = '';
                                    }
                                };
                            }(i));
                            subChooser.content.appendChild(preview);
                        }
                    };

                }(avatars[name], name));
                chooser.content.appendChild(preview);
            }
        }
    }

    function renderInventoryList() {
        inventorylist.content.innerHTML = '';
        if (inventory.length) {
            for (var i = 0; i < inventory.length; i++) {
                var name = inventory[i];
                if (inventoryItems.hasOwnProperty(name)) {
                    var preview = document.createElement('img');
                    preview.src = inventoryItems[name].img;
                    preview.title = inventoryItems[name].name_full;
                    preview.className = 'inventory-item-preview';
                    if (inventoryItems[name].type !== 'useless') {
                        preview.className += ' inventory-item-clickable';
                        (function (itemName, item) {
                            preview.onclick = function () {
                                handleItemClick(itemName, item);
                            };
                        }(name, inventoryItems[name]));
                    }
                    inventorylist.content.appendChild(preview);
                }
            }
        } else {
            appendText(inventorylist.content, 'You have no inventory items.');
        }
    }

    function initGUI_stage() {
        outerstage = document.createElement('div');
        outerstage.id = 'outer-stage';
        container.appendChild(outerstage);

        stage = document.createElement('div');
        stage.id = 'stage';
        stage.style.display = 'none';
        outerstage.appendChild(stage);

        background = document.createElement('img');
        background.id = 'background';
        background.onclick = function (e) {
            doMove(e.layerX, e.layerY);
        };
        background.ondragstart = function () {
            return false;
        };
        stage.appendChild(background);

        roomwidgets = document.createElement('div');
        roomwidgets.id = 'background-widgets';
        stage.appendChild(roomwidgets);
    }

    function handleChatMessage() {
        // is command
        if (chatbox.value[0] === '/') {
            socket.send(JSON.stringify({
                type: 'console_command',
                cmd: chatbox.value.substr(1)
            }));
            logSentConsoleCommandInChat(chatbox.value.substr(1));
        // is chat message
        } else {
            me.chat = chatbox.value;
            if (me.chat !== '') {
                logMineInChat(myNick, me.chat, true);
            }
            pushAndUpdateState(me);
        }
        chatbox.value = '';
    }

    function initGUI_chatbar() {
        chatlog = document.createElement('div');
        chatlog.id = 'chatlog';
        chatlog.className = 'unlocked';
        overlay.appendChild(chatlog);

        chatbar = document.createElement('div');
        chatbar.id = 'chatbar';
        overlay.appendChild(chatbar);

        chatloglock = document.createElement('button');
        chatloglock.id = 'chatlog-lock';
        appendText(chatloglock, 'Lock log');
        chatloglock.onclick = function () {
            chatloglocked = !chatloglocked;
            chatloglock.innerHTML = '';
            if (chatloglocked) {
                appendText(chatloglock, 'Unlock log');
                chatlog.className = 'locked';
            } else {
                appendText(chatloglock, 'Lock log');
                chatlog.className = 'unlocked';
                chatlog.scrollTop = chatlog.scrollHeight;
            }
        };
        chatloglock.disabled = true;
        chatbar.appendChild(chatloglock);

        chatboxholder = document.createElement('div');
        chatboxholder.id = 'chatbox-holder';
        chatbar.appendChild(chatboxholder);

        chatbox = document.createElement('input');
        chatbox.type = 'text';
        chatbox.id = 'chatbox';
        chatbox.maxLength = 100;
        chatbox.placeholder = 'Press TAB to switch to the chat box. It also auto-completes nicknames. Type /help to get a command listing.';
        chatbox.onfocus = function () {
            blockMovement = true;
        };
        chatbox.onblur = function () {
            blockMovement = false;
        };
        chatbox.onkeypress = function (e) {
            // enter
            if (e.which === 13) {
                handleChatMessage();
                e.preventDefault();
                chatbox.blur();
                return false;
            }
        };
        chatbox.onkeydown = function (e) {
            var kc = e.keyCode || e.which;

            // tab completion
            if (kc === 9) {
                e.preventDefault();
                var parts = chatbox.value.split(' ');
                var lastpart = parts[parts.length - 1];
                userManager.forEach(function (nick) {
                    if (nick === myNick) {
                        return;
                    }
                    if (nick.substr(0, lastpart.length) === lastpart) {
                        if (parts.length === 1) {
                            parts[parts.length - 1] = nick + ':';
                        } else {
                            parts[parts.length - 1] = nick;
                        }
                        parts.push('');
                        chatbox.value = parts.join(' ');
                        return 'stop';
                    }
                });
                return false;
            }
        };
        chatbox.disabled = true;
        chatboxholder.appendChild(chatbox);

        chatbutton = document.createElement('input');
        chatbutton.type = 'submit';
        chatbutton.value = 'Send';
        chatbutton.id = 'chatbutton';
        chatbutton.onclick = function (e) {
            handleChatMessage();
        };
        chatbutton.disabled = true;
        chatbar.appendChild(chatbutton);

        inventorylistbutton = document.createElement('input');
        inventorylistbutton.id = 'inventory-list-button';
        inventorylistbutton.type = 'submit';
        inventorylistbutton.value = 'Inventory';
        inventorylistbutton.onclick = function () {
            inventorylist.show();
        };
        inventorylistbutton.disabled = true;
        chatbar.appendChild(inventorylistbutton);

        chooserbutton = document.createElement('input');
        chooserbutton.id = 'chooser-button';
        chooserbutton.type = 'submit';
        chooserbutton.value = 'Avatars';
        chooserbutton.onclick = function () {
            chooser.show();
        };
        chooserbutton.disabled = true;;
        chatbar.appendChild(chooserbutton);
    }

    function initGUI_topbar() {
        topbuttons = document.createElement('div');
        topbuttons.id = 'top-buttons';
        overlay.appendChild(topbuttons);

        homebutton = document.createElement('button');
        var icon = document.createElement('img');
        icon.src = 'media/icons/house.png';
        icon.alt = icon.title = 'My House';
        homebutton.appendChild(icon);
        homebutton.id = 'home-button';
        homebutton.onclick = function () {
            socket.send(JSON.stringify({
                type: 'room_change',
                name: 'house ' + myNick
            }));
        };
        homebutton.disabled = true;
        topbuttons.appendChild(homebutton);

        roomlistbutton = document.createElement('button');
        roomlistbutton.id = 'room-list-button';
        appendText(roomlistbutton, 'Choose room');
        roomlistbutton.onclick = function () {
            if (!roomlistopen) {
                roomlist.style.display = 'block';
                roomlistopen = true;
            } else {
                roomlist.style.display = 'none';
                roomlistopen = false;
            }
        };
        roomlistbutton.disabled = true;
        topbuttons.appendChild(roomlistbutton);

        accountsettingsbutton = document.createElement('input');
        accountsettingsbutton.id = 'account-settings-button';
        accountsettingsbutton.type = 'submit';
        accountsettingsbutton.value = 'My Account';
        accountsettingsbutton.onclick = function () {
            accountsettings.show();
        };
        accountsettingsbutton.disabled = true;
        topbuttons.appendChild(accountsettingsbutton);

        roomeditbutton = document.createElement('input');
        roomeditbutton.id = 'room-edit-button';
        roomeditbutton.type = 'submit';
        roomeditbutton.value = 'Edit Room';
        roomeditbutton.onclick = function () {
            if (roomeditvisible) {
                roomedit.style.display = 'none';
                roomeditvisible = false;
            } else {
                roomedit.style.display = 'block'
                roomeditvisible = true;
            }
        };
        roomeditbutton.style.display = 'none';
        overlay.appendChild(roomeditbutton);

        roomedit = document.createElement('div');
        roomedit.id = 'room-edit';
        roomedit.style.display = 'none';
        appendText(roomedit, "Change this room's background by clicking one in your inventory.");
        roomeditvisible = false;
        overlay.appendChild(roomedit);

        roomeditreset = document.createElement('input');
        roomeditreset.type = 'submit';
        roomeditreset.value = 'Reset to default';
        roomeditreset.onclick = function () {
            socket.send(JSON.stringify({
                type: 'change_room_background',
                room: myRoom.name,
                bg_name: null
            }));
        };
        roomedit.appendChild(roomeditreset);

        accountsettings = makePopup('#account-settings', 'My Account', true, 300, 300, true);
        accountsettings.hide();

        friendslistbutton = document.createElement('button');
        friendslistbutton.id = 'friends-list-button';
        appendText(friendslistbutton, 'Friends');
        friendslistbutton.onclick = function () {
            friendslist.show();
        };
        friendslistbutton.disabled = true;
        accountsettings.content.appendChild(friendslistbutton);

        changepassbutton = document.createElement('a');
        changepassbutton.href = 'https://login.persona.org';
        changepassbutton.className = 'button';
        changepassbutton.target = '_blank';
        appendText(changepassbutton, 'Change password etc.');
        changepassbutton.onclick = function () {
            accountsettings.hide();
            return true;
        };
        accountsettings.content.appendChild(changepassbutton);

        rmpassbutton = document.createElement('input');
        rmpassbutton.type = 'submit';
        rmpassbutton.value = 'Delete account';
        rmpassbutton.onclick = function () {
            if (confirm("Are you sure you want to delete your ponyplace account?\nYou'll your house, and your nickname!\nNote: This will *not* do anything to your Persona ID.")) {
                socket.send(JSON.stringify({
                    type: 'delete_account'
                }));
                accountsettings.hide();
            }
        };
        accountsettings.content.appendChild(rmpassbutton);

        chooser = makePopup('.chooser', 'Avatar inventory', true, 200, 200, true, null, function () {
            renderChooser();

        });
        chooser.hide();

        inventorylist = makePopup('.chooser', 'Item inventory', true, 200, 200, true, null, function () {
            renderInventoryList();
        });
        inventorylist.hide();

        friendslist = makePopup('#friends-list', 'Friends', true, 200, 200, true, null, function () {
            renderFriendsList();
        });
        friendslist.hide();
    }

    function doLogin(newAccount, assertion) {
        if (nickbox.value || !newAccount) {
            nickbox.blur();
            loginbox.hide();
            initNetwork(newAccount, assertion);
        }
    }

    function initGUI_login() {
        loginbox = makePopup('#loginbox', 'Log in');
        loginbox.content.innerHTML = "<h1>Welcome to ponyplace!</h1>\
        <p>ponyplace is a My Little Pony-themed chatroom! You can hang out, chat and customise your avatar and house. It's all free, forever. You'll never have to pay a cent!</p>\
        <div id=rules>By creating an account and logging in you must abide by these rules:\
        <ul>\
            <li>You must be 13 years or older, or have asked your parents for permission.\
            <li>You understand that ponyplace is a public chatroom that may occasionally feature content unsuitable for children.\
            <li>Keep 18+ content in rooms labelled as such.\
            <li>Do not ask to be a mod (moderator) or pester the mods.\
            <li>Be nice.\
            <li>Don't spam or flood the chat.\
        </ul>\
        </div>\
        <p>If you already have a ponyplace and Persona account, log in.</p>";

        personasubmit = document.createElement('input');
        personasubmit.type = 'submit';
        personasubmit.value = 'Sign in to ponyplace (using Persona login)';
        personasubmit.onclick = function () {
            navigator.id.watch({
                loggedInUser: currentUser,
                onlogin: function (assertion) {
                    doLogin(false, assertion);
                },
                onlogout: function () {
                    // ???
                }
            });
            navigator.id.request();
        };
        loginbox.content.appendChild(personasubmit);

        appendText(loginbox.content, 'Or, create an account. Choose a nickname (3 to 18 characters; digits, letters and underscores (_) only).');

        nickbox = document.createElement('input');
        nickbox.type = 'text';
        nickbox.placeholder = 'nickname';
        nickbox.maxLength = 18;
        nickbox.onfocus = function () {
            blockMovement = true;
        };
        nickbox.onblur = function () {
            blockMovement = false;
        };
        loginbox.content.appendChild(nickbox);
        nickbox.focus();

        loginsubmit = document.createElement('input');
        loginsubmit.type = 'submit';
        loginsubmit.value = 'Create ponyplace Account (using Persona login)';
        loginsubmit.onclick = function () {
            navigator.id.watch({
                loggedInUser: currentUser,
                onlogin: function (assertion) {
                    doLogin(true, assertion);
                },
                onlogout: function () {
                    // ???
                }
            });
            navigator.id.request();
        };
        loginbox.content.appendChild(loginsubmit);

        var a = document.createElement('a');
        a.href = '/credits.html';
        a.target = '_blank';
        appendText(a, "Disclaimer and Credits");
        loginbox.content.appendChild(a);
    }

    function initGUI() {
        document.body.innerHTML = '';

        container = document.createElement('div');
        container.id = 'container';
        document.body.appendChild(container);

        initGUI_stage();

        overlay = document.createElement('div');
        overlay.id = 'overlay';
        container.appendChild(overlay);

        userManager.initGUI();

        initGUI_topbar();
        initGUI_chatbar();

        roomlist = document.createElement('div');
        roomlist.id = 'room-list';
        overlay.appendChild(roomlist);

        initGUI_login();

        window.onfocus = function () {
            pageFocussed = true;
            document.title = 'ponyplace';
            unseenHighlights = 0;
        };
        window.onblur = function () {
            pageFocussed = false;
        };
        window.onresize = translateViewport;
        document.body.onkeyup = function (e) {
            if (blockMovement) {
                return;
            }
            switch (e.keyCode || e.which) {
                // tab
                case 9:
                    chatbox.focus();
                    return false;
                // left
                case 37:
                // up
                case 38:
                // right
                case 39:
                // down
                case 40:
                    window.clearInterval(moveInterval);
                    moveInterval = null;
                    doAvatarRevert(true);
                    pushAndUpdateState(me);
                    e.preventDefault();
                    return false;
            }
        };
        document.body.onkeydown = function (e) {
            if (blockMovement) {
                return;
            }
            switch (e.keyCode || e.which) {
                // left
                case 37:
                    if (!moveInterval) {
                        doAvatarFlip(false);
                        doRunningAvatarSwap();
                        moveInterval = window.setInterval(function () {
                            me.x -= 100;
                            pushAndUpdateState(me);
                        }, 250);
                        me.x -= 100;
                        pushAndUpdateState(me);
                    }
                    e.preventDefault();
                    return false;
                // up
                case 38:
                    if (!moveInterval) {
                        doFlyingAvatarSwap();
                        moveInterval = window.setInterval(function () {
                            me.y -= 56;
                            pushAndUpdateState(me);
                        }, 250);
                        me.y -= 56;
                        pushAndUpdateState(me);
                    }
                    e.preventDefault();
                    return false;
                // right
                case 39:
                    if (!moveInterval) {
                        doAvatarFlip(true);
                        doRunningAvatarSwap();
                        moveInterval = window.setInterval(function () {
                            me.x += 100;
                            pushAndUpdateState(me);
                        }, 250);
                        me.x += 100;
                        pushAndUpdateState(me);
                    }
                    e.preventDefault();
                    return false;
                // down
                case 40:
                    if (!moveInterval) {
                        doFlyingAvatarSwap();
                        moveInterval = window.setInterval(function () {
                            me.y += 56;
                            pushAndUpdateState(me);
                        }, 250);
                        me.y += 56;
                        pushAndUpdateState(me);
                    }
                    e.preventDefault();
                    return false;
            }
        };
    }

    function initNetwork(newAccount, assertion) {
        socket = new WebSocket('ws://' + window.location.host + '/', 'ponyplace');

        socket.onopen = function () {
            connected = true;
            me = {
                img_name: localStorage.getItem('last-avatar') || 'derpy',
                img_index: 0,
                effect: null,
                x: 0,
                y: 0,
                chat: ''
            };

            if (!newAccount) {
                socket.send(JSON.stringify({
                    type: 'login',
                    obj: me,
                    assertion: assertion,
                    mode: 'existing'
                }));
            } else {
                // trim whitespace
                var nick = nickbox.value.replace(/^\s+|\s+$/g, '');
                socket.send(JSON.stringify({
                    type: 'login',
                    obj: me,
                    assertion: assertion,
                    mode: 'create',
                    nick: nick
                }));
            }
        };
        socket.onclose = function (e) {
            connected = false;
            if (!ignoreDisconnect) {
                alert('Error, lost connection!\nThis may be because:\n- Server shut down to be updated (try reloading)\n- Failed to connect (server\'s down)\n- Server crashed\n- You were kicked');
                container.className = 'disconnected';
                container.innerHTML = '';
            }
        };
        socket.onmessage = function (e) {
            var msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'appear':
                    userManager.add(msg.nick, msg.obj, msg.special, false, msg.joining);
                break;
                case 'update':
                    if (msg.nick !== myNick) {
                        userManager.update(msg.nick, msg.obj);
                    }
                break;
                case 'avatar_change':
                    me.img_name = msg.img_name;
                    me.img_index = msg.img_index;
                    if (myRoom !== null) {
                        userManager.update(myNick, me);
                        // erase last avatar
                        localStorage.setItem('last-avatar', '');
                    }
                break;
                case 'account_state':
                    chatbox.focus();

                    chatbox.disabled = false;
                    chatbutton.disabled = false;
                    chatloglock.disabled = false;

                    myNick = msg.nick;
                    mySpecialStatus = msg.special;
                    avatarInventory = msg.avatar_inventory;
                    renderChooser();
                    inventory = msg.inventory;
                    friends = msg.friends;
                    chooserbutton.disabled = false;
                    accountsettingsbutton.disabled = false;
                    changepassbutton.style.display = 'block';
                    rmpassbutton.style.display = 'block';
                    inventorylistbutton.disabled = false;
                    renderInventoryList();
                    friendslistbutton.disabled = false;
                    renderFriendsList();
                    homebutton.disabled = false;

                    stage.style.display = 'block';
                    if (myRoom === null) {
                        background.src = '/media/rooms/noroom.png';
                        stage.style.height = '660px';
                        stage.style.width = '1173px';
                        // ponyplace.ajf.me/#roomname shortcut
                        if (window.location.hash) {
                            socket.send(JSON.stringify({
                                type: 'room_change',
                                name: window.location.hash.substr(1)
                            }));
                        // otherwise show room chooser popup
                        } else {
                            roomlist.style.display = 'block';
                            roomlistopen = true;
                        }
                    }

                    updateRoomWidgets();
                break;
                case 'broadcast':
                    logBroadcastInChat(msg.msg);
                break;
                case 'console_msg':
                    logConsoleMessageInChat(msg.msg);
                break;
                case 'mod_log':
                    var popup = makePopup('.mod-log', '/' + msg.cmd, true, 250, 250, true, function () {
                        popup.destroy();
                    });
                    var ul = document.createElement('ul');
                    for (var i = 0; i < msg.items.length; i++) {
                        var item = msg.items[i];
                        var li = document.createElement('li');
                        var pre = document.createElement('pre');
                        appendText(li, {
                            ban: 'Ban',
                            unban: 'Unban',
                            kick: 'Kick',
                            warn: 'Warning',
                            move: 'Move room',
                            broadcast: 'Broadcast message'
                        }[item.type] + ' by ' + item.mod + ' at ' + (new Date(item.date)).toLocaleString());
                        delete item.type;
                        delete item.date;
                        delete item.mod;
                        appendText(pre, JSON.stringify(item, null, 2));
                        li.appendChild(pre);
                        ul.appendChild(li);
                    }
                    popup.content.appendChild(ul);
                break;
                case 'mod_msgs':
                    var popup = makePopup('.mod-log', '/' + msg.cmd, true, 250, 250, true, function () {
                        popup.destroy();
                    });
                    var ul = document.createElement('ul');
                    for (var i = 0; i < msg.messages.length; i++) {
                        var message = msg.messages[i];
                        var li = document.createElement('li');
                        if (message.type === 'user_report') {
                            appendText(li, 'At ' + (new Date(message.date)).toLocaleString() +' "' + message.nick + '" was reported by "' + message.from + '" because: "' + message.reason + '"');
                        } else if (message.type === 'warn') {
                            appendText(li, 'At ' + (new Date(message.date)).toLocaleString() +' "' + message.nick + '" was warned by "' + message.from + '" because: "' + message.reason + '"');
                        }
                        ul.appendChild(li);
                    }
                    popup.content.appendChild(ul);
                break;
                case 'help':
                    var popup = makePopup('.mod-log', 'Help', true, 250, 250, true, function () {
                        popup.destroy();
                    });
                    var ul = document.createElement('ul');
                    for (var i = 0; i < msg.lines.length; i++) {
                        var li = document.createElement('li');
                        appendText(li, msg.lines[i]);
                        ul.appendChild(li);
                    }
                    popup.content.appendChild(ul);
                break;
                case 'mod_warning':
                    var popup = makePopup('.mod-warning', 'Moderator Warning', true, 250, 250, true, function () {
                        popup.destroy();
                    });
                    appendText(popup.content, 'You have been warned by ');
                    appendNickname(popup.content, msg.mod_nick, msg.mod_special);
                    appendText(popup.content, ' because: "' + msg.reason + '"');
                break;
                case 'profile':
                    showProfile(msg.data, msg.moderator_mode);
                break;
                case 'priv_msg':
                    logPrivmsgInChat(msg.from_nick, msg.msg, msg.from_special);
                break;
                case 'priv_msg_fail':
                    logPrivmsgFailInChat(msg.nick);
                break;
                case 'die':
                    userManager.kill(msg.nick, true);
                break;
                case 'room_list':
                    updateRoomList(msg.list);
                    globalUserCount = msg.user_count;
                    globalModCount = msg.mod_count;
                    userManager.showUserCounter();
                    userManager.updateCounter();
                break;
                case 'avatar_list':
                    avatars = msg.list;
                break;
                case 'inventory_item_list':
                    inventoryItems = msg.list;
                break;
                case 'room_change':
                    changeRoom(msg.data);
                break;
                case 'kick_notice':
                    logKickNoticeInChat(msg.mod_nick, msg.mod_special, msg.kickee_nick, msg.kickee_special, msg.reason);
                break;
                case 'kickban_notice':
                    logKickBanNoticeInChat(msg.mod_nick, msg.mod_special, msg.kickee_nick, msg.kickee_special, msg.reason);
                break;
                case 'kick':
                    if (msg.reason === 'account_in_use') {
                        alert('You are already logged in somewhere else. Log out from there first.');
                    } else if (msg.reason === 'bad_nick') {
                        alert('Bad nickname.\nNicknames must be between 3 and 18 characters long, and contain only letters, digits, and underscores (_).');
                    } else if (msg.reason === 'bad_login') {
                        alert('Login with Persona failed.');
                    } else if (msg.reason === 'no_assoc_account') {
                        alert('There is no account associated with this email address.\nAre you sure you have a ponyplace account? This is separate from your Persona account, which you log in to to sign in to ponyplace or create a ponyplace account.');
                    } else if (msg.reason === 'already_email') {
                        alert('There is already an account associated with this email address. You can only have one ponyplace account for one email address.');
                    } else if (msg.reason === 'already_account') {
                        alert('There is already an account with this nickname. Choose a different one.');
                    } else if (msg.reason === 'account_deleted') {
                        alert('Your account was deleted.');
                        navigator.id.logout();
                        // erase last avatar
                        localStorage.setItem('last-avatar', '');
                        window.location.reload();
                    } else if (msg.reason === 'protocol_error') {
                        alert('There was a protocol error. This usually means your client sent a malformed packet. Your client is probably out of date, try clearing your cache and refreshing.');
                    } else if (msg.reason === 'no_such_room') {
                        alert("No such room. You tried to join a room that doesn't exist.");
                    } else if (msg.reason === 'dont_have_item') {
                        alert("You do not have the item you tried to wear. This is probably a bug.");
                    } else if (msg.reason === 'dont_have_avatar') {
                        alert("You do not have the avatar you tried to wear. This is probably a bug.");
                        // erase last avatar
                        localStorage.setItem('last-avatar', '');
                    } else if (msg.reason === 'dont_have_item') {
                        alert("You do not have the item you tried to use. This is probably a bug.");
                    } else if (msg.reason === 'kick') {
                        if (msg.msg) {
                            alert('You were kicked!\nReason: "' + msg.msg + '"');
                        } else {
                            alert('You were kicked!');
                        }
                    } else if (msg.reason === 'ban') {
                        if (msg.msg) {
                            alert('You were banned!\nReason: "' + msg.msg + '"');
                        } else {
                            alert('You were banned!');
                        }
                    } else if (msg.reason === 'update') {
                        ignoreDisconnect = true;
                        window.setTimeout(function () {
                            alert('ponyplace update happening - page will reload');
                            window.location.reload();

                        }, (5+Math.floor(Math.random() * 5)) * 1000);
                    } else {
                        alert('You were disconnected for an unrecognised reason: "' + msg.reason + '"');
                    }
                break;
                default:
                    alert('There was a protocol error. This usually means the server sent a malformed packet. Your client is probably out of date, try clearing your cache and refreshing.');
                    socket.close();
                break;
            }
        };
    }

    window.onload = function () {
        initGUI();
    };
}());
