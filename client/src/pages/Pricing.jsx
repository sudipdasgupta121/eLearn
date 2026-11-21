import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../AuthContext.jsx'
import PaymentModal from '../components/PaymentModal.jsx'

export default function Pricing() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [plans, setPlans] = useState([])
  const [sub, setSub] = useState(null)
  const [cycle, setCycle] = useState('monthly')
  const [paying, setPaying] = useState(null)
  const [msg, setMsg] = useState(null)

  const loadSub = () => (user ? api('/subscription').then((d) => setSub(d.subscription)) : setSub(null))
  useEffect(() => { api('/plans').then(setPlans) }, [])
  useEffect(() => { loadSub() }, [user])

  const price = (p) => (cycle === 'yearly' ? p.price_yearly : p.price_monthly)
  const active = sub?.status === 'active' ? sub : null

  function label(p) {
    if (!active) return `Choose ${p.name}`
    if (p.id === active.plan_id && cycle === active.cycle) return 'Current plan'
    const up = p.rank > active.plan_rank || (p.rank === active.plan_rank && cycle === 'yearly' && active.cycle === 'monthly')
    return up ? `Upgrade to ${p.name}` : `Downgrade to ${p.name}`
  }

  async function choose(p) {
    setMsg(null)
    if (!user) return nav('/login', { state: { from: '/pricing' } })
    if (!active) return setPaying(p)
    try {
      const r = await api('/subscription/change', { method: 'POST', body: { planId: p.id, cycle } })
      setSub(r.subscription)
      setMsg({ ok: true, text: r.type === 'upgrade'
        ? `Upgraded to ${p.name}. Charged $${r.charged.toFixed(2)} (unused time on your old plan was credited).`
        : `Downgrade to ${p.name} scheduled for ${fmtDate(r.effectiveAt)}. You keep your current benefits until then.` })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }

  async function subscribe(card) {
    const r = await api('/subscription/subscribe', { method: 'POST', body: { planId: paying.id, cycle, card } })
    setSub(r.subscription); setPaying(null)
    nav('/account')
  }

  return (
    <div className="container page">
      <div className="center">
        <h1>Simple plans, unlimited learning</h1>
        <p className="muted">Each plan unlocks every course in its tier and below. Change or cancel anytime.</p>
        <div className="toggle">
          <button className={cycle === 'monthly' ? 'on' : ''} onClick={() => setCycle('monthly')}>Monthly</button>
          <button className={cycle === 'yearly' ? 'on' : ''} onClick={() => setCycle('yearly')}>Yearly <small>2 months free</small></button>
        </div>
      </div>
      {sub?.status === 'expired' && <div className="alert alert-warn">Your subscription expired. Pick a plan to get access to your courses again, or <Link to="/account">renew from your account</Link>.</div>}
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text} {msg.ok && <Link to="/account">Manage subscription</Link>}</div>}
      <div className="plans">
        {plans.map((p) => {
          const current = active && p.id === active.plan_id && cycle === active.cycle
          return (
            <div key={p.id} className={`card plan ${p.rank === 2 ? 'featured' : ''} ${current ? 'current' : ''}`}>
              {p.rank === 2 && <span className="ribbon">Most popular</span>}
              <h2>{p.name}</h2>
              <p className="muted">{p.description}</p>
              <div className="plan-price">${price(p)}<small>/{cycle === 'yearly' ? 'year' : 'month'}</small></div>
              <ul>{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
              <button className={`btn ${p.rank === 2 ? 'btn-primary' : 'btn-outline'} btn-block`} disabled={current} onClick={() => choose(p)}>{label(p)}</button>
            </div>
          )
        })}
      </div>
      {paying && (
        <PaymentModal title={`Subscribe to ${paying.name}`} summary={`${cycle === 'yearly' ? 'Yearly' : 'Monthly'} plan. Renews automatically; cancel anytime.`}
          amount={price(paying)} confirmLabel="Subscribe" onSubmit={subscribe} onClose={() => setPaying(null)} />
      )}
    </div>
  )
}
