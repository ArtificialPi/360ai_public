const { db, createSystem, deleteAllChat } = require('../db/db.js');
const dissectManager = require('../microservices/dissect-manager');
const crypto = require('crypto');

//Admin logs everything
function logEverything(whom, content, sessionUa, sessionIp, logType, choice ) {
	if(choice) {
	  db.prepare(`
		INSERT INTO logs_360 (userAgentInfo, ipAddressInfo, whom, content, logType)
		VALUES (?, ?, ?, ?, ?)
	  `).run(sessionUa, sessionIp, whom, content, logType);
  }
  const { emitToRoom } = require("./webSocketLogic.js");
  emitToRoom("Admin", "loginEntry", {
	  whom: whom,
	  content: content,
	  ua: sessionUa,
	  ip: sessionIp,
	  logType: logType,
	  timestamp: Date.now()
	});
}

//Generates alphanumeric at the length desired
function generateRandomString(length) {
  return crypto.randomBytes(length)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, length);
}

//Sqlite timestamp logic
function sqliteTimestamp() {
  const d = new Date();
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds()) + "." +
    pad(d.getMilliseconds(), 3)
  );
}

//Bumping message order for chats/conversations
function getNextMessageOrder(chatGroupId, chatId) {
    if(chatGroupId) {
        const row = db.prepare(`
            SELECT COALESCE(MAX(messageOrder), 0) AS maxOrder
            FROM chat_360
            WHERE chatGroupId = ?
        `).get(chatGroupId);
        return row.maxOrder + 1;
    } else {
        const row = db.prepare(`
        SELECT COALESCE(MAX(messageOrder), 0) AS maxOrder
        FROM chat_360
        WHERE chatId = ?
        `).get(chatId);
        return row.maxOrder + 1;
    }
    
}

//Sending chat through a really big processs
async function sendChat (chatPayloadData, startAi, aiType, req) {
    let chatField=chatPayloadData[0];
    let chatGroupId=chatPayloadData[1];
    let targetMember = [chatPayloadData[2],chatPayloadData[3],chatPayloadData[4]];
    let myCredentials = [chatPayloadData[5],chatPayloadData[6],chatPayloadData[7]];
    let qora = chatPayloadData[8];
    let qoraType = chatPayloadData[9];
    let chatId;
    let checking=[];
    let approved=0;
    let denied=0;
    let accuracy=0;
    const sessionUa = req.headers['user-agent'];
	const sessionIp =
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip;
	try {
		if (chatField && chatField.trim() !== "") {
			if(qora===true && !chatGroupId) {        
				do {
					chatGroupId=generateRandomString(16);
					checking = db.prepare('SELECT * FROM chat_360 WHERE chatGroupId = ?').get(chatGroupId);
				} while(checking);
				const nextOrder = getNextMessageOrder(chatGroupId);
				db.prepare('INSERT INTO chat_360 (chatGroupId, message, messageOrder, membershipNumber, markUpAi) VALUES (?, ?, ?, ?, ?)').run(chatGroupId, chatField.trim(), nextOrder, myCredentials[1], Number(startAi));
				const row = db.prepare('SELECT chatId FROM chat_360 WHERE chatGroupId = ? ORDER BY chatId DESC LIMIT 1').get(chatGroupId);
				chatId = row.chatId;
				db.prepare('INSERT INTO chatGroup_360 (chatGroupId, membershipNumber, unread, qoraType, qoraStatus) VALUES (?, ?, ?, ?, ?)').run(chatGroupId, myCredentials[1], 0, qoraType, "Pending");
			} else if(qora===false && !chatGroupId) {
				do {
					chatGroupId=generateRandomString(16);
					checking = db.prepare('SELECT * FROM chat_360 WHERE chatGroupId = ?').get(chatGroupId);
				} while(checking);
				const nextOrder = getNextMessageOrder(chatGroupId);       
				db.prepare('INSERT INTO chat_360 (chatGroupId, message, messageOrder, membershipNumber, markUpAi) VALUES (?, ?, ?, ?, ?)').run(chatGroupId, chatField.trim(), nextOrder, myCredentials[1], Number(startAi));
				const row = db.prepare('SELECT chatId FROM chat_360 WHERE chatGroupId = ? ORDER BY chatId DESC LIMIT 1').get(chatGroupId);
				chatId = row.chatId;
				db.prepare('INSERT INTO chatGroup_360 (chatGroupId, membershipNumber, unread) VALUES (?, ?, ?)').run(chatGroupId, targetMember[1], 1);
				db.prepare('INSERT INTO chatGroup_360 (chatGroupId, membershipNumber, unread) VALUES (?, ?, ?)').run(chatGroupId, myCredentials[1], 0);
				const myListChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(myCredentials[1]);
				const listChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(targetMember[1]);
				const myGroup = myListChats.map(row => row.chatGroupId);
				const group = listChats.map(row => row.chatGroupId);
				if(myGroup.length && group.length) {
					for(i=0;i<myGroup.length;i++) {
						for(j=0;j<group.length;j++) {
							if(myGroup[i]==group[j] && !chatGroupId) {
								chatGroupId=myGroup[i];
								break;
							}
						}
					}
				}
			} else {
				const nextOrder = getNextMessageOrder(chatGroupId);
				db.prepare('INSERT INTO chat_360 (chatGroupId, message, messageOrder, membershipNumber, markUpAi) VALUES (?, ?, ?, ?, ?)').run(chatGroupId, chatField.trim(), nextOrder, myCredentials[1], Number(startAi));
				const checking = db.prepare('SELECT membershipNumber FROM chatGroup_360 WHERE chatGroupId = ? AND membershipNumber = ?').get(chatGroupId, myCredentials[1]);
				if (!checking) {
					db.prepare('INSERT INTO chatGroup_360 (chatGroupId, membershipNumber, unread) VALUES (?, ?, ?)').run(chatGroupId, myCredentials[1], 0);
				}
				const row = db.prepare('SELECT chatId FROM chat_360 WHERE chatGroupId = ? ORDER BY chatId DESC LIMIT 1').get(chatGroupId);
				chatId = row.chatId;
			}
			const result = await dissectManager.dissect(chatField);
			chatDissection(result, chatId, chatGroupId, myCredentials[1], aiType);
			const chatGroupIdQora=chatGroupId;
			let totalWeight;
			const viouValue = db.prepare(`
			SELECT virtualiou FROM info_360
			WHERE membershipNumber = ?`).get(myCredentials[1]);
			const viou = viouValue.virtualiou||0;
			//console.log(startAi);
			if(startAi) {
				await chatWeight(chatPayloadData, chatGroupId, chatId, chatId);
			}
			const wordLingMap = db.prepare('SELECT status, weight FROM word_360').all();
			const sentenceLingMap = db.prepare('SELECT status, weight FROM sentence_360').all();
			const paragraphLingMap = db.prepare('SELECT status, weight FROM paragraph_360').all();
			approved = 0;
			denied = 0;
			totalWeight = 0;
			for (let row of wordLingMap) {
				if (row.status === 'approved') approved++;
				if (row.status === 'denied') denied++;
				totalWeight = totalWeight + row.weight;
			}
			for (let row of sentenceLingMap) {
				if (row.status === 'approved') approved++;
				if (row.status === 'denied') denied++;
				totalWeight = totalWeight + row.weight;
			}
			for (let row of paragraphLingMap) {
				if (row.status === 'approved') approved++;
				if (row.status === 'denied') denied++;
				totalWeight = totalWeight + row.weight;
			}
			let total = approved + denied;
			accuracy = (approved / total) * 100||0;
			logEverything(myCredentials[1], myCredentials[1]+" successful send chat attempt", sessionUa, sessionIp, "send chat", false);
			return {chatGroupId, chatId, approved, denied, accuracy, startAi, totalWeight, viou };
		} else {
			return;
		}
	} catch (err) {		
		logEverything("N/A", "Send Chat Error: "+err, sessionUa, sessionIp, "error", false);
		throw err;
	}	
}

//This logic breaks down a string to single words, sentences, and paragraphs
function chatDissection(result, chatId, chatGroupId, myMembershipNumber, aiType) {
    let checking=[];
    let words = result.words;
    let sentences = result.sentences;
    let paragraphs = result.paragraphs;
    for (let i = 0; i < sentences.length; i++) {
        for (const w of words) {
            if (sentences[i] === w) {
                sentences.splice(i, 1);
                i--;
                break;
            }
        }
    }
    for (let i = 0; i < paragraphs.length; i++) {
        for (const s of sentences) {
            if (paragraphs[i] === s) {
                paragraphs.splice(i, 1);
                i--;
                break;
            }
        }
    }
    for (let i = 0; i < paragraphs.length; i++) {
        for (const w of words) {
            if (paragraphs[i] === w) {
                paragraphs.splice(i, 1);
                i--;
                break;
            }
        }
    }
    /*
    function cleanSoft(text) {
        return text
            .replace(/[^a-z0-9\s]/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    */
    for(let i=0;i<words.length;i++) {
        db.prepare(`
        UPDATE info_360
        SET virtualiou = virtualiou + 0.01
        WHERE membershipNumber = ?`).run(myMembershipNumber);
        const exists = db.prepare(`
            SELECT * FROM word_360
            WHERE word = ?
        `).get(words[i]);
        if (!exists) {
			db.prepare(`
			UPDATE info_360
			SET virtualiou = virtualiou + 1
			WHERE membershipNumber = ?`).run(myMembershipNumber);
            if(!myMembershipNumber.endsWith("-AI")) {
                db.prepare(`
                    INSERT INTO word_360 (chatId, word, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, words[i], chatGroupId);
            } else {
                db.prepare(`
                    INSERT INTO word_360 (chatId, word, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, words[i], chatGroupId);
            }
            
        }
	}
	for(let i=0;i<words.length;i++) {
		if (!words[i] || !words[i+1]) continue;
		const result = db.prepare('SELECT wordId, word FROM word_360 WHERE word = ?').get(words[i]);
		if(!result || !result.word) continue;
		const result2 = db.prepare('SELECT crossReferences FROM word_360 WHERE wordId = ?').get(result.wordId);
		if (result2) {
			const existing = result2.crossReferences || "";
			const crossReferencesData = existing
				.replace(/;$/, "")
				.split(/;(?!;)/)  
				.map(x => x.trim())
				.filter(x => x.length > 0);
			if (!crossReferencesData.includes(words[i+1])) {
				db.prepare(
					'UPDATE word_360 SET crossReferences = ? WHERE wordId = ?'
				).run(
					existing + words[i+1] + ";",
					result.wordId
				);
			}
		} else {
			db.prepare('UPDATE word_360 SET crossReferences = ? WHERE wordId = ?').run(words[i+1]+";", result.wordId);
		}  
    }  
    for(let i=0;i<sentences.length;i++) {
        db.prepare(`
        UPDATE info_360
        SET virtualiou = virtualiou + 0.025
        WHERE membershipNumber = ?`).run(myMembershipNumber);
        const exists = db.prepare(`
            SELECT * FROM sentence_360
            WHERE sentence = ?
        `).get(sentences[i]);
        if (!exists) {
                db.prepare(`
                UPDATE info_360
                SET virtualiou = virtualiou + 2
                WHERE membershipNumber = ?`).run(myMembershipNumber);
            if(!myMembershipNumber.endsWith("-AI")) {
                db.prepare(`
                    INSERT INTO sentence_360 (chatId, sentence, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, sentences[i], chatGroupId);
            } else {
                db.prepare(`
                    INSERT INTO sentence_360 (chatId, sentence, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, sentences[i], chatGroupId);
            }
        }
	}
	for(let i=0;i<sentences.length;i++) {
		if (!sentences[i] || !sentences[i+1]) continue;
			const result = db.prepare('SELECT sentenceId, sentence FROM sentence_360 WHERE sentence = ?').get(sentences[i]);
			if(!result || !result.sentence) continue;
			const result2 = db.prepare('SELECT crossReferences FROM sentence_360 WHERE sentenceId = ?').get(result.sentenceId);
			if (result2) {
				const existing = result2.crossReferences || "";
				const crossReferencesData = existing
					.replace(/;$/, "")
					.split(/;(?!;)/) 
					.map(x => x.trim())
					.filter(x => x.length > 0);

				if (!crossReferencesData.includes(sentences[i+1])) {
					db.prepare(
						'UPDATE sentence_360 SET crossReferences = ? WHERE sentenceId = ?'
					).run(
						existing + sentences[i+1] + ";",
						result.sentenceId
					);
				}
		} else {
			db.prepare('UPDATE sentence_360 SET crossReferences = ? WHERE sentenceId = ?').run(sentences[i+1]+";", result.sentenceId);
		} 
    }
    const lastRow3 = db.prepare(`
	  SELECT paragraph FROM paragraph_360 WHERE chatGroupId=? ORDER BY paragraphId DESC LIMIT 1
	`).get(chatGroupId);
	const lastParagraph = lastRow3?.paragraph;
    for(let i=0;i<paragraphs.length;i++) {
        db.prepare(`
        UPDATE info_360
        SET virtualiou = virtualiou + 0.05
        WHERE membershipNumber = ?`).run(myMembershipNumber);
        const exists = db.prepare(`
            SELECT * FROM paragraph_360
            WHERE paragraph = ?
        `).get(paragraphs[i]);
        if (!exists) {
			db.prepare(`
			UPDATE info_360
			SET virtualiou = virtualiou + 3
			WHERE membershipNumber = ?`).run(myMembershipNumber);
            if(!myMembershipNumber.endsWith("-AI")) {
                db.prepare(`
                    INSERT INTO paragraph_360 (chatId, paragraph, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, paragraphs[i], chatGroupId);
            } else {
                db.prepare(`
                    INSERT INTO paragraph_360 (chatId, paragraph, chatGroupId)
                    VALUES (?, ?, ?)
                `).run(chatId, paragraphs[i], chatGroupId);
            }
        }
     }
    if(lastParagraph) {
		paragraphs.unshift(lastParagraph);
	}
    for (let i=0;i<paragraphs.length;i++) {
        if (!paragraphs[i] || !paragraphs[i+1]) continue;
        const result = db.prepare('SELECT paragraphId, paragraph FROM paragraph_360 WHERE paragraph = ?').get(paragraphs[i+1]);
        if(!result) continue;
        const result2 = db.prepare('SELECT crossReferences FROM paragraph_360 WHERE paragraphId = ?').get(result.paragraphId);
        if (result2) {
            const existing = result2.crossReferences || "";
            const crossReferencesData = existing
                .replace(/;$/, "")
				.split(/;(?!;)/) 
                .map(x => x.trim())
                .filter(x => x.length > 0);
            if (!crossReferencesData.includes(paragraphs[i+1])) {
                db.prepare(
                    'UPDATE paragraph_360 SET crossReferences = ? WHERE paragraphId = ?'
                ).run(
                    existing + paragraphs[i] + ";",
                    result.paragraphId
                );
            }
        } else {
			db.prepare('UPDATE paragraph_360 SET crossReferences = ? WHERE paragraphId = ?').run( paragraphs[i] + ";", result.paragraphId);
        }
    }
}

//This is the joinChat function the selects chatGroupId if both have the same
//LEGACY?
async function joinChat(chatInitialPayload) {
    if (chatInitialPayload) {
        let chatGroupId=null;
        let targetMember = [chatInitialPayload[2],chatInitialPayload[3],chatInitialPayload[4]];
        let myCredentials = [chatInitialPayload[5],chatInitialPayload[6],chatInitialPayload[7]];
        const myListChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(myCredentials[1]);
        const listChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(targetMember[1]);
        const myGroup = myListChats.map(row => row.chatGroupId);
        const group = listChats.map(row => row.chatGroupId);
        if(myGroup.length && group.length && myCredentials[1] !== targetMember[1]) {
            for(i=0;i<myGroup.length;i++) {
                for(j=0;j<group.length;j++) {
                    if(myGroup[i]==group[j]) {
                        chatGroupId=myGroup[i];
                        break;
                    }
                }
            }
        }
        return chatGroupId;
    }
}

//Logic for loading chat messages
async function loadChat(chatPayloadLoading, chatPayloadInfo, newMessages, chatGroupIdQora, blockedList, startAi, startUpAiAccess, aiAccess, req) {
	/*console.log(chatPayloadLoading);
    console.log(chatPayloadInfo);
    console.log(newMessages);
    console.log(chatGroupIdQora);
    console.log(blockedList);
    console.log(startAi);
    console.log(startUpAiAccess);
    console.log(aiAccess);
    //console.log(aiAccess);*/
    const sessionUa = req.headers['user-agent'];
	const sessionIp =
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip;
    let chatPayload = [];
    let chatGroupId=chatPayloadLoading[1];
    let targetMember = [chatPayloadLoading[2],chatPayloadLoading[3],chatPayloadLoading[4]];
    let myCredentials = [chatPayloadLoading[5],chatPayloadLoading[6],chatPayloadLoading[7]];
    let qora = chatPayloadInfo[6];
    let qoraType = chatPayloadInfo[7];
    let initialQora = chatPayloadInfo[8];
    let firstLoad = chatPayloadInfo[9];
    let chatAmount2 = chatPayloadInfo[10]||0;
    let humanCheck = chatPayloadInfo[11];
    let sortClick = chatPayloadInfo[2];
    let searchingStill = chatPayloadInfo[3];
    let approved=0;
    let denied=0;
    let accuracy=0;
    if(targetMember[1]!=myCredentials[1]) {
        if((qora===false && !chatGroupId && targetMember[1] || qora===false && targetMember[1])) {
            const myListChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(myCredentials[1]);
            const listChats = db.prepare('SELECT chatGroupId FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(targetMember[1]);
            const myGroup = myListChats.map(row => row.chatGroupId);
            const group = listChats.map(row => row.chatGroupId);
            if(myGroup.length && group.length) {
                for(i=0;i<myGroup.length;i++) {
                    for(j=0;j<group.length;j++) {
                        if(myGroup[i]==group[j]) {
                            chatGroupId=myGroup[i];
                            break;
                        }
                    }
                }
            }
        } else if(qora===true) {
            chatGroupId = chatGroupIdQora;
        }
    } else if(targetMember[1].endsWith('-AI')) {
        const myListChats = db.prepare('SELECT * FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(myCredentials[1]);
        const listChats = db.prepare('SELECT * FROM chatGroup_360 WHERE membershipNumber = ? ORDER BY timestamp').all(targetMember[1]);
		if(myListChats.length && listChats.length) {
			for(i=0;i<myListChats.length;i++) {
				for(j=0;j<listChats.length;j++) {
					if(myListChats[i].chatGroupId===listChats[j].chatGroupId && myListChats[i].membershipNumber===listChats[j].membershipNumber ) {
						const rows = db.prepare(`SELECT membershipNumber FROM chatGroup_360 WHERE chatGroupId = ?`).all(myListChats[i].chatGroupId);
						const distinct = [...new Set(rows.map(r => r.membershipNumber))];
						if(distinct.length===1) {
							chatGroupId=myListChats[i].chatGroupId;
							break;
						}
					}
				}
				if(chatGroupId) {
					break;
				}
			}
		}
	}
    let groupChatData;
    let chatAmount=0;
    let sql = `SELECT count(*) as total FROM chat_360 WHERE chatGroupId = ?`;
    if (blockedList.length > 0) {
        sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
    }
    sql += `ORDER BY messageOrder`;
    const params = blockedList.length > 0
    ? [chatGroupId, ...blockedList]
    : [chatGroupId];
    chatAmount = db.prepare(sql).get(params);
    const difference = Number(chatAmount.total)- Number(chatAmount2);
    let aisChatHistoryExtract;
    let autoResponse;
    let totalWeight = 0;
    let viou=0;
    let aisChatHistory;
    //startUpAiAccess = String(startUpAiAccess).trim();
    if (startUpAiAccess && startUpAiAccess !== "" && aiAccess === false) {
		logEverything(chatPayloadLoading[6], startUpAiAccess+" access code attempt", sessionUa, sessionIp, "access code", false);
	}
    if(difference != 0 || chatAmount.total==0 && chatAmount2==0 || sortClick || searchingStill || chatAmount.total==chatAmount2) {
		if(humanCheck==true) {
			let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
			if (blockedList.length > 0) {
				sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
			}
			sql += `ORDER BY messageOrder`;
			const params = blockedList.length > 0
			? [chatGroupId, ...blockedList]
			: [chatGroupId];
			aisChatHistoryExtract = db.prepare(sql).all(params);
		} else {
		   if(chatPayloadInfo[2]=="old") {
				const realPages = Math.ceil(chatAmount.total / chatPayloadInfo[1]);
				const allowedPages = Math.min(realPages, chatPayloadInfo[1]);
				const pageIndex = chatPayloadInfo[0]-1;
				if (pageIndex === 0) {
					const limit = difference;
					const offset = 0;
					let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
					if (blockedList.length > 0) {
						sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
					}
					sql += ` ORDER BY messageOrder LIMIT ? OFFSET ?`;
					const params = blockedList.length > 0
					? [chatGroupId, ...blockedList, limit, offset]
					: [chatGroupId, limit, offset];
					aisChatHistoryExtract = db.prepare(sql).all(...params);
				} else {
					const pageSize = difference;
					const offset = pageIndex * pageSize;
					let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
					if (blockedList.length > 0) {
						sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
					}
					sql += ` ORDER BY messageOrder LIMIT ? OFFSET ?`;
					const params = blockedList.length > 0
					? [chatGroupId, ...blockedList, pageSize, offset]
					: [chatGroupId, pageSize, offset];
					aisChatHistoryExtract = db.prepare(sql).all(...params);
				}
			} else {
				let start = difference;
				let end = (chatPayloadInfo[0]-1) * chatPayloadInfo[1];
				let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
				if (blockedList.length > 0) {
					sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
				}
				sql += ` ORDER BY messageOrder DESC LIMIT ? OFFSET ?`;
				const params = blockedList.length > 0
				? [chatGroupId, ...blockedList, start, end]
				: [chatGroupId, start, end];
				aisChatHistoryExtract = db.prepare(sql).all(...params);
			} 
		}
		if(chatPayloadInfo[2]=="old") {
			const realPages = Math.ceil(chatAmount.total / chatPayloadInfo[1]);
			const allowedPages = Math.min(realPages, chatPayloadInfo[1]);
			const pageIndex = chatPayloadInfo[0]-1;
			if (pageIndex === 0) {
				const limit = chatPayloadInfo[1];
				const offset = 0;
				let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
				if (blockedList.length > 0) {
					sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
				}
				sql += ` ORDER BY messageOrder LIMIT ? OFFSET ?`;
				const params = blockedList.length > 0
				? [chatGroupId, ...blockedList, limit, offset]
				: [chatGroupId, limit, offset];
				groupChatData = db.prepare(sql).all(...params);
			} else {
				const pageSize = chatPayloadInfo[1];
				const offset = pageIndex * pageSize;
				let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
				if (blockedList.length > 0) {
					sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
				}
				sql += ` ORDER BY messageOrder LIMIT ? OFFSET ?`;
				const params = blockedList.length > 0
				? [chatGroupId, ...blockedList, pageSize, offset]
				: [chatGroupId, pageSize, offset];
				groupChatData = db.prepare(sql).all(...params);
			}
		} else {
			let start = chatPayloadInfo[1];
			let end = (chatPayloadInfo[0]-1) * chatPayloadInfo[1];
			let sql = `SELECT chatId, message, membershipNumber, messageOrder, voteYes, voteNo, timestamp, markUpAi, rememberAi FROM chat_360 WHERE chatGroupId = ?`;
			if (blockedList.length > 0) {
				sql += ` AND membershipNumber NOT IN (${blockedList.map(() => '?').join(',')})`;
			}
			sql += ` ORDER BY messageOrder DESC LIMIT ? OFFSET ?`;
			const params = blockedList.length > 0
			? [chatGroupId, ...blockedList, start, end]
			: [chatGroupId, start, end];
			groupChatData = db.prepare(sql).all(...params);
		}
		for (const row of groupChatData) {
			const frontendData = db.prepare('SELECT username, botPic FROM info_360 WHERE membershipNumber = ?').get(row.membershipNumber);
			if(frontendData) {        
				autoResponse=false;
				row.username = frontendData.username;
				row.botPic = frontendData.botPic;
			} else {
				if (row.membershipNumber.endsWith("-AI")) {
					row.username = myCredentials[0];
					row.botPic = myCredentials[2];
					autoResponse=true;
				}
			}
		}
		for (let i = 0; i < groupChatData.length; i++) {     
			let row = groupChatData[i];
			const messages = db.prepare(`
				SELECT message, chatId 
				FROM chat_360 
				WHERE chatId = ? 
				ORDER BY timestamp
			`).get(row.chatId);
			const normalizedMessage = messages.message.trim();
			let dupeCheck = db.prepare(`
				SELECT * FROM chat_360
				WHERE LOWER(message) = ?
				ORDER BY timestamp ASC
			`).all(normalizedMessage);
			if (!dupeCheck.length) {
				dupeCheck = [{ chatId: row.chatId }];
			}

			const result = db.prepare(`
				SELECT status, weight FROM word_360 WHERE chatId = ?
			`).get(dupeCheck[0].chatId);

			const weight = result?.weight;
			const status = result?.status;
			let targetsMsg;
			if(row.rememberAi) {
				targetsMsg = db.prepare(`
					SELECT message FROM chat_360 WHERE chatId = ? LIMIT 1
				`).get(row.rememberAi);
			}
			if(targetsMsg) {
				chatPayload.push([row.message, row.membershipNumber, row.username, row.botPic, row.timestamp , row.chatId, row.messageOrder, row.voteYes, row.voteNo, weight, dupeCheck.length, status, row.markUpAi, row.rememberAi, targetsMsg.message]);
			} else {
				chatPayload.push([row.message, row.membershipNumber, row.username, row.botPic, row.timestamp , row.chatId, row.messageOrder, row.voteYes, row.voteNo, weight, dupeCheck.length, status, row.markUpAi, row.rememberAi, null]);
			}
		}
		aisChatHistory=[];
		for (let i = 0; i < aisChatHistoryExtract.length; i++) {     
			let row = aisChatHistoryExtract[i];
			const messages = db.prepare(`
				SELECT message, chatId 
				FROM chat_360 
				WHERE chatId = ? 
				ORDER BY timestamp
			`).get(row.chatId);
			const normalizedMessage = messages.message.trim();
			let dupeCheck = db.prepare(`
				SELECT * FROM chat_360
				WHERE LOWER(message) = ?
				ORDER BY timestamp ASC
			`).all(normalizedMessage);
			if (!dupeCheck.length) {
				dupeCheck = [{ chatId: row.chatId }];
			}

			const result = db.prepare(`
				SELECT status, weight FROM word_360 WHERE chatId = ?
			`).get(dupeCheck[0].chatId);
			const weight = result?.weight;
			const status = result?.status;
			let targetsMsg;
			if(row.rememberAi) {
				targetsMsg = db.prepare(`
					SELECT message FROM chat_360 WHERE chatId = ? LIMIT 1
				`).get(row.rememberAi);
			}
			if(targetsMsg!=undefined) {
				aisChatHistory.push([row.message, row.membershipNumber, row.username, row.botPic, row.timestamp , row.chatId, row.messageOrder, row.voteYes, row.voteNo, weight, dupeCheck.length, status, row.markUpAi, row.rememberAi, targetsMsg.message]);
			} else {
				aisChatHistory.push([row.message, row.membershipNumber, row.username, row.botPic, row.timestamp , row.chatId, row.messageOrder, row.voteYes, row.voteNo, weight, dupeCheck.length, status, row.markUpAi, row.rememberAi, null]);
			}
		}
		if(chatPayloadInfo[3]) {
			let {anArray: chatPayloadTemp, amount} = searchingChats(chatPayloadInfo, chatPayload);
			chatPayload = chatPayloadTemp;
			chatAmount=amount;
		} else {
			chatAmount=chatAmount.total;
		}
		const wordLingMap = db.prepare('SELECT status, weight FROM word_360').all();
		const sentenceLingMap = db.prepare('SELECT status, weight FROM sentence_360').all();
		const paragraphLingMap = db.prepare('SELECT status, weight FROM paragraph_360').all();
		approved = 0;
		denied = 0;
		for (let row of wordLingMap) {
			if (row.status === 'approved') approved++;
			if (row.status === 'denied') denied++;
			totalWeight = totalWeight + row.weight;
		}
		for (let row of sentenceLingMap) {
			if (row.status === 'approved') approved++;
			if (row.status === 'denied') denied++;
			totalWeight = totalWeight + row.weight;
		}
		for (let row of paragraphLingMap) {
			if (row.status === 'approved') approved++;
			if (row.status === 'denied') denied++;
			totalWeight = totalWeight + row.weight;
		}

		let total = approved + denied;
		accuracy = (approved / total) * 100||0;
		if(myCredentials[1]) {
			const viouValue = db.prepare(`
			SELECT virtualiou FROM info_360
			WHERE membershipNumber = ?`).get(myCredentials[1]);
			viou = viouValue.virtualiou;
		}
	}
    return {chatGroupId, chatPayload, chatAmount, autoResponse, approved, denied, accuracy, totalWeight, viou, startAiDecision:startAi, aisChatHistory};
}

//This is the AI logic. So, linguistic generating
async function chatWeight(chatPayloadData, chatGroupId, chatId, aiTarget) {
    let chatField=chatPayloadData[0];
    const wordLingMap = db.prepare('SELECT weight, status, crossReferences FROM word_360 WHERE wordId = ? GROUP BY crossReferences');
    const sentenceLingMap = db.prepare('SELECT weight, status, crossReferences FROM sentence_360 WHERE sentenceId = ? GROUP BY crossReferences');
    const paragraphLingMap = db.prepare('SELECT weight, status, crossReferences FROM paragraph_360 WHERE paragraphId = ? GROUP BY crossReferences');
    //const cleanMatch = x => x.replace(/[^a-z0-9]/gi, "").trim();
    let wordsAll =  db.prepare('SELECT * FROM word_360 GROUP BY word').all();
    let sentencesAll = db.prepare('SELECT * FROM sentence_360 GROUP BY sentence').all();
    let paragraphsAll = db.prepare('SELECT * FROM paragraph_360 GROUP BY paragraph').all();
    let wordsWeightAll=[];
    const wordsSql = db.prepare(
    'SELECT * FROM word_360 WHERE word = ? GROUP BY word'
    );
    for (let w of wordsAll) {
        const rawWord = w.word || "";
        const cw = rawWord
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\u200b/g, '');

        const row = wordsSql.get(cw);
        if (!row) continue;

        let entry = {
            wordId: row.wordId,
            word: row.word,
            status: '',
            crossReferences: row.crossReferences || "",
            weight: 0
        };
        const refs = wordLingMap.all(entry.wordId);
        for (let r of refs) {
            entry.weight += r.weight;
            entry.status = r.status;
        }
        wordsWeightAll.push(entry);
    }
    let sentencesWeightAll=[];
    const sentencesSql = db.prepare(
    'SELECT * FROM sentence_360 WHERE sentence = ? GROUP BY sentence'
    );
    for (let s of sentencesAll) {
        const rawSentence = s.sentence || "";
        const cs = rawSentence
            .trim()

        const row = sentencesSql.get(cs);
        if (!row) continue;

        let entry = {
            sentenceId: row.sentenceId,
            sentence: row.sentence,
            status: '',
            crossReferences: row.crossReferences || "",
            weight: 0
        };
        const refs = sentenceLingMap.all(entry.sentenceId);

        for (let r of refs) {
            entry.weight += r.weight;
            entry.status = r.status;
        }

        sentencesWeightAll.push(entry);
    }
    let paragraphsWeightAll=[];
    const paragraphsSql = db.prepare(
    'SELECT * FROM paragraph_360 WHERE paragraph = ? GROUP BY paragraph'
    );
    for (let p of paragraphsAll) {
        const rawParagraph = p.paragraph || "";
        const cp = rawParagraph
            .trim()

        const row = paragraphsSql.get(cp);
        if (!row) continue;

        let entry = {
            paragraphId: row.paragraphId,
            paragraph: row.paragraph,
            status: '',
            crossReferences: row.crossReferences || "",
            weight: 0
        };
        const refs = paragraphLingMap.all(entry.paragraphId);

        for (let r of refs) {
            entry.weight += r.weight;
            entry.status = r.status;
        }
        paragraphsWeightAll.push(entry);
    }
	const chatMessages = db.prepare(`
    SELECT message, chatId, rememberAi, approveAi, denyAi, nothingAi, membershipNumber 
    FROM chat_360
`	).all();
	for (const m of chatMessages) {
		const dissect = await dissectManager.dissect(m.message);
		for (let i = 0; i < dissect.sentences.length; i++) {
			for (const w of dissect.words) {
				if (dissect.sentences[i] === w) {
					dissect.sentences.splice(i, 1);
					i--;
					break;
				}
			}
		}
		for (let i = 0; i < dissect.paragraphs.length; i++) {
			for (const s of dissect.sentences) {
				if (dissect.paragraphs[i] === s) {
					dissect.paragraphs.splice(i, 1);
					i--;
					break;
				}
			}
		}
		for (let i = 0; i < dissect.paragraphs.length; i++) {
			for (const w of dissect.words) {
				if (dissect.paragraphs[i] === w) {
					dissect.paragraphs.splice(i, 1);
					i--;
					break;
				}
			}
		}
		const accuracy = (m.approveAi / (m.approveAi + m.denyAi + m.nothingAi)) || 0;
		for (let w of dissect.words) {
			const wText = typeof w === "string" ? w : w.word;
			if (!wText) continue;

			let entry = wordsWeightAll.find(e => e.word === wText);

			if (!entry) {
				entry = {
					word: wText,
					weight: 0,
					locate: [{
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					}]
				};
				wordsWeightAll.push(entry);
			} else {
				if (!entry.locate) entry.locate = [];
				let hit = entry.locate.find(l => l.chatId === m.chatId);
				if (hit) {
					hit.amount++;
				} else {
					entry.locate.push({
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					});
				}

				const nonAI = entry.locate.filter(l => l.membershipNumber.endsWith("-AI"));
				entry.trueAccuracy = nonAI.length
					? nonAI.reduce((s, l) => s + l.accuracy, 0) / nonAI.length
					: 0;

				entry.sumAccuracy = entry.locate
					.filter(l => !l.membershipNumber.endsWith("-AI"))
					.length;
				
				entry.total=0;
			}
		}
		for (let s of dissect.sentences) {
			const sText = typeof s === "string" ? s : s.sentence;
			if (!sText) continue;

			let entry = sentencesWeightAll.find(e => e.sentence === sText);

			if (!entry) {
				entry = {
					sentence: sText,
					locate: [{
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					}]
				};
				sentencesWeightAll.push(entry);
			} else {
				if (!entry.locate) entry.locate = [];
				let hit = entry.locate.find(l => l.chatId === m.chatId);
				if (hit) {
					hit.amount++;
				} else {
					entry.locate.push({
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					});
				}

				const nonAI = entry.locate.filter(l => l.membershipNumber.endsWith("-AI"));
				entry.trueAccuracy = nonAI.length
					? nonAI.reduce((s, l) => s + l.accuracy, 0) / nonAI.length
					: 0;

				entry.sumAccuracy = entry.locate
					.filter(l => !l.membershipNumber.endsWith("-AI"))
					.length;
					
				entry.total=0;
			}
		}
		for (let p of dissect.paragraphs) {
			const pText = typeof p === "string" ? p : p.paragraph;
			if (!pText) continue;

			let entry = paragraphsWeightAll.find(e => e.paragraph === pText);

			if (!entry) {
				entry = {
					paragraph: pText,
					locate: [{
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					}]
				};
				paragraphsWeightAll.push(entry);
			} else {
				if (!entry.locate) entry.locate = [];
				let hit = entry.locate.find(l => l.chatId === m.chatId);
				if (hit) {
					hit.amount++;
				} else {
					entry.locate.push({
						chatId: m.chatId,
						accuracy,
						amount: 1,
						membershipNumber: m.membershipNumber,
						message: m.message
					});
				}

				const nonAI = entry.locate.filter(l => l.membershipNumber.endsWith("-AI"));
				entry.trueAccuracy = nonAI.length
					? nonAI.reduce((s, l) => s + l.accuracy, 0) / nonAI.length
					: 0;

				entry.sumAccuracy = entry.locate
					.filter(l => !l.membershipNumber.endsWith("-AI"))
					.length;
					
				entry.total=0;
			}
		}
	}
	let languagePool = [
		...wordsWeightAll,
		...sentencesWeightAll,
		...paragraphsWeightAll
	].sort((a, b) => b.weight - a.weight);
	const dissect2 = await dissectManager.dissect(chatField);
    let chatFieldWords=dissect2.words;
    let chatFieldSentences=dissect2.sentences;
    let chatFieldParagraphs=dissect2.paragraphs;
    let bestStartingLanguages=[];
    for (let cfw of chatFieldWords) {
		const startingLanguage = languagePool
		.filter(ai => {
			const aiWord =
				typeof ai.word === "string" ? ai.word.trim() : "";
			const aiSentence =
				typeof ai.sentence === "string" ? ai.sentence.trim() : "";
			const aiParagraph =
				typeof ai.paragraph === "string" ? ai.paragraph.trim() : "";
			let refs = [];
			if (ai.crossReferences && ai.crossReferences.trim()) {
				refs = ai.crossReferences
					.replace(/;$/, "")
					.split(";")
					.map(r => r.trim())
					.filter(Boolean);
			}
			/*const tokens = chatField
				.trim()
				.split(/\s+/)
				.map(t => t.trim())
				.filter(Boolean);
			*/
			let token;
			if(cfw) {
				token=cfw;
			}
			const directRefMatch = refs.includes(token)
			return directRefMatch || "";
		})
		.sort((a, b) => {
			
			const aHasRef = a.crossReferences && a.crossReferences.length > 0 ? 1 : 0;
			const bHasRef = b.crossReferences && b.crossReferences.length > 0 ? 1 : 0;
			if (aHasRef !== bHasRef) return bHasRef - aHasRef;
			
			const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
			const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
			if (pA !== pB) return pB - pA;
			
			
			const aTrue = a.trueAccuracy || 0;
			const bTrue = b.trueAccuracy || 0;
			if (aTrue !== bTrue) return bTrue - aTrue;
			
			const aW = a.weight || 0;
			const bW = b.weight || 0;
			if (aW !== bW) return bW - aW;
			
			const aSum = a.sumAccuracy || 0;
			const bSum = b.sumAccuracy || 0;
			if (aSum !== bSum) return bSum - aSum;
			
			return 0;
		});
		//console.log(startingLanguage[0]);
		bestStartingLanguages.push(startingLanguage[0]);
	}
	for (let cfs of chatFieldSentences) {
		const startingLanguage = languagePool
		.filter(ai => {
			const aiWord =
				typeof ai.word === "string" ? ai.word.trim() : "";
			const aiSentence =
				typeof ai.sentence === "string" ? ai.sentence.trim() : "";
			const aiParagraph =
				typeof ai.paragraph === "string" ? ai.paragraph.trim() : "";
			let refs = [];
			if (ai.crossReferences && ai.crossReferences.trim()) {
				refs = ai.crossReferences
					.replace(/;$/, "")
					.split(";")
					.map(r => r.trim())
					.filter(Boolean);
			}
			/*const tokens = chatField
				.trim()
				.split(/\s+/)
				.map(t => t.trim())
				.filter(Boolean);
			*/
			let token;
			if(cfs) {
				token=cfs;
			}
			const directRefMatch = refs.includes(token)
			return directRefMatch || "";
		})
		.sort((a, b) => {
			
			const aHasRef = a.crossReferences && a.crossReferences.length > 0 ? 1 : 0;
			const bHasRef = b.crossReferences && b.crossReferences.length > 0 ? 1 : 0;
			if (aHasRef !== bHasRef) return bHasRef - aHasRef;
			
			const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
			const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
			if (pA !== pB) return pB - pA;
			
			
			const aTrue = a.trueAccuracy || 0;
			const bTrue = b.trueAccuracy || 0;
			if (aTrue !== bTrue) return bTrue - aTrue;
			
			const aW = a.weight || 0;
			const bW = b.weight || 0;
			if (aW !== bW) return bW - aW;
			
			const aSum = a.sumAccuracy || 0;
			const bSum = b.sumAccuracy || 0;
			if (aSum !== bSum) return bSum - aSum;
			
			return 0;
		});
		//console.log(startingLanguage[0]);
		bestStartingLanguages.push(startingLanguage[0]);
	}
	for (let cfp of chatFieldParagraphs) {
		const startingLanguage = languagePool
		.filter(ai => {
			const aiWord =
				typeof ai.word === "string" ? ai.word.trim() : "";
			const aiSentence =
				typeof ai.sentence === "string" ? ai.sentence.trim() : "";
			const aiParagraph =
				typeof ai.paragraph === "string" ? ai.paragraph.trim() : "";
			let refs = [];
			if (ai.crossReferences && ai.crossReferences.trim()) {
				refs = ai.crossReferences
					.replace(/;$/, "")
					.split(";")
					.map(r => r.trim())
					.filter(Boolean);
			}
			/*const tokens = chatField
				.trim()
				.split(/\s+/)
				.map(t => t.trim())
				.filter(Boolean);
			*/
			let token;
			if(cfp) {
				token=cfp;
			}
			const directRefMatch = refs.includes(token)
			return directRefMatch || "";
		})
		.sort((a, b) => {
			
			const aHasRef = a.crossReferences && a.crossReferences.length > 0 ? 1 : 0;
			const bHasRef = b.crossReferences && b.crossReferences.length > 0 ? 1 : 0;
			if (aHasRef !== bHasRef) return bHasRef - aHasRef;
			
			const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
			const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
			if (pA !== pB) return pB - pA;
			
			
			const aTrue = a.trueAccuracy || 0;
			const bTrue = b.trueAccuracy || 0;
			if (aTrue !== bTrue) return bTrue - aTrue;
			
			const aW = a.weight || 0;
			const bW = b.weight || 0;
			if (aW !== bW) return bW - aW;
			
			const aSum = a.sumAccuracy || 0;
			const bSum = b.sumAccuracy || 0;
			if (aSum !== bSum) return bSum - aSum;
			
			return 0;
		});
		//console.log(startingLanguage[0]);
		bestStartingLanguages.push(startingLanguage[0]);
	}
	
	const bestStartingLanguagesSort = bestStartingLanguages
	.filter(item => item && item !== undefined||null)
	.sort((a, b) => {
		const aHasRef = a.crossReferences && a.crossReferences.length > 0 ? 1 : 0;
		const bHasRef = b.crossReferences && b.crossReferences.length > 0 ? 1 : 0;
		if (aHasRef !== bHasRef) return bHasRef - aHasRef;
		
		const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
		const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
		if (pA !== pB) return pB - pA;
		
		
		const aTrue = a.trueAccuracy || 0;
		const bTrue = b.trueAccuracy || 0;
		if (aTrue !== bTrue) return bTrue - aTrue;
		
		const aW = a.weight || 0;
		const bW = b.weight || 0;
		if (aW !== bW) return bW - aW;
		
		const aSum = a.sumAccuracy || 0;
		const bSum = b.sumAccuracy || 0;
		if (aSum !== bSum) return bSum - aSum;
		
		return 0;
	});
	
	
	
	//console.log(bestStartingLanguagesSort);	
	console.log(JSON.stringify(bestStartingLanguagesSort, null, 2));
	//console.log(bestStartingLanguagesSort[0]);
	//return
	let aiOutput = '';
	let allAiOutput=[];
	let directPick=[];
	let randomLength=0;
	if (bestStartingLanguagesSort.length>0) {
		const min = 0.5 * chatField.length;
		const max = 2 * chatField.length;
		randomLength = min + Math.random() * (max - min);
		let memoryLanguage = [];
		let totalMemoryLanguage = [];
		let memoryFound=false;
		let iterationCount=0;
		for(let i=0;i<bestStartingLanguagesSort.length;i++) {
			/*aiOutput =
				bestStartingLanguagesSort[i].paragraph ||
				bestStartingLanguagesSort[i].sentence ||
				bestStartingLanguagesSort[i].word ||
				"";*/
			let refs = (bestStartingLanguagesSort[i].crossReferences || "")
				.replace(/;$/, "")
				.split(";")
				.filter(Boolean);
			console.log('----------------------------------');
			console.log("Cross References: "+refs);
			console.log('----------------------------------');
			if (refs.length > 0) {
				for (let r of refs) {
					console.log(r);
				//do {
					bestRef=null;
					iterationCount=0;
					
					memoryLanguage=[];
					do {
						let refMatches;
						refMatches = languagePool.filter(ai => {
							const text = ai.paragraph || ai.sentence || ai.word || "";
							if (ai === bestStartingLanguagesSort[i]) return false;
							if (text === chatField) return false;
							//if (ai !== r) return false;
							return r===text;
							//return text
						});
						//console.log(refMatches);
						//return;
						
							/*
							if (refMatches.length === 0) {
								refMatches = languagePool.filter(ai => {
									const text = ai.paragraph || ai.sentence || ai.word || "";
									if (ai === bestStartingLanguagesSort[i]) return false;
									if (text === chatField) return false;
									return ai.paragraph || ai.sentence || ai.word;
								});
							}
							*/
							//memoryLanguage.push(refMatches);
							//console.log(refMatches);
							//return
						if (bestRef) {
							const nextRefs = (bestRef.crossReferences || "")
								.replace(/;$/, "")
								.split(";")
								.filter(Boolean);
							refMatches = languagePool.filter(ai => {
								return nextRefs.some(r =>
									r === ai.paragraph ||
									r === ai.sentence ||
									r === ai.word
								);
							});
							/*
							if (refMatches.length === 0) {
								refMatches = languagePool.filter(ai => {
									const text = ai.paragraph || ai.sentence || ai.word || "";
									if (ai === bestStartingLanguagesSort[i]) return false;
									if (text === chatField) return false;
									
								});
								//console.log(refMatches);
							}
							refs = nextRefs;
							*/
							//console.log(refMatches);
							//memoryLanguage.push(refMatches);
							
						}
						if (refMatches.length === 0) break;
						const statusOrder = {
							pending: 2,
							approved: 1,
							denied: 0
						};
						bestRef = refMatches
							/*.filter(ai => !memoryLanguage[iterationCount]?.some(dataPiece => 
								(dataPiece.word && dataPiece.word === ai.word) ||
								(dataPiece.sentence && dataPiece.sentence === ai.sentence) ||
								(dataPiece.paragraph && dataPiece.paragraph === ai.paragraph)
							))*/
							.filter(ai => {
							  if (!Array.isArray(memoryLanguage)) return true;
							  return !memoryLanguage.some(dataPiece => 
								dataPiece && (
								  (dataPiece.word && dataPiece.word === ai.word) ||
								  (dataPiece.sentence && dataPiece.sentence === ai.sentence) ||
								  (dataPiece.paragraph && dataPiece.paragraph === ai.paragraph)
								)
							  );
							})

							.sort((a, b) => {
								
								const aStatus = statusOrder[a?.status] ?? -1;
								const bStatus = statusOrder[b?.status] ?? -1;
								if (aStatus !== bStatus) return bStatus - aStatus;
								
								const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
								const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
								if (pA !== pB) return pB - pA;								
							
								const aTrue = a?.trueAccuracy || 0;
								const bTrue = b?.trueAccuracy || 0;

								if (aTrue !== bTrue) return bTrue - aTrue;
								
								const aW = a?.weight || 0;
								const bW = b?.weight || 0;

								if (aW !== bW) return bW - aW;

								const aSum = a?.sumAccuracy || 0;
								const bSum = b?.sumAccuracy || 0;

								return bSum - aSum;
								/*
								const aHasRef = a.crossReferences && a.crossReferences.length > 0 ? 1 : 0;
								const bHasRef = b.crossReferences && b.crossReferences.length > 0 ? 1 : 0;
								if (aHasRef !== bHasRef) return bHasRef - aHasRef;
								
								const pA = a.paragraph ? 3 : a.sentence ? 2 : a.word ? 1 : 0;
								const pB = b.paragraph ? 3 : b.sentence ? 2 : b.word ? 1 : 0;
								if (pA !== pB) return pB - pA;
								
								
								const aTrue = a.trueAccuracy || 0;
								const bTrue = b.trueAccuracy || 0;
								if (aTrue !== bTrue) return bTrue - aTrue;
								
								const aW = a.weight || 0;
								const bW = b.weight || 0;
								if (aW !== bW) return bW - aW;
								
								const aSum = a.sumAccuracy || 0;
								const bSum = b.sumAccuracy || 0;
								if (aSum !== bSum) return bSum - aSum;
								
								return 0;
								*/
							})[0];
						if (!bestRef) break;
						iterationCount++;
						//console.log(bestRef);
						memoryLanguage.push(bestRef);
						/*
						for (let ml of memoryLanguage) {
							if(ml==bestRef) {
								memoryFound=true;
								console.log(memoryFound);
							}
						}						
						if(bestRef.word) {
							memoryLanguage.push(bestRef.word);
						}
						if(bestRef.sentence) {
							memoryLanguage.push(bestRef.sentence);
						}
						if(bestRef.paragraph) {
							memoryLanguage.push(bestRef.paragraph);
						}
						*/
						//visitedRefs.add(bestRef);
						let token = bestRef.paragraph 
							|| bestRef.sentence 
							|| bestRef.word 
							|| "";
						let trimmed = token.trim();
						aiOutput += (aiOutput === "" ? "" : " ") + trimmed;
						aiOutput.trim();
						
						let pick=[]				
						pick = languagePool.filter(lang => {
							const words = aiOutput.split(" ");
							return (
								lang.word === aiOutput ||
								lang.sentence === aiOutput ||
								lang.paragraph === aiOutput ||
								words.some(word => 
									lang.word?.includes(word) || 
									lang.sentence?.includes(word) || 
									lang.paragraph?.includes(word)
								)
							);
						});
						
						
						if(aiOutput.length > randomLength) {
							if(pick.length > 0) {
								break;
							}
						}
					} while (true);
					if(aiOutput) {
						console.log(aiOutput);
						allAiOutput.push({aiOutput,weight:0,trueAccuracy:0,sumAccuracy:0});
						totalMemoryLanguage.push(memoryLanguage);
						bestRef=null;
						aiOutput='';
						refMatches=null;
					}
				}
			}
		}
		//return
		aiOutput=null;
		//console.log(allAiOutput);
		//return;
		directPick=[];
		for(let i=0;i<allAiOutput.length;i++) {
			//const target = allAiOutput[i]?.[1];
			const sample = languagePool.filter(lang => 
				lang && (
					lang.paragraph === allAiOutput[i].aiOutput ||					
					lang.sentence === allAiOutput[i].aiOutput// || 
					//lang.word === allAiOutput[i].aiOutput
				)
			);
			//console.log(sample);
			if(sample.length>0) {
				directPick.push(sample);
			}
		}
		//console.log(directPick);
		//return;
	}
	
	/*
	for (let dp of directPick) {
		for (let dp2 of dp) {
			if(dp2.paragraph) {
				if(!aiOutput) {
					aiOutput=dp2.paragraph;
				}
			}
			if(dp2.sentence) {
				if(!aiOutput) {
					aiOutput=dp2.sentence;
				}
			}
			if(dp2.word) {
				if(!aiOutput) {
					aiOutput=dp2.word;
				}
			}
		}
	}
	*/
	
	if(allAiOutput.length>0) {
		for (let aao of allAiOutput) {
			//for (let dp2 of dp) {
			let dissect3;
			/*
			if(dp2.word) {
				dissect3 = await dissectManager.dissect(dp2.word);
			}
			if(dp2.sentence) {
				dissect3 = await dissectManager.dissect(dp2.sentence);
			}
			if(dp2.paragraph) {
				dissect3 = await dissectManager.dissect(dp2.paragraph);
			}
			*/
			dissect3 = await dissectManager.dissect(aao.aiOutput);
			let dissectWords=dissect3.words;
			let dissectSentences=dissect3.sentences;
			let dissectParagraphs=dissect3.paragraphs;		
			total=0;trueAccuracy=0;sumAccuracy=0;weight=0;
			alreadyFlagged=false;
			
			for (let dp2 of dissectParagraphs) {
				exists = languagePool.filter(ai => {
					const text = ai.word || "";
					if (!text) return false;
					//if (ai !== r) return false;
					return dp2===text;
					//return text
				});
				//console.log(exists);
				if(exists.length>0 && alreadyFlagged==false) {
					alreadyFlagged=true;
					weight+=exists[0].weight;
					trueAccuracy+=exists[0].trueAccuracy;
					sumAccuracy+=exists[0].sumAccuracy;
					total++
				}
			}
			for (let ds of dissectSentences) {
				exists = languagePool.filter(ai => {
					const text = ai.word || "";
					if (!text) return false;
					//if (ai !== r) return false;
					return ds===text;
					//return text
				});
				//console.log(exists);
				if(exists.length>0 && alreadyFlagged==false) {
					alreadyFlagged=true;
					weight+=exists[0].weight;
					trueAccuracy+=exists[0].trueAccuracy;
					sumAccuracy+=exists[0].sumAccuracy;
					total++
				}
			}
			
			for (let dw of dissectWords) {
				/*
				const exists = languagePool.filter(dbItem => {
					const rawText = dbItem.word || dbItem.sentence || dbItem.paragraph;
					if (!rawText) return false;
					//const cleanDbText = rawText.toLowerCase().trim();
					return dw.includes(rawText) || rawText.includes(dw);
				});
				*/
				exists = languagePool.filter(ai => {
					const text = ai.word || "";
					if (!text) return false;
					//if (ai !== r) return false;
					return dw===text;
					//return text
				});
				//console.log(exists);
				if(exists.length>0 && alreadyFlagged==false) {
					alreadyFlagged=true;
					weight+=exists[0].weight;
					trueAccuracy+=exists[0].trueAccuracy;
					sumAccuracy+=exists[0].sumAccuracy;
					total++
				}
			}
			aao.weight=Number(weight/total);
			aao.trueAccuracy=Number(trueAccuracy/total);
			aao.sumAccuracy=Number(sumAccuracy/total);
			
			
			//console.log(aao);
			//return
			//}	
		}
	}
	
	//console.log(allAiOutput);
	console.log(directPick);
	//return;
	//console.log(directPick);
	let sortDirectPick;
	if(!directPick.length) {
		/*const statusOrder = {
			pending: 2,
			approved: 1,
			denied: 0
		};*/
		sortDirectPick = allAiOutput.sort((a, b) => {
			/*
			const aStatus = statusOrder[a?.status] ?? -1;
			const bStatus = statusOrder[b?.status] ?? -1;
			if (aStatus !== bStatus) return bStatus - aStatus;
			*/
			
			const aTrue = a?.trueAccuracy || 0;
			const bTrue = b?.trueAccuracy || 0;

			if (aTrue !== bTrue) return bTrue - aTrue;
			
			const aW = a?.weight || 0;
			const bW = b?.weight || 0;

			if (aW !== bW) return bW - aW;

			const aSum = a?.sumAccuracy || 0;
			const bSum = b?.sumAccuracy || 0;

			return bSum - aSum;
		})[0];
		if(aiOutput===chatField || !sortDirectPick) {
			aiOutput = "What do you mean by..? " + chatField;
		} else {
			aiOutput = sortDirectPick.aiOutput;
			  /*
			  sortDirectPick[0]?.[0]?.word ||
			  sortDirectPick[0]?.[0]?.sentence ||
			  sortDirectPick[0]?.[0]?.paragraph;
			  */
		}
	} else {
		console.log('---------------DIRECTPICK---------------');
		const statusOrder = {
			pending: 1,
			approved: 2,
			denied: 0
		};
		sortDirectPick = directPick.sort((a, b) => {
			
			const aStatus = statusOrder[a[0]?.status] ?? -1;
			const bStatus = statusOrder[b[0]?.status] ?? -1;
			if (aStatus !== bStatus) return bStatus - aStatus;
			
			const pA = a[0].paragraph ? 3 : a[0].sentence ? 2 : a[0].word ? 1 : 0;
			const pB = b[0].paragraph ? 3 : b[0].sentence ? 2 : b[0].word ? 1 : 0;
			if (pA !== pB) return pB - pA;					
		
			const aTrue = a[0]?.trueAccuracy || 0;
			const bTrue = b[0]?.trueAccuracy || 0;

			if (aTrue !== bTrue) return bTrue - aTrue;
			
			const aW = a[0]?.weight || 0;
			const bW = b[0]?.weight || 0;

			if (aW !== bW) return bW - aW;

			const aSum = a[0]?.sumAccuracy || 0;
			const bSum = b[0]?.sumAccuracy || 0;

			return bSum - aSum;
		})[0];
		if(aiOutput===chatField || !sortDirectPick) {
			aiOutput = "What do you mean by..? " + chatField;
		} else {
			aiOutput = sortDirectPick[0].word||sortDirectPick[0].sentence||sortDirectPick[0].paragraph;
			  /*
			  sortDirectPick[0]?.[0]?.word ||
			  sortDirectPick[0]?.[0]?.sentence ||
			  sortDirectPick[0]?.[0]?.paragraph;
			  */
		}
	}
	console.log(sortDirectPick);
	//return;
	//return;
	//let aiOutput2 = [];
	//if(directPick.length>0) aiOutput2=directPick.filter(lang => lang.length > 0);
	//aiOutput2.sort((a, b) => b.total - a.total);
	/*
	if (!directPick.length) {
		aiOutput = "What do you mean by..? " + chatField;
	} else {
		if(aiOutput2.length>0) {
			//console.log(aiOutput2);
			
			for (let ao of aiOutput2) {
				for (let ao2 of ao) {
					if(ao2.word) {
						//console.log(ao2.word);
						aiOutput=ao2.word;
						break;
					}
					if(ao2.sentence) {
						//console.log(ao2.sentence);
						aiOutput=ao2.sentence;
						break;
					}
					if(ao2.paragraph) {
						//console.log(ao2.paragraph);
						aiOutput=ao2.paragraph;
						break;
					}
				}
				break;
			}
		}
	}
	*/
		
	
	//console.log(aiOutput);
	console.log("Passing GO");
	//return;
	let finalOutput = aiOutput;
    console.log(chatPayloadData[6]+" says: "+chatField);
    console.log(chatPayloadData[6]+"-AI says: " + finalOutput);
    const last = db.prepare('SELECT chatId FROM chat_360 ORDER BY chatId DESC LIMIT 1').get();
    let nextChatId = last.chatId;
    const nextOrder = getNextMessageOrder(chatPayloadData[1], nextChatId );
    if(nextChatId) {
        nextChatId++;
    }
    if(finalOutput && finalOutput!=="undefined") {
        const cleanSoft = x => x
        .replace(/\s+/g, " ")
        .replace(/[^\w\s.,!?']/g, "")
        .trim()
        .toLowerCase();
        let aiMember = String(chatPayloadData[6]);
        if(!aiMember.endsWith("-AI")) {
            aiMember=aiMember+"-AI";
        }
        db.prepare('INSERT INTO chat_360 (chatGroupId, message, messageOrder, membershipNumber, rememberAi) VALUES (?, ?, ?, ?, ?)').run(chatGroupId, finalOutput, nextOrder, aiMember, aiTarget);
        //db.prepare('INSERT INTO chat_360 (chatGroupId, message, messageOrder, membershipNumber, markUpAi, rememberAi) VALUES (?, ?, ?, ?, ?, ?)').run(chatGroupId, finalOutput, nextOrder, aiMember, startAi, aiTarget);
        const chatGroupCheck = db.prepare(`SELECT * FROM chatGroup_360 WHERE chatGroupId = ?`).get(chatGroupId);
        if(!chatGroupId) {
            db.prepare('INSERT INTO chatGroup_360 (chatGroupId, membershipNumber, unread) VALUES (?, ?, ?)').run(chatGroupId, aiMember, 0);
        }
        const finalFlash = await dissectManager.dissect(finalOutput);
        chatDissection(finalFlash, nextChatId, chatGroupId, chatPayloadData[6]+"-AI");
    }
}

//This is for when language searching in chat.ejs
function searchingChats(chatPayloadInfo, chatRows) {
    const page       = chatPayloadInfo[0];
    const pageLimit  = chatPayloadInfo[1];
    const searchText = chatPayloadInfo[4];
    let amount = 0;
    if (!searchText || searchText === '') {
        return { anArray: chatRows, amount: chatRows.length };
    }
    const search = searchText.trim().toLowerCase();
    let filtered = [];
    for (let i = 0; i < chatRows.length; i++) {
        const row = chatRows[i];
        if (!row) continue;

        const col0 = String(row[0] || '').toLowerCase();
        const col2 = String(row[2] || '').toLowerCase();

        if (col0.startsWith(search) || col2.startsWith(search)) {
            filtered.push(row);
        }
    }
    amount = filtered.length;
    const start = page * pageLimit - pageLimit;
    const end   = Math.min(page * pageLimit, filtered.length);
    const paged = filtered.slice(start, end);
    return { anArray: paged, amount };
}

module.exports = {
  sendChat,
  loadChat,
  joinChat,
  chatWeight
};
