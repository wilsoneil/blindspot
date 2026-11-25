// Shown the moment a link is tapped, while the next page loads (most pages read the
// database first, so they can take a moment).

export default function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}
