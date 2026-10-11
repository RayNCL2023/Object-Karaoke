// Small browser helpers for the server API. Import what you need: import { gemma, speak } from "./api.js";

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${url} ${res.status}`);
  return res;
}

/** Ask Gemma 4. Returns { text, json? }. image: a File/Blob (optional). */
export async function gemma(prompt, { json = false, image } = {}) {
  const body = { prompt, json };
  if (image) body.image = { data: await toBase64(image), mime: image.type || "image/png" };
  return (await post("/api/gemma", body)).json();
}

/** Text to speech. Returns an object URL you can play: new Audio(url).play(). */
export async function speak(text, voice) {
  return URL.createObjectURL(await (await post("/api/speak", { text, voice })).blob());
}

/** Sound effect from a description. Returns an object URL. */
export async function sfx(prompt, seconds = 2) {
  return URL.createObjectURL(await (await post("/api/sfx", { prompt, seconds })).blob());
}

export const voices = async () => (await fetch("/api/voices")).json();
export const remember = async (text) => (await post("/api/memory/remember", { text })).json();
export const recall = async (query) => (await post("/api/memory/search", { query })).json();
export const listMemories = async () => (await fetch("/api/memory/list")).json();
export const status = async () => (await fetch("/api/status")).json();

/** Listen for phone events. handler gets the object the phone sent, e.g. { type: "pad", pad: 3 }. */
export function onPhone(handler) {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => handler(JSON.parse(e.data));
  return () => es.close();
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
