export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="KájovoDagmar — docházkový systém">
    <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
    <span className="brand__copy"><strong>KájovoDagmar</strong><small>DOCHÁZKOVÝ SYSTÉM</small></span>
  </div>;
}
