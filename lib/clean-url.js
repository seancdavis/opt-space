// Turns the URL of the page you're on into the link you'd actually want to
// share: no tracking junk, and the short form where a site has one.
//
// Two passes. First a site's own canonical link is preferred when it points at
// the same host, then a set of rules strips parameters. Site rules run last so
// they can shorten what the canonical link gave us (Amazon is the clearest
// case: canonical keeps the product-name slug, the rule cuts it to /dp/ASIN).

// Parameters no site needs to render the page. Matched against the whole name.
const TRACKING_PARAMS = [
  /^utm_/i,
  /^(_ga|_gl|ga_)/i,
  /^(mc_cid|mc_eid)$/i,
  /^(pk_|piwik_|matomo_)/i,
  /^(gclid|dclid|gbraid|wbraid|fbclid|msclkid|twclid|ttclid|yclid|scid|rdt_cid)$/i,
  /^(igshid|igsh|mibextid)$/i,
  /^(ref_src|ref_url|referrer|ncid|cmpid|campaign_id|mkt_tok)$/i,
];

// Per-site cleanup. `params` are dropped on top of the tracking list above;
// `rewrite` gets the URL object and may change anything.
const SITE_RULES = [
  {
    match: /(^|\.)amazon\.[a-z.]+$/i,
    rewrite: (url) => {
      const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (asin) {
        url.pathname = `/dp/${asin[1].toUpperCase()}`;
        url.search = "";
      }
    },
  },
  { match: /(^|\.)youtube\.com$/i, params: ["si", "pp", "feature", "ab_channel", "index", "list"] },
  { match: /(^|\.)youtu\.be$/i, params: ["si", "feature"] },
  { match: /(^|\.)(twitter|x)\.com$/i, params: ["s", "t"] },
  { match: /(^|\.)(spotify|open\.spotify)\.com$/i, params: ["si", "nd", "context"] },
  { match: /(^|\.)linkedin\.com$/i, params: ["trk", "trackingId", "rcm", "lipi", "originalSubdomain"] },
  { match: /(^|\.)ebay\.[a-z.]+$/i, params: ["hash", "_trkparms", "_trksid", "_from"] },
  { match: /(^|\.)google\.[a-z.]+$/i, params: ["sca_esv", "ved", "ei", "sclient", "sourceid", "oq", "gs_lcrp", "uact"] },
  { match: /(^|\.)reddit\.com$/i, params: ["share_id", "utm_name", "rdt", "chainedPosts"] },
  { match: /(^|\.)medium\.com$/i, params: ["sk", "source", "gi"] },
];

/**
 * @param {string} rawUrl        the tab's current URL
 * @param {object} [page]        what the page itself said about the link
 * @param {string} [page.canonical]  contents of <link rel="canonical">
 * @returns {string} the cleaned URL, or the original if it can't be parsed
 */
export function cleanUrl(rawUrl, page = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

  // A canonical link on the same host is the site telling us the real address
  // of this page. One pointing somewhere else is usually syndication, and
  // swapping hosts under someone who asked to copy *this* link would surprise.
  if (page.canonical) {
    try {
      const canonical = new URL(page.canonical, url);
      if (canonical.hostname === url.hostname && /^https?:$/.test(canonical.protocol)) {
        // Keep the fragment from the tab: it's where the reader actually is.
        canonical.hash = url.hash;
        url = canonical;
      }
    } catch {
      // A malformed canonical link is no reason to give up on the rest.
    }
  }

  const rule = SITE_RULES.find((r) => r.match.test(url.hostname));
  const extraParams = new Set((rule?.params || []).map((p) => p.toLowerCase()));

  for (const name of [...url.searchParams.keys()]) {
    const drop =
      extraParams.has(name.toLowerCase()) ||
      TRACKING_PARAMS.some((pattern) => pattern.test(name));
    if (drop) url.searchParams.delete(name);
  }

  rule?.rewrite?.(url);

  // URL keeps a lone "?" when every parameter is gone.
  return url.toString().replace(/\?(#|$)/, "$1");
}
