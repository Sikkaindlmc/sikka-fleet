const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { verifyCronSecret } = require('../middleware/verifyCronSecret');

function getStatus(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/scheduled',
      method: 'GET',
      headers,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

test('scheduled GPS endpoint guard requires CRON_SECRET and accepts a matching header', async () => {
  const originalSecret = process.env.CRON_SECRET;
  const app = express();
  app.get('/scheduled', verifyCronSecret, (req, res) => res.status(204).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const port = server.address().port;
    process.env.CRON_SECRET = '';
    assert.equal(await getStatus(port), 500);

    process.env.CRON_SECRET = randomBytes(32).toString('hex');
    assert.equal(await getStatus(port), 401);
    assert.equal(await getStatus(port, { 'x-cron-secret': process.env.CRON_SECRET }), 204);
  } finally {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
