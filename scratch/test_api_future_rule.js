const path = require('path');
const axios = require(path.join(__dirname, '../backend/node_modules/axios'));

async function testApi() {
  // Login first to get JWT
  const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
    username: 'ajaysomra',
    password: 'Somra@2012',
  });
  const token = loginRes.data.token;
  console.log('✅ Logged in as:', loginRes.data.user.fullName);

  const testQueries = [
    'Where will vehicle UP14GT0300 be at 10:00 AM tomorrow?',
    'Where was UP14GT0300 on 02-Oct-2026?',
    'Where will Driver Ramesh be tomorrow at 11 AM?',
    'UP14GT0300 location on date 05-10-2026 time 02:10 PM',
  ];

  for (const q of testQueries) {
    console.log(`\n===========================================`);
    console.log(`QUERY: "${q}"`);
    const res = await axios.post(
      'http://localhost:5000/api/sikka-ai/query',
      { query: q },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`TYPE: ${res.data.type}`);
    console.log(`REPLY:\n${res.data.reply}`);
  }
}

testApi().catch((err) => {
  console.error('API Error:', err.response?.data || err.message);
  process.exit(1);
});
