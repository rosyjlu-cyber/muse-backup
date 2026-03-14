import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return jsonError("unauthorized", 401);

    const body = await req.json();
    const { action } = body;

    if (action === "scan")
      return await handleScan(body, user.id, supabaseAdmin);
    if (action === "generate")
      return await handleGenerate(body, user.id, supabaseAdmin);
    if (action === "processBackground")
      return await handleProcessBackground(body, user.id, supabaseAdmin);
    return jsonError("invalid action", 400);
  } catch (e: any) {
    return jsonError(e?.message ?? "internal error", 500);
  }
});

// ─── Fuzzy label matching ─────────────────────────────────────────────────────

const COLOR_WORDS = new Set([
  "black",
  "white",
  "grey",
  "gray",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "beige",
  "navy",
  "cream",
  "khaki",
  "olive",
  "teal",
  "coral",
  "burgundy",
  "tan",
  "ivory",
  "charcoal",
  "gold",
  "silver",
  "camel",
  "rust",
  "sage",
  "lavender",
  "maroon",
  "mint",
  "nude",
  "multicolor",
  "multicolour",
  "patterned",
]);

// Visually distinctive materials/textures — different material = different item
const MATERIAL_WORDS = new Set([
  "velvet",
  "tweed",
  "silk",
  "satin",
  "linen",
  "wool",
  "woolen",
  "leather",
  "suede",
  "chiffon",
  "lace",
  "fleece",
  "cashmere",
  "corduroy",
  "shearling",
  "mesh",
  "denim",
  "sequin",
  "sequined",
  "embroidered",
  "crochet",
  "knit",
  "ribbed",
  "woven",
  "seersucker",
  "chambray",
  "canvas",
  "organza",
  "taffeta",
  "brocade",
  "jersey",
]);

// Normalized cut/silhouette descriptors — different cut = different item
const CUT_WORDS = new Set([
  // Necklines
  "boatneck",
  "crewneck",
  "vneck",
  "turtleneck",
  "halter",
  "strapless",
  "cowl",
  "scoop",
  "offtheshoulder",
  // Waist rise
  "highrise",
  "midrise",
  "lowrise",
  // Pants leg silhouette
  "wideleg",
  "straightleg",
  "bootcut",
  "barrelleg",
  "flared",
  "skinny",
  "tapered",
  // Skirt silhouettes
  "pencil",
  "aline",
  "pleated",
  "tiered",
  "bodycon",
  "balloon",
  "bubble",
  // Shorts style
  "biker",
  "cargo",
  "cutoff",
  "bermuda",
  "capri",
  // Garment length (tops, skirts, dresses)
  "mini",
  "midi",
  "maxi",
  "micro",
  "crop",
  "cropped",
  // Footwear shaft height
  "ankle",
  "kneehigh",
  "calf",
  "thighhigh",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "by",
  "to",
  "my",
  "your",
  "is",
  "it",
  "its",
  "this",
]);

// Normalize multi-word cut terms into single tokens before tokenizing
function normalizeCuts(s: string): string {
  return s
    .toLowerCase()
    .replace(/high[\s-]rise/g, "highrise")
    .replace(/mid[\s-]rise/g, "midrise")
    .replace(/low[\s-]rise/g, "lowrise")
    .replace(/wide[\s-]leg/g, "wideleg")
    .replace(/straight[\s-]leg/g, "straightleg")
    .replace(/boot[\s-]cut/g, "bootcut")
    .replace(/barrel[\s-]leg/g, "barrelleg")
    .replace(/boat[\s-]neck/g, "boatneck")
    .replace(/crew[\s-]neck/g, "crewneck")
    .replace(/v[\s-]neck/g, "vneck")
    .replace(/off[\s-]the[\s-]shoulder/g, "offtheshoulder")
    .replace(/a[\s-]line/g, "aline")
    .replace(/body[\s-]con/g, "bodycon")
    .replace(/cut[\s-]off/g, "cutoff")
    .replace(/knee[\s-]?high/g, "kneehigh")
    .replace(/thigh[\s-]?high/g, "thighhigh")
    .replace(/full[\s-]?length/g, "fulllength")
    .replace(/\bflare\b/g, "flared")
    .replace(/flare[\s-]leg/g, "flared");
}

function tokenize(s: string): Set<string> {
  return new Set(
    normalizeCuts(s)
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .filter((w) => w && !STOP_WORDS.has(w)),
  );
}

function itemSimilarity(
  a: {
    label: string;
    ai_description?: string | null;
    category?: string | null;
  },
  b: {
    label: string;
    ai_description?: string | null;
    category?: string | null;
  },
): number {
  // Category gate — if both have categories and differ, can't be the same item
  if (a.category && b.category && a.category !== b.category) return 0;

  // Color + material checks using label + ai_description combined
  // If both items mention colors (or materials) that don't overlap → definitely different items
  const tokA = tokenize(`${a.label} ${a.ai_description ?? ""}`);
  const tokB = tokenize(`${b.label} ${b.ai_description ?? ""}`);
  const colA = [...tokA].filter((w) => COLOR_WORDS.has(w));
  const colB = [...tokB].filter((w) => COLOR_WORDS.has(w));
  if (colA.length > 0 && colB.length > 0 && !colA.some((c) => colB.includes(c)))
    return 0;
  const matA = [...tokA].filter((w) => MATERIAL_WORDS.has(w));
  const matB = [...tokB].filter((w) => MATERIAL_WORDS.has(w));
  if (matA.length > 0 && matB.length > 0 && !matA.some((m) => matB.includes(m)))
    return 0;
  const cutA = [...tokA].filter((w) => CUT_WORDS.has(w));
  const cutB = [...tokB].filter((w) => CUT_WORDS.has(w));
  if (cutA.length > 0 && cutB.length > 0 && !cutA.some((c) => cutB.includes(c)))
    return 0;

  // Label word-overlap (Jaccard) as the core score
  const labA = tokenize(a.label);
  const labB = tokenize(b.label);
  if (labA.size === 0 || labB.size === 0) return 0;
  let n = 0;
  for (const w of labA) if (labB.has(w)) n++;
  return n / Math.max(labA.size, labB.size);
}

// ─── Scan: identify + match + generate ───────────────────────────────────────

async function handleScan(body: any, userId: string, supabase: any) {
  const { postId, photoUrl } = body;
  if (!postId || !photoUrl) return jsonError("missing postId or photoUrl", 400);

  // Verify post belongs to caller
  const { data: post } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();
  if (!post) return jsonError("post not found or not yours", 403);

  // Fetch caller's existing wardrobe items — only fields needed for matching + prompt context
  const { data: existing } = await supabase
    .from("wardrobe_items")
    .select("id, label, category, ai_description, generated_image_url")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const existingItems: any[] = existing ?? [];

  const identified = await identifyItems(photoUrl);
  console.log(`scan: identified ${identified.length} items`);
  if (identified.length === 0) return jsonOk({ items: [] });

  // Match each identified item to an existing wardrobe item or create a new one
  const resolvedItems: any[] = [];
  for (const item of identified) {
    const match = existingItems.find((e) => itemSimilarity(item, e) >= 0.7);
    if (match) {
      if (!resolvedItems.some((r) => r.id === match.id))
        resolvedItems.push(match);
    } else {
      const { data: created, error: createErr } = await supabase
        .from("wardrobe_items")
        .insert({
          user_id: userId,
          label: item.label,
          description: item.label, // pre-fill user notes with the label as a starting point
          ai_description: item.ai_description ?? null,
          category: item.category ?? null,
        })
        .select()
        .single();
      if (createErr) {
        console.error(
          `scan: failed to insert item "${item.label}":`,
          createErr.message,
        );
      } else if (created) {
        existingItems.push(created);
        resolvedItems.push(created);
      }
    }
  }

  console.log(`scan: resolved ${resolvedItems.length} items`);
  // Link post → wardrobe items (replace any previous links for this post)
  await supabase.from("post_wardrobe_items").delete().eq("post_id", postId);
  if (resolvedItems.length > 0) {
    await supabase
      .from("post_wardrobe_items")
      .insert(
        resolvedItems.map((item) => ({
          post_id: postId,
          wardrobe_item_id: item.id,
        })),
      );
  }

  return jsonOk({ items: resolvedItems });
}

// ─── Generate: (re-)generate image for one item ───────────────────────────────

async function handleGenerate(body: any, userId: string, supabase: any) {
  const { itemId } = body;
  if (!itemId) return jsonError("missing itemId", 400);

  const { data: item } = await supabase
    .from("wardrobe_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();
  if (!item) return jsonError("item not found", 404);

  // Source photo: prefer most recent linked outfit post; fall back to item's own photos
  const { data: postLinks } = await supabase
    .from("post_wardrobe_items")
    .select("post:posts(photo_url, created_at)")
    .eq("wardrobe_item_id", itemId);
  const sorted = ((postLinks ?? []) as any[]).sort(
    (a, b) =>
      new Date(b.post?.created_at).getTime() -
      new Date(a.post?.created_at).getTime(),
  );
  let sourcePhotoUrl: string | null = sorted[0]?.post?.photo_url ?? null;
  if (!sourcePhotoUrl) {
    const { data: itemPhotos } = await supabase
      .from("wardrobe_item_photos")
      .select("photo_url")
      .eq("item_id", itemId)
      .limit(1);
    sourcePhotoUrl = itemPhotos?.[0]?.photo_url ?? null;
  }

  // Return immediately — generate in background so the HTTP request doesn't time out
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        console.log(`generate: starting for item ${item.id} "${item.label}"`);
        const url = await generateAndStore(
          item.label,
          item.ai_description,
          item.id,
          supabase,
          sourcePhotoUrl,
          item.category,
        );
        await supabase
          .from("wardrobe_items")
          .update({ generated_image_url: url })
          .eq("id", item.id);
        console.log(`generate: done for item ${item.id}`);
      } catch (e: any) {
        console.error(`generate: failed for item ${item.id}:`, e?.message ?? e);
      }
    })(),
  );

  return jsonOk({ item }); // current state — no image yet
}

// ─── Background removal ───────────────────────────────────────────────────────

async function handleProcessBackground(
  body: any,
  userId: string,
  supabase: any,
) {
  const { photoId } = body;
  if (!photoId) return jsonError("missing photoId", 400);

  const removebgKey = Deno.env.get("REMOVEBG_API_KEY");
  if (!removebgKey) return jsonError("background removal not configured", 400);

  // Verify ownership via item
  const { data: photo } = await supabase
    .from("wardrobe_item_photos")
    .select("*, item:wardrobe_items!inner(user_id, id)")
    .eq("id", photoId)
    .single();
  if (!photo || photo.item.user_id !== userId)
    return jsonError("not found", 404);

  try {
    const rbRes = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": removebgKey, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: photo.photo_url, size: "auto" }),
    });
    if (!rbRes.ok) throw new Error(`remove.bg: ${await rbRes.text()}`);

    const imgBytes = await rbRes.arrayBuffer();
    const path = `wardrobe/${photo.item.id}/rb_${Date.now()}.png`;
    await supabase.storage.from("outfit-photos").remove([path]);
    const { error: upErr } = await supabase.storage
      .from("outfit-photos")
      .upload(path, imgBytes, { contentType: "image/png" });
    if (upErr) throw upErr;

    const finalUrl = supabase.storage.from("outfit-photos").getPublicUrl(path)
      .data.publicUrl;
    await supabase
      .from("wardrobe_item_photos")
      .update({ photo_url: finalUrl })
      .eq("id", photoId);
    return jsonOk({ photo_url: finalUrl });
  } catch (e: any) {
    return jsonError(e?.message ?? "background removal failed", 500);
  }
}

// ─── GPT-4o vision ────────────────────────────────────────────────────────────

async function identifyItems(
  photoUrl: string,
): Promise<Array<{ label: string; ai_description: string; category: string }>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: photoUrl, detail: "high" } },
            {
              type: "text",
              text: `Look at this outfit photo. List each distinct wearable fashion item the person is wearing.

Only include: clothing, shoes, bags, hats, sunglasses, scarves, belts. Do NOT include jewellery, watches, phone cases, phones, electronics, food, furniture, props, or anything not worn/carried as a fashion item.

Identify garment type by silhouette first, not color. If a single continuous garment covers both the torso and legs, it is a dress or jumpsuit — never jeans or pants. Do not let color (e.g. blue) cause you to misidentify a dress as jeans.

Return ONLY a JSON array, no markdown fences, no explanation. Each element:
{ "label": "3–5 word item name following the pattern [color] [most-distinctive-feature] [garment-type] — the middle slot is whichever single feature best identifies this item: material/texture (velvet, tweed, ribbed, denim, leather), cut (high-rise, wrap, flare-leg, bootcut, oversized, cropped), embellishment (bow-sleeve, ruffle-hem, sequined, floral-embroidered), or pattern (striped, plaid, tie-dye). Examples: navy ribbed crew-neck sweater, ivory velvet midi dress, olive tweed blazer, white bow-sleeve silk blouse, black ruffle-hem mini skirt, high-rise dark-wash flare-leg jeans, tan bootcut trousers. Use precise words, no filler.", "ai_description": "2–3 dense sentences, no filler words — write like a product photograph caption. Pack in: exact color with precise shade; material and texture; complete silhouette (neckline, waist rise, leg or skirt shape, sleeve length, hem length); every embellishment with exact location (e.g. bow on left shoulder, ruffle at hem, floral embroidery at cuffs); distinctive hardware or closures; for footwear, shaft height and toe shape.", "category": "top|bottom|outerwear|shoes|bag|accessory|dress" }

Max 8 items. If no person or clothing visible, return [].`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`vision API: ${await res.text()}`);

  const json = await res.json();
  const raw: string = json.choices?.[0]?.message?.content ?? "[]";
  try {
    const parsed = JSON.parse(
      raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Image generation + Storage upload ───────────────────────────────────────

async function generateAndStore(
  label: string,
  description: string | null,
  itemId: string,
  supabase: any,
  sourcePhotoUrl?: string | null,
  category?: string | null,
): Promise<string> {
  const placement =
    category === "shoes" || category === "bag"
      ? "Display it upright on a pure white background, as if standing on its own."
      : "Lay it flat on a pure white background, photographed from directly above.";

  const shoeInstructions =
    category === "shoes"
      ? "Match the exact shoe type (sneaker, boot, heel, flat, sandal, etc.), sole height, toe shape, lacing or straps — do NOT substitute with a different shoe style. The shoe is empty with no foot inside."
      : "";

  if (!sourcePhotoUrl) throw new Error("no source photo available");
  const photoRes = await fetch(sourcePhotoUrl);
  if (!photoRes.ok) throw new Error("could not fetch source photo");
  const photoBytes = await photoRes.arrayBuffer();

  const editPrompt = `Follow every instruction below exactly — no exceptions.\n\nIMPORTANT: No person, no body parts, no skin, no feet, no legs, no hands, no arms anywhere in the image. The item is empty — not being worn. No mannequin. No shadow. Pure white background only. Do NOT include any other items that appear in the source photo — ignore all other clothing, shoes, and accessories visible in the photo.\n\nFrom this outfit photo, produce an isolated product photo of ONLY the "${label}". ${description ?? ""} Reproduce the exact item — match the precise silhouette, style, and color. ${shoeInstructions} The image contains this single item only — everything else from the photo must be removed entirely. ${placement} The item must be zoomed out with significant empty white space surrounding it on all four sides — top, bottom, left, and right. The item should appear small within the frame, not filling the full height or width. Professional studio lighting, commercial fashion product photo.`;

  const formData = new FormData();
  formData.append("model", "gpt-image-1.5");
  formData.append("prompt", editPrompt);
  formData.append(
    "image",
    new Blob([photoBytes], { type: "image/jpeg" }),
    "photo.jpg",
  );
  formData.append("n", "1");
  formData.append("size", "1024x1024");
  formData.append("quality", "high");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);
  let b64: string | undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")!}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      b64 = (await res.json()).data?.[0]?.b64_json;
      console.log(
        `generateAndStore: image edit ${b64 ? "succeeded" : "returned no b64"}`,
      );
    } else {
      const errText = await res.text();
      throw new Error(`image edit failed: ${errText}`);
    }
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    throw fetchErr;
  }

  if (!b64) throw new Error("no image data in OpenAI response");

  const binaryStr = atob(b64);
  const imgBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++)
    imgBytes[i] = binaryStr.charCodeAt(i);

  const path = `generated/${itemId}.png`;
  await supabase.storage.from("outfit-photos").remove([path]);
  const { error: upErr } = await supabase.storage
    .from("outfit-photos")
    .upload(path, imgBytes, { contentType: "image/png" });
  if (upErr) throw new Error(`storage: ${upErr.message}`);

  return supabase.storage.from("outfit-photos").getPublicUrl(path).data
    .publicUrl;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
