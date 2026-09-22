const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const { sendChat, loadChat, joinChat, chatWeight, logEverythingOverride } = require("./chatProcesses.js");
const cookie = require("cookie");
const signature = require("cookie-signature");
const rooms = new Map();
const sockets = new Map();
const socketRooms = new Map();
const { db } = require('../db/db.js');

//Admin logging logic
function logEverything(whom, content, sessionUa, sessionIp, logType, choice ) {
	if(choice) {
	  db.prepare(`
		INSERT INTO logs_360 (userAgentInfo, ipAddressInfo, whom, content, logType)
		VALUES (?, ?, ?, ?, ?)
	  `).run(sessionUa, sessionIp, whom, content, logType);
	}
	emitToRoom("Admin", "loginEntry", {
	  whom: whom,
	  content: content,
	  ua: sessionUa,
	  ip: sessionIp,
	  logType: logType,
	  timestamp: Date.now()
	});
}

//Websocket joining room logic
function joinRoom(socketId, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(socketId);
  if (!socketRooms.has(socketId)) socketRooms.set(socketId, new Set());
  socketRooms.get(socketId).add(room);
}

//Websocket leaving room logic
function leaveRoom(socketId, room) {
  rooms.get(room)?.delete(socketId);
  socketRooms.get(socketId)?.delete(room);
}

//Sending a message to everyone is room logic
function emitToRoom(room, event, data) {
  const members = rooms.get(room);
  if (!members) return;
  for (const socketId of members) {
    const sock = sockets.get(socketId);
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ event, data }));
    }
  }
}

//All the websocket logic + upgrade for allowing session placement inside of
function initWebSocket(server, sessionMiddleware) {
	const wss = new WebSocket.Server({ noServer:true });  
	server.on("upgrade", (req, socket, head) => {
		sessionMiddleware(req, {}, () => {
			wss.handleUpgrade(req, socket, head, (ws) => {
			ws.session = req.session;
			wss.emit("connection", ws, req);
			});
		});
	});
	
	//For pinging websocket to keep alive
	function heartbeat() {
		this.isAlive = true;
	}
	const aiDecisionServer = {};
	//Websocket logic for those connected
	wss.on("connection", (socket, req) => {
		socket.isAlive = true;
		socket.on("pong", heartbeat);
		socket.session = req.session;
		const socketId = randomUUID();
		sockets.set(socketId, socket);
		socketRooms.set(socketId, new Set());
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(socket.session.myMembershipNumber, socket.session.myUsername+"-"+socket.session.myMembershipNumber+" connect web socket attempt", sessionUa, sessionIp, "web socket", false);
		//Upon websocket message do this
		socket.on("message", async (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			const { event, data } = msg;
			//Logic loops around and tries to update everyone when new client joins chat room. Besides that, the changing of AI type
			if (event === "aiEngagement2") {
				const [ chatGroupId ] = data;   
					for (const [otherId, otherSocket] of sockets.entries()) { 
						if (otherSocket === socketId) continue;
						const otherRooms = socketRooms.get(otherId);
						if (!otherRooms) continue;
						if (otherRooms.has(chatGroupId)) {
							if (otherSocket.readyState === WebSocket.OPEN) {
								otherSocket.send(JSON.stringify({
								event: "votingSwitch",
								data: { chatGroupId }
							}));
						}
					}
				}
			}
			
			//This logic turns ON/OFF AI auto response, calculates vote over & the commencing of voting
			if (event === "aiEngagement") {
				const [ chatGroupId, aiDecision ] = data;
				aiDecisionServer[chatGroupId] = aiDecision;
				for (const [otherId, otherSocket] of sockets.entries()) {      
					if (otherSocket === socketId) continue;
					const otherRooms = socketRooms.get(otherId);
					if (!otherRooms) continue;
					if (otherRooms.has(chatGroupId)) {
						if (otherSocket.readyState === WebSocket.OPEN) {
							//console.log("hit");
							otherSocket.send(JSON.stringify({
								event: "aiEngine",
								data: { aiDecision:aiDecision, changer:true }
							}));
						}
					}
				}
			}
			
			//This code is for the AI vote system. When 50% or more have vote, do this
			if (event === "continueAi") {
				const [ chatGroupId, approved, denied, accuracy, totalWeight ] = data;
				for (const [otherId, otherSocket] of sockets.entries()) {
					if (otherSocket === socketId) continue;
					const otherRooms = socketRooms.get(otherId);
					if (!otherRooms) continue;
					if (otherRooms.has(chatGroupId)) {
					if (otherSocket.readyState === WebSocket.OPEN) {
						otherSocket.send(JSON.stringify({
							event: "continueEveryone",
							data: {approved, denied, accuracy, totalWeight}
							}));
						}
					}
				}
			}
			
			//Chat dots for when your talking. This logic passes it to webSocketLogic.js for the purpose of everyone seeing it in the same group
			if (event === "chatDots") {
				const [ chatGroupId, time ] = data;
				for (const [otherId, otherSocket] of sockets.entries()) {
					if (otherSocket === socket) continue;
					const otherRooms = socketRooms.get(otherId);
					if (!otherRooms) continue;
					if (otherRooms.has(chatGroupId)) {
						if (otherSocket.readyState === WebSocket.OPEN) {
							otherSocket.send(JSON.stringify({
								event: "chatDots",
								data: { time:time }
							}));
						}
					}
				}
			}
			
			//When casting a vote, this is the logic
			if (event === "voteUpdate") {
				const [ chatGroupId, chatId, voteYes, voteNo ] = data;
				for (const [otherId, otherSocket] of sockets.entries()) {
					if (otherSocket === socket) continue;
					const otherRooms = socketRooms.get(otherId);
					if (!otherRooms) continue;
					if (otherRooms.has(chatGroupId)) {
						if (otherSocket.readyState === WebSocket.OPEN) {
							otherSocket.send(JSON.stringify({
								event: "voteUpdate",
								data: { chatId, voteYes, voteNo }
							}));
						}
					}
				}
			}
			
			//When sending a chat message, logic flow here
			if (event === "sendChat") {
				const [
					chatPayloadData,
					chatPayloadLoading,
					chatPayloadInfo,
					newMessages,
					chatInitialPayload,
					startAi,
					aiType
				] = data;
				const result = await sendChat(
					chatPayloadData,
					startAi,
					aiType,
					req
				);
				if (!result) return;
				const { chatGroupId, chatId, approved, denied, accuracy, startAiResult, totalWeight, viou } = result;
				
				if (chatGroupId && (req.session.qora===false || req.session.qora=="undefined")) {
					const sortedData = [chatInitialPayload[3], chatInitialPayload[6]].sort();
					const waitingRoom = "waiting_" + sortedData[0] + "_" + sortedData[1];
					const users = rooms.get(waitingRoom);
					if (users) {
						for (const userId of [...users]) {
							joinRoom(userId, chatGroupId);
							leaveRoom(userId, waitingRoom);
						}
					}
					/*
					socket.send(JSON.stringify({
						event: "chatPayloadPrivate",
						data: {
							chatGroupIdTemp: chatGroupId,
							chatPayloadTemp: chatPayload,
							chatAmountTemp: chatAmount,
							forceReload: false,
							autoResponse:autoResponse,
							approved,
							denied,
							accuracy,
							totalWeight,
							viou,
							aisChatHistory:aisChatHistory,
							membership:chatPayloadLoading[6]
						}
					}));
					*/
					emitToRoom(chatGroupId, "anExtension", { chatGroupIdTemp: chatGroupId, chatId, approved, denied, accuracy, startAiResult, totalWeight, viou });
				} else if(chatGroupId && req.session.qora===true) {
					req.session.qoraRoom=chatGroupId;
					req.session.initialQora = true;
					req.session.save();
					const waitingRoom = "waiting_room";
					const users = rooms.get(waitingRoom);
					if (users) {
						for (const userId of [...users]) {
							joinRoom(userId, chatGroupId);
							leaveRoom(userId, waitingRoom);
						}
					}
					emitToRoom(chatGroupId, "anExtension", { chatGroupIdTemp: chatGroupId, chatId, approved, denied, accuracy, startAiResult, totalWeight, viou });
				}
			}
			
			/*
			if (event === "joinChat") {
				const [chatInitialPayload] = data;
				const chatGroupId = await joinChat(
					chatInitialPayload
				);
			}
			*/
			
			//This loads the entire change messages payload backend
			if (event === "loadChat") {
				const [chatPayloadLoading, chatPayloadInfo, newMessages, blockedUpdate, blockedList, startAi, startUpAiAccess, aiAccess, aiInRoom, changer] = data;
				let chatGroupIdQora = req.session.qoraRoom;
				let aiInRoomName=aiInRoom;
				const result = await loadChat(
					chatPayloadLoading,
					chatPayloadInfo,
					newMessages,
					chatGroupIdQora,
					blockedList,
					startAi,
					startUpAiAccess,
					aiAccess,
					req
				);
				if(result && req.session.qora==false) {
					const sortedData = [chatPayloadLoading[3], chatPayloadLoading[6]].sort();
					const room = "waiting_" + sortedData[0] + "_" + sortedData[1];
					joinRoom(socketId, room);
				} else if(result && req.session.qora==true) {
					const room = "waiting_room";
					joinRoom(socketId, room);
				}
				if (!result) return;
				const { chatGroupId, chatPayload, chatAmount, autoResponse, approved, denied, accuracy, totalWeight, viou, startAiDecision, aisChatHistory } = result;
				const current = aiDecisionServer[chatGroupId];
				if (current !== undefined) {
				socket.send(JSON.stringify({
						event: "aiEngine",
						data: { aiDecision: current, changer:changer }
					}));
				}
				if (!blockedUpdate) {
					joinRoom(socketId, chatGroupId);
					for (const room of socketRooms.get(socketId)) {
					const socketsInRoom = getSocketsInRoom(room);
					const count = socketsInRoom.size;
					emitToRoom(room, "figureRoomCount", {roomCount: count, aiInRoom:aiInRoomName, getReady:false, leaving:false });
					}
					socket.send(JSON.stringify({
						event: "chatPayloadPrivate",
						data: {
							chatGroupIdTemp: chatGroupId,
							chatPayloadTemp: chatPayload,
							chatAmountTemp: chatAmount,
							forceReload: false,
							autoResponse:autoResponse,
							approved,
							denied,
							accuracy,
							totalWeight,
							viou,
							aisChatHistory:aisChatHistory,
							membership:chatPayloadLoading[6]
						}
					}));
				} else {
					for (const [otherId, otherSocket] of sockets.entries()) {
						const otherRooms = socketRooms.get(otherId);
						if (!otherRooms) continue;
						if (!otherRooms.has(chatGroupId)) {
						otherRooms.add(chatGroupId);
						}
						if (otherSocket.readyState === WebSocket.OPEN) {
							joinRoom(otherSocket, chatGroupId);
							for (const room of socketRooms.get(otherSocket)) {
							const socketsInRoom = getSocketsInRoom(room);
							const count = socketsInRoom.size;
							emitToRoom(room, "figureRoomCount", {roomCount: count, aiInRoom:aiInRoomName, getReady:false, leaving:false });
							}
							otherSocket.send(JSON.stringify({
								event: "chatPayloadPrivate",
								data: {
									chatGroupIdTemp: chatGroupId,
									chatPayloadTemp: chatPayload,
									chatAmountTemp: chatAmount,
									forceReload: true,
									autoResponse:autoResponse,
									startAi:startAi,
									approved,
									denied,
									accuracy,
									totalWeight,
									viou,
									aisChatHistory:aisChatHistory,
									membership:chatPayloadLoading[6]
								}
							}));
						}
					}
				}
			}
			
			//This is ai responding logic on a websocket distribution level
			if (event === "aiResponding") {
				const [chatPayloadData, chatGroupId, chatIdBubble, aiInRoom, chatPayloadLoading, chatPayloadInfo, newMessages, blockedUpdate, blockedList, startAi, startUpAiAccess, aiAccess, membership, aiType, aiSpot, aiTarget] = data;
				await chatWeight(chatPayloadData, chatGroupId, aiSpot, aiTarget);
				let chatGroupIdQora = req.session.qoraRoom;
				let aiInRoomName=aiInRoom;
				let aiMembership=membership;
				let startAiTrigger=startAi;
				const result = await loadChat(
					chatPayloadLoading,
					chatPayloadInfo,
					newMessages,
					chatGroupIdQora,
					blockedList,
					startAi,
					startUpAiAccess,
					aiAccess,
					req
				);
				for (const room of socketRooms.get(socketId)) {
					const socketsInRoom = getSocketsInRoom(room);
					const count = socketsInRoom.size;
					emitToRoom(room, "figureRoomCount", {roomCount: count, getReady:true, aiChatId:aiSpot, leaving:false});
				}
				if (!result) return;
				const { chatPayload, chatAmount, autoResponse, approved, denied, accuracy, totalWeight, viou, startAiDecision, aisChatHistory } = result;
				//console.log(aisChatHistory);
				if (chatGroupId) {
					for (const [otherId, otherSocket] of sockets.entries()) {
						const otherRooms = socketRooms.get(otherId);
						if (!otherRooms) continue;
						if (!otherRooms.has(chatGroupId)) continue;
						if (otherSocket.readyState === WebSocket.OPEN) {
							otherSocket.send(JSON.stringify({
								event: "chatPayloadPrivate",
								data: {
									chatGroupIdTemp: chatGroupId,
									chatPayloadTemp: chatPayload,
									chatAmountTemp: chatAmount,
									forceReload: true,
									autoResponse,
									startAi:startAiTrigger,
									approved,
									denied,
									accuracy,
									totalWeight,
									viou,
									aisChatHistory:aisChatHistory,
									membership:membership
								}
							}));
						}
					}
				}
			}
			
			//This is for sending logs to admin console
			if (event === "adminJoin") {
				const { room } = data;
				joinRoom(socketId, room);
			}
		});
		
		//This is the logic when websocket closes
		socket.on("close", () => {
			const sessionUa = req.headers['user-agent'];
			const sessionIp =
			req.headers['x-forwarded-for'] ||
			req.connection.remoteAddress ||
			req.socket.remoteAddress ||
			req.ip;
			logEverything(socket.session.myMembershipNumber, socket.session.myUsername+"-"+socket.session.myMembershipNumber+" disconnect web socket attempt", sessionUa, sessionIp, "web socket", false);
			for (const room of socketRooms.get(socketId)) {
			leaveRoom(socketId, room);
			const socketsInRoom = socketRooms.get(room);
			const count = socketsInRoom ? socketsInRoom.size : 0;
			emitToRoom(room, "figureRoomCount", {roomCount: count, getReady:false, leaving:true});
			}
			sockets.delete(socketId);
			socketRooms.delete(socketId);
		});
	});
	
	//This is a part of the ping-pong keeping web socket persistant
	const interval = setInterval(() => {
		wss.clients.forEach((socket) => {
			if (socket.isAlive === false) {
				return socket.terminate();
			}
			socket.isAlive = false;
			socket.ping();
		});
	}, 30000);

	wss.on("close", () => {
		clearInterval(interval);
	});
}

//This counts the many sockets per room
function getSocketsInRoom(roomName) {
    const result = new Set();

    for (const [id, rooms] of socketRooms.entries()) {
        if (rooms.has(roomName)) {
            result.add(id);
        }
    }

    return result;
}

module.exports = {
  initWebSocket,
  emitToRoom,
  joinRoom,
  leaveRoom
};
