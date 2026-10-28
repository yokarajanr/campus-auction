// Shows the whole photo (never cropped) over a blurred copy of itself, so any aspect ratio fills the frame cleanly.
export function Photo({ src, alt, lazy = false }: { src?: string; alt: string; lazy?: boolean }) {
  if (!src) return <span className="photo-missing">No photo</span>;
  return (
    <>
      <span className="photo-backdrop" style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" />
      <img className="photo-img" src={src} alt={alt} loading={lazy ? 'lazy' : undefined} decoding="async" />
    </>
  );
}
