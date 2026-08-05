export default function LibraryModalHeader({ icon: Icon, eyebrow, title }) {
  return (
    <div className="song-recordings-modal-head library-row">
      <div className="song-recordings-modal-icon">
        <Icon size={21} />
      </div>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
  );
}
