// Test URLs organized by domain for predictable sorting
export const URLS = {
  // example.com domain
  EXAMPLE_A: 'https://example.com/aaa',
  EXAMPLE_B: 'https://example.com/bbb',
  EXAMPLE_C: 'https://example.com/ccc',

  // test.org domain
  TEST_A: 'https://test.org/aaa',
  TEST_B: 'https://test.org/bbb',

  // github.com domain
  GITHUB_A: 'https://github.com/aaa',
  GITHUB_B: 'https://github.com/bbb',

  // mozilla.org domain
  MOZILLA_A: 'https://mozilla.org/aaa',
  MOZILLA_B: 'https://mozilla.org/bbb',

  // example.org domain (avoid wikipedia.org which redirects to en.wikipedia.org)
  WIKI_A: 'https://example.org/aaa',
  WIKI_B: 'https://example.org/bbb',

  // stackoverflow.com domain
  SO_A: 'https://stackoverflow.com/aaa',
  SO_B: 'https://stackoverflow.com/bbb',

  // Special URLs
  DATA_URL: 'data:text/html,<h1>data</h1>',
  ABOUT_BLANK: 'about:blank',
};
