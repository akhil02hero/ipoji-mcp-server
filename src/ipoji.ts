import * as cheerio from "cheerio";

const BASE_URL = "https://www.ipoji.com";
const USER_AGENT = "ipoji-mcp-server/0.1 (+https://www.ipoji.com)";
const PAGE_TTL_MS = 5 * 60 * 1000;
const SITEMAP_TTL_MS = 60 * 60 * 1000;

export type IpoListStatus = "current" | "upcoming" | "listed";
export type IpoBoard = "mainboard" | "sme";

export interface IpoCard {
  name: string;
  slug: string;
  board: string;
  listStatus: string;
  status: string | null;
  openDate: string | null;
  closeDate: string | null;
  offerPrice: string | null;
  lotSize: string | null;
  subscription: string | null;
  issueSize: string | null;
  expectedPremium: string | null;
  listingDate: string | null;
  listPrice: string | null;
  url: string;
}

export interface TimelineStep {
  label: string;
  date: string | null;
  state: string;
}

export interface IpoDetails {
  name: string;
  fullName: string | null;
  slug: string;
  board: string | null;
  status: string | null;
  summary: string | null;
  timeline: TimelineStep[];
  facts: Record<string, string>;
  registrar: { name: string | null; url: string | null };
  exchangeCheckLinks: { bse: string | null; nse: string | null };
  detailsUrl: string;
  allotmentUrl: string;
}

const cache = new Map<string, { at: number; body: string }>();

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

const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t && t !== "N/A" && t !== "₹N/A" ? t : null;
};

/** IPO cards from the homepage, deduplicated by slug. */
export async function listIpos(filter: { status?: IpoListStatus; board?: IpoBoard }): Promise<IpoCard[]> {
  const $ = cheerio.load(await fetchText("/"));
  const bySlug = new Map<string, IpoCard>();

  $("article.ipo-card[data-ipo-status]").each((_, el) => {
    const card = $(el);
    const href = card.attr("data-agent-href") ?? "";
    const slug = href.replace(/^\/ipo\//, "");
    if (!slug || bySlug.has(slug)) return;

    const stat = (label: string) =>
      clean(
        card
          .find(".ipo-card-secondary-label")
          .filter((_, l) => $(l).text().trim() === label)
          .first()
          .next()
          .text(),
      );
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

/** Every IPO slug IPO Ji knows: the sitemap plus the homepage (new IPOs can be missing from the sitemap). */
async function allIpoSlugs(): Promise<string[]> {
  const xml = await fetchText("/sitemap-ipo.xml", SITEMAP_TTL_MS);
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/<loc>https:\/\/www\.ipoji\.com\/(?:ipo|ipo-allotment-status)\/([^<\/]+-ipo)<\/loc>/g)) {
    slugs.add(m[1]);
  }
  for (const card of await listIpos({})) slugs.add(card.slug);
  return [...slugs];
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !["ipo", "ltd", "limited", "the", "and", "india"].includes(t));

/** Best-matching IPO slugs for a company name, most likely first. */
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
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.slug);
}

/** Accepts a slug ("bls-polymers-ipo") or a company name ("BLS Polymers"). */
export async function resolveSlug(ipo: string): Promise<string> {
  const input = ipo.trim().replace(/^https?:\/\/(www\.)?ipoji\.com/, "").replace(/^\/?(ipo|ipo-allotment-status)\//, "");
  const slugs = await allIpoSlugs();
  if (slugs.includes(input)) return input;
  if (slugs.includes(`${input}-ipo`)) return `${input}-ipo`;

  const [best] = await searchIpos(input, 1);
  if (!best) throw new Error(`No IPO on IPO Ji matches "${ipo}". Try search_ipos with a shorter name.`);
  return best;
}

/** Status, timeline, key facts and registrar from an IPO's allotment-status page. */
export async function getIpoDetails(slug: string): Promise<IpoDetails> {
  const $ = cheerio.load(await fetchText(`/ipo-allotment-status/${slug}`));
  const top = $("section.ipo-top-card").first();

  const timeline: TimelineStep[] = $("section.ipo-timeline li.step")
    .map((_, el) => ({
      label: clean($(el).find(".step-label").text()) ?? "",
      date: clean($(el).find(".step-date").text()),
      state: clean($(el).find(".step-status").text()) ?? "",
    }))
    .get()
    .map((s) => (s.date === "TBA" ? { ...s, date: null } : s));

  const facts: Record<string, string> = {};
  $("dl.ipo-meta-strip .ipo-meta-item, .ipo-summary-identity ~ * dl div").each((_, el) => {
    const k = clean($(el).find("dt").first().text());
    const v = clean($(el).find("dd").first().text());
    if (k && v && !(k in facts)) facts[k] = v;
  });

  const externalLink = (pattern: RegExp) =>
    $("a[href]")
      .map((_, a) => $(a).attr("href"))
      .get()
      .find((h) => pattern.test(h)) ?? null;

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
