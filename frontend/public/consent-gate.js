// Consent gate, for the hosted demo only. The same bundle IS the local-first
// app, which is expected to make no outbound request at all and to work
// air-gapped -- so the hostname is checked here rather than letting the
// script load and no-op itself. Shared copy: ai-automation-tools.dev/consent.js
if (/(^|\.)ai-automation-tools\.dev$/.test(location.hostname)) {
  var c = document.createElement('script');
  c.src = 'https://ai-automation-tools.dev/consent.js';
  c.defer = true;
  document.head.appendChild(c);
}
