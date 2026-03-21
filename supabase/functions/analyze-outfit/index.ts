import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

console.log("module loaded");

Deno.serve(async (req) => {
  console.log("request received:", req.method);
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

// ─── Suggestion matching helpers ─────────────────────────────────────────────

// Jaccard similarity on label tokens, requiring same category.
// Returns 0–1 (percentage of words that overlap). Category mismatch = 0.
const LABEL_STOP = new Set(["a","an","the","with","and","or","of","in","on","at","by","to"]);

function labelJaccard(
  a: { label: string; category?: string | null },
  b: { label: string; category?: string | null },
): number {
  // If both items have a category, they must match. If either is missing, skip category gate.
  if (a.category && b.category && a.category !== b.category) return 0;
  const tok = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/)
      .filter((w) => w.length > 1 && !LABEL_STOP.has(w)),
  );
  const tokA = tok(a.label);
  const tokB = tok(b.label);
  let intersection = 0;
  for (const w of tokA) if (tokB.has(w)) intersection++;
  const union = tokA.size + tokB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Scan: identify + insert ──────────────────────────────────────────────────

async function handleScan(body: any, userId: string, supabase: any) {
  const { postId, photoUrl, knownItems } = body;
  if (!postId || !photoUrl) return jsonError("missing postId or photoUrl", 400);
  const knownArr: Array<{ id: string; label: string; ai_description?: string | null }> = knownItems ?? [];

  // Verify post belongs to caller
  const { data: post } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();
  if (!post) return jsonError("post not found or not yours", 403);

  const identified = await identifyItems(photoUrl, knownArr);
  console.log(`scan: identified ${identified.length} items`);
  if (identified.length === 0 && knownArr.length === 0) return jsonOk({ items: [] });

  // Always create a new wardrobe item for each identified item — never match against
  // existing items. People commonly own multiple near-identical pieces; a duplicate is
  // easy to delete, but a false merge loses "worn in" history and is hard to undo.
  const resolvedItems: any[] = [];
  for (const item of identified) {
    const { data: created, error: createErr } = await supabase
      .from("wardrobe_items")
      .insert({
        user_id: userId,
        label: item.label,
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
      resolvedItems.push(created);
    }
  }

  console.log(`scan: resolved ${resolvedItems.length} items, knownArr ${knownArr.length} items`);
  // Link post → wardrobe items
  // Only delete links that aren't for known items (preserve manually-added items)
  const knownIds = new Set(knownArr.map((ki) => ki.id));
  if (knownIds.size > 0) {
    // Delete only non-known links
    const { data: existingLinks } = await supabase
      .from("post_wardrobe_items")
      .select("wardrobe_item_id")
      .eq("post_id", postId);
    const toDelete = (existingLinks ?? [])
      .map((l: any) => l.wardrobe_item_id)
      .filter((id: string) => !knownIds.has(id));
    if (toDelete.length > 0) {
      await supabase.from("post_wardrobe_items").delete()
        .eq("post_id", postId)
        .in("wardrobe_item_id", toDelete);
    }
  } else {
    // No known items — safe to delete all
    await supabase.from("post_wardrobe_items").delete().eq("post_id", postId);
  }
  // Insert new links (known items may already exist, use upsert-style ignore)
  const newLinks = resolvedItems.map((item) => ({ post_id: postId, wardrobe_item_id: item.id }));
  if (newLinks.length > 0) {
    const { error: linkErr } = await supabase.from("post_wardrobe_items").insert(newLinks);
    if (linkErr) console.error("scan: failed to insert new links:", linkErr.message);
  }
  // Ensure known items are linked (in case they were somehow removed)
  for (const ki of knownArr) {
    await supabase.from("post_wardrobe_items")
      .upsert({ post_id: postId, wardrobe_item_id: ki.id }, { onConflict: "post_id,wardrobe_item_id" });
  }
  console.log(`scan: linked ${newLinks.length} new + ${knownArr.length} known items`);

  // Compute match suggestions in background (non-blocking)
  if (resolvedItems.length > 0) {
    const newIds = resolvedItems.map((i) => i.id);
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          const { data: existingForSug } = await supabase
            .from("wardrobe_items")
            .select("id, label, ai_description, category")
            .eq("user_id", userId)
            .not("id", "in", `(${newIds.join(",")})`)
            .order("created_at", { ascending: false })
            .limit(200);
          const existingItems: any[] = existingForSug ?? [];
          const suggestions: any[] = [];
          for (const newItem of resolvedItems) {
            let bestScore = 0;
            let bestMatch: any = null;
            for (const existing of existingItems) {
              const score = labelJaccard(newItem, existing);
              if (score > bestScore) { bestScore = score; bestMatch = existing; }
            }
            if (bestMatch && bestScore >= 0.4) {
              suggestions.push({ user_id: userId, new_item_id: newItem.id, existing_item_id: bestMatch.id });
            }
          }
          if (suggestions.length > 0) {
            await supabase.from("wardrobe_suggestions").insert(suggestions);
            console.log(`scan: inserted ${suggestions.length} suggestions`);
          }
        } catch (e: any) {
          console.error("scan: suggestion computation failed:", e?.message ?? e);
        }
      })(),
    );
  }

  // Trigger image generation in the background — grid approach for 2+ items
  if (resolvedItems.length === 1) {
    // Single item — use individual generation (no grid needed)
    const item = resolvedItems[0];
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          console.log(`scan: generating single image for item ${item.id} "${item.label}"`);
          const url = await generateAndStore(
            item.label,
            item.ai_description,
            item.id,
            supabase,
            photoUrl,
            item.category,
          );
          await supabase
            .from("wardrobe_items")
            .update({ generated_image_url: url })
            .eq("id", item.id);
          console.log(`scan: image done for item ${item.id}`);
        } catch (e: any) {
          console.error(`scan: image generation failed for item ${item.id}:`, e?.message ?? e);
        }
      })(),
    );
  } else if (resolvedItems.length > 1) {
    // Multiple items — generate one grid image, crop into individual images
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          await generateGridAndCrop(resolvedItems, photoUrl, supabase);
        } catch (e: any) {
          console.error(`scan: grid generation failed:`, e?.message ?? e);
          // Fallback: generate individually if grid fails
          for (const item of resolvedItems) {
            try {
              const url = await generateAndStore(
                item.label, item.ai_description, item.id, supabase, photoUrl, item.category,
              );
              await supabase.from("wardrobe_items").update({ generated_image_url: url }).eq("id", item.id);
            } catch (fallbackErr: any) {
              console.error(`scan: fallback generation failed for ${item.id}:`, fallbackErr?.message);
            }
          }
        }
      })(),
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
  knownItems?: Array<{ label: string; ai_description?: string | null }>,
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
{ "label": "3–5 word item name following the pattern [color] [most-distinctive-feature] [garment-type]. RULES: (1) Always start with a specific color word — never omit it (e.g. ivory, forest-green, rust, camel, white, black, navy, dark-wash). If multicolored use 'multicolor'. (2) The middle slot is the single feature that best identifies this item: material/texture (velvet, tweed, ribbed, denim, leather), cut (high-rise, wrap, flare-leg, bootcut, oversized, cropped, short-sleeve, long-sleeve, sleeveless), embellishment (bow-sleeve, ruffle-hem, sequined, floral-embroidered), or pattern (striped, plaid, tie-dye). (3) Be precise — a different cut or sleeve length is a different item. Examples: navy ribbed crew-neck sweater, ivory velvet midi dress, olive tweed blazer, white short-sleeve silk blouse, black ruffle-hem mini skirt, dark-wash flare-leg jeans, tan bootcut trousers. No filler.", "ai_description": "2–3 dense sentences written as a brief for an isolated product photograph — no filler, no vague adjectives. Include: exact color with precise shade; material and texture; complete silhouette (neckline, waist rise, leg or skirt shape, sleeve length, hem length); every embellishment with exact location (e.g. bow tied at left shoulder, ruffle trim at hem, floral embroidery at cuffs); distinctive hardware, closures, or branding; for footwear, shaft height, toe shape, sole height, and any lacing or straps. Be specific enough that a model could render the item from the description alone.", "category": "top|bottom|outerwear|shoes|bag|accessory|dress" }

${knownItems && knownItems.length > 0 ? `\nThe user has already tagged these items — do NOT include them in your list:\n${knownItems.map((i) => `• ${i.label}`).join("\n")}\n` : ""}Max 8 items. If no person or clothing visible, return [].`,
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

// ─── Grid generation: one image → crop into individual items ─────────────────

async function generateGridAndCrop(
  items: any[],
  sourcePhotoUrl: string,
  supabase: any,
): Promise<void> {
  const count = items.length;
  const gridSize = count <= 4 ? 2 : 3; // 2×2 for 2-4 items, 3×3 for 5-9
  const imgSize = 1024; // always 1024x1024 (max supported by edits endpoint)
  const cellSize = Math.floor(imgSize / gridSize);

  console.log(`grid: generating ${gridSize}×${gridSize} grid for ${count} items`);

  // Assign items to grid cells (left→right, top→bottom)
  // Category order: top, dress, outerwear, bottom, shoes, bag, accessory
  const categoryOrder: Record<string, number> = {
    top: 0, dress: 1, outerwear: 2, bottom: 3, shoes: 4, bag: 5, accessory: 6,
  };
  const sorted = [...items].sort(
    (a, b) => (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99),
  );

  // Build position labels for the prompt
  const positionLabels: string[] = [];
  const positionNames = gridSize === 2
    ? ["top-left", "top-right", "bottom-left", "bottom-right"]
    : ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const pos = positionNames[i];
    const placement = item.category === "shoes" || item.category === "bag"
      ? "displayed upright"
      : "laid flat, viewed from above";
    positionLabels.push(
      `${pos}: "${item.label}" — ${item.ai_description ?? item.label}. ${placement}.`,
    );
  }

  // Fill remaining cells with "empty — pure white"
  for (let i = sorted.length; i < gridSize * gridSize; i++) {
    positionLabels.push(`${positionNames[i]}: EMPTY — pure white, nothing here.`);
  }

  const gridPrompt = `Follow every instruction below exactly — no exceptions.

IMPORTANT: No person, no body parts, no skin, no feet, no legs, no hands, no arms anywhere in the image. Every item is empty — not being worn. No mannequin. No shadow.

From this outfit photo, produce a single image containing a ${gridSize}×${gridSize} grid of isolated product photos on a pure white background.

GRID RULES:
- The image is divided into exactly ${gridSize} columns and ${gridSize} rows of EQUAL size.
- Each cell contains ONLY ONE isolated item, centered within that cell with generous white padding on all sides.
- Items must NOT cross cell boundaries — each item must fit entirely within its assigned cell.
- Do NOT draw any lines, borders, dividers, or gridlines between cells. The only separation is white space.
- Every cell's background is pure white — the entire image background is pure white.

CELL ASSIGNMENTS:
${positionLabels.join("\n")}

For each item: reproduce the EXACT item from the photo — match precise silhouette, color, material, and details. For shoes: match exact shoe type, empty with no foot inside. Professional studio lighting, commercial fashion product photo style. Each item should appear small within its cell, not filling the full cell.`;

  // Fetch source photo
  const photoRes = await fetch(sourcePhotoUrl);
  if (!photoRes.ok) throw new Error("could not fetch source photo for grid");
  const photoBytes = await photoRes.arrayBuffer();

  const formData = new FormData();
  formData.append("model", "gpt-image-1.5");
  formData.append("prompt", gridPrompt);
  formData.append(
    "image",
    new Blob([photoBytes], { type: "image/jpeg" }),
    "photo.jpg",
  );
  formData.append("n", "1");
  formData.append("size", `${imgSize}x${imgSize}`);
  formData.append("quality", "high");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 80000); // longer timeout for grid
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
      console.log(`grid: image edit ${b64 ? "succeeded" : "returned no b64"}`);
    } else {
      const errText = await res.text();
      throw new Error(`grid image edit failed: ${errText}`);
    }
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    throw fetchErr;
  }

  if (!b64) throw new Error("no image data in grid response");

  // Decode the grid image using UPNG (pure JS, works in Deno Deploy)
  const binaryStr = atob(b64);
  const gridBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) gridBytes[i] = binaryStr.charCodeAt(i);

  const UPNG = (await import("https://esm.sh/upng-js@2.1.0")).default;
  const decoded = UPNG.decode(gridBytes.buffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  const fullW = decoded.width;
  const fullH = decoded.height;
  console.log(`grid: decoded ${fullW}x${fullH}`);

  // Crop each cell and upload
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const col = i % gridSize;
    const row = Math.floor(i / gridSize);
    // Inset crop by a few pixels on each edge to remove any gridline artifacts
    const INSET = Math.round(cellSize * 0.03); // ~3% inset per side
    const cropX = col * cellSize + INSET;
    const cropY = row * cellSize + INSET;
    // Clamp cell size to image bounds
    const cw = Math.min(cellSize - INSET * 2, fullW - cropX);
    const ch = Math.min(cellSize - INSET * 2, fullH - cropY);

    try {
      // Extract cell pixels from RGBA buffer
      const cellPixels = new Uint8Array(cw * ch * 4);
      for (let py = 0; py < ch; py++) {
        const srcOffset = ((cropY + py) * fullW + cropX) * 4;
        const dstOffset = py * cw * 4;
        cellPixels.set(rgba.subarray(srcOffset, srcOffset + cw * 4), dstOffset);
      }
      // Re-encode as PNG
      const cellPng = new Uint8Array(UPNG.encode([cellPixels.buffer], cw, ch, 0));

      // Upload
      const path = `generated/${item.id}.png`;
      await supabase.storage.from("outfit-photos").remove([path]);
      const { error: upErr } = await supabase.storage
        .from("outfit-photos")
        .upload(path, cellPng, { contentType: "image/png" });
      if (upErr) throw new Error(`storage: ${upErr.message}`);

      const url = supabase.storage.from("outfit-photos").getPublicUrl(path).data.publicUrl;
      await supabase
        .from("wardrobe_items")
        .update({ generated_image_url: url })
        .eq("id", item.id);
      console.log(`grid: cropped + uploaded cell [${row},${col}] for item ${item.id} "${item.label}"`);
    } catch (cropErr: any) {
      console.error(`grid: failed to crop/upload cell for item ${item.id}:`, cropErr?.message);
    }
  }

  console.log(`grid: done — ${sorted.length} items from 1 image`);
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
