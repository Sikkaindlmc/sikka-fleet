const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const connectDB = require('../config/db');

async function testAllQueries() {
  await connectDB();
  const { processUserQuery } = require('../services/sikkaAiService');

  const queries = [
    'Aaj UP14GT0300 kahan hai?',
    '29 September ko UP14GT0300 kahan tha?',
    '29 September ko 11:30 AM par UP14GT0300 ki location kya thi?',
    'Kal 3 PM par Rajesh driver kahan tha?',
    'UP14GT0300 Tea Plant mein kitne hours raha?',
    '29 September ko UP14GT0300 Tea Plant mein kitne hours raha?',
    '25 September se 30 September tak vehicle ka movement batao.',
    'Kaun-kaun se vehicles aaj Tea Plant mein available the?',
    'Vehicle aur driver ki location 29 September ko 2 PM par batao.',
    'UP14GT0300 ka GPS sync karo.',
    'Aaj 10:30 AM par UP14GT0300 kahan tha?',
    'Tea Plant radius 500 meter se 1000 meter kar do',
    'UP14GT0300 ka old GPS record delete karo',
    '15 August 2026 ko UP14GT0300 kahan tha?', // Test "No record" scenario
  ];

  const dummyUser = { fullName: 'Fleet Operator', role: 'User' };

  for (const q of queries) {
    console.log(`\n========================================`);
    console.log(`🔍 QUERY: "${q}"`);
    console.log(`========================================`);
    try {
      const res = await processUserQuery({ query: q, user: dummyUser });
      console.log(`Type: ${res.type}`);
      console.log(`Classification: ${res.classification || res.rule || 'N/A'}`);
      console.log(`Reply:\n${res.reply}`);
    } catch (e) {
      console.error(`ERROR:`, e);
    }
  }

  await mongoose.disconnect();
}

testAllQueries().catch(console.error);
