// Supabase Edge Function: aroo-service-request
//
// Backs the "Request Service" form on aroodog.com, plus a tiny counter for
// taps on the "text us" links. Deployed to the shared Supabase project with
// --no-verify-jwt, so the site sends no key at all.
//
// POST { action: "request", first_name, zip, dogs, service_type, phone, email,
//        notes, website (honeypot), elapsed_ms }
//   -> saves to aroo_service_requests, logs a request_submitted event, emails
//      hello@aroodog.com. Success is returned only after the row is saved.
// POST { action: "event", event: "sms_click", placement }
//   -> logs an aroo_events row (no personal info).
//
// Customer details are never written to logs.

const ALLOWED_ORIGINS = new Set([
  "https://aroodog.com",
  "https://www.aroodog.com",
  "http://localhost:8642",
]);

const NOTIFY_TO = "hello@aroodog.com";
// Preferred sender is aroodog.com. Until that domain is verified in Resend, Resend
// rejects it, so we fall back to the already-verified roqhome.com sender.
const NOTIFY_FROM = ["aroo. requests <requests@aroodog.com>", "aroo. requests <notifications@roqhome.com>"];

const LIMITS = {
  request: { max: 5, windowMin: 60 },
  event: { max: 40, windowMin: 60 },
};

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://aroodog.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function str(v: unknown, max: number) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max + 1) : "";
}

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(origin, { error: "Method not allowed" }, 405);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "Not allowed" }, 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(origin, { error: "Server is not configured." }, 500);

  const db = (path: string, init: RequestInit = {}) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

  // sendBeacon posts text/plain, so parse the raw text either way.
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 6000) return json(origin, { error: "Request too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json(origin, { error: "Invalid request." }, 400);
  }
  const action = body.action === "event" ? "event" : "request";

  // ---- Rate limit by hashed IP ----
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "unknown";
  const keyHash = await hmac(serviceKey, "aroo-rl:" + ip);
  const lim = LIMITS[action];
  const since = new Date(Date.now() - lim.windowMin * 60_000).toISOString();
  try {
    const countRes = await db(
      `aroo_rate_limits?select=id&bucket=eq.${action}&key_hash=eq.${keyHash}&created_at=gte.${encodeURIComponent(since)}`,
      { method: "HEAD", headers: { Prefer: "count=exact" } },
    );
    const total = Number((countRes.headers.get("content-range") || "*/0").split("/")[1]) || 0;
    if (total >= lim.max) {
      return json(origin, {
        error: action === "request"
          ? "Too many requests from this connection. Please try again later, or text us at (785) 600-8801."
          : "Too many events.",
      }, 429);
    }
    await db("aroo_rate_limits", { method: "POST", body: JSON.stringify({ bucket: action, key_hash: keyHash }) });
    // Housekeeping: drop rate-limit rows older than a day.
    await db(`aroo_rate_limits?created_at=lt.${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`, { method: "DELETE" });
  } catch {
    // If the limiter itself is down, fall through rather than block real customers.
  }

  // ---- Click counter ----
  if (action === "event") {
    if (body.event !== "sms_click") return json(origin, { error: "Unknown event." }, 400);
    const placement = str(body.placement, 40).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || null;
    const r = await db("aroo_events", { method: "POST", body: JSON.stringify({ event: "sms_click", placement }) });
    return r.ok ? json(origin, { ok: true }) : json(origin, { error: "Could not record event." }, 502);
  }

  // ---- Spam checks ----
  // Honeypot: a hidden field people never see. Bots that fill it get a quiet "ok"
  // and nothing is saved.
  if (str(body.website, 200)) return json(origin, { ok: true });
  const elapsed = Number(body.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < 1200) {
    return json(origin, { error: "That was a little fast. Please check your details and try again." }, 400);
  }

  // ---- Validation ----
  const errors: Record<string, string> = {};
  const firstName = str(body.first_name, 60);
  if (!firstName) errors.first_name = "Please enter your first name.";
  else if (firstName.length > 60) errors.first_name = "Please use 60 characters or fewer.";
  else if (/https?:|www\.|[<>]/i.test(firstName)) errors.first_name = "Please enter just your first name.";

  const zip = str(body.zip, 10);
  if (!/^[0-9]{5}$/.test(zip)) errors.zip = "Please enter a 5-digit ZIP code.";

  const dogs = str(body.dogs, 3);
  if (!["1", "2", "3+"].includes(dogs)) errors.dogs = "Please choose how many dogs.";

  const service = str(body.service_type, 10);
  if (!["weekly", "one_time"].includes(service)) errors.service_type = "Please choose weekly or one-time.";

  let phone: string | null = null;
  const phoneRaw = str(body.phone, 30);
  if (phoneRaw) {
    let d = phoneRaw.replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length !== 10) errors.phone = "Please enter a 10-digit phone number.";
    else phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  let email: string | null = null;
  const emailRaw = str(body.email, 254).toLowerCase();
  if (emailRaw) {
    if (emailRaw.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailRaw)) errors.email = "Please enter a valid email address.";
    else email = emailRaw;
  }
  if (!phoneRaw && !emailRaw) errors.contact = "Please add a phone number or email so we can reach you.";

  const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notesRaw.length > 1000) errors.notes = "Please keep notes under 1,000 characters.";
  const notes = notesRaw ? notesRaw.slice(0, 1000) : null;

  if (Object.keys(errors).length) {
    return json(origin, { error: "Please fix the highlighted fields.", fields: errors }, 400);
  }

  // ---- Save (success depends only on this) ----
  const row = { first_name: firstName, zip, dogs, service_type: service, phone, email, notes };
  const saved = await db("aroo_service_requests", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!saved.ok) {
    console.error("aroo-service-request: insert failed", saved.status);
    return json(origin, { error: "We couldn't send your request. Please try again, or text us at (785) 600-8801." }, 502);
  }
  const [{ id }] = await saved.json();

  await db("aroo_events", { method: "POST", body: JSON.stringify({ event: "request_submitted", placement: "form" }) })
    .catch(() => {});

  // ---- Notify (awaited so the function isn't torn down mid-send) ----
  let emailStatus = "failed";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const serviceLabel = service === "weekly" ? "Weekly" : "One-time";
    const dogsLabel = dogs === "1" ? "1 dog" : dogs === "2" ? "2 dogs" : "3+ dogs";
    const html = `
      <h2 style="margin:0 0 12px">New aroo. service request</h2>
      <p><strong>Name:</strong> ${esc(firstName)}</p>
      <p><strong>ZIP:</strong> ${esc(zip)}</p>
      <p><strong>Dogs:</strong> ${esc(dogsLabel)}</p>
      <p><strong>Service:</strong> ${esc(serviceLabel)}</p>
      ${phone ? `<p><strong>Phone:</strong> <a href="tel:${esc(phone.replace(/\D/g, ""))}">${esc(phone)}</a></p>` : ""}
      ${email ? `<p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>` : ""}
      ${notes ? `<p><strong>Notes:</strong><br>${esc(notes).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="color:#777;font-size:12px">Request ${esc(id)} · saved in Supabase table aroo_service_requests</p>`;
    for (const from of NOTIFY_FROM) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [NOTIFY_TO],
            ...(email ? { reply_to: email } : {}),
            subject: `New request: ${serviceLabel}, ${dogsLabel}, ${zip}`,
            html,
          }),
        });
        if (r.ok) { emailStatus = from.includes("aroodog.com") ? "sent" : "sent_fallback"; break; }
        console.error("aroo-service-request: email failed", r.status);
      } catch {
        console.error("aroo-service-request: email error");
      }
    }
  }
  await db(`aroo_service_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ email_status: emailStatus }) })
    .catch(() => {});

  return json(origin, { ok: true });
});
