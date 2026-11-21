import { useState } from 'react'

export default function PaymentModal({ title, summary, amount, confirmLabel = 'Pay now', onSubmit, onClose }) {
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', expiry: `12/${(new Date().getFullYear() + 3) % 100}`, cvc: '123' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setCard({ ...card, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await onSubmit(card) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        <p className="muted">{summary}</p>
        <div className="total"><span>Total today</span><strong>${Number(amount).toFixed(2)}</strong></div>
        <label>Card number<input value={card.number} onChange={set('number')} inputMode="numeric" autoComplete="off" /></label>
        <div className="grid2">
          <label>Expiry (MM/YY)<input value={card.expiry} onChange={set('expiry')} /></label>
          <label>CVC<input value={card.cvc} onChange={set('cvc')} /></label>
        </div>
        <p className="hint">Demo mode: use the prefilled test card. Use <code>4000 0000 0000 0002</code> to simulate a declined payment. No real charge is made.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row gap">
          <button className="btn btn-primary grow" disabled={busy}>{busy ? 'Processing…' : `${confirmLabel} · $${Number(amount).toFixed(2)}`}</button>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
