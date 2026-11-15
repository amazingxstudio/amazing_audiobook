# ဖိုင်စာရင်း (Audiobook Step 2)

## api/ (Vercel serverless — ဖိုလ်ဒါအမည် အက္ခရာသေးသာ)
- `api/tts.js` — မူလ endpoint (`POST /api/tts {text, control, cfg}` → `{url}`)။ ပြင်ချက် ၂ ခုသာ: ရွေးချယ်စရာ `space` field ထည့်ထားသည် (Settings ၏ Space override)၊ override Space သို့ HF token မပို့ရန် ကာကွယ်ထားသည်။
- `api/audio.js` — အသစ်။ ဘရောက်ဇာက Space ၏ အသံလင့်ခ်ကို CORS ကြောင့် တိုက်ရိုက် မယူနိုင်မှသာ သုံးမည့် proxy။ `<owner>-<name>.hf.space` host တစ်ခုတည်းကိုသာ ခွင့်ပြုသည်၊ 4.4 MB ကန့်သတ်။

## public/
- `index.html` — အပြင်ဘောင် (header၊ MM|EN ခလုတ်၊ အောက်ခြေ မီနူး)။ စာသား hard-code မပါ။
- `tts-test.html` — မူလ စမ်းသပ်စာမျက်နှာ (မပြောင်းဘဲ ထိန်းထား)။
- `css/app.css` — အရောင်/အလင်း-အမှောင်၊ မြန်မာစာ line-height၊ wrap စည်းမျဉ်းများ၊ စာရွက်ကြိုးပုံ ခွဲ progress bar။

## public/js/ (module များ)
- `app.js` — router၊ မီနူး၊ စာသား/ပုံ ရွေးချယ်ခြင်း (long-press) ပိတ်ဆို့မှု။
- `i18n.js` — `I18N.mm` / `I18N.en` ဘာသာပြန်အဘိဓာန် + ချက်ချင်းပြောင်းသည့် engine။
- `dom.js`, `ui.js` — DOM ကူညီကိရိယာ၊ error alert၊ confirm dialog၊ chunk progress bar။
- `errors.js` — ဘာသာပြန်ကီးပါသော error class။
- `settings.js` — chunk size၊ cfg၊ Space override၊ speed (localStorage)။
- `store.js` — IndexedDB (စာအုပ်များ + အသံ blob များ)။
- `pdf.js` — pdf.js (cdnjs 3.11.174) ဖြင့် စာသားထုတ်ခြင်း။
- `zawgyi.js` — Zawgyi စစ်ဆေးခြင်း + အခြေခံ Zawgyi→Unicode ပြောင်းကိရိယာ။
- `cleanup.js` — စာမျက်နှာနံပါတ်၊ ခေါင်းစီး/ခြေစီး ဖယ်ခြင်း၊ ကြောင်းတွဲခြင်း။
- `splitter.js` — အခန်းခေါင်းစဉ် ရှာခြင်း၊ အပိုင်းအစ fallback၊ ပေါင်း/ခွဲ/ဖျက် လုပ်ဆောင်ချက်များ။
- `chunker.js` — ။ ၊ နှင့် syllable ကိုမဖြတ်သော chunk ခွဲခြင်း၊ chunk key (hash)။
- `queue.js` — တစ်ခုချင်း queue (pause/resume/cancel) + ၃ ကြိမ် retry/backoff။
- `generator.js` — အခန်းတစ်ခု၏ အသံထုတ်လုပ်ငန်း (ထုတ်ပြီးသည်ကျော်၊ မအောင်မြင်သည်သာ ပြန်လုပ်)။
- `audio.js` — အသံလင့်ခ် ဒေါင်းလုဒ် (CORS auto-detect + proxy fallback)၊ WAV ပေါင်းခြင်း။
- `chapter-audio.js` — အခန်းတစ်ခု WAV ဒေါင်းလုဒ်။
- `player.js` — audio ၂ ခု အလှည့်ကျ သုံးသော ဆက်တိုက်ဖွင့်စနစ်၊ Media Session။
- `book-model.js`, `sample.js` — စာအုပ်/အသံပရိုဖိုင် ပုံစံ၊ နမူနာစာအုပ်။
- `analyzer.js` — နောက်အဆင့် (စကားပြောသူ/စိတ်ခံစားမှု အလိုအလျောက်သိခြင်း) အတွက် hook သာ၊ မလုပ်ရသေး။
- `views/` — `library.js`, `import.js`, `book.js` (အခန်း/အသံပရိုဖိုင်/အသံထုတ်), `chapter-editor.js`, `player.js`, `settings.js`။

## tests/
- `unit.mjs`, `i18n-check.mjs`, `api.mjs` — `npm test` ဖြင့် run နိုင်သည်။

## Deploy
zip ကို ဖြေ၍ repo ထဲ အကုန်ထည့်ပြီး push လုပ်ပါ။ Vercel တွင် `VOXCPM_SPACE`, `HF_TOKEN` (ရှိလျှင်) မူလအတိုင်း ဆက်သုံးနိုင်သည်။
