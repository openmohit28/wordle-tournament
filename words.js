const fs = require('fs');
const path = require('path');

function extractArray(src, key) {
  const start = src.indexOf(`"${key}"`);
  if (start === -1) return [];
  const arrStart = src.indexOf('[', start);
  const arrEnd = src.indexOf(']', arrStart);
  const content = src.slice(arrStart + 1, arrEnd);
  return content.match(/"([a-z]+)"/g)?.map(w => w.replace(/"/g, '').toUpperCase()) ?? [];
}

const src = fs.readFileSync(path.join(__dirname, 'word_list.js'), 'utf8');

// Answer pool — common recognizable words, used as the round target
const ANSWER_WORDS = extractArray(src, 'words');

// Full valid guess list — answers + extended valid words
const VALID_WORDS = [...new Set([...ANSWER_WORDS, ...extractArray(src, 'valid')])];

function getRandomWord(used = []) {
  const available = ANSWER_WORDS.filter(w => !used.includes(w));
  const pool = available.length > 0 ? available : ANSWER_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function checkGuess(guess, answer) {
  const result = new Array(5).fill('absent');
  const ansArr = answer.split('');
  const guessArr = guess.split('');
  const ansUsed = new Array(5).fill(false);
  const guessUsed = new Array(5).fill(false);

  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === ansArr[i]) {
      result[i] = 'correct';
      ansUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < 5; j++) {
      if (!ansUsed[j] && guessArr[i] === ansArr[j]) {
        result[i] = 'present';
        ansUsed[j] = true;
        break;
      }
    }
  }

  return result;
}

function isValidWord(word) {
  return VALID_WORDS.includes(word.toUpperCase());
}

module.exports = { getRandomWord, checkGuess, isValidWord, VALID_WORDS };
