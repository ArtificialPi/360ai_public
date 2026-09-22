const express = require("express");
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db, deleteAllChat } = require('../db/db.js');
const XXH = require('xxhashjs');
const dissectManager = require('../microservices/dissect-manager');
const { emitToRoom } = require("../sockets/webSocketLogic.js");
require('dotenv').config();

//Alphanumeric string generator and desired length
function generateRandomString(length) {
  return crypto.randomBytes(length)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, length);
}

//16 digit hash
function hashText(text) {
  return XXH.h64(text, 0xA1B2C3D4).toString(16);
}

//LEGACY
/*
function stableHashRow(row) {
  if (!row) return hashText("null");
  return hashText(
    JSON.stringify({
      descriptions: row.descriptions,
      categories: row.categories,
      crossReferences: row.crossReferences,
      trade: row.trade,
	  status: row.status,
	  lock: row.lock
    })
  );
}
*/

//Admin logging for everything
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

//Starting for router/routes logic	
router.post("/", async (req, res) => {
	//Registering logic
	if (req.body.registerInfo) {
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		try {
			let errors = [];
			let checking;
			let registerInfo = req.body.registerInfo;
			let confirmationCheck = req.body.confirmationCheck;
			if (!registerInfo[0] || registerInfo[0].length < 2 || registerInfo[0].length > 20) {
				errors.push("name");
			}
			const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
			if (!registerInfo[1] || !registerInfo[1].match(pattern)) {
				errors.push("email");
			} else {
				const checking = db.prepare('SELECT * FROM member_360 WHERE email = ?').get(registerInfo[1]);
				if (checking) {
					errors.push("email");
				}
			}
			if (!registerInfo[2] || !registerInfo[3] || registerInfo[2].length < 6 || registerInfo[2] !== registerInfo[3]) {
				errors.push("password");
			}
			const checking2 = db.prepare('SELECT * FROM member_360').get();
			if(checking2) {
				if (registerInfo[4].length == 16) {
					const checking = db.prepare('SELECT * FROM info_360 WHERE membershipNumber = ?').get(registerInfo[4]);
					if (!checking) {
						errors.push("recruiter");
					}
				} else {
					errors.push("recruiter");
				}
			} else {
				registerInfo[4]="Owner";
			}
			if(!confirmationCheck[0] || !confirmationCheck[1] || !confirmationCheck[2]) {
				errors.push("confirmationCheck");
			}
			checking = db.prepare('SELECT * FROM member_360').all();
			if (checking.length>10) {
				errors.push("too many people");
			}
			if(errors.length>0) {	
				logEverything("N/A", sessionIp+" failed register attempt", sessionUa, sessionIp, "register", false);
				return res.json({ errors });
			} else {
				let membershipNumber;
				do {
					membershipNumber = generateRandomString(16);
					checking = db.prepare('SELECT * FROM member_360 WHERE membershipNumber = ?').get(membershipNumber);
				} while(checking);
				const password=crypto.createHash('sha256').update(registerInfo[2]).digest('hex');
				db.prepare('INSERT INTO member_360 (email, password, membershipNumber) VALUES (?, ?, ?)').run(registerInfo[1].toLowerCase(), password, membershipNumber);
				botPic=Math.floor(Math.random() * 50) + 1;			
				db.prepare('INSERT INTO info_360 (username, membershipNumber, recruiterNumber, status, verified, botPic) VALUES (?, ?, ?, ?, ?, ?)').run(registerInfo[0], membershipNumber, registerInfo[4], "approved", 0, botPic);
				let tokenNumber;
				do {
					tokenNumber = generateRandomString(64);
					const checking = db.prepare('SELECT * FROM token_360 WHERE tokenNumber = ?').get(tokenNumber);
				} while(checking);
				tokenNumberHashed=crypto.createHash('sha256').update(tokenNumber).digest('hex');
				db.prepare('INSERT INTO token_360 (tokenNumber, membershipNumber, tokenReason) VALUES (?, ?, ?)').run(tokenNumberHashed, membershipNumber, 'verification');
				const transporter = nodemailer.createTransport({
				host: process.env.HOST,
				port: 465,
				secure: true,
				auth: {
					user: process.env.EMAIL_USER,
					pass: process.env.EMAIL_PASS
				},
				tls: {
					rejectUnauthorized: false
				}
				});
				const emailTemplate = `
				<!DOCTYPE html>
				<html>
					<head>
						<title>
							360AI
						</title>
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<style>
							body, html {
								margin: 0;
								padding: 0;
								font-family: Arial, Helvetica, sans-serif;
							}

							#wholePage {
								text-align: center;
								width:100%;
								max-width:100%;
								min-height:100vh;
							}

							#banner {
								background-image: url('https://www.360-ai.ca/banner');
								background-repeat: no-repeat;
								background-size: 100% 100%;
								width:100vw;
								height:945px;
								max-width: 100%;
								cursor: pointer;
								margin: 0 auto;
							}
							
							#info {
								width:750px;
								text-align: center;
								margin:0 auto;
							}
							
							@media only screen and (max-width:700px) {
								 #info {
									width:100%;
									text-align: center;
									margin:0 auto;
									border: 1px;
								}
							}
							
							@media only screen and (max-width:275px) {
								* {
									word-break:break-all;
								}
							}

							@media only screen and (min-width: 1921px) {
								#banner {
									background-image: url('https://www.360-ai.ca/banner');
									background-repeat: no-repeat;
									background-size: 100% 100%;
									width:1920px;
									height:945px;
									cursor: pointer;
									margin:0 auto;
								}
							}
							
							@media only screen and (max-width: 700px) {
								#banner {
									background-image: url('https://www.360-ai.ca/bannerSmall');
									background-repeat: no-repeat;
									background-size: 100% 100%;
									width:1920px;
									height:945px;
									cursor: pointer;
									margin:0 auto;
								}
							}
						</style>
						<link rel="icon" href="/favicon" type="image/png">
					</head>
					<body>
						<div id="wholePage">
							<div id="banner"></div>
							<div id="info" style="">
								<div style="font-size: clamp(40px, 2vw, 60px);margin:25px 0 0 0;font-weight: bold;text-decoration: underline;color: rgba(102, 153, 255,1);">Thank you for subscribing to 360AI!</div>
								<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;">Below are your credentials following the verification link!</div>
								<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;"><b>Username:</b> <div style="color: rgba(102, 153, 255,1);display:inline-block;">`+registerInfo[0]+`</div></div>
								<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;"><b>Membership Number:</b> <div style="color: rgba(102, 153, 255,1);display:inline-block;">`+membershipNumber+`</div></div>
								<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;"><b>Recruiters Number:</b> <div style="color: rgba(102, 153, 255,1);display:inline-block;">`+registerInfo[4]+`</div></div>
								<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;">Please click <a href="https://www.360-ai.ca/membership?token=`+tokenNumberHashed+`" style="color: rgba(102, 153, 255,1);">Verification Link</a> to proceed!</div>
							</div>
							<div id="footer" style="max-width: 100%;margin:25px 0 25px 0;font-weight: bold;font-size: clamp(20px, 1vw, 30px);text-align: center;">Copyright 360AI &copy; All Rights Reserved.</div>
						</div>
					</body>
				</html>			
				`;
				const mailOptions = {
				from: '"noreply" <noreply@360-ai.ca>',
				to: registerInfo[1],
				subject: 'Welcome to 360AI!',
				html: emailTemplate,
				replyTo: 'noreply@360-ai.ca' 
				};
				transporter.sendMail(mailOptions, (err, info) => {
				if (err) console.error(err);
				else console.log('Email sent:', info.response);
				});
				logEverything(membershipNumber, membershipNumber+" successful register attempt", sessionUa, sessionIp, "register", false);
				return res.json({membershipNumber, tokenNumber});
			}
		} catch (err) {
			logEverything("N/A", "Registration Error: "+err, sessionUa, sessionIp, "error", false);
			return res.sendStatus(500);
		}			
	}
	
	//Logic logic
	if (req.body.loginInfo) {
		const sessionUa = req.headers['user-agent'];
		const sessionIp = req.ip;
		try {
			let errors = [];
			let loginInfo = req.body.loginInfo;
			let forgotPassword = req.body.forgotPassword;
			const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
			if (!loginInfo[0] || !loginInfo[0].match(pattern)) {
				errors.push("email");
			}
			if (!loginInfo[1]) {
				errors.push("password");
			}
			if (errors.length === 0) {
				const password = crypto.createHash('sha256')
					.update(loginInfo[1])
					.digest('hex');
				const checking = db.prepare(
					"SELECT m.membershipNumber, m.email FROM member_360 m LEFT JOIN info_360 i ON m.membershipNumber = i.membershipNumber WHERE m.password = ? AND m.email = ? AND i.verified = 1 AND i.status = 'approved'"
				).get(password, loginInfo[0].toLowerCase());
				if (!checking) {
					logEverything(checking.membershipNumber, checking.membershipNumber+" failed login attempt", sessionUa, sessionIp, "login", false);
					errors.push("password");
				} else {
					const checking2 = db.prepare(
						'SELECT username, botPic FROM info_360 WHERE membershipNumber = ?'
					).get(checking.membershipNumber);
					if (checking2) {
						
						let sessionId = req.signedCookies.session_360;
						let confirmationCheck = null;
						if (sessionId) {
							confirmationCheck = db.prepare(
								'SELECT membershipNumber FROM session_360 WHERE sessionId = ?'
							).get(sessionId);
						}
						if (!sessionId || !confirmationCheck) {
							sessionId = crypto.randomUUID();
							res.cookie("session_360", sessionId, {
								httpOnly: true,
								secure: false,
								sameSite: "lax",
								signed: true,
								maxAge: 1000 * 60 * 60 * 24 * 7
							});
							const expiryTime = Date.now() + 1000 * 60 * 60 * 24 * 7;
							db.prepare(`
								INSERT INTO session_360 
								(sessionId, userAgentInfo, ipAddressInfo, expirationTimeInfo, membershipNumber)
								VALUES (?, ?, ?, ?, ?)
							`).run(sessionId, sessionUa, sessionIp, expiryTime, checking.membershipNumber);
						}
						req.session.myEmail = checking.email;
						req.session.myMembershipNumber = checking.membershipNumber;
						req.session.myUsername = checking2.username;
						req.session.myBotPic = checking2.botPic;
						req.session.vote=[];
						logEverything(checking.membershipNumber, checking.membershipNumber+" successful login attempt", sessionUa, sessionIp, "login", true);
						return res.json({ success: true });
					} else {
						if (errors[0] === "password" && forgotPassword[0] === true) {
							let tokenNumber;
							do {
								tokenNumber = generateRandomString(64);
								const checking = db.prepare('SELECT * FROM token_360 WHERE tokenNumber = ?').get(tokenNumber);
							} while(checking);
							tokenNumberHashed=crypto.createHash('sha256').update(tokenNumber).digest('hex');
							db.prepare('INSERT INTO token_360 (tokenNumber, membershipNumber, tokenReason) VALUES (?, ?, ?)').run(tokenNumberHashed, checking.membershipNumber, 'forgot password');
							const transporter = nodemailer.createTransport({
							host: process.env.HOST,
							port: 465,
							secure: true,
							auth: {
								user: process.env.EMAIL_USER,
								pass: process.env.EMAIL_PASS
							},
							tls: {
								rejectUnauthorized: false
							}
							});
							const emailTemplate = `
							<!DOCTYPE html>
							<html>
								<head>
									<title>
										360AI
									</title>
									<meta name="viewport" content="width=device-width, initial-scale=1.0">
									<style>
										body, html {
											margin: 0;
											padding: 0;
											font-family: Arial, Helvetica, sans-serif;
										}

										#wholePage {
											text-align: center;
											width:100%;
											max-width:100%;
											min-height:100vh;
										}

										#banner {
											background-image: url('https://www.360-ai.ca/banner');
											background-repeat: no-repeat;
											background-size: 100% 100%;
											width:100vw;
											height:945px;
											max-width: 100%;
											cursor: pointer;
											margin: 0 auto;
										}
										
										#info {
											width:750px;
											text-align: center;
											margin:0 auto;
										}

										@media only screen and (min-width: 1921px) {
											#banner {
												background-image: url('https://www.360-ai.ca/banner');
												background-repeat: no-repeat;
												background-size: 100% 100%;
												width:1920px;
												height:945px;
												cursor: pointer;
												margin:0 auto;
											}
										}
										
										@media only screen and (max-width: 700px) {
											#banner {
												background-image: url('https://www.360-ai.ca/bannerSmall');
												background-repeat: no-repeat;
												background-size: 100% 100%;
												width:1920px;
												height:945px;
												cursor: pointer;
												margin:0 auto;
											}
											#info {
												width:100%;
												text-align: center;
												margin:0 auto;
											}
										}
									</style>
									<link rel="icon" href="/favicon" type="image/png">
								</head>
								<body>
									<div id="wholePage">
										<div id="banner"></div>
										<div id="info" style="">
											<div style="font-size: clamp(40px, 2vw, 60px);margin:25px auto 0 0;font-weight: bold;text-decoration: underline;color: rgba(102, 153, 255,1);text-align:center;">Reset Your Password!</div>
											<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;">Totally understandable. You forgot your password is likely the cause here. Just confirm your credentials and if correct, click the reset password link below! Thank you.</div>
											<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;"><b>Username:</b> <div style="color: rgba(102, 153, 255,1);display:inline-block;">`+checking2.username+`</div></div>
											<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;"><b>Membership Number:</b> <div style="color: rgba(102, 153, 255,1);display:inline-block;">`+checking.membershipNumber+`</div></div>
											<div style="font-size: clamp(20px, 1vw, 30px);margin:25px 0 0 0;">Please click the <a href="https://www.360-ai.ca/resetpassword?token=`+tokenNumberHashed+`" style="color: rgba(102, 153, 255,1);">Reset Password Link</a></div>
										</div>
										<div id="footer" style="max-width: 100%;margin:25px 0 25px 0;font-weight: bold;font-size: clamp(20px, 1vw, 30px);text-align: center;">Copyright 360AI &copy; All Rights Reserved.</div>
									</div>
								</body>
							</html>
							`;
							const mailOptions = {
							from: '"noreply" <noreply@360-ai.ca>',
							to: registerInfo[1],
							subject: 'Forgot Password!',
							html: emailTemplate,
							replyTo: 'noreply@360-ai.ca' 
							};
							transporter.sendMail(mailOptions, (err, info) => {
							if (err) console.error(err);
							else console.log('Email sent:', info.response);
							});
							errors.push("forgotpassword");
						}
					}
				}
			}
			
			return res.json({ errors });
		} catch (err) {
			logEverything("N/A", "Login Error: "+err, sessionUa, sessionIp, "error", false);
			return res.sendStatus(500);
		}
	}
	
	//Reset password logic
	if (req.body.passwordInfo) {
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		try {
			let errors = [];
			let passwordInfo = req.body.passwordInfo;
			let tokenId = req.body.tokenId;
			if (!passwordInfo[0] || !passwordInfo[1] || passwordInfo[0].length < 6 || passwordInfo[0] !== passwordInfo[1]) {
				errors.push("password");
			}
			if(errors.length>0) {
				logEverything(membershipNumber, sessionIp+" failed retype password attempt", sessionUa, sessionIp, "retype password", false);
				return res.json({ errors });
			} else {
				const membershipNumber = db.prepare('SELECT membershipNumber FROM token_360 WHERE tokenNumber = ?').get(row.tokenId);
				if(membershipNumber) {
					const password=crypto.createHash('sha256').update(passwordInfo[0]).digest('hex')||'';
					db.prepare('UPDATE member_360 SET password = ? WHERE membershipNumber = ?').run(password, membershipNumber);
					logEverything("N/A", sessionIp+" successful retype password attempt", sessionUa, sessionIp, "retype password", false);
					return res.sendStatus(200);
				} else {
					errors.push("token");
					logEverything("N/A", sessionIp+" failed retype password attempt", sessionUa, sessionIp, "retype password", false);
					return res.json({errors});
				}
				
			}
		} catch (err) {
			logEverything("N/A", "Retype Password Error: "+err, sessionUa, sessionIp, "error", false);
			return res.sendStatus(500);
		}		
	}
	
	//Registering and verification
	if (req.body.registering) {
		confirmation=false;
		const checking = db.prepare('SELECT * FROM token_360 WHERE tokenNumber = ?').get(req.body.token);
		if(checking) {
			const membershipNumber=checking.membershipNumber;
			db.prepare('DELETE FROM token_360 WHERE tokenNumber = ?').run(req.body.token);
			db.prepare('UPDATE info_360 SET verified = 1 WHERE membershipNumber = ?').run(membershipNumber);
			confirmation=true;
		}
		return res.json({confirmation});
	}

	//Search members load up
	if (req.body.realMembers) {
		let realMembersPayload = [];	
		let myMembershipNumber = req.session.myMembershipNumber;
		let members = db.prepare('SELECT membershipNumber FROM member_360 WHERE membershipNumber != ? ORDER BY timestamp DESC').all(myMembershipNumber);	
		for (const row of members) {
			const info = db.prepare('SELECT username, botPic FROM info_360 WHERE membershipNumber = ?').get(row.membershipNumber);
			row.username = info.username;
			row.botPic = info.botPic;
		}
		realMembersPayload = members
		.filter(row => row.membershipNumber)
		.map(row => [row.membershipNumber, row.username, row.botPic]);
		return res.json({realMembersPayload});
	}
	//LEGACY
	/*
	if (req.body.directionLoad) {
		let directionLoad = req.body.directionLoad; 
		let myMembershipNumber = req.session.myMembershipNumber;
		let words = [];
		let sentences = [];
		let paragraphs = [];
		if(directionLoad=='words') {
			result = db.prepare(`SELECT w.word, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.trade, l.timestamp
    		FROM word_360 l JOIN words_360 w ON w.lingGroup = l.lingGroup WHERE l.membershipNumber = ? ORDER BY l.timestamp DESC, w.timestamp DESC`).all(myMembershipNumber);
			if(result) {
				words = result;
			}
			return res.json({words});
		}
		if(directionLoad=='sentences') {
			result = db.prepare(`SELECT s.sentence, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.trade, l.timestamp FROM word_360 l JOIN sentences_360 s ON s.lingGroup = l.lingGroup WHERE l.membershipNumber = ? ORDER BY l.timestamp DESC, s.timestamp DESC`).all(myMembershipNumber);
			if(result) {
				sentences = result;
			}
			return res.json({sentences});
		}
		if(directionLoad=='paragraphs') {
			result = db.prepare(`SELECT p.paragraph, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.trade, l.timestamp FROM word_360 l JOIN paragraphs_360 p ON p.lingGroup = l.lingGroup WHERE l.membershipNumber = ? ORDER BY l.timestamp DESC, p.timestamp DESC`).all(myMembershipNumber);
			if(result) {
				paragraphs = result;
			}
			return res.json({paragraphs});
		}
	}

	if (req.body.autosaveDataPackage) {
		const selectedLing = req.body.selectedLing;
		const savedChangedData = req.body.autosaveDataPackage[0];
		const myMembershipNumber = req.session.myMembershipNumber;
		const sample = stableHashRow(savedChangedData);
		let result = null;
		let sample2 = null;
		if(selectedLing=='words' && savedChangedData) {
			result = db.prepare(`SELECT w.word, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.trade, l.timestamp, l.lock 
    		FROM ling_360 l JOIN words_360 w ON w.lingGroup = l.lingGroup WHERE l.membershipNumber = ? AND l.lingId = ? ORDER BY l.timestamp DESC, w.timestamp DESC`).get(myMembershipNumber,savedChangedData.lingId);
			if(result) {
				sample2 = stableHashRow(result);
				if(sample !== sample2) {
					db.prepare('UPDATE ling_360 SET descriptions = ?,  categories = ?, crossReferences = ?, trade = ?, status = ?, lock = ?  WHERE membershipNumber = ? AND lingId = ?').run(savedChangedData.descriptions, savedChangedData.categories, savedChangedData.crossReferences, savedChangedData.trade, savedChangedData.status, savedChangedData.lock, myMembershipNumber,savedChangedData.lingId);
					return res.json(1);
				}
			}	else {
				return res.json(0);
			}
		}
		if(selectedLing=='sentences' && savedChangedData) {
			result = db.prepare(`SELECT s.sentence, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.timestamp, l.lock
    		FROM ling_360 l JOIN sentences_360 s ON s.lingGroup = l.lingGroup WHERE l.membershipNumber = ? AND l.lingId = ? ORDER BY l.timestamp DESC, s.timestamp DESC`).get(myMembershipNumber,savedChangedData.lingId);
			if(result) {
				sample2 = stableHashRow(result);
				if(sample !== sample2) {
					db.prepare('UPDATE ling_360 SET descriptions = ?,  categories = ?, crossReferences = ?, trade = ?, status = ?, lock = ?  WHERE membershipNumber = ? AND lingId = ?').run(savedChangedData.descriptions, savedChangedData.categories, savedChangedData.crossReferences, savedChangedData.trade, savedChangedData.status, savedChangedData.lock, myMembershipNumber,savedChangedData.lingId);
					return res.json(1);
				}
			} else {
				return res.json(0);
			}
		}
		if(selectedLing=='paragraphs' && savedChangedData) {
			result = db.prepare(`SELECT p.paragraph, l.lingId, l.lingGroup, l.membershipNumber, l.status, l.descriptions, l.categories, l.crossReferences, l.trade, l.timestamp, l.lock
    		FROM ling_360 l JOIN paragraphs_360 p ON p.lingGroup = l.lingGroup WHERE l.membershipNumber = ? AND l.lingId = ? ORDER BY l.timestamp DESC, p.timestamp DESC`).get(myMembershipNumber,savedChangedData.lingId);
			
			if(result) {
				sample2 = stableHashRow(result);
				if(sample !== sample2) {
					db.prepare('UPDATE ling_360 SET descriptions = ?,  categories = ?, crossReferences = ?, trade = ?, status = ?, lock = ? WHERE membershipNumber = ? AND lingId = ?').run(savedChangedData.descriptions, savedChangedData.categories, savedChangedData.crossReferences, savedChangedData.trade, savedChangedData.status, savedChangedData.lock, myMembershipNumber,savedChangedData.lingId);
					return res.json(1);
				}
			} else {
				return res.json(0);
			}
		}
		return res.json(0);
	}
	*/
	//When clicking someone in search, leads to selecting them my membership. Thats this logic
	if (req.body.whomChat) {
		if(req.body.whomChat[0]==req.body.theirMembershipNumber) {
			req.session.theirMembershipNumber = req.body.whomChat[0]+"-AI";
			req.session.aiChoice="self";
			
		} else {
			req.session.theirMembershipNumber = req.body.whomChat[0];
			req.session.aiChoice="everyone";
		}
		req.session.theirUsername = req.body.whomChat[1];
		req.session.theirBotPic = req.body.whomChat[2];
		req.session.qoraType = null;
		req.session.qora = false;
		req.session.chatGroupId = null;
		return res.sendStatus(200);
	}
	
	//Same concept as whomChat but for Q/A webpage logic
	if (req.body.qoraJoinChat) {
		req.session.theirMembershipNumber = null;
		req.session.theirUsername = null;
		req.session.theirBotPic = null;
		req.session.qoraType = req.body.qoraJoinChat[0];
		req.session.qora = true;
		req.session.initialQora = req.body.qoraJoinChat[1]
		req.session.qoraRoom = req.body.qoraJoinChat[2]
		return res.sendStatus(200);
	}
	
	//Loading Q/A
	if (req.body.loadQora) {
		const result = db.prepare('SELECT * FROM chatGroup_360 WHERE qoraType IS NOT NULL ORDER BY timestamp DESC').all();
		const qoraResult = result.map(row => {
			const firstMessage = db.prepare(`
				SELECT *
				FROM chat_360
				WHERE chatGroupId = ?
				ORDER BY timestamp ASC
				LIMIT 1
			`).get(row.chatGroupId);
			if(row.qoraType=="question") {
				firstMessage.message=firstMessage.message+"?"
			}
			const username = db.prepare(`
				SELECT *
				FROM info_360
				WHERE membershipNumber = ?
				ORDER BY timestamp ASC
				LIMIT 1
			`).get(firstMessage.membershipNumber);
			return {
				...row,
				firstMessage,
				username
			};
		});
		return res.json({qoraResult});
	}
	
	//Casting a vote in chat system
	if (req.body.castingVote) {
		if (!req.session.vote) {
			req.session.vote = [];
		}
		const checking = db.prepare('SELECT * FROM voteReportWho_360 WHERE chatid = ? AND voteWho = ? ORDER BY timestamp DESC').get(req.body.castingVote[0], req.body.castingVote[1]);
		if(checking) {
			if(req.body.castingVote[4]==="yes") {
				const downOrder = getDownVoteYes(req.body.castingVote[0]);  
				db.prepare('UPDATE chat_360 SET voteYes = ? WHERE chatId = ?').run(downOrder, req.body.castingVote[0]);
				
			} else if(req.body.castingVote[4]==="no") {
				const downOrder = getDownVoteNo(req.body.castingVote[0]);
				db.prepare('UPDATE chat_360 SET voteNo = ? WHERE chatId = ?').run(downOrder, req.body.castingVote[0]);
			}
			db.prepare('DELETE FROM voteReportWho_360 WHERE chatId = ? AND voteWho = ?').run(req.body.castingVote[0], req.body.castingVote[1]);
			const chatId = req.body.castingVote[0];
			req.session.vote=[];
		} else {
			db.prepare('INSERT INTO voteReportWho_360 (chatId, voteWho, chatGroupId, voteState) VALUES (?, ?, ?, ?)').run(req.body.castingVote[0], req.body.castingVote[1],req.body.castingVote[3], 2);
			if(req.body.castingVote[4]==="yes") {
				const nextOrder = getNextVoteNo(req.body.castingVote[0]);  
				db.prepare('UPDATE chat_360 SET voteYes = ? WHERE chatId = ?').run(nextOrder, req.body.castingVote[0]);
				req.session.vote.push([req.body.castingVote[3]]);
			} else if(req.body.castingVote[4]==="no") {
				const nextOrder = getNextVoteNo(req.body.castingVote[0]);  
				db.prepare('UPDATE chat_360 SET voteNo = ? WHERE chatId = ?').run(nextOrder, req.body.castingVote[0]);
				req.session.vote.push([req.body.castingVote[3]]);
			}
			
		}
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful vote attempt", sessionUa, sessionIp, "cast vote", false);
		return res.sendStatus(200);
	}
	
	//Checking the casted vote for refreshing page
	if (req.body.checkingVote) {
		if (!req.session.vote) {
			req.session.vote = [];
		}
		const checking = db.prepare('SELECT * FROM voteReportWho_360 WHERE chatId = ? AND voteWho = ? ORDER BY timestamp DESC').get(req.body.checkingVote[0], req.body.checkingVote[1]);
		if(checking) {
			const checking2 = db.prepare('SELECT * FROM chat_360 WHERE chatId = ? ORDER BY timestamp DESC').get(checking.chatId);
			if (checking2) { 
				return res.json([checking.chatId, checking.voteState, checking.chatId, checking2.voteYes, checking2.voteNo, checking.voteWho]);
			} else {
				return res.json(null);
			}
		} else {
			return res.json(null);
		}
	}
	
	//Checking is client is blocked
	if (req.body.blockedListCheck) {
		const checking = db.prepare('SELECT * FROM blockList_360 WHERE blockedBy = ? AND (forgiveBlocked = 0 OR forgiveBlockedBy = 0) ORDER BY timestamp DESC').all(req.session.myMembershipNumber);
		const checking2 = db.prepare('SELECT * FROM blockList_360 WHERE blocked = ? AND (forgiveBlocked = 0 OR forgiveBlockedBy = 0) ORDER BY timestamp DESC').all(req.session.myMembershipNumber);
		let membershipNumbers=[];
		for(let i = 0;i<checking.length;i++) {
			membershipNumbers.push(checking[i].blocked);
		}
		for(let i = 0;i<checking2.length;i++) {
			membershipNumbers.push(checking2[i].blockedBy);
		}
		return res.json({membershipNumbers});
	}
	
	//Blocking client logic
	if (req.body.blockWhom) {
		if(req.body.blockWhom !== req.session.myMembershipNumber) {
			db.prepare(`DELETE FROM voteReportWho_360 WHERE voteWho = ? AND chatId IN (SELECT chatId FROM chat_360 WHERE membershipNumber = ?)`).run(req.session.myMembershipNumber, req.body.blockWhom);
			db.prepare(`DELETE FROM voteReportWho_360 WHERE voteWho = ? AND chatId IN (SELECT chatId FROM chat_360 WHERE membershipNumber = ?)`).run(req.body.blockWhom, req.session.myMembershipNumber);
			db.prepare('INSERT INTO blockList_360 (blocked, blockedBy) VALUES (?, ?)').run(req.body.blockWhom, req.session.myMembershipNumber);
		}
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" successful blocking attempt", sessionUa, sessionIp, "block", false);
		return res.sendStatus(200);
	}
	
	//Marking AI response logic
	if (req.body.markUpAI) {
		//let markUpHumanCheck;
		//markUpHumanCheck = db.prepare('SELECT * FROM chat_360 WHERE chatId = ?').get(req.body.markUpAI[4]);
		const cleanMembership = req.body.markUpAI[2].replace(/-AI$/, "");
		//if(markUpHumanCheck) {
		db.prepare(`
		UPDATE chat_360
		SET markUpAi = 1
		WHERE chatId = ?`).run(req.body.markUpAI[0]);
		db.prepare(`
		UPDATE chat_360
		SET markUpAi = 1
		WHERE chatId = ?`).run(req.body.markUpAI[4]);
		/*
		const markUpCheck = db.prepare('SELECT markUpAi FROM chat_360 WHERE markUpAi=1 AND chatId = ?').get(req.body.markUpAI[0]);
		if(markUpCheck) {
			const lingMap = db.prepare('SELECT status, weight FROM word_360').all();
			let approved = 0;
			let denied = 0;
			let totalWeight = 0;
			for (let row of lingMap) {
				if (row.status === 'approved') approved++;
				if (row.status === 'denied') denied++;
				totalWeight = totalWeight + row.weight;
			}
			let total = approved + denied;
			let accuracy = (approved / total) * 100||0;
			const viouValue = db.prepare(`
			SELECT virtualiou FROM info_360
			WHERE membershipNumber = ?`).get(cleanMembership);
			const viou = viouValue.virtualiou||0;
			return res.json({ approved, denied, accuracy, totalWeight, viou, markUpAI:1 });
		}
		*/
		req.session.markUpAI = true;
		db.prepare('UPDATE chat_360 SET markUpAi = 1 WHERE chatId = ?')
		.run(req.body.markUpAI[0]);		
		const result2 = await dissectManager.dissect(req.body.markUpAI[3]);
		let words = result2.words || []
		.map(w => {
			if (!w) return null;
			if (typeof w === "string") return w.trim();
			if (typeof w.word === "string") return w.word.trim();
			return null;
		})
		let sentences = result2.sentences || []
		.map(s => {
			if (!w) return null;
			if (typeof s === "string") return s.trim();
			if (typeof s.sentence === "string") return s.sentence.trim();
			return null;
		})
		let paragraphs = result2.paragraphs || []
		.map(p => {
			if (p) return null;
			if (typeof p === "string") return p.trim();
			if (typeof p.paragraph === "string") return p.paragraph.trim();
			return null;
		})
		let wordLingGroups = [];
		for (const w of words) {
			const row = db.prepare(`
				SELECT wordId
				FROM word_360
				WHERE word = ?
			`).get(w);

			if (row) wordLingGroups.push(row.wordId);
		}

		let sentenceLingGroups = [];
		for (const s of sentences) {
			const row = db.prepare(`
				SELECT sentenceId
				FROM sentence_360
				WHERE sentence = ?
			`).get(s);

			if (row) sentenceLingGroups.push(row.sentenceId);
		}

		let paragraphLingGroups = [];
		for (const p of paragraphs) {
			const row = db.prepare(`
				SELECT paragraphId
				FROM paragraph_360
				WHERE paragraph = ?
			`).get(p);

			if (row) paragraphLingGroups.push(row.paragraphId);
		}
		//).get(`%${p}%`);
		//const clean = x => x.replace(/\s+/g, " ").trim();
		let msglingGroups = [];
		/*const cleanSoft = x => x
		.replace(/\s+/g, " ")
		.replace(/[^\w\s.,!?']/g, "")
		.trim();*/
		console.log(wordLingGroups);
		console.log(sentenceLingGroups);
		console.log(paragraphLingGroups);
		if (req.body.markUpAI[1] == "denied") {
			console.log('Smack Down');
			for (const lgs of wordLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.01
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM word_360 WHERE wordId = ?')
					.get(lgs);

				if (!result) continue;
				db.prepare(`
					UPDATE word_360
					SET weight = weight - 1
					WHERE wordId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM word_360
					WHERE wordId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'denied'
					WHERE wordId = ?
				`).run(lgs);
				} 
				if(result2.weight>0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'approved'
					WHERE wordId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'pending'
					WHERE wordId = ?
				`).run(lgs);
				}
			}
			for (const lgs of sentenceLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.025
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM sentence_360 WHERE sentenceId = ?')
					.get(lgs);
				if (!result) continue;
				db.prepare(`
					UPDATE sentence_360
					SET weight = weight - 1
					WHERE sentenceId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM sentence_360
					WHERE sentenceId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'denied'
					WHERE sentenceId = ?
				`).run(lgs);
				}
				if(result2.weight>0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'approved'
					WHERE sentenceId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'pending'
					WHERE sentenceId = ?
				`).run(lgs);
				}
			}
			for (const lgs of paragraphLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.05
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM paragraph_360 WHERE paragraphId = ?')
					.get(lgs);
				if (!result) continue;
				db.prepare(`
					UPDATE paragraph_360
					SET weight = weight - 1
					WHERE paragraphId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM paragraph_360
					WHERE paragraphId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'denied'
					WHERE paragraphId = ?
				`).run(lgs);
				}
				if(result2.weight>0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'approved'
					WHERE paragraphId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'pending'
					WHERE paragraphId = ?
				`).run(lgs);
				}
			}
		} else if (req.body.markUpAI[1] == "approved") {
			console.log('Smack up');
			for (const lgs of wordLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.01
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM word_360 WHERE wordId = ?')
					.get(lgs);
				if (!result) continue;
				db.prepare(`
					UPDATE word_360
					SET weight = weight + 1
					WHERE wordId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM word_360
					WHERE wordId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'denied'
					WHERE wordId = ?
				`).run(lgs);
				}
				if(result2.weight>0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'approved'
					WHERE wordId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE word_360
					SET status = 'pending'
					WHERE wordId = ?
				`).run(lgs);
				}
			}
			for (const lgs of sentenceLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.025
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM sentence_360 WHERE sentenceId = ?')
					.get(lgs);
				if (!result) continue;
				
				db.prepare(`
					UPDATE sentence_360
					SET weight = weight + 1
					WHERE sentenceId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM sentence_360
					WHERE sentenceId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'denied'
					WHERE sentenceId = ?
				`).run(lgs);
				}
				if(result2.weight>0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'approved'
					WHERE sentenceId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE sentence_360
					SET status = 'pending'
					WHERE sentenceId = ?
				`).run(lgs);
				}
			}
			for (const lgs of paragraphLingGroups) {
				db.prepare(`
				UPDATE info_360
				SET virtualiou = virtualiou + 0.05
				WHERE membershipNumber = ?`).run(cleanMembership);
				const result = db.prepare('SELECT status, weight FROM paragraph_360 WHERE paragraphId = ?')
					.get(lgs);
				if (!result) continue;
				db.prepare(`
					UPDATE paragraph_360
					SET weight = weight + 1
					WHERE paragraphId = ?
				`).run(lgs);
				const result2 = db.prepare(`
					SELECT weight FROM paragraph_360
					WHERE paragraphId = ?
				`).get(lgs);
				if(result2.weight<0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'denied'
					WHERE paragraphId = ?
				`).run(lgs);
				}
				if(result2.weight>0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'approved'
					WHERE paragraphId = ?
				`).run(lgs);
				}
				if(result2.weight==0) {
					db.prepare(`
					UPDATE paragraph_360
					SET status = 'pending'
					WHERE paragraphId = ?
				`).run(lgs);
				}
			}
		} else {
			console.log('Chillin');
		}
		//}
		if (req.body.markUpAI[1] == "denied") {
			db.prepare('UPDATE chat_360 SET denyAi = denyAi+1 WHERE chatId = ?')
			.run(req.body.markUpAI[0]);
		} else if (req.body.markUpAI[1] == "approved") {
			db.prepare('UPDATE chat_360 SET approveAi = approveAi+1 WHERE chatId = ?')
			.run(req.body.markUpAI[0]);
		} else if (req.body.markUpAI[1] == "none") {
			db.prepare('UPDATE chat_360 SET nothingAi = nothingAi+1 WHERE chatId = ?')
			.run(req.body.markUpAI[0]);
		}
		const wordLingMap = db.prepare('SELECT status, weight FROM word_360').all();
		const sentenceLingMap = db.prepare('SELECT status, weight FROM sentence_360').all();
		const paragraphLingMap = db.prepare('SELECT status, weight FROM paragraph_360').all();
		let approved = 0;
		let denied = 0;
		let totalWeight = 0;
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
		let accuracy = (approved / total) * 100||0;
		const viouValue = db.prepare(`
		SELECT virtualiou FROM info_360
		WHERE membershipNumber = ?`).get(cleanMembership);
		const viou = viouValue.virtualiou||0;
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful marking attempt", sessionUa, sessionIp, "mark up", false);
		return res.json({ approved, denied, accuracy, totalWeight, viou, markUpAI:1 });
	}
	
	//Access code for being able to talk to AI logic
	if (req.body.accessCode) {
		let accessCode = req.body.accessCode;
		req.session.aiAccessCode=accessCode;
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful access code attempt", sessionUa, sessionIp, "acccess code", false);
		return res.sendStatus(200);		
	}
	
	//Wipe conversations button logic
	if (req.body.WipeData) {
		let WipeData = req.body.WipeData;
		if(WipeData==req.session.myMembershipNumber) {
			deleteAllChat();
		}
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful wipe data attempt", sessionUa, sessionIp, "admin", true);
		return res.sendStatus(200);		
	}
	
	//Logout logic
	if (req.body.logout) {
		const sessionId = req.signedCookies.session_360;
		if (sessionId) {
			db.prepare(`DELETE FROM session_360 WHERE sessionId = ?`).run(sessionId);
		}
		res.clearCookie("session_360");
		const sessionUa = req.headers['user-agent'];
		const sessionIp =
		req.headers['x-forwarded-for'] ||
		req.connection.remoteAddress ||
		req.socket.remoteAddress ||
		req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful logout attempt", sessionUa, sessionIp, "mark up", true);
		return res.sendStatus(200);
	}
	
	//Admin loading up specific parts
	if (req.body.admin) {
		const choice = req.body.admin;
		if(choice=="chats") {
			const rows = db.prepare(`SELECT DISTINCT chatGroupId FROM chatGroup_360`).all();
			const data = rows.map(r => r.chatGroupId);
			return res.json({ data });
		}
		if(choice=="votes/reports") {
			const rows = db.prepare(`SELECT DISTINCT voteReportWhoId FROM voteReportWho_360`).all();
			const data = rows.map(r => r.voteReportWhoId);
			return res.json({ data });
		}
		if(choice=="tokens") {
			const rows = db.prepare(`SELECT DISTINCT tokenId FROM token_360`).all();
			const data = rows.map(r => r.tokenId);
			return res.json({ data });
		}
		if(choice=="sessions") {
			const rows = db.prepare(`SELECT DISTINCT id FROM session_360`).all();
			const data = rows.map(r => r.id);
			return res.json({ data });
		}
		const sessionUa = req.headers['user-agent'];
		const sessionIp = req.ip;
		logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" succcessful admin + attempt", sessionUa, sessionIp, "admin", true);
		return res.sendStatus(200);
	}
});

//Upping the vote for yes
function getNextVoteYes(chatId) {
    const row = db.prepare(`
        SELECT COALESCE(MAX(voteYes), 0) AS maxOrder
        FROM chat_360
        WHERE chatId = ?
    `).get(chatId);
    return row.maxOrder + 1;
}

//Upping the vote for no
function getNextVoteNo(chatId) {
    const row = db.prepare(`
        SELECT COALESCE(MAX(voteNo), 0) AS maxOrder
        FROM chat_360
        WHERE chatId = ?
    `).get(chatId);
    return row.maxOrder + 1;
}

//Downing the vote for no
function getDownVoteNo(chatId) {
    const row = db.prepare(`
        SELECT COALESCE(MAX(voteNo), 0) AS maxOrder
        FROM chat_360
        WHERE chatId = ?
    `).get(chatId);
    if(row.maxOrder) {
    	return row.maxOrder - 1;
	} else {
		return row.maxOrder;
	}
}

//Downing the vote for yes
function getDownVoteYes(chatId) {
    const row = db.prepare(`
        SELECT COALESCE(MAX(voteYes), 0) AS maxOrder
        FROM chat_360
        WHERE chatId = ?
    `).get(chatId);
	if(row.maxOrder) {
    	return row.maxOrder - 1;
	} else {
		return row.maxOrder;
	}
}

module.exports = router;
