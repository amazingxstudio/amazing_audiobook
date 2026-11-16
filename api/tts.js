import { Client, handle_file } from "@gradio/client";

// Vercel: allow a longer run for TTS. If your plan rejects 60, lower it.
export const config = { maxDuration: 60 };

const DEFAULT_SPACE = process.env.VOXCPM_SPACE || "openbmb/VoxCPM-Demo";
const SPACE_RE = /^[\w.-]+\/[\w.-]+$/; // owner/space-name
const MAX_REF_B64 = 3.2 * 1024 * 1024;  // request bodies are limited to ~4.5 MB on Vercel

// Request: { text, control, cfg, space?, ref? }   ->   { url }
//   space : optional Space override (Settings screen)
//   ref   : optional voice-cloning audio { b64: <base64 WAV>, text?: <exact transcript of the audio> }
//           with `text`  -> "ultimate cloning" (the Space continues from the reference voice)
//           without text -> reference-only cloning (the control instruction still applies)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { text, control = "", cfg = 2.0, space, ref } = req.body || {};
  if (space !== undefined && space !== "" && !SPACE_RE.test(String(space))) {
    return res.status(400).json({ error: "space must look like owner/space-name" });
  }
  const SPACE = space ? String(space) : DEFAULT_SPACE;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (ref && (typeof ref.b64 !== "string" || ref.b64.length > MAX_REF_B64)) {
    return res.status(400).json({ error: "ref.b64 must be a base64 WAV string under ~3 MB" });
  }

  try {
    // Never send the HF token to an overridden Space (it would leak the token to a third party).
    const opts = process.env.HF_TOKEN && SPACE === DEFAULT_SPACE ? { hf_token: process.env.HF_TOKEN } : {};
    const client = await Client.connect(SPACE, opts);

    let refFile = null;
    const promptText = ref && typeof ref.text === "string" ? ref.text.trim() : "";
    if (ref) {
      const buf = Buffer.from(ref.b64, "base64");
      const blob = typeof File !== "undefined" ? new File([buf], "ref.wav", { type: "audio/wav" }) : new Blob([buf], { type: "audio/wav" });
      refFile = handle_file(blob); // uploaded to the Space by the gradio client
    }

    // Parameters copied from the Space's API docs (/generate, 8 params)
    const result = await client.predict("/generate", {
      text_input: text,
      control_instruction: control,
      reference_wav_path_input: refFile,
      use_prompt_text: !!(refFile && promptText),
      prompt_text_input: refFile ? promptText : "",
      cfg_value_input: Number(cfg),
      do_normalize: false,
      denoise: false,
    });

    const file = result.data?.[0];
    let url = file?.url || file?.path;
    if (url && url.startsWith("/")) url = `https://${SPACE.toLowerCase().replace(/[/_.]/g, "-")}.hf.space${url}`;
    if (!url) {
      return res.status(502).json({ error: "No audio returned", raw: result.data });
    }
    return res.status(200).json({ url, cloned: !!refFile, promptText: !!(refFile && promptText) });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
