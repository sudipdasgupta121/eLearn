import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../AuthContext.jsx'

const KIND = {
  course_purchase: 'Course purchase', subscription_new: 'New subscription',
  subscription_upgrade: 'Upgrade', subscription_renewal: 'Renewal',
}

export default function Account() {
  const { user } = useAuth()
  const [sub, setSub] = useState(undefined)
  const [payments, setPayments] = useState([])
  const [msg, setMsg] = useState(null)
  const [demo, setDemo] = useState(false)

  const loadPayments = () => api('/payments').then(setPayments)
  useEffect(() => { api('/config').then((c) => setDemo(c.demoTools)).catch(() => {}); api('/subscription').then((d) => setSub(d.subscription)); loadPayments() }, [])

  async function act(path, okText, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    setMsg(null)
    try {
      const r = await api(`/subscription/${path}`, { method: 'POST', body: {} })
      setSub(r.subscription); loadPayments(); setMsg({ ok: true, text: okText })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }

  if (sub === undefined) return <div className="container page"><p className="muted">Loading…</p></div>
  const active = sub?.status === 'active'
  const price = sub && (sub.cycle === 'yearly' ? sub.price_yearly : sub.price_monthly)

  return (
    <div className="container page narrow">
      <h1>My account</h1>
      <p className="muted">{user.name} · {user.email}</p>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}

      <h2>Subscription</h2>
      {!sub ? (
        <div className="card empty"><p>You don't have a subscription yet.</p><Link className="btn btn-primary" to="/pricing">View plans</Link></div>
      ) : (
        <div className="card sub-card">
          <div className="row between">
            <div>
              <h3>{sub.plan_name} plan <span className={`pill ${active ? (sub.cancel_at_period_end ? 'pill-warn' : 'pill-ok') : 'pill-bad'}`}>
                {!active ? 'Expired' : sub.cancel_at_period_end ? 'Cancelling' : 'Active'}</span></h3>
              <p className="muted">${price}/{sub.cycle === 'yearly' ? 'year' : 'month'} · billed {sub.cycle}{sub.card_last4 && ` · card •••• ${sub.card_last4}`}</p>
            </div>
          </div>
          <dl className="kv">
            <div><dt>Current period</dt><dd>{fmtDate(sub.period_start)} – {fmtDate(sub.period_end)}</dd></div>
            <div><dt>{!active ? 'Expired on' : sub.cancel_at_period_end ? 'Access ends' : 'Next renewal'}</dt><dd>{fmtDate(sub.period_end)}</dd></div>
          </dl>
          {active && sub.cancel_at_period_end && <div className="alert alert-warn">Your plan will not renew. You keep access until {fmtDate(sub.period_end)}.</div>}
          {active && sub.pending_plan_id && (
            <div className="alert alert-info">Scheduled change: switching to <b>{sub.pending_plan_name}</b> ({sub.pending_cycle}) on {fmtDate(sub.period_end)}.
              {' '}<button className="link" onClick={() => act('cancel-change', 'Scheduled plan change removed.')}>Undo</button></div>
          )}
          {!active && <div className="alert alert-error">Your subscription has expired. Courses you enrolled in through it are locked.</div>}
          <div className="row gap wrap">
            {active && <Link className="btn btn-primary" to="/pricing">Upgrade / downgrade</Link>}
            {!active && <button className="btn btn-primary" onClick={() => act('renew', 'Subscription renewed. Welcome back!')}>Renew ${price}</button>}
            {active && !sub.cancel_at_period_end && <button className="btn btn-outline" onClick={() => act('renew', 'Renewed early: one more billing period was added.', `Renew early for $${price}? An extra ${sub.cycle === 'yearly' ? 'year' : 'month'} will be added.`)}>Renew early</button>}
            {active && sub.cancel_at_period_end && <button className="btn btn-primary" onClick={() => act('resume', 'Subscription resumed.')}>Resume subscription</button>}
            {active && !sub.cancel_at_period_end && <button className="btn btn-danger" onClick={() => act('cancel', 'Cancellation scheduled.', 'Cancel your subscription? You keep access until the end of the billing period.')}>Cancel subscription</button>}
            {!active && <Link className="btn btn-outline" to="/pricing">Choose a different plan</Link>}
          </div>
          {active && demo && (
            <p className="hint demo">
              Demo tool: <button className="link" onClick={() => act('demo-expire', 'Billing period ended. Pending changes / renewal / expiry have been applied.')}>Fast-forward to end of billing period</button>
            </p>
          )}
        </div>
      )}

      <h2>Payment history</h2>
      {payments.length === 0 ? <p className="muted">No payments yet.</p> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="r">Amount</th></tr></thead>
          <tbody>{payments.map((p) => (
            <tr key={p.id}><td>{fmtDate(p.created_at)}</td><td>{KIND[p.kind] || p.kind}</td><td>{p.description}</td><td className="r">${Number(p.amount).toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
