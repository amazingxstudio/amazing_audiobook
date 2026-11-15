// Audio proxy. Only needed when the browser cannot fetch the Space's temporary audio URL directly (CORS).
// GET /api/audio?u=<audio url>[&s=<owner/space-name>]
// Safety: https only, host must be exactly the configured Space's host (<owner>-<name>.hf.space),
// redirects are followed manually and re-checked, and the response is capped at ~4.4 MB (Vercel's limit is ~4.5 MB).

const DEFAULT_SPACE = process.env.VOXCPM_SPACE || "openbmb/VoxCPM-Demo";
const SPACE_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_BYTES = 4.4 * 1024 * 1024;

// Hugging Face turns "owner/Space_Name" into "owner-space-name.hf.space"
export function spaceHost(space) {
  return space.toLowerCase().replace(/[/_.]/g, "-") + ".hf.space";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const space = req.query?.s && SPACE_RE.test(String(req.query.s)) ? String(req.query.s) : DEFAULT_SPACE;
  const allowedHost = spaceHost(space);

  let url;
  try { url = new URL(String(req.query?.u || "")); } catch { return res.status(400).json({ error: "u must be a valid URL" }); }

  try {
    let r;
    for (let hop = 0; hop < 3; hop++) {
      if (url.protocol !== "https:" || url.hostname !== allowedHost) {
        return res.status(403).json({ error: `host not allowed (expected ${allowedHost})` });
      }
      r = await fetch(url, { redirect: "manual" });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), url); continue; }
      break;
    }
    if (!r || !r.ok) return res.status(502).json({ error: `upstream HTTP ${r ? r.status : "?"}` });
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return res.status(413).json({ error: `audio is ${len} bytes; lower the chunk size` });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: `audio is ${buf.length} bytes; lower the chunk size` });
    res.setHeader("Content-Type", r.headers.get("content-type") || "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).json({ error: String(err?.message || err) });
  }
}
