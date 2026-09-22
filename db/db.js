const path = require('path');
const Database = require('better-sqlite3');
const __dir = path.resolve(process.cwd(), 'db');
const dbPath = path.join(__dir, 'system_360.sqlite');
const crypto = require('crypto');
const db = new Database(dbPath);
//db.pragma('journal_mode = WAL');
//db.pragma('busy_timeout = 2000');

//Random alphanumeric generator
function generateRandomString(length) {
  return crypto.randomBytes(length)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, length);
}

//createSystem function for database schedma generating
function createSystem() {
	const tableStatements = [
    `CREATE TABLE IF NOT EXISTS member_360 (
      memberId INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT CHECK(length(email) <= 100),
      password TEXT CHECK(length(password) <= 64),
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS info_360 (
      infoId INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT CHECK(length(username) <= 20),
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      recruiterNumber TEXT CHECK(length(recruiterNumber) <= 19),
      status TEXT CHECK(length(status) <= 8),
      verified INTEGER DEFAULT 0,
      botPic INTEGER DEFAULT 0,
      virtualiou INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS token_360 (
      tokenId INTEGER PRIMARY KEY AUTOINCREMENT,
      tokenNumber TEXT CHECK(length(tokenNumber) <= 64),
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      tokenReason TEXT CHECK(length(tokenReason) <= 50),
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    /*
    `CREATE TABLE IF NOT EXISTS chat_360 (
      chatId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      message TEXT,
      messageOrder INTEGER DEFAULT NULL,
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      markUpAi BOOLEAN DEFAULT FALSE,
      rememberAi INTEGER DEFAULT NULL,
      voteYes INTEGER DEFAULT 0,
      voteNo INTEGER DEFAULT 0,
      report INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now'))
    );`,
    */
    
    `CREATE TABLE IF NOT EXISTS chat_360 (
      chatId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      message TEXT,
      messageOrder INTEGER DEFAULT 0,
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      markUpAi INTEGER NOT NULL DEFAULT 0,
      rememberAi INTEGER DEFAULT 0,
      approveAi INTEGER DEFAULT 0,
      denyAi INTEGER DEFAULT 0,
      nothingAi INTEGER DEFAULT 0,
      voteYes INTEGER DEFAULT 0,
      voteNo INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    

    `CREATE TABLE IF NOT EXISTS chatGroup_360 (
      groupId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      unread INTEGER NOT NULL DEFAULT 1,
      qoraType INTEGER DEFAULT NULL,
      qoraStatus TEXT DEFAULT NULL,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS word_360 (
      wordId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      weight FLOAT DEFAULT 0,
      crossReferences TEXT,
      word TEXT,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS sentence_360 (
      sentenceId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      weight FLOAT DEFAULT 0,
      crossReferences TEXT,
      sentence TEXT,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS paragraph_360 (
      paragraphId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      weight FLOAT DEFAULT 0,
      crossReferences TEXT,
      paragraph TEXT,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    /*
    `CREATE TABLE IF NOT EXISTS words_360 (
      wordId INTEGER PRIMARY KEY AUTOINCREMENT,
      lingGroup TEXT CHECK(length(lingGroup) <= 16),
      word TEXT,
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      descriptions TEXT,
      categories TEXT,
      crossReferences TEXT,
      adminFlag BOOLEAN NOT NULL DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now'))
    );`,
    

    `CREATE TABLE IF NOT EXISTS sentences_360 (
      sentenceId INTEGER PRIMARY KEY AUTOINCREMENT,
      lingGroup TEXT CHECK(length(lingGroup) <= 16),
      sentence TEXT,
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      descriptions TEXT,
      categories TEXT,
      crossReferences TEXT,
      adminFlag BOOLEAN NOT NULL DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now'))
    );`,

    `CREATE TABLE IF NOT EXISTS paragraphs_360 (
      paragraphId INTEGER PRIMARY KEY AUTOINCREMENT,
      lingGroup TEXT CHECK(length(lingGroup) <= 16),
      paragraph TEXT,
      status TEXT CHECK(length(status) <= 8) DEFAULT 'pending',
      descriptions TEXT,
      categories TEXT,
      crossReferences TEXT,
      adminFlag BOOLEAN NOT NULL DEFAULT 0,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now'))
    );`,
    */
	`CREATE TABLE IF NOT EXISTS session_360 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT,
      userAgentInfo TEXT,
      ipAddressInfo TEXT,
      expirationTimeInfo INTEGER,
      membershipNumber TEXT CHECK(length(membershipNumber) <= 19),
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    `CREATE TABLE IF NOT EXISTS voteReportWho_360 (
      voteReportWhoId INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      chatGroupId TEXT CHECK(length(chatGroupId) <= 16),
      voteWho TEXT CHECK(length(voteWho) <= 16),
      voteState INTEGER,
      reported TEXT CHECK(length(reported) <= 16),
      reportWho TEXT CHECK(length(reportWho) <= 16),
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    `CREATE TABLE IF NOT EXISTS blockList_360 (
      blockListId INTEGER PRIMARY KEY AUTOINCREMENT,
      blocked TEXT CHECK(length(blocked) <= 16),
      blockedBy TEXT CHECK(length(blockedBy) <= 16),
      forgiveBlocked INTEGER DEFAULT 0,
      forgiveBlockedBy INTEGER DEFAULT 0,
      blockedTime INTEGER DEFAULT 0,
      blockType TEXT,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`,
    `CREATE TABLE IF NOT EXISTS logs_360 (
      logsId INTEGER PRIMARY KEY AUTOINCREMENT,
      userAgentInfo TEXT,
      ipAddressInfo TEXT,
      whom TEXT CHECK(length(whom) <= 19),
      content TEXT,
      logType TEXT,
      timestamp TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'now')),
      timestampMs INTEGER DEFAULT (strftime('%s','now') * 1000)
    );`
  ];
  for (const sql of tableStatements) {
    db.prepare(sql).run();
  }
}

//Used for deleting all chats, chatGroups, words, sentences, and paragraphs
function deleteAllChat() {
  const tables = [
    "chat_360",
    "chatGroup_360"
  ];

  for (const table of tables) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare('UPDATE word_360 SET weight = 0, status="pending"').run();
  db.prepare('UPDATE sentence_360 SET weight = 0, status="pending"').run();
  db.prepare('UPDATE paragraph_360 SET weight = 0, status="pending"').run();
}

module.exports = { db, createSystem, deleteAllChat };
