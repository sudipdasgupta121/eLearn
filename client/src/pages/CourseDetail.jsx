import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../api'
import { useAuth } from '../AuthContext.jsx'
import PaymentModal from '../components/PaymentModal.jsx'

export default function CourseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => api(`/courses/${id}`).then(setD).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id, user])

  if (error) return <div className="container page"><div className="alert alert-error">{error}</div><Link to="/courses">← Back to courses</Link></div>
  if (!d) return <div className="container page"><p className="muted">Loading…</p></div>
  const { course: c, lessons, tierPlan } = d

  const needLogin = () => nav('/login', { state: { from: `/courses/${id}` } })
  async function buy(card) {
    await api(`/courses/${id}/purchase`, { method: 'POST', body: { card } })
    nav(`/learn/${id}`)
  }
  async function enroll() {
    setBusy(true); setError('')
    try { await api(`/courses/${id}/enroll`, { method: 'POST' }); nav(`/learn/${id}`) }
    catch (e) { setError(e.message); setBusy(false) }
  }

  let actions
  if (d.access) {
    actions = <Link className="btn btn-primary btn-lg" to={`/learn/${id}`}>Go to course</Link>
  } else {
    actions = (
      <>
        {d.enrolled && <div className="alert alert-warn">Your subscription no longer covers this course. Renew your plan or buy the course to keep access.</div>}
        {user && d.includedInPlan && !d.enrolled && (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={enroll}>Enroll free with your plan</button>
        )}
        <button className={`btn btn-lg ${d.includedInPlan && !d.enrolled ? 'btn-outline' : 'btn-primary'}`} onClick={() => (user ? setPaying(true) : needLogin())}>
          Buy this course · {money(c.price)}
        </button>
        {!d.includedInPlan && (
          <p className="small">Or get it with the <Link to="/pricing"><b>{tierPlan?.name}</b> plan or higher</Link> along with other courses.</p>
        )}
      </>
    )
  }

  return (
    <>
      <section className="detail-hero" style={{ background: `linear-gradient(135deg, ${c.color}, #1e1b4b)` }}>
        <div className="container detail-in">
          <div>
            <div className="tags"><span className="tag tag-dark">{c.category}</span><span className="tag tag-dark">{c.level}</span></div>
            <h1>{c.emoji} {c.title}</h1>
            <p className="lead">{c.description}</p>
            <p>⭐ {Number(c.rating).toFixed(1)} · {c.students.toLocaleString()} learners · {c.hours} hours · by <b>{c.instructor}</b></p>
          </div>
          <aside className="card buy-box">
            <div className="price big">{money(c.price)}</div>
            <p className="muted small">One-time purchase · lifetime access<br />Included in {tierPlan?.name} plan &amp; above</p>
            {error && <div className="alert alert-error">{error}</div>}
            {actions}
          </aside>
        </div>
      </section>
      <div className="container page">
        <h2>Course content</h2>
        <p className="muted">{lessons.length} lessons · {lessons.reduce((a, l) => a + l.minutes, 0)} min</p>
        <ol className="syllabus">
          {lessons.map((l) => <li key={l.id}><span>{l.position}. {l.title}</span><span className="muted">{l.minutes} min</span></li>)}
        </ol>
      </div>
      {paying && (
        <PaymentModal title="Complete your purchase" summary={c.title} amount={c.price} onSubmit={buy} onClose={() => setPaying(false)} />
      )}
    </>
  )
}
