import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "../shared/types";
import {
  clearCustomRingtone,
  hasCustomRingtone,
  ringer,
  setCustomRingtone,
} from "../lib/ringer";
import { Avatar } from "./Avatar";
import { CloseIcon, SpinnerIcon } from "./Icons";

interface Props {
  user: AuthUser;
  open: boolean;
  onClose: () => void;
  onSave: (input: Omit<AuthUser, "id" | "username" | "online" | "lastSeen">) => Promise<void>;
}

async function imageDataUrl(file: File): Promise<string> {
  const allowedTypes = new Set(["image/jpeg", "image/png"]);
  const allowedExtension = /\.(jpe?g|png)$/i.test(file.name);
  if (!allowedTypes.has(file.type) || !allowedExtension) {
    throw new Error("Only JPG, JPEG, and PNG profile images are allowed.");
  }
  const bitmap = await createImageBitmap(file);
  const size = Math.min(512, Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process this image.");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function ProfileSettings({ user, open, onClose, onSave }: Props) {
  const [name, setName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [phone, setPhone] = useState(user.phoneNumber);
  const [social, setSocial] = useState(user.social);
  const [visibility, setVisibility] = useState(user.visibility);
  const [ringtoneSet, setRingtoneSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(user.displayName);
    setAvatarUrl(user.avatarUrl);
    setPhone(user.phoneNumber);
    setSocial(user.social);
    setVisibility(user.visibility);
    setError("");
    void hasCustomRingtone().then(setRingtoneSet);
  }, [open, user]);

  if (!open) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ displayName: name.trim(), avatarUrl, phoneNumber: phone.trim(), social, visibility });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = () => {
    ringer.stop();
    void ringer.start(false);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => ringer.stop(), 4500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Profile and settings">
      <form onSubmit={save} className="scroll-slim max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-ink-900 shadow-2xl ring-1 ring-white/10 sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink-900/95 px-5 py-4 backdrop-blur">
          <div><h2 className="font-semibold">Profile & settings</h2><p className="text-xs text-slate-400">Control what other callers can see.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close"><CloseIcon className="h-5 w-5" /></button>
        </header>

        <div className="space-y-6 p-5">
          {error && <p className="rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <section className="flex items-center gap-4">
            <label className="group relative shrink-0 cursor-pointer rounded-full focus-within:ring-2 focus-within:ring-accent-400 focus-within:ring-offset-2 focus-within:ring-offset-ink-900" title="Upload profile image">
              <Avatar src={avatarUrl} name={name} id={user.id} size="h-20 w-20" ring />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-xs font-semibold text-transparent transition group-hover:bg-black/60 group-hover:text-white">Change</span>
              <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="sr-only" aria-label="Upload JPG or PNG profile image" onChange={(event) => { const file = event.target.files?.[0]; if (file) void imageDataUrl(file).then(setAvatarUrl).catch((err) => setError(err.message)); event.target.value = ""; }} />
            </label>
            <div><p className="text-sm font-medium">Profile image</p><p className="mt-1 text-xs text-slate-500">Click the image to upload a JPG or PNG. It will fill and crop to the 512 × 512 frame.</p></div>
          </section>

          <label className="block text-sm font-medium">Display name<input className="field mt-2" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required /></label>

          <section className="space-y-3 rounded-xl bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-4"><label className="text-sm font-medium" htmlFor="phone">Phone number</label><Visibility checked={visibility.phone} onChange={(phoneVisible) => setVisibility((v) => ({ ...v, phone: phoneVisible }))} /></div>
            <input id="phone" className="field" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" maxLength={20} />
          </section>

          <section className="space-y-3 rounded-xl bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-medium">Social info</h3><Visibility checked={visibility.social} onChange={(socialVisible) => setVisibility((v) => ({ ...v, social: socialVisible }))} /></div>
            <textarea className="field min-h-20 resize-y" value={social.bio} onChange={(e) => setSocial((s) => ({ ...s, bio: e.target.value }))} placeholder="Short bio" maxLength={240} />
            <input className="field" value={social.website} onChange={(e) => setSocial((s) => ({ ...s, website: e.target.value }))} placeholder="Website" maxLength={200} />
            <input className="field" value={social.instagram} onChange={(e) => setSocial((s) => ({ ...s, instagram: e.target.value }))} placeholder="Instagram username" maxLength={80} />
            <input className="field" value={social.linkedin} onChange={(e) => setSocial((s) => ({ ...s, linkedin: e.target.value }))} placeholder="LinkedIn URL" maxLength={200} />
          </section>

          <section className="space-y-3 rounded-xl bg-white/[0.04] p-4">
            <div><h3 className="text-sm font-medium">Ringtone</h3><p className="text-xs text-slate-500">Stored privately on this browser. MP3, WAV, M4A, or OGG up to 8 MB.</p></div>
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary cursor-pointer text-sm">Choose audio<input type="file" accept="audio/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void setCustomRingtone(file).then(() => { setRingtoneSet(true); setError(""); }).catch((err) => setError(err.message)); }} /></label>
              <button type="button" onClick={preview} className="btn-secondary text-sm">Preview</button>
              {ringtoneSet && <button type="button" onClick={() => void clearCustomRingtone().then(() => setRingtoneSet(false))} className="rounded-xl px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">Use default</button>}
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-white/10 bg-ink-900/95 p-4 backdrop-blur"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="submit" disabled={busy} className="btn-primary">{busy ? <SpinnerIcon className="h-5 w-5" /> : "Save changes"}</button></footer>
      </form>
    </div>
  );
}

function Visibility({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"><span>{checked ? "Visible to everyone" : "Private"}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-violet-500" /></label>;
}
