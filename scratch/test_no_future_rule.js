const path = require('path');
const mongoose = require(path.join(__dirname, '../backend/node_modules/mongoose'));
const { processUserQuery, parseQueryDateTimeRange } = require(path.join(__dirname, '../backend/services/sikkaAiService'));

async function test() {
  console.log('--- TEST 1: Date & Time Parsing for Tomorrow ---');
  const p1 = parseQueryDateTimeRange('Where will vehicle UP14GT0300 be at 10:00 AM tomorrow?');
  console.log('Result 1:', {
    hasDate: p1.hasDate,
    isTomorrow: p1.isTomorrow,
    isFuture: p1.isFuture,
    hasTime: p1.hasTime,
    timeStr: p1.timeStr,
    dateStr: p1.dateStr,
  });

  console.log('\n--- TEST 2: Process User Query for Tomorrow ---');
  const connectDB = require(path.join(__dirname, '../backend/config/db'));
  await connectDB();
  
  const Vehicle = mongoose.model('Vehicle');
  const vList = await Vehicle.find({ status: 'Active' });
  console.log('Active vehicles in DB:', vList.map(v => v.vehicleNumber));

  const testV = vList.find(v => v.vehicleNumber === 'UP14GT0300')?.vehicleNumber || vList[0]?.vehicleNumber || 'UP14HT0600';
  console.log('Testing with vehicle:', testV);

  const res1 = await processUserQuery({
    query: `Where will vehicle ${testV} be at 10:00 AM tomorrow?`,
    user: { fullName: 'Test User' },
  });
  console.log(`Query: "Where will vehicle ${testV} be at 10:00 AM tomorrow?"`);
  console.log('Reply:\n' + res1.reply);
  console.log('Type:', res1.type);

  console.log('\n--- TEST 3: Past Date Missing Record ---');
  const res2 = await processUserQuery({
    query: `Where was ${testV} on 02-Oct-2026?`,
    user: { fullName: 'Test User' },
  });
  console.log(`Query: "Where was ${testV} on 02-Oct-2026?"`);
  console.log('Reply:\n' + res2.reply);

  console.log('\n--- TEST 4: Missing GPS Interval on Past Date ---');
  const res3 = await processUserQuery({
    query: `05-Oct-2026 ko 02:00 AM par ${testV} kahan tha?`,
    user: { fullName: 'Test User' },
  });
  console.log(`Query: "05-Oct-2026 ko 02:00 AM par ${testV} kahan tha?"`);
  console.log('Reply:\n' + res3.reply);

  console.log('\n--- TEST 4B: Specific Point-in-Time Missing Interval (02:00 PM) ---');
  const res3b = await processUserQuery({
    query: 'UP14GT0300 location on date 05-10-2026 time 02:00 PM',
    user: { fullName: 'Test User' },
  });
  console.log('Query: "UP14GT0300 location on date 05-10-2026 time 02:00 PM"');
  console.log('Reply:\n' + res3b.reply);

  console.log('\n--- TEST 5: Actual Historical Data (05-Oct-2026) ---');
  const res4 = await processUserQuery({
    query: `Where was ${testV} on 05-Oct-2026 between 10 AM and 4 PM?`,
    user: { fullName: 'Test User' },
  });
  console.log(`Query: "Where was ${testV} on 05-Oct-2026 between 10 AM and 4 PM?"`);
  console.log('Reply snippet:\n' + res4.reply.substring(0, 300) + '...');

  console.log('\n--- TEST 6: Future Driver Query ---');
  const res5 = await processUserQuery({
    query: 'Where will Driver Ramesh be tomorrow at 11 AM?',
    user: { fullName: 'Test User' },
  });
  console.log('Query: "Where will Driver Ramesh be tomorrow at 11 AM?"');
  console.log('Reply:\n' + res5.reply);

  await mongoose.disconnect();
}

test().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
