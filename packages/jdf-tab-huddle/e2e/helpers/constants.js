// Test URLs organized by domain for predictable sorting.
// Uses IANA-reserved domains and subdomains to guarantee no redirects.
// example.com, example.org, example.net are reserved by RFC 2606.
export const URLS = {
  // example.com domain
  EXAMPLE_A: 'https://example.com/aaa',
  EXAMPLE_B: 'https://example.com/bbb',
  EXAMPLE_C: 'https://example.com/ccc',

  // example.org domain
  TEST_A: 'https://example.org/aaa',
  TEST_B: 'https://example.org/bbb',

  // example.net domain
  GITHUB_A: 'https://example.net/aaa',
  GITHUB_B: 'https://example.net/bbb',

  // Subdomains of example.com (distinct hostnames, no redirects)
  MOZILLA_A: 'https://a.example.com/aaa',
  MOZILLA_B: 'https://a.example.com/bbb',

  WIKI_A: 'https://b.example.com/aaa',
  WIKI_B: 'https://b.example.com/bbb',

  SO_A: 'https://c.example.com/aaa',
  SO_B: 'https://c.example.com/bbb',

  // Special URLs
  DATA_URL: 'data:text/html,<h1>data</h1>',
  ABOUT_BLANK: 'about:blank',
};
