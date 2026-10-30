/**
 * Reads IPO data from IPO Ji (www.ipoji.com).
 *
 * IPO Ji has no public API, so this file downloads its normal web pages and
 * picks the data out of the HTML. If IPO Ji redesigns its pages, the CSS
 * selectors below (the strings like ".ipo-card-name") may stop matching and
 * will need updating.
 */
import * as cheerio from "cheerio";

const BASE_URL = "https://www.ipoji.com";

// Tells IPO Ji who is making the request.
const USER_AGENT = "ipoji-mcp-server/0.1 (+https://www.ipoji.com)";

// How long a downloaded page is reused before fetching it again.
// IPO pages change during the day (status, subscription), so keep this short.
const PAGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// The sitemap (the list of every IPO) changes rarely, so it can be kept longer.
const SITEMAP_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Which section of the homepage an IPO appears in. */
export type IpoListStatus = "current" | "upcoming" | "listed";

/** Mainboard = large IPOs on NSE/BSE main market. SME = small and medium enterprise IPOs. */
export type IpoBoard = "mainboard" | "sme";

/** One IPO as shown in a card on the IPO Ji homepage. Missing values are null. */
export interface IpoCard {
  name: string; // Company name, e.g. "BLS Polymers"
  slug: string; // IPO Ji's ID for the IPO, used in its URLs, e.g. "bls-polymers-ipo"
  board: string; // "mainboard" or "sme"
  listStatus: string; // Homepage section: "current", "upcoming" or "listed"
  status: string | null; // Badge text, e.g. "Live", "Closed", "Allotment Out"
  openDate: string | null; // Subscription start, as YYYY-MM-DD
  closeDate: string | null; // Subscription end, as YYYY-MM-DD
  offerPrice: string | null; // Price band, e.g. "₹142-150"
  lotSize: string | null; // Minimum number of shares per application
  subscription: string | null; // How many times the IPO was subscribed, e.g. "241.22x"
  issueSize: string | null; // Total amount being raised, e.g. "₹255 Cr"
  expectedPremium: string | null; // Grey market premium (GMP), e.g. "₹66 (44%)"
  listingDate: string | null; // Only for listed IPOs
  listPrice: string | null; // Price the share listed at; only for listed IPOs
  url: string; // IPO Ji page for this IPO
}

/** One step of an IPO's timeline: open, close, allotment or listing. */
export interface TimelineStep {
  label: string; // e.g. "Allotment Date"
  date: string | null; // e.g. "Oct 29, 2026"; null when not announced yet
  state: string; // "Completed" or "Upcoming"
}

/** Everything read from an IPO's allotment-status page on IPO Ji. */
export interface IpoDetails {
  name: string; // Short name, e.g. "EAAA India Alternatives"
  fullName: string | null; // e.g. "EAAA India Alternatives Limited IPO"
  slug: string;
  board: string | null; // "Mainboard" or "SME"
  status: string | null; // e.g. "Live", "Allotment Out"; null if IPO Ji doesn't know yet
  summary: string | null; // IPO Ji's one-paragraph summary of the allotment status
  timeline: TimelineStep[];
  facts: Record<string, string>; // Label/value pairs such as "Lot Size": "9", "Registrar": "..."
  registrar: { name: string | null; url: string | null }; // The company that processes allotment
  exchangeCheckLinks: { bse: string | null; nse: string | null }; // Exchange pages for checking allotment
  detailsUrl: string; // IPO Ji page with full IPO details
  allotmentUrl: string; // IPO Ji page for checking allotment
}

// Pages downloaded recently, keyed by path, so repeated questions don't
// re-download the same page. Lives in memory and resets when the server restarts.
const cache = new Map<string, { at: number; body: string }>();

/**
 * Downloads a page from IPO Ji and returns its HTML (or XML).
 * Returns the cached copy if it is younger than `ttlMs`.
 */
async function fetchText(path: string, ttlMs = PAGE_TTL_MS): Promise<string> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;

  const res = await fetch(BASE_URL + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xml" },
  });
  if (res.status === 404) throw new Error(`Not found on IPO Ji: ${path}`);
  if (!res.ok) throw new Error(`IPO Ji returned HTTP ${res.status} for ${path}`);

  const body = await res.text();
  cache.set(path, { at: Date.now(), body });
  return body;
}

/**
 * Tidies text taken from the page: collapses extra spaces and line breaks.
 * Returns null for empty text and for IPO Ji's "N/A" placeholders.
 */
const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t && t !== "N/A" && t !== "₹N/A" ? t : null;
};

/**
 * Lists the IPOs shown on the IPO Ji homepage, optionally filtered by
 * section (current/upcoming/listed) and board (mainboard/sme).
 */
export async function listIpos(filter: { status?: IpoListStatus; board?: IpoBoard }): Promise<IpoCard[]> {
  const $ = cheerio.load(await fetchText("/"));

  // The homepage shows the same IPO in several tabs (All, Mainboard, SME),
  // so keep only the first card for each IPO.
  const bySlug = new Map<string, IpoCard>();

  $("article.ipo-card[data-ipo-status]").each((_, el) => {
    const card = $(el);
    const href = card.attr("data-agent-href") ?? ""; // e.g. "/ipo/bls-polymers-ipo"
    const slug = href.replace(/^\/ipo\//, "");
    if (!slug || bySlug.has(slug)) return;

    // Each number on a card sits right after its label, e.g. "Lot Size" then "100".
    // Find the label and return the value next to it.
    const stat = (label: string) =>
      clean(
        card
          .find(".ipo-card-secondary-label")
          .filter((_, l) => $(l).text().trim() === label)
          .first()
          .next()
          .text(),
      );

    // The card's date line holds two dates: open date, then close date.
    const times = card.find(".ipo-card-date time");

    bySlug.set(slug, {
      name: clean(card.find(".ipo-card-name").text()) ?? slug,
      slug,
      board: card.attr("data-ipo-board") ?? "",
      listStatus: card.attr("data-ipo-status") ?? "",
      status: clean(card.find(".ipo-card-status-badge").text()),
      openDate: times.eq(0).attr("datetime") ?? null,
      closeDate: times.eq(1).attr("datetime") ?? null,
      offerPrice: stat("Offer Price"),
      lotSize: stat("Lot Size"),
      subscription: stat("Subscription"),
      issueSize: stat("Issue Size"),
      expectedPremium: stat("Exp. Premium"),
      listingDate: stat("Listing Date"),
      listPrice: stat("List Price"),
      url: BASE_URL + href,
    });
  });

  return [...bySlug.values()].filter(
    (c) =>
      (!filter.status || c.listStatus === filter.status) &&
      (!filter.board || c.board.toLowerCase() === filter.board),
  );
}

/**
 * Collects the slug of every IPO IPO Ji has a page for.
 * Uses the site's IPO sitemap, plus the homepage, because brand-new IPOs
 * can appear on the homepage before they are added to the sitemap.
 */
async function allIpoSlugs(): Promise<string[]> {
  const xml = await fetchText("/sitemap-ipo.xml", SITEMAP_TTL_MS);
  const slugs = new Set<string>();

  // Sitemap entries look like <loc>https://www.ipoji.com/ipo/bls-polymers-ipo</loc>.
  // Take the part after the last slash.
  for (const m of xml.matchAll(/<loc>https:\/\/www\.ipoji\.com\/(?:ipo|ipo-allotment-status)\/([^<\/]+-ipo)<\/loc>/g)) {
    slugs.add(m[1]);
  }
  for (const card of await listIpos({})) slugs.add(card.slug);
  return [...slugs];
}

/**
 * Splits a name or slug into lowercase words for matching, dropping common
 * words that don't help tell IPOs apart ("ipo", "limited", "india", ...).
 * Example: "BLS Polymers Ltd" -> ["bls", "polymers"]
 */
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !["ipo", "ltd", "limited", "the", "and", "india"].includes(t));

/**
 * Finds the IPOs whose names best match `query`, best match first.
 *
 * Scoring, per IPO:
 *  - mostly: the share of the query's words found in the IPO's name
 *    (a query word also counts if a name word starts with it, so "poly" matches "polymers");
 *  - a small penalty for each extra word in the name, so "BLS Polymers"
 *    beats "BLS Polymers Engineering Works";
 *  - a bonus when the query words appear together in the same order.
 */
export async function searchIpos(query: string, limit = 10): Promise<string[]> {
  const q = tokens(query);
  if (q.length === 0) return [];
  const qJoined = q.join("-");

  return (await allIpoSlugs())
    .map((slug) => {
      const s = tokens(slug);
      const hits = q.filter((t) => s.some((st) => st === t || st.startsWith(t))).length;
      let score = hits / q.length - (s.length - hits) * 0.01;
      if (slug.replace(/-ipo$/, "").includes(qJoined)) score += 0.5;
      return { slug, score, hits };
    })
    .filter((r) => r.hits > 0) // Drop IPOs that share no words with the query
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.slug);
}

/**
 * Turns whatever the user typed into an IPO Ji slug.
 * Accepts a slug ("bls-polymers-ipo"), a slug without "-ipo" ("bls-polymers"),
 * an IPO Ji URL, or a company name ("BLS Polymers").
 * Throws an error if nothing matches.
 */
export async function resolveSlug(ipo: string): Promise<string> {
  // Strip a pasted IPO Ji URL down to just the slug.
  const input = ipo.trim().replace(/^https?:\/\/(www\.)?ipoji\.com/, "").replace(/^\/?(ipo|ipo-allotment-status)\//, "");

  // Exact slug: use it directly.
  const slugs = await allIpoSlugs();
  if (slugs.includes(input)) return input;
  if (slugs.includes(`${input}-ipo`)) return `${input}-ipo`;

  // Otherwise treat it as a company name and take the best match.
  const [best] = await searchIpos(input, 1);
  if (!best) throw new Error(`No IPO on IPO Ji matches "${ipo}". Try search_ipos with a shorter name.`);
  return best;
}

/**
 * Reads an IPO's allotment-status page on IPO Ji and returns its current
 * status, timeline, key facts, registrar and allotment-check links.
 * This page exists for every IPO, including ones that haven't opened yet.
 */
export async function getIpoDetails(slug: string): Promise<IpoDetails> {
  const $ = cheerio.load(await fetchText(`/ipo-allotment-status/${slug}`));

  // The summary box at the top of the page stores name, board and status as attributes.
  const top = $("section.ipo-top-card").first();

  // The timeline has four steps: open, close, allotment and listing.
  // Dates not announced yet are shown as "TBA"; return those as null.
  const timeline: TimelineStep[] = $("section.ipo-timeline li.step")
    .map((_, el) => ({
      label: clean($(el).find(".step-label").text()) ?? "",
      date: clean($(el).find(".step-date").text()),
      state: clean($(el).find(".step-status").text()) ?? "",
    }))
    .get()
    .map((s) => (s.date === "TBA" ? { ...s, date: null } : s));

  // The "IPO Details" box is a list of label/value pairs (Issue Price, Lot Size,
  // Registrar, ...). Keep the first value for each label.
  const facts: Record<string, string> = {};
  $("dl.ipo-meta-strip .ipo-meta-item, .ipo-summary-identity ~ * dl div").each((_, el) => {
    const k = clean($(el).find("dt").first().text());
    const v = clean($(el).find("dd").first().text());
    if (k && v && !(k in facts)) facts[k] = v;
  });

  // Returns the first link on the page whose address matches `pattern`.
  const externalLink = (pattern: RegExp) =>
    $("a[href]")
      .map((_, a) => $(a).attr("href"))
      .get()
      .find((h) => pattern.test(h)) ?? null;

  // The registrar's website isn't labelled directly, so look for an outside
  // link that is described as the registrar (or the "legacy" registrar method),
  // ignoring links to IPO Ji itself and to the BSE/NSE sites.
  const registrarAnchor = $("a[href^='http']")
    .filter((_, a) => /registrar|legacy/i.test($(a).text()) || /registrar/i.test($(a).parent().text()))
    .filter((_, a) => !/ipoji|bseindia|nseindia/i.test($(a).attr("href") ?? ""))
    .first();

  const status = top.attr("data-ipo-status");
  return {
    name: top.attr("data-ipo-name") ?? slug,
    fullName: clean($("#ipo-top-card-title").text()),
    slug,
    board: top.attr("data-ipo-board") ?? null,
    // IPO Ji says "Unknown" for IPOs with no dates yet; return null instead.
    status: status && status !== "Unknown" ? status : null,
    summary: clean($("#ipo-summary").text()),
    timeline,
    facts,
    registrar: { name: facts["Registrar"] ?? null, url: registrarAnchor.attr("href") ?? null },
    exchangeCheckLinks: {
      bse: externalLink(/bseindia\.com\/investors\/appli_check/i),
      nse: externalLink(/nseindia\.com\/.*ipo/i),
    },
    detailsUrl: `${BASE_URL}/ipo/${slug}`,
    allotmentUrl: `${BASE_URL}/ipo-allotment-status/${slug}`,
  };
}
