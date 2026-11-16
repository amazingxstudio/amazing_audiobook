// GET /api/space-info[?s=owner/space]  ->  tells the Settings screen whether the Space accepts a reference voice.
import { Client } from "@gradio/client";

const DEFAULT_SPACE = process.env.VOXCPM_SPACE || "openbmb/VoxCPM-Demo";
const SPACE_RE = /^[\w.-]+\/[\w.-]+$/;

export default async function handler(req, res) {
  const s = req.query?.s ? String(req.query.s) : "";
  if (s && !SPACE_RE.test(s)) return res.status(400).json({ error: "space must look like owner/space-name" });
  const space = s || DEFAULT_SPACE;
  try {
    const opts = process.env.HF_TOKEN && space === DEFAULT_SPACE ? { hf_token: process.env.HF_TOKEN } : {};
    const client = await Client.connect(space, opts);
    const api = await client.view_api();
    const gen = api?.named_endpoints?.["/generate"];
    const names = (gen?.parameters || []).map((p) => p.parameter_name || p.label);
    return res.status(200).json({
      space, hasGenerate: !!gen, params: names,
      cloning: names.includes("reference_wav_path_input"),
      promptText: names.includes("prompt_text_input") && names.includes("use_prompt_text"),
    });
  } catch (err) {
    return res.status(502).json({ error: String(err?.message || err) });
  }
}
