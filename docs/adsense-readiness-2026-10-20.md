# AdSense Readiness Review - October 20, 2026

## Scope and interpretation

This review covers ImagePrivacy, ToolkitBox, their English/Chinese documents,
and their tool subdomains. It is an engineering and content-quality review,
not an AdSense approval, policy certification, or legal opinion.

The account screenshot says that the account was not approved and links to
the general AdSense policies. It does not identify a particular failing URL
or prove that content quantity is the cause. The generic content tip in a
rejection email is not a site-specific diagnosis. Do not resubmit without
reading any new account/email details.

Official references:

- [An AdSense account was not approved](https://support.google.com/adsense/answer/81904?hl=en)
- [Make sure site pages are ready](https://support.google.com/adsense/answer/7299563?hl=en)
- [Google-certified CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en)

There is no approval guarantee based on a chosen article count, word count,
SEO score, or a fixed wait after deployment.

## Implemented changes

- Retain distinct useful ToolkitBox guides instead of redirecting unrelated
  UUID, diff, URL, and color topics to a generic testing page.
- Redirect consolidated ImagePrivacy material to relevant sections, including
  direct `index.html` entry points and matching Chinese destinations.
- Remove unsupported completed-test, independent-audit, and CMP-certification
  claims. Distinguish local input processing from analytics/ad network traffic.
- Keep privacy choices reachable when a consent-provider API is unavailable.
- Fix mobile table overflow, corrupt-file errors, stale downloads, decode
  races, and touch editing. Verify actual downloaded pixels and dimensions.
- Gate upload controls until their event handlers are installed, including
  after language navigation on slow connections.
- Exercise developer-tool parsing, comparison, Unicode, generated values,
  invalid inputs, download handling, and expensive regular expressions.
- Repair SSL API routing and test certificate trust and public-address
  restrictions separately from simple expiration dates.

## Repeatable checks

Local verification on the release source used Chrome 155.0.8059.85:

- 96 documents, 64 technical endpoints, 104 redirects: no detected issues
  across four viewport widths in the integrated crawl.
- 30 ImagePrivacy functional scenarios passed, including downloaded pixels,
  nested EXIF/GPS input, touch redaction, corrupt files, and decode races.
- 12 delayed-script initialization checks passed across all six tools in
  both languages: upload remains disabled until handlers are registered,
  then a real selection and decoded download succeeds.
- 4 additional codec scenarios passed: one pinned upstream HEIC sample to
  PNG/JPEG/WebP in both languages, and real CDN-backed PNG encoding, resizing,
  ZIP integrity, and duplicate output filenames. This is one HEIC sample,
  not a compatibility matrix. AVIF encoding was not exercised.
- 26 ToolkitBox unit tests and 14 English/Chinese Chrome smoke suites passed.
- 159 SSL API/routing/browser tests passed with mocked DNS/TLS. Separately,
  the deployed API returned valid for example.com, invalid for self-signed
  and expired badssl.com test hosts, and HTTP 405 for a GET request.

The redaction fixes also received an independent pixel-level review. Tests
do not establish that blur or pixelation is safe for high-risk information;
opaque coverage remains the clearer option.

Run the commands in the repository README. The crawl includes sitemap URLs
and discovered first-party document links, metadata, bilingual alternates,
structured JSON, resources, redirect destinations/fragments, genuine missing
page responses, ads.txt records, and browser overflow at 320, 390, 768, and
1280 pixels. A simulated Googlebot user-agent is not a request from Google.

The crawl and functional smoke block advertising requests. Consequently they
do not verify live ad placement, fill rates, impression reporting, or a real
regional consent dialog. Desktop Chrome touch emulation is not testing on
physical iOS/Android hardware. Fixture successes are not exhaustive image
format or metadata-security certification.

## Account-side release gates

1. Obtain the specific rejection detail, if Google provides one. Verify the
   account is eligible and has no duplicate-account problem; code cannot
   resolve these account checks.
2. Confirm the CMP provider, published message, domain/subdomain coverage,
   applicable regions, consent withdrawal, and request behavior in AdSense
   and a real regional browser session. The restricted account UI observed
   in this review did not expose Privacy & messaging. A privacy link is not
   a substitute for a configured and tested CMP.
3. Confirm contact-mailbox delivery with a real received test. MX records
   alone do not establish that the contact inbox is monitored or deliverable.
4. Inspect real ads after approval: distinguish ads from download/tool
   controls, avoid blocked content, and check mobile placement without
   clicking one's own ads.
5. Keep Search Console indexing and real user reports separate from local
   technical test results. Successful deployment is not proof of crawling,
   indexing, useful traffic, or AdSense approval.

No AdSense resubmission is performed by these scripts.
