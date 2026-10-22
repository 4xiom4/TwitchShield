import test from 'node:test';
import assert from 'node:assert/strict';
import { GQLManager, FALLBACK_PLAYBACK_ACCESS_TOKEN_HASH } from '../src/gql/dynamic-hash.ts';

test('GQLManager defaults to known fallback hash', () => {
  const gql = GQLManager.getInstance();
  assert.equal(gql.getPlaybackAccessTokenHash(), FALLBACK_PLAYBACK_ACCESS_TOKEN_HASH);
});

test('GQLManager inspects fetch requests and extracts new sha256 hash', () => {
  const gql = GQLManager.getInstance();
  const newHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  const fakeBody = JSON.stringify({
    operationName: 'PlaybackAccessToken',
    variables: { isLive: true, login: 'streamer' },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: newHash
      }
    }
  });

  gql.inspectFetchRequest('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: fakeBody,
    headers: {
      'Client-Integrity': 'test-integrity-token',
      'Client-Version': 'v1.2.3',
      'X-Device-Id': 'device-abc-123'
    }
  });

  assert.equal(gql.getPlaybackAccessTokenHash(), newHash);
  const headers = gql.getHeaders('kimne78kx3ncx6brgo4mv6wki5h1ko');
  assert.equal(headers['Client-Integrity'], 'test-integrity-token');
  assert.equal(headers['Client-Version'], 'v1.2.3');
  assert.equal(headers['X-Device-Id'], 'device-abc-123');
});
