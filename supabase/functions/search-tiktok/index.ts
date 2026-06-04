import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, getAuthenticatedUser } from "../_shared/supabase.ts";

type WorkerTikTokResult = {
  resultUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
  viewCount: number | null;
  uploader: string | null;
  raw: Record<string, unknown>;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await getAuthenticatedUser(request);
    const service = createServiceClient();
    const body = await request.json();
    const query = String(body.query ?? "").trim().replace(/\s+/g, " ");
    const limit = clampLimit(body.limit);

    if (query.length < 2) {
      throw new Error("query is required");
    }

    const cached = await loadCachedResults(service, user.id, query, limit);
    if (cached.length >= limit) {
      return jsonResponse({ query, cached: true, results: cached });
    }

    const workerResults = await fetchWorkerResults(query, limit);
    const rows = workerResults.map((result) => ({
      user_id: user.id,
      query,
      result_url: result.resultUrl,
      title: result.title,
      thumbnail_url: result.thumbnailUrl,
      duration_s: nullableInteger(result.durationS),
      view_count: nullableInteger(result.viewCount),
      uploader: result.uploader,
      raw: result.raw,
      searched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await service
        .from("tiktok_search_results")
        .upsert(rows, { onConflict: "user_id,query,result_url" });
      if (error) throw error;
    }

    const fresh = await loadCachedResults(service, user.id, query, limit);
    return jsonResponse({ query, cached: false, results: fresh });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
});

async function loadCachedResults(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  query: string,
  limit: number,
) {
  const { data, error } = await service
    .from("tiktok_search_results")
    .select("*")
    .eq("user_id", userId)
    .eq("query", query)
    .gt("expires_at", new Date().toISOString())
    .order("searched_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

async function fetchWorkerResults(query: string, limit: number) {
  const workerUrl = Deno.env.get("VIDEO_WORKER_URL");
  const workerSecret = Deno.env.get("VIDEO_WORKER_SECRET");
  if (!workerUrl) {
    throw new Error("Missing VIDEO_WORKER_URL");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (workerSecret) {
    headers.Authorization = `Bearer ${workerSecret}`;
  }

  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/search-tiktok`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, limit }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404) {
      throw new Error(
        "TikTok worker search endpoint not found. Rebuild/redeploy the video worker container with the latest code.",
      );
    }
    throw new Error(`TikTok worker search failed: ${text}`);
  }

  const payload = await response.json() as { results?: WorkerTikTokResult[] };
  return payload.results ?? [];
}

function clampLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
}

function nullableInteger(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}
