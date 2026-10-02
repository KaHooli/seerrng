import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import WikidataVideoMetadataAPI from '@server/api/wikidata/videoMetadata';

describe('WikidataVideoMetadataAPI external-ID search', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('returns plain-text snippet labels that cannot reassemble markup', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      query: {
        search: [
          {
            title: 'Q1',
            snippet: '<span class="searchmatch">Film</span> (2001)',
          },
          { title: 'Q2', snippet: '<<b>script>alert(1)<</b>/script>' },
          { title: 'Q3', snippet: '<b></b>' },
          { title: 'not-an-item', snippet: 'ignored' },
        ],
      },
    }));

    const result = await new WikidataVideoMetadataAPI().searchItemsByExternalId(
      { propertyId: 'P4947', value: '123' }
    );

    assert.deepStrictEqual(
      result.map(({ id }) => id),
      ['Q1', 'Q2', 'Q3']
    );
    assert.strictEqual(result[0].label, 'Film (2001)');
    for (const { label } of result) {
      assert.doesNotMatch(label, /[<>]/);
    }
    assert.strictEqual(result[2].label, 'Q3');
  });
});
