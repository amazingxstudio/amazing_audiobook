import { Client } from "@gradio/client";

// Vercel: allow a longer run for TTS. If your plan rejects 60, lower it.
export const config = { maxDuration: 60 };

const SPACE = process.env.VOXCPM_SPACE || "openbmb/VoxCPM-Demo";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { text, control = "", cfg = 2.0 } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const opts = process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : {};
    const client = await Client.connect(SPACE, opts);

    // Parameters copied from the Space's API docs (/generate, 8 params)
    const result = await client.predict("/generate", {
      text_input: text,
      control_instruction: control,
      reference_wav_path_input: null,
      use_prompt_text: false,
      prompt_text_input: "",
      cfg_value_input: Number(cfg),
      do_normalize: false,
      denoise: false,
    });

    const file = result.data?.[0];
    const url = file?.url || file?.path;
    if (!url) {
      return res.status(502).json({ error: "No audio returned", raw: result.data });
    }
    return res.status(200).json({ url });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
