# Burmese Audiobook - ဖိုင်စာရင်း

## ဘယ်လိုသုံးမလဲ (အတိုချုပ်)
1. **စာကြည့်တိုက်** → "PDF ထည့်မည်" → PDF ရွေး → အခန်းများ စစ် → သိမ်း။
2. စာအုပ်ကို ဖွင့်ပြီး **"စာအုပ်တစ်အုပ်လုံး ထုတ်မည်"** ကိုနှိပ်ပါ။
3. **အသံတူစေရန်** (စာအုပ်ဖွင့်ထားသည့်စာမျက်နှာ၏ "အသံ" အကန့်):
   - ဘာမှမလုပ်လည်း ရသည် - ပထမအပိုင်း ထုတ်ပြီးသည်နှင့် ထိုအသံကို လော့ခ်ချပြီး နောက်အပိုင်းအားလုံးကို ထိုအသံဖြင့် ထုတ်သည်။
   - ကြိုက်သောအသံ ရွေးလိုလျှင် **"အသံ စမ်းမည်"** ကို နှိပ်ပြီး ကြိုက်လျှင် **"ဤအသံကို သုံးမည်"**။
   - ကိုယ့်အသံ clone လုပ်လိုလျှင် **"ကိုယ့်အသံနမူနာဖြင့် ကူးယူမည်"** ကိုဖွင့် → အသံဖိုင်ရွေး (သန့်ရှင်း၊ စက္ကန့် ၅-၂၀) → ထိုအသံထဲက စကားကို အတိအကျ ရိုက်ထည့် → **"သိမ်းပြီး စမ်းမည်"**။ ကူးထားသောအသံကို ချက်ချင်း ကြားရမည်။
4. **အသံပေါင်း** တက်ဘ်: ဖုန်းထဲက အသံဖိုင်များ (သို့) စာအုပ်ထဲက အခန်းများကို တစ်ဖိုင်တည်း (WAV) ပေါင်းသည်။ အသံအသစ် မထုတ်ပါ။

## api/ (Vercel — ဖိုလ်ဒါအမည် အက္ခရာသေးသာ)
- `api/tts.js` — `POST {text, control, cfg}` → `{url}` မူလအတိုင်း။ **ထပ်ထည့်ထားသည်**: `ref: {b64, text?}` (clone အသံ)၊ `space` (override)။ Space ၏ `reference_wav_path_input` / `use_prompt_text` / `prompt_text_input` သို့ တကယ်ပို့သည်။
- `api/audio.js` — CORS ပိတ်ခံရမှသာ သုံးမည့် proxy (hf.space host တစ်ခုတည်း၊ 4.4 MB ကန့်သတ်)။
- `api/space-info.js` — Settings ၏ "Space နှင့် clone စစ်မည်" အတွက်။

## public/
- `index.html` — floating header (MM|EN)၊ floating bottom nav (စာအုပ်စင်၊ နားထောင်၊ အသံပေါင်း၊ ဆက်တင်)။
- `tts-test.html` — မူလ စမ်းသပ်စာမျက်နှာ။
- `css/app.css` — Glassmorphism၊ အလင်း/အမှောင်၊ မြန်မာစာ line-height စည်းမျဉ်းများ။
- `js/app.js` router + select ပိတ်ဆို့မှု · `i18n.js` MM/EN အဘိဓာန် · `ui.js` panel/inline error · `dom.js`
- `js/store.js` IndexedDB · `settings.js` · `errors.js`
- `js/pdf.js` PDF · `zawgyi.js` · `cleanup.js` · `splitter.js` · `chunker.js`
- `js/generator.js` အသံထုတ် + **voice lock/clone** + စာအုပ်တစ်အုပ်လုံး · `queue.js` retry
- `js/refaudio.js` clone နမူနာအသံ (16 kHz mono) ပြင်ဆင် · `audio.js` ဒေါင်းလုဒ်/WAV · `merger.js` **အသံဖိုင်ပေါင်း engine**
- `js/player.js` ဆက်တိုက်ဖွင့်စနစ် · `chapter-audio.js` · `book-model.js` · `sample.js` · `analyzer.js` (နောက်အဆင့် hook)
- `js/views/` — `library.js` `import.js` `book.js` `voice-box.js` `chapter-editor.js` `player.js` `merge.js` `settings.js` (ဆက်သွယ်ရန် ပါ)

## tests/
`npm test` — unit၊ i18n၊ API။

## ဆက်သွယ်ရန်
Telegram: @aung_myat_minn · Gmail: amazingxstudio@google.com · Team: AmazinG
