// Node modules
const TelegramBot = require('node-telegram-bot-api'), sqlite3 = require('sqlite3').verbose(), SteamUser = require('steam-user'), 
	SteamTotp = require('steam-totp'), settings = require('./settings.json'), SocksAgent = require('socks5-https-client/lib/Agent'),
	fs = require('fs'), oneDay = 86400000, file = './db/SteamDB.db', getSteamID64 = require('customurl2steamid64/lib/steamid64'),
	sleep = require('system-sleep');

const socksAgent = new SocksAgent({socksHost: settings.host, socksPort: settings.port, socksUsername: settings.login, socksPassword: settings.psswd}),
	bot = new TelegramBot(settings.token, {polling: true, agent: socksAgent});

// Global variebles
var config, client, community, countAcc, configArray = {}, accountCount = settings.count, db, state, mode, connect, gameLaunched = false;

// Add bots option
const addBotOptions = {username: '', password: '', sharedSecret: ''};

// SQL
if (fs.existsSync(file)) {
	db = new sqlite3.Database(file, sqlite3.OPEN_READWRITE, function(err) {
		if (err)
			console.log(err.message);
		else
			console.log('Connected to the SteamDB database.');
	});
} else {
	db = new sqlite3.Database(file);
	console.log('SteamDB database was create.');
	db.run('CREATE TABLE DateTimeOut(name INTEGER, state VARCHAR(25), mode VARCHAR(25))', function(){
		console.log('TABLE DateTimeOut was create.');
		var i = 0;
		while(i<accountCount){
			i++;
			db.run('INSERT INTO DateTimeOut(name, state, mode) VALUES(?, ?, ?)', [i, '1', '0']);
		}
	});
	db.run('CREATE TABLE Accounts(countAcc INTEGER)', function(){
		console.log('TABLE Accounts was create.');
		db.run('INSERT INTO Accounts(countAcc) VALUES(?)', [0], function(err){
			if (err)
				console.log(err.message);
			else
				console.log('Insert was ended.');
		});
	});
}

function selectCountAcc(){
	let sql = 'SELECT countAcc FROM Accounts';
	db.all(sql, [], function(err, rows) {
		if (err)
			throw err;
		rows.forEach(function(row) {
			countAcc = row.countAcc;
			console.log('Count: ' + (countAcc+1));
		});
	});
}

function selectFunction(){
	let sql = 'SELECT state FROM DateTimeOut WHERE name= ' + config;
	db.all(sql, [], function(err, rows) {
		if (err)
			throw err;
		rows.forEach(function(row) {
			state = row.state;
		});
	});
	let sql1 = 'SELECT mode FROM DateTimeOut WHERE name= ' + config;
	db.all(sql1, [], function(err, rows) {
		if (err)
			throw err;
		rows.forEach(function(row) {
			mode = row.mode;
		});
	});
}

function requireJSON(){
	configArray = {};
	for(var i = 1; i <= accountCount; i++){
		delete require.cache[require.resolve('./config' + i + '.json')];
		configArray[i] = require('./config' + i + '.json');
	}
}

// Telegram's functions
bot.onText(/\/start/, async function(msg) { // Start
	console.log('Use /bot to add new Steam account, if Steam account was added use /go, instructions /help');
	await bot.sendMessage(msg.chat.id, '\u{1F6A7} Use /bot to add new Steam account, if Steam account was added use /go, instructions /help');
});

bot.onText(/\/help/, async function(msg) { // Help
	await bot.sendMessage(msg.chat.id, 'Please wait, loading...');
	await bot.sendPhoto(msg.chat.id, 'https://drive.google.com/open?id=1mLKoemjlLsCxFdC4C-NJgPaDeM2f1JAa', {caption: 'List of comands'});
});

bot.onText(/\/go/, async function(msg) { // Go
	if(client == undefined){
		requireJSON();
		go(msg);
	}else{
		await bot.sendMessage(msg.chat.id, '\u{1F6A7} Please logout from ' + connect.username + '!');
		console.log('Please logout from ' + connect.username + '!');
	}
});

bot.onText(/\/function/, async function(msg) { // Function
	if(client != undefined)
		addDeleteSpam(msg.chat.id);
	else{
		console.log('Please select a bot!');
		await bot.sendMessage(msg.chat.id, '\u{1F6A7} Please select a bot! /go');
	}
});

bot.onText(/\/bot/, async function(msg) { // Bot
	console.log('Enter username:');
	await bot.sendMessage(msg.chat.id, 'Enter username:');
	bot.on('message', onMessageAddBot);
});

bot.onText(/\/logout/, async function(msg) { // Logout
	if(connect != undefined && connect.username != '' )
		loggoutSteamClient(msg.chat.id, msg);
	else{
		console.log('Please select a bot!');
		await bot.sendMessage(msg.chat.id, '\u{1F6A7} Please select a bot! /go');
	}
});

// Go - show all accounts
async function go(msg) {
	var keyboard = {};
	keyboard['inline_keyboard'] = [];
	for (var i = 1; i <= accountCount; i++) {
		keyboard['inline_keyboard'].push([{
			text: configArray[i].username,
			callback_data: i
		}]);
	}
	await bot.sendMessage(msg.chat.id,'\u{231B} Select bot to login', {'reply_markup': JSON.stringify(keyboard)});
}

// Callbacks
bot.on('callback_query', async function(msg)  {
	if (client == undefined) {
		requireJSON();
		if (configArray.hasOwnProperty(msg.data)) {
			connect = configArray[msg.data];
			config = parseInt(msg.data, 10);
			selectFunction();
			connectSteamClient(msg.message, connect.username, connect.password, connect.sharedSecret);
		}
	} else {
		switch (msg.data) {
			case 'func1':
				await bot.sendMessage(msg.message.chat.id, '\u{270F} Upload a file with ID64 or links');
				bot.once('document', addFriends);
				break;
			case 'func2':
				deleteRequestFriends(msg);
				break;
			case 'func3':
			 	deleteAllFriends(msg);
			 	break;
			case 'func4':
				await bot.sendMessage(msg.message.chat.id, '\u{270F} Enter text for spam');
				bot.once('message', spamFriends);
				break;
			case 'func':
				loggoutSteamClient(msg.message.chat.id, msg.message);
				break;
			case 'func5':
				await bot.sendMessage(msg.message.chat.id, '\u{270F} Enter new nickname');
				bot.once('message', onMessageChangeNick);
				break;
			case 'func6':
				await bot.sendMessage(msg.message.chat.id, 'Offline: 0,' + '\n' + 'Online: 1,' + '\n' + 'Busy: 2,' + '\n' + 'Away: 3,' +
				'\n' + 'Snooze: 4,' + '\n' + 'LookingToTrade: 5,' + '\n' + 'LookingToPlay: 6');
				await bot.sendMessage(msg.message.chat.id, '\u{270F} Enter number of new status:');
				bot.once('message', function(msg){
					newState(msg, msg.text);
				});
				break;
			case 'func7':
				await bot.sendMessage(msg.message.chat.id, 'PC: 0,' + '\n' + 'BigPicture: 1,' + '\n' + 'Mobile: 2,' + '\n' + 'Web: 3,');
				await bot.sendMessage(msg.message.chat.id, '\u{270F} Enter number of new mode:');
				bot.once('message', function(msg){
					newMode(msg, msg.text);
				});
				break;
			case 'func8':
				hoursBoost(msg.message);
				break;
			case '440|Team Fortress 2':
			case '570|Dota 2':
			case '730|CS:GO':
			case '230410|Warframe':
			case '755790|Ring of Elysium':
				hoursBooster(msg.message, msg.data);
				break;
		}
	}
});

bot.on('callback_query', function(msg)  {
	switch (msg.data) {
		case 'maFile':
			console.log('Enter maFile');
			bot.sendMessage(msg.message.chat.id, 'Enter maFile');
			bot.once('document', maFileRead);
			break;
		case 'haven`t maFile':
			console.log('Recording for account without maFile');
			bot.sendMessage(msg.message.chat.id, 'Recording for account without maFile');
			addBot(msg.message, addBotOptions.username, addBotOptions.password, addBotOptions.sharedSecret);
			break;
		case 'have SteamGuard':
			console.log('Recording for account without SteamGuard');
			addBotOptions.sharedSecret = 1;
			bot.sendMessage(msg.message.chat.id, 'Recording for account without SteamGuard');
			addBot(msg.message, addBotOptions.username, addBotOptions.password, addBotOptions.sharedSecret);
			break;
	}
});

// Functions for Accounts (Callbacks)
async function addDeleteSpam(msg) {
	var keyboard = {
        "inline_keyboard": [
			[{
				text: '\u{1F4B0} Добавить друзей',
				callback_data: 'func1'
			}],
			[{
				text: '\u{26A0} Удалить отправленные заявки в друзья',
				callback_data: 'func2'
			}],
			//[{
				//text: 'Удалить всех друзей и исходящие заявки',
				//callback_data: 'func3'
			//}],
			[{
				text: '\u{1F4E8} Spam друзьям',
				callback_data: 'func4'
			}],
			[{
				text: '\u{1F55C} Hour boost игр',
				callback_data: 'func8'
			}],
			[{
				text: '\u{1F511} Изменить имя аккаунта',
				callback_data: 'func5'
			}],
			[{
				text: '\u{1F4CC} Изменить статус аккаунта',
				callback_data: 'func6'
			}],
			[{
				text: '\u{1F6A6} Изменить UI mode (PC, BigPicture, Mobile, WEB)',
				callback_data: 'func7'
			}],
			[{
				text: '\u{1F4A4} Logout',
				callback_data: 'func'
			}]
        ]
    };
	await bot.sendMessage(msg,'\u{1F31F} Select functions for ' + connect.username, {'reply_markup': JSON.stringify(keyboard)});
}

// Add Bot into JSONs
function onMessageAddBot(msg){
	if(addBotOptions.username == ''){
		addBotOptions.username = msg.text;
		bot.sendMessage(msg.chat.id, 'Enter Password:');
		console.log('Enter Password:');
	}else if(addBotOptions.password == ''){
		addBotOptions.password = msg.text;
		selectCountAcc();
	}
	if((addBotOptions.username != '') && (addBotOptions.password != '')){
		bot.off('message');
		sharedSecretRead(msg);
	}
}

function sharedSecretRead(msg) {
	var keyboard = {
        "inline_keyboard":[
			[{
				text: 'I have maFile',
				callback_data: 'maFile'
			}],
			[{
				text: 'I haven`t maFile and SteamGuard',
				callback_data: 'haven`t maFile'
			}],
			[{
				text: 'I haven`t  maFile, but have SteamGuard',
				callback_data: 'have SteamGuard'
			}]
        ]
    };
	bot.sendMessage(msg.chat.id,'\u{1F6A8} Select option:', {'reply_markup': JSON.stringify(keyboard)});
}

// Read maFile
function maFileRead(msg){
	var path = bot.downloadFile(msg.document.file_id, './path/').then(function (path) {
		fs.rename(path, path + '.json', function(err) {
			if (err) console.log('ERROR: ' + err);
			delete require.cache[require.resolve('./' + path)];
			var maFile = require('./' + path);
			addBotOptions.sharedSecret = maFile.shared_secret;
			bot.sendMessage(msg.chat.id, '\u{231A} Recording...');
			addBot(msg, addBotOptions.username, addBotOptions.password, addBotOptions.sharedSecret);
		});
	});
}

// Add data: username, pass, sharedSecret
async function addBot(msg, username, pass, sharedSecret){
	if(countAcc <= accountCount)
	{
		let configurate = {  
			username: username,
			password: pass, 
			sharedSecret: sharedSecret
		};
		
		addBotOptions.username = '';
		addBotOptions.password = '';
		addBotOptions.sharedSecret = '';
		countAcc++;
		fs.writeFileSync('config' + countAcc + '.json', JSON.stringify(configurate), function(err) {  
			if (err) throw err;
		});
		console.log('Account added!');
		
		await bot.sendMessage(msg.chat.id, '\u{2705} Account added! Count '+ countAcc);
		let sql = 'UPDATE Accounts SET countAcc = ' + countAcc;
		db.run(sql, function(err) {
		  if (err)
			return console.error(err.message);
		console.log(`Row(s) updated: ${this.changes}`);
		});
	} else {
		console.log('Account bots limit');
		await bot.sendMessage(msg.chat.id, '\u{26D4} Account bots limit');
	}
}

function onMessageChangeNick(msg){
	client.setPersona(undefined, msg.text);
	console.log('New name is "' + msg.text + '"');
	bot.sendMessage(msg.chat.id, '\u{2B50} New name is "' + msg.text + '"');
}

// Change State
async function newState(msg, stateN){
	db.run('UPDATE DateTimeOut SET state=? WHERE name=?', [stateN, config]);
	var stringState;
	switch (stateN) {
			case '0':
				client.setPersona(SteamUser.Steam.EPersonaState.Offline);
				stringState = 'Now state is Offline';
				break;
			case '1':
				client.setPersona(SteamUser.Steam.EPersonaState.Online);
				stringState = 'Now state is Online';
				break;
			case '2':
				client.setPersona(SteamUser.Steam.EPersonaState.Busy);
				stringState = 'Now state is Busy';
				break;
			case '3':
				client.setPersona(SteamUser.Steam.EPersonaState.Away);
				stringState = 'Now state is Away';
				break;
			case '4':
				client.setPersona(SteamUser.Steam.EPersonaState.Snooze);
				stringState = 'Now state is Snooze';
				break;
			case '5':
				client.setPersona(SteamUser.Steam.EPersonaState.LookingToTrade);
				stringState = 'Now state is LookingToTrade';
				break;
			case '6':
				client.setPersona(SteamUser.Steam.EPersonaState.LookingToPlay);
				stringState = 'Now state is LookingToPlay';
				break;
			default:
				console.log('Wrong number');
				stringState = 'Wrong number';
				break;
	}
	await bot.sendMessage(msg.chat.id,'\u{1F4CC} ' + stringState);
}

// Change Mode
async function newMode(msg, modeN){
	db.run('UPDATE DateTimeOut SET mode=? WHERE name=?', [mode, config]);
	var stringMode;
	if(modeN != null)
		client.setUIMode(parseInt(modeN, 10));
	switch (modeN) {
			case '0':
				stringMode = 'Now mode is PC';
				break;
			case '1':
				stringMode = 'Now mode is BigPicture';
				break;
			case '2':
				stringMode = 'Now mode is Mobile';
				break;
			case '3':
				stringMode = 'Now mode is WEB';
				break;
			default:
				console.log('Wrong number');
				stringMode = 'Wrong number';
				break;
	}
	await bot.sendMessage(msg.chat.id,'\u{1F4CC} ' + stringMode);
}

// Hour Boost (Callbacks)
async function hoursBoost(msg) {
	var keyboard = {
        "inline_keyboard":[
			[{
				text: 'Team Fortress 2',
				callback_data: '440|Team Fortress 2'
			}],
			[{
				text: 'Dota 2',
				callback_data: '570|Dota 2'
			}],
			[{
				text: 'CS:GO',
				callback_data: '730|CS:GO'
			}],
			[{
				text: 'Warframe',
				callback_data: '230410|Warframe'
			}],
			[{
				text: 'Ring of Elysium',
				callback_data: '755790|Ring of Elysium'
			}]
        ]
    };
	await bot.sendMessage(msg.chat.id,'\u{1F52E} Select game for boost:', {'reply_markup': JSON.stringify(keyboard)});
}

// Steam Connections
function connectSteamClient(msg, username, pass, sharedSecret, guard) {
	client = new SteamUser();
	client.setOption('promptSteamGuardCode', false);
	client.logOn({
		"accountName": username,
		"password": pass
	});
	
	client.on('error', async function(e) {
		if(e){
			console.log(String(e));
			await bot.sendMessage(msg.chat.id,'\u{274C} ' + String(e));
			return go(msg);
		}
	});
	
	client.on('steamGuard', function(domain, callback){
		if(sharedSecret == '1' && guard == undefined){
			console.log('Enter Guard for ' + connect.username + ':');
			bot.sendMessage(msg.chat.id,'\u{1F4AB} Enter Guard for ' + connect.username + ':');
			bot.once('message', function(msg){
				connectSteamClient(msg, connect.username, connect.password, connect.sharedSecret, msg.text);
			});
		}else if(sharedSecret == '1' && guard != undefined){
			callback(guard);
		}else{
			callback(SteamTotp.generateAuthCode(sharedSecret));
		}
	});

	client.on('loggedOn', async function() {
		console.log('Logged into Steam');
		await bot.sendMessage(msg.chat.id,'\u{2705} Logged into Steam');
		addGames();
		console.log('State ' + state);
		newState(msg, state);
		console.log('Mode ' + mode);
		newMode(msg, mode);
		addDeleteSpam(msg.chat.id);
	});
}

function addGames(){
	client.requestFreeLicense([440, 570, 730, 230410, 755790], function(err, grantedPackages, grantedAppIDs){
		if(err){
			console.log(err);
			return;
		}
	});
}

// Add Friends
function addFriends(msg){
	var add = 0;
	bot.downloadFile(msg.document.file_id, './path/').then(function (path) {
		console.log('Add friend ' + path);
		fs.readFile(path, 'utf8', function(err, contents) {
			allID = contents.split('\r\n');
			console.log(allID.length);
			var p = 0;
			bot.sendMessage(msg.chat.id, '\u{26A0} Loading, please wait ');
			for( p; p < 30; p++){
				if(allID[p] != undefined){
					addFriendsSleep(msg, allID[p], p);
				}else
					break;
			}
			bot.sendMessage(msg.chat.id, 'Added friends: ' + p);
		});
	});
}

function addFriendsSleep(msg, line, add){
	if(client == undefined)
		return;
	add++;
	sleep(500);
	var fields = line.split('/');
	if(fields[3] == 'id'){
		getSteamID64(line + '/?xml=1').then(function (result) {
			client.addFriend(result, function(err){
				if(err){
					exceptionAddFriends(msg, add, err);
				}else{
					console.log(add + ' Friend added with id ', result);
					bot.sendMessage(msg.chat.id, add + ' Friend added with id ' + result);
				}
			});
		});
	}else if(fields[3] == 'profiles'){
		client.addFriend(fields[4], function(err){
			if(err){
				exceptionAddFriends(msg, add, err)
			}else{
				console.log(add + ' Friend added with id ', fields[4]);
				bot.sendMessage(msg.chat.id, add + ' Friend added with id ' + fields[4]);
			}
		});
	}else{
		client.addFriend(line, function(err){
			if(err){
				exceptionAddFriends(msg, add, err);
			}else{
				console.log(add + ' Friend added with id ', line);
				bot.sendMessage(msg.chat.id, add + ' Friend added with id ' + line);
			}
		});
	}
}

function exceptionAddFriends(msg, add, err){
	if(String(err) == 'Error: DuplicateName'){
		console.log(add + ' Already friends or pending confirmation');
		bot.sendMessage(msg.chat.id, add + ' Already friends or pending confirmation');
	}else if(String(err) == 'Error: Ignored'){
		console.log(add + ' You are ignored');
		bot.sendMessage(msg.chat.id, add + ' You are ignored');
	}else if(String(err) == 'Error: Blocked'){
		console.log(add + ' You are blocked');
		bot.sendMessage(msg.chat.id, add + ' You are blocked');
	}else{
		console.log(String(err));
		bot.sendMessage(msg.chat.id, add + ' Steam ' + String(err));
	}
}

// Delete Requests to Friends
function deleteRequestFriends(msg){
	if(client != undefined){
		var allFriends = client.myFriends;
		var i = 0;
		for (var key in allFriends) {
			if(allFriends[key] == 4){
				client.removeFriend(key);
				console.log('Friend request deleted with id ' + key);
				i++;
			}
		}
		console.log('Count of deleted friends: ' + i);
		bot.sendMessage(msg.message.chat.id, '\u{1F3AF} Count of deleted friends: ' + i);
	}
}

//Delete All Friends
/*function deleteAllFriends(msg){
	console.log('Count of friends to delete: ' + Object.keys(client.myFriends).length);
	bot.sendMessage(msg.message.chat.id, 'Count of friends to delete: ' + Object.keys(client.myFriends).length);
	for (var key in client.myFriends) {
 		client.removeFriend(key);
 		bot.sendMessage(msg.message.chat.id,'Friend deleted with id ' + key);
 		console.log('Friend deleted with id ' + key);
 	}
}*/

// Spam Friends
async function spamFriends(msg){
	var allFriends = client.myFriends;
	var countReallFriends = 0;
	var secondsWait = 0;
	for (var key in client.myFriends) {
		if(allFriends[key] == 3){
			countReallFriends++;
		}
	}
	secondsWait = countReallFriends * 5;
	await bot.sendMessage(settings.chatID, '\u{26A0} Loading, please wait '+ secondsWait + ' seconds');
	for (var key in client.myFriends) {
		if(allFriends[key] == 3){
			spamFriendsSleep(key, msg);
		}
	}
	bot.sendMessage(msg.chat.id, '\u{2705} Sending end!');
}

function spamFriendsSleep(key, msg){
	if(client != undefined){
		client.chatMessage(key, msg.text);
		console.log(msg.text);
		sleep(5000);
	}
}

// Hour Boost
async function hoursBooster(msg, game){
	if(client != undefined){
		var fields = game.split('|');
		console.log('Запущена игра: ' + fields[1] + ' - ' + [parseInt(fields[0], 10)]);
		client.gamesPlayed([parseInt(fields[0], 10)]);
		gameLaunched = true;
		await bot.sendMessage(msg.chat.id, '\u{1F4A5} ' + fields[1] + ' was launched!');
	}
}

// Log Out
async function loggoutSteamClient(id, message) {
	if(client != undefined){
		client.logOff();
		client = undefined;
		if(gameLaunched)
			await bot.sendMessage(id, '\u{1F534} Game was closed!');
		console.log('Log out from ' + connect.username);
		await bot.sendMessage(id, '\u{1F4BE} Log out from ' + connect.username);
		go(message);
	}
}