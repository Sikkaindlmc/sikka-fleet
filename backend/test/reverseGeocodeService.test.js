const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNominatimAddress, getCoordinateKey } = require('../services/reverseGeocodeService');
const { getReadableLocation, isReadableProviderAddress } = require('../services/locationHelper');

test('Nominatim results are reduced to locality, district, and state', () => {
  assert.equal(
    formatNominatimAddress({
      village: 'Example Village',
      state_district: 'Example District',
      state: 'Uttar Pradesh',
      country: 'India',
    }),
    'Example Village, Example District, Uttar Pradesh'
  );
  assert.equal(formatNominatimAddress({}), '');
});

test('reverse-geocode cache keys round coordinates to four decimal places', () => {
  assert.equal(getCoordinateKey(28.123456, 77.987654), '28.1235,77.9877');
});

test('unreadable coordinate strings are rejected and fallback locations never expose coordinates', () => {
  assert.equal(isReadableProviderAddress('En Route (28.2024, 78.2598)'), false);
  assert.equal(isReadableProviderAddress('Hapur, Uttar Pradesh'), true);
  assert.equal(getReadableLocation(28.2024, 78.2598), 'Location unavailable');
  assert.match(
    getReadableLocation(28.5, 77.2, [{
      plantName: 'Salt Plant',
      latitude: 28.4,
      longitude: 77.2,
      radiusMeters: 100,
    }]),
    /^About \d+\.\d km from Salt Plant$/
  );
});
