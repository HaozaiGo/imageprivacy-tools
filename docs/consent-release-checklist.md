# Consent release checklist

## Verified status: 2026-11-02 (America/Los_Angeles)

The signed-in AdSense account is still on the **account not approved** onboarding
screen. Its visible menu has Home, Reports and Feedback; Account and Payments
are disabled. There is no available Privacy & messaging entry in that screen.
No message publication, account eligibility change or review resubmission was
performed. Both site families' real CMP publication remains **unverified**.

Code tests verify the revocation entry point, not a certified CMP. The adapter
uses Google's `callbackQueue` / `CONSENT_DATA_READY`, times out safely, and never
stores consent or changes consent on page load. An expired callback cannot later
clear the user's choice. A missing provider retains a policy-page fallback.

## Required account-side completion

Once Privacy & messaging is available (or an independently chosen, Google-certified
CMP is configured), publish the appropriate European regulations message for
both sites. Check the provider's domain scope against this complete inventory:

- ToolkitBox: toolkitbox.org; json, base64, uuid, color, regex, diff, url and ssl.toolkitbox.org.
- ImagePrivacy: imageprivacy.org; exif, watermark, redact, resize, compress and convert.imageprivacy.org.

For each origin and `/` + `/zh/`, record the message ID/version, publication time,
covered domain, policy URL, UI language and tester's actual network region.
Use English if the provider has no supported Chinese translation; never fabricate
an unsupported consent translation. Do not assume choices share across subdomains.

## Browser acceptance matrix

Use a clean browser profile and harmless synthetic files. Do not click ads or
generate repeated ad impressions. Inspect requests rather than testing revenue.

1. Test an actual EEA/UK/Swiss network location. Browser geolocation emulation
   alone does not establish IP-based region targeting.
2. Observe the initial message and applicable choices before interaction.
   Inspect TCF API readiness and provider status without recording TC strings,
   cookies or other user identifiers in the report.
3. Reject optional purposes, reload and confirm persistence and applicable ad/
   storage restrictions. Non-personalized and limited ads have different rules;
   do not equate every network request with personalized advertising.
4. Grant the applicable purposes in this isolated test profile, reload and
   inspect the resulting behavior. Never change the real user's existing choices.
5. Activate the privacy entry point on the same origin, withdraw/change choices,
   reload and verify the new state. Repeat on each tool subdomain.
6. Block the provider: tools must still work; policy fallback must remain usable
   and must not say consent was saved or imply consent was granted.
7. Repeat the relevant checks for other targeted regions and applicable US state
   messages. A missing GDPR prompt outside the applicable region is not failure.

For a **published** Google message, `?fc=alwaysshow&fctype=gdpr` is a supported
preview aid, not proof of correct real-region targeting or certification.
Use the site's own AdSense tag; do not invent a Funding Choices account script
or create a home-grown consent banner and call it Google-certified.

## Evidence and release decision

Record pass/fail/blocked separately for publication, domain coverage, initial
display, rejection, acceptance, persistence, withdrawal, blocked-provider fallback,
and regional ad/storage behavior. Account-level blockers cannot be fixed by
adding more policy text. This checklist does not guarantee AdSense approval.

Official references (checked 2026-11-02):

- https://support.google.com/adsense/answer/13554116
- https://developers.google.com/funding-choices/fc-api-docs
