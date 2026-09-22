//Created By Tyrone Pelletier
const __dir = process.cwd();
const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const requestProcessing = require('./routes/requestProcessing.js');
const crypto = require('crypto');
const { initWebSocket } = require('./sockets/webSocketLogic.js');
const cookieParser = require("cookie-parser");
require('dotenv').config();
//const SECRET = process.env.SECRET;
const http = require("http");
const server = http.createServer(app);
const { db, createSystem, deleteAllChat } = require('./db/db.js')
const sessionMiddleware = session({
	secret: process.env.SECRET,
	resave: false,
	saveUninitialized: false
});

//Admin logging everything
function logEverything(whom, content,  logType, choice, req ) {
	const sessionUa = req.headers['user-agent'];
	const sessionIp =
	req.headers['x-forwarded-for'] ||
	req.connection.remoteAddress ||
	req.socket.remoteAddress ||
	req.ip;
	if(choice) {
	  db.prepare(`
		INSERT INTO logs_360 (userAgentInfo, ipAddressInfo, whom, content, logType)
		VALUES (?, ?, ?, ?, ?)
	  `).run(sessionUa, sessionIp, whom, content, logType);
	}
	const { emitToRoom } = require("./sockets/webSocketLogic.js");
	emitToRoom("Admin", "loginEntry", {
	  whom: whom,
	  content: content,
	  ua: sessionUa,
	  ip: sessionIp,
	  logType: logType,
	  timestamp: Date.now()
	});
}

//This logic checks cookie, session and redirects if incorrect
function cookieSessionValidator(req, webPage) {
	const sessionIp =
	req.headers['x-forwarded-for'] ||
	req.connection.remoteAddress ||
	req.socket.remoteAddress ||
	req.ip;
	const raw = req.signedCookies.session_360;
	if (!raw) {
		if(webPage=="membership") {
			logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" connect "+webPage+" attempt", "direction", false, req);
		} else {
			logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" redirect "+webPage+" attempt", "direction", false, req);
		}
		return false;
	}
	const sessionId = raw;
	const confirmationCheck = db.prepare(
	'SELECT membershipNumber FROM session_360 WHERE sessionId = ?'
	).get(sessionId);
	if (!confirmationCheck) {
		if(webPage=="membership") {
			logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" connect "+webPage+" attempt", "direction", false, req);
		} else {
			logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" redirect "+webPage+" attempt", "direction", false, req);
		}
		return false;
	}
	const checking = db.prepare(
	  'SELECT username, botPic, recruiterNumber FROM info_360 WHERE membershipNumber = ?'
	).get(confirmationCheck.membershipNumber);
	const checking2 = db.prepare(
	  'SELECT email FROM member_360 WHERE membershipNumber = ?'
	).get(confirmationCheck.membershipNumber);
	req.session.myMembershipNumber = confirmationCheck.membershipNumber;
	req.session.myUsername = checking.username;
	req.session.myBotPic = checking.botPic;
	req.session.myEmail = checking2.email;
	req.session.myRecruiter=checking.recruiterNumber;
	if(webPage=="membership") {
		webPage="profile";
	}
	logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" connect "+webPage+" attempt", "direction", false, req);
	return true;
}

//App use cookie parser
app.use(cookieParser(process.env.SECRET));

//App use session middleware
app.use(sessionMiddleware);

//Server binded to 0.0.0.0 open on port 3000
server.listen(3000, "0.0.0.0", () => {
	initWebSocket(server, sessionMiddleware); 
});

//Creates database
createSystem();

//Setting file view for ejs in views, public, and bots
app.set('views', path.join(__dir, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dir, 'public')));
app.use('/bots', express.static(path.join(__dir, 'public/images/bots')));

//Index loading
app.get('/', (req, res) => {
	const sessionIp =
	req.headers['x-forwarded-for'] ||
	req.connection.remoteAddress ||
	req.socket.remoteAddress ||
	req.ip;
	logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" connect index attempt", "direction", false, req);
    res.render('index');
});

//Allows of json post requests
app.use(express.json());

app.use(express.urlencoded({ extended: true }));

//The backend logic for all routing
app.use('/requestProcessing', requestProcessing);

//The membership webpage
app.get('/membership', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"membership")
	if(check) {
		res.render('profile', {
			myEmail: req.session.myEmail,
			myUsername: req.session.myUsername,
			myMembershipNumber: req.session.myMembershipNumber,
			myBotPic: req.session.myBotPic,
			theirUsername: req.session.myUsername,
			theirMembershipNumber: req.session.myMembershipNumber,
			theirBotPic: req.session.myBotPic,
			myRecruiter: req.session.myRecruiter
		});		
	} else {
		res.render('membership', {token:token});
	}
});

//The reset password webpage
app.get('/resetpassword', (req, res) => {
	const token = req.query.token;
	if(!token || token==="N/A" || token.trim() === "") {
		logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" redirect reset password attempt", "direction", false, req);
		return res.redirect('/');
	} else {
		logEverything(req.session.myMembershipNumber||sessionIp, req.session.myMembershipNumber||sessionIp+" connect reset password attempt", "direction", false, req);
		res.render('resetpassword', {token});
}
});

/*
//These are email templates
app.get('/template', (req, res) => {
	const raw = req.signedCookies.mySession;
	const session = raw;
	const username = req.session.username || "N/A";
	const membershipNumber = req.session.myMembershipNumber || "N/A";
	const recruiterNumber = req.session.recruiterNumber || "N/A";
	const token = req.session.token || "N/A";
	res.render('../experiments/template', { username, membershipNumber, recruiterNumber, token });
});

//These are email templates
app.get('/template2', (req, res) => {
	const raw = req.signedCookies.mySession;
	const session = raw;
	const username = req.session.username || "N/A";
	const membershipNumber = req.session.myMembershipNumber || "N/A";
	const token = req.session.token || "N/A";
	res.render('../experiments/template2', { username, membershipNumber, token });
});
*/

//The profile webpage
app.get('/profile', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"profile")
	if(check) {
		res.render('profile', {
			myEmail: req.session.myEmail,
			myUsername: req.session.myUsername,
			myMembershipNumber: req.session.myMembershipNumber,
			myBotPic: req.session.myBotPic,
			theirUsername: req.session.myUsername,
			theirMembershipNumber: req.session.myMembershipNumber,
			theirBotPic: req.session.myBotPic,
			myRecruiter:req.session.myRecruiter
		});		
	} else {
		return res.redirect('/');
	}
});

//The search webpage
app.get('/search', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"search")
	if(check) {
		res.render('search',{myEmail: req.session.myEmail, myUsername:req.session.myUsername,myMembershipNumber:req.session.myMembershipNumber,myBotPic:req.session.myBotPic, aiChoice:req.session.aiChoice});	
	} else {
		return res.redirect('/');
	}
});

//The chat webpage
app.get('/chat', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"chat")
	if(check) {
		res.render('chat', {myEmail: req.session.myEmail, username: req.session.theirUsername, membership:req.session.theirMembershipNumber, botPic:req.session.theirBotPic, myUsername:req.session.myUsername,myMembershipNumber:req.session.myMembershipNumber,myBotPic:req.session.myBotPic, qora:req.session.qora, qoraType:req.session.qoraType, initialQora: req.session.initialQora, vote: req.session.vote, markUpAI: req.session.markUpAI, aiAccessCode:req.session.aiAccessCode, aiChoice:req.session.aiChoice, myRecruiter:req.session.myRecruiter });
	} else {
		return res.redirect('/');
	}
});

//The question portion of Q/A webpage
app.get('/question', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"question")
	if(check) {
		res.render('chat', {myEmail: req.session.myEmail, username: req.session.theirUsername, membership:req.session.theirMembershipNumber, botPic:req.session.theirBotPic, myUsername:req.session.myUsername,myMembershipNumber:req.session.myMembershipNumber,myBotPic:req.session.myBotPic, qora:req.session.qora, qoraType:req.session.qoraType, initialQora: req.session.initialQora, vote: req.session.vote, markUpAI: req.session.markUpAI, aiAccessCode:req.session.aiAccessCode, aiChoice:req.session.aiChoice, myRecruiter:req.session.myRecruiter});
	} else {
		return res.redirect('/');
	}
});

//The answer portion of Q/A webpage
app.get('/answer', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"answer")
	if(check) {
		res.render('chat', {myEmail: req.session.myEmail, username: req.session.theirUsername, membership:req.session.theirMembershipNumber, botPic:req.session.theirBotPic, myUsername:req.session.myUsername,myMembershipNumber:req.session.myMembershipNumber,myBotPic:req.session.myBotPic, qora:req.session.qora, qoraType:req.session.qoraType, initialQora: req.session.initialQora, vote: req.session.vote, markUpAI: req.session.markUpAI, aiAccessCode:req.session.aiAccessCode, aiChoice:req.session.aiChoice, myRecruiter:req.session.myRecruiter});
	} else {
		return res.redirect('/');
	}
});

//The Q/A webpage
app.get('/questionoranswer', (req, res) => {
	const token = req.query.token;
	const check = cookieSessionValidator(req,"questionoranswer")
	if(check) {
		res.render('questionoranswer');
	} else {
		return res.redirect('/');
	}
});

//The terms & conditions webpage
app.get('/termsandconditions', (req, res) => {
	logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" connect termsandconditions attempt", "direction", false, req);
	res.render('termsandconditions');
});

//The privacy policy webpage
app.get('/privacypolicy', (req, res) => {
	logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" connect privacypolicy attempt", "direction", false, req);
	res.render('privacypolicy');
});

//The options webpage
app.get('/options', (req, res) => {
	logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" connect options attempt", "direction", false, req);
	res.render('options');
});

//The admin webpage
app.get('/admin', (req, res) => {
	const check = cookieSessionValidator(req,"admin")
	const myRecruiter = req.session.myRecruiter;
	logEverything(req.session.myMembershipNumber, req.session.myMembershipNumber+" connect admin attempt", "direction", false, req);
	if(myRecruiter=="Owner") {
		res.render('admin');
	} else {
		return res.redirect('/');
	}
});

//Loading of CSS stylesheets
app.get('/my_termsandconditions_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_termsandconditions_style.css');
	res.sendFile(cssPath);
});

app.get('/my_privacypolicy_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_privacypolicy_style.css');
	res.sendFile(cssPath);
});

app.get('/my_options_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_options_style.css');
	res.sendFile(cssPath);
});

app.get('/my_admin_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_admin_style.css');
	res.sendFile(cssPath);
});

app.get('/my_index_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_index_style.css');
	res.sendFile(cssPath);
});

app.get('/my_membership_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_membership_style.css');
	res.sendFile(cssPath);
});

app.get('/my_resetpassword_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_resetpassword_style.css');
	res.sendFile(cssPath);
});

app.get('/my_profile_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_profile_style.css');
	res.sendFile(cssPath);
});

app.get('/my_search_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_search_style.css');
	res.sendFile(cssPath);
});

app.get('/my_chat_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_chat_style.css');
	res.sendFile(cssPath);
});

app.get('/my_qora_style', (req, res) => {
	const cssPath = path.join(__dir, './public/stylesheets/my_qora_style.css');
	res.sendFile(cssPath);
});

//Loading of imagery
app.get('/banner', (req, res) => {
	const imgPath = path.join(__dir, './public/images/banner.jpg');
	res.sendFile(imgPath);
});

app.get('/bannerSmall', (req, res) => {
	const imgPath = path.join(__dir, './public/images/bannerSmall.jpg');
	res.sendFile(imgPath);
});

app.get('/favicon.ico', (req, res) => {
	const imgPath = path.join(__dir, './public/images/favicon.png');
	res.sendFile(imgPath);
});

app.get('/chatDots', (req, res) => {
	const imgPath = path.join(__dir, './public/images/chatDots.gif');
	res.sendFile(imgPath);
});

app.get('/right', (req, res) => {
	const imgPath = path.join(__dir, './public/images/right.jpg');
	res.sendFile(imgPath);
});

app.get('/wrong', (req, res) => {
	const imgPath = path.join(__dir, './public/images/wrong.jpg');
	res.sendFile(imgPath);
});

app.get('/none', (req, res) => {
	const imgPath = path.join(__dir, './public/images/none.jpg');
	res.sendFile(imgPath);
});

app.get('/up', (req, res) => {
	const imgPath = path.join(__dir, './public/images/up.jpg');
	res.sendFile(imgPath);
});

app.get('/down', (req, res) => {
	const imgPath = path.join(__dir, './public/images/down.jpg');
	res.sendFile(imgPath);
});

app.get('/origin', (req, res) => {
	const imgPath = path.join(__dir, './public/images/origin.png');
	res.sendFile(imgPath);
});
