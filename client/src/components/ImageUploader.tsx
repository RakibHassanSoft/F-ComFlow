// Product photo uploader — up to N images, uploaded straight to Cloudinary.
// The parent owns the array of image URLs; this component just adds/removes.
'use client';
import { useRef, useState } from 'react';
import { ImagePlus, X, Loader2 } from 'lucide-react';
import { uploadImage } from '@/lib/upload';

export function ImageUploader({
  images, onChange, max = 3,
}: {
  images: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr('');
    const chosen = Array.from(files).slice(0, max - images.length);
    if (chosen.length === 0) { setErr(`You can add up to ${max} photos`); return; }
    setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const f of chosen) uploaded.push(await uploadImage(f));
      onChange([...images, ...uploaded]);
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        Photos <span className="font-normal text-slate-400">— up to {max}, first is the main image</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={src} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
            <button
              type="button"
              onClick={() => onChange(images.filter((_, idx) => idx !== i))}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-slate-500 shadow ring-1 ring-slate-200 hover:text-red-600"
              aria-label="Remove photo"
            >
              <X size={14} />
            </button>
            {i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">MAIN</span>
            )}
          </div>
        ))}
        {images.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            <span className="text-[10px]">{busy ? 'Uploading' : 'Add photo'}</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
