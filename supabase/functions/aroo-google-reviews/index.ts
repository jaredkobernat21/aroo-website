// Supabase Edge Function: aroo-google-reviews
//
// Feeds the Google review carousel on aroodog.com (home page + /community/).
// Pulls aroo.'s rating and reviews from the Google Places API (New) and returns
// only the 5-star reviews. Deployed with --no-verify-jwt, so the site sends no key.
//
// GET -> { rating, count, reviewsUrl, writeReviewUrl, reviews: [...] }
//
// Secret required: GOOGLE_PLACES_API_KEY (restrict it to the Places API (New)).
// Results are held in memory for an hour so page views don't each cost an API call.

const PLACE_ID = "ChIJY4iKqfIq2AIRIS_nS5wgfbI";
const CACHE_MS = 60 * 60 * 1000;
const FIELDS = "rating,userRatingCount,reviews,googleMapsUri,googleMapsLinks";

const ALLOWED_ORIGINS = new Set([
  "https://aroodog.com",
  "https://www.aroodog.com",
  "http://localhost:8642",
  "http://localhost:8765",
]);

type Review = {
  author: string;
  authorUrl: string | null;
  photo: string | null;
  text: string;
  when: string;
  published: string | null;
  url: string | null;
};
type Payload = {
  rating: number | null;
  count: number;
  reviewsUrl: string;
  writeReviewUrl: string;
  reviews: Review[];
};

// Google's API doesn't return review text for some service-area businesses.
// When it sends none, these 5-star reviews (copied from the Business Profile) are shown.
// Shown in this order.
const FEATURED: Review[] = [
  {
    author: "Jeanette Wood",
    authorUrl: null,
    photo: null,
    text:
      "Very friendly, excellent service. He went above and beyond my expectations. Was attentive to every detail and came out to serve me quickly. Thank you for a job well done.",
    when: "",
    published: null,
    url: null,
  },
  {
    author: "Keri Ahlf",
    authorUrl: null,
    photo: null,
    text:
      "They showed up exactly when they said they would and came fully prepared with all the necessary supplies. They worked quickly and efficiently, took care to properly secure the gate so the dogs couldn't get out when they went outside, and made sure all the waste was taken care of. Everyone was extremely friendly, professional, and accommodating. No job was too big, and they went above and beyond to make sure everything was taken care of. I highly recommend this company! Great service from start to finish!",
    when: "",
    published: null,
    url: null,
  },
  {
    author: "Chris Hancock",
    authorUrl: null,
    photo: null,
    text:
      "They're very thorough and professional. Communication was timely and attention to details (like locking the gate, mindfulness of pets) made the service well worth it.",
    when: "",
    published: null,
    url: null,
  },
];

let cache: { at: number; data: Payload } | null = null;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://aroodog.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

async function load(key: string): Promise<Payload> {
  const r = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
  });
  if (!r.ok) throw new Error(`Places API ${r.status}`);
  // deno-lint-ignore no-explicit-any
  const p: any = await r.json();
  // deno-lint-ignore no-explicit-any
  const reviews: Review[] = (p.reviews || [])
    .filter((v: any) => v.rating === 5 && (v.text?.text || v.originalText?.text))
    .map((v: any) => ({
      author: v.authorAttribution?.displayName || "Google user",
      authorUrl: v.authorAttribution?.uri || null,
      photo: v.authorAttribution?.photoUri || null,
      text: v.text?.text || v.originalText?.text,
      when: v.relativePublishTimeDescription || "",
      published: v.publishTime || null,
      url: v.googleMapsUri || null,
    }));
  return {
    rating: typeof p.rating === "number" ? p.rating : null,
    count: p.userRatingCount || 0,
    reviewsUrl: p.googleMapsLinks?.reviewsUri || p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
    writeReviewUrl: "https://g.page/r/CSEv50ucIH2yEBM/review",
    reviews: reviews.length ? reviews : FEATURED,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "GET") return json(origin, { error: "Method not allowed" }, 405);

  if (cache && Date.now() - cache.at < CACHE_MS) return json(origin, cache.data, 200, 900);

  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json(origin, { error: "Server is not configured." }, 500);

  try {
    const data = await load(key);
    cache = { at: Date.now(), data };
    return json(origin, data, 200, 900);
  } catch (e) {
    console.error("aroo-google-reviews:", (e as Error).message);
    // Serve the last good result rather than an empty carousel.
    if (cache) return json(origin, cache.data, 200, 300);
    return json(origin, { error: "Reviews are unavailable right now." }, 502);
  }
});
