const { parentPort } = require('worker_threads');

const WORD = /[^\s]+/g;
const SENTENCE = /[^.!?;]+(?:[.!?;]+|$)/g;

function normalizeText(text) {
  if (/[A-Za-z0-9]$/.test(text)) {
    //text += '.';
  }

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .trimEnd();
}


function seperateWords(text) {
  return text.match(WORD) || [];
}

function seperateSentences(text) {
  return text.match(SENTENCE) || [];
}

function seperateParagraphs(text) {
  return text.split(/\r?\n\r?\n+|(?<=\S)\r?\n(?=\S)/);
}

parentPort.on("message", (payload) => {
  const { id, text } = payload;
  //console.log(text);
  const clean = normalizeText(text);
  //console.log(clean);
  const words = seperateWords(clean).map(s => s.trim()).filter(s => s.length > 0);
  //console.log(words);
  const sentences = seperateSentences(clean).map(s => s.trim()).filter(s => s.length > 0);
  //console.log(sentences);
  const paragraphs = clean.match(/[^\n]+/g).map(s => s.trim()).filter(s => s.length > 0);
  //console.log(paragraphs);
  parentPort.postMessage({
    id,
    paragraphs,
    sentences,
    words
  });
});
